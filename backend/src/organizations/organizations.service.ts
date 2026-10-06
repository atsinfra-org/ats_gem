import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service';
import { AppError } from '../common/errors/app-error';
import { sha256Hex } from '../common/stable-json';
import { slugify, withRandomSuffix } from '../common/slugify';
import { PrismaService } from '../database/prisma.service';
import type { Organization, OrganizationMember, Prisma, User } from '../generated/prisma/client';
import { OutboxService } from '../outbox/outbox.service';
import type { InviteMemberDto } from './dto/invite-member.dto';
import type { UpdateOrganizationDto } from './dto/update-organization.dto';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60_000;

export interface MemberWithUser extends OrganizationMember {
  user: Pick<User, 'id' | 'name' | 'email' | 'avatarUrl'>;
}

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditLogService,
  ) {}

  /** Called once, inside the registration transaction (ADR-06: every user gets a personal workspace). */
  async createPersonalOrganization(tx: Prisma.TransactionClient, user: Pick<User, 'id' | 'name'>): Promise<Organization> {
    const slug = await this.uniqueSlug(tx, `${user.name}-workspace`);
    const organization = await tx.organization.create({ data: { name: `${user.name}'s Workspace`, slug, isPersonal: true } });
    await tx.organizationMember.create({ data: { organizationId: organization.id, userId: user.id, role: 'OWNER' } });
    await this.outbox.record(tx, 'organization.created', { organizationId: organization.id, ownerUserId: user.id });
    return organization;
  }

  /** Every user has exactly one personal organization; see docs/ARCHITECTURE.md §17.4. */
  async resolvePersonalOrganizationId(userId: string): Promise<string> {
    const organization = await this.prisma.organization.findFirst({
      where: { isPersonal: true, members: { some: { userId, role: 'OWNER' } } },
      select: { id: true },
    });
    if (!organization) throw new Error(`User ${userId} has no personal organization — registration invariant violated`);
    return organization.id;
  }

  async getCurrent(organizationId: string): Promise<Organization> {
    return this.requireOrganization(organizationId);
  }

  async updateCurrent(organizationId: string, dto: UpdateOrganizationDto, actorUserId: string): Promise<Organization> {
    const before = await this.requireOrganization(organizationId);
    const organization = await this.prisma.organization.update({ where: { id: organizationId }, data: dto });
    await this.audit.record({
      actorUserId,
      organizationId,
      action: 'ORGANIZATION_UPDATED',
      resourceType: 'organization',
      resourceId: organizationId,
      oldValue: before,
      newValue: organization,
    });
    return organization;
  }

  async listMembers(organizationId: string): Promise<MemberWithUser[]> {
    await this.requireOrganization(organizationId);
    return this.prisma.organizationMember.findMany({
      where: { organizationId },
      include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
      orderBy: { joinedAt: 'asc' },
    });
  }

  /** Returns the raw invitation token — the caller enqueues the email; it is never stored. */
  async inviteMember(organizationId: string, dto: InviteMemberDto, inviter: Pick<User, 'id'>): Promise<{ token: string; expiresAt: Date }> {
    await this.requireOrganization(organizationId);
    const email = dto.email.toLowerCase();

    const existingUser = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existingUser) {
      const alreadyMember = await this.prisma.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId, userId: existingUser.id } },
      });
      if (alreadyMember) throw new AppError('ALREADY_MEMBER', 'This person is already a member of the organization.');
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
    await this.prisma.$transaction([
      // Re-inviting replaces any invitation still pending, rather than erroring.
      this.prisma.organizationInvitation.deleteMany({ where: { organizationId, email, acceptedAt: null } }),
      this.prisma.organizationInvitation.create({
        data: { organizationId, email, role: dto.role, tokenHash: sha256Hex(token), invitedBy: inviter.id, expiresAt },
      }),
    ]);
    return { token, expiresAt };
  }

  async acceptInvitation(token: string, user: Pick<User, 'id' | 'email'>): Promise<MemberWithUser> {
    const invitation = await this.prisma.organizationInvitation.findUnique({ where: { tokenHash: sha256Hex(token) } });
    if (!invitation) throw new AppError('TOKEN_INVALID_OR_EXPIRED', 'This invitation is invalid or has expired.');
    if (invitation.email.toLowerCase() !== user.email.toLowerCase()) {
      throw new AppError('FORBIDDEN', 'This invitation cannot be accepted with the signed-in account.');
    }

    // Checked before the expiry/already-accepted guard below, so accepting the same invitation
    // twice (e.g. the user clicks the email link again) is idempotent rather than an error.
    const existing = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: invitation.organizationId, userId: user.id } },
      include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
    });
    if (existing) {
      if (!invitation.acceptedAt) await this.prisma.organizationInvitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } });
      return existing;
    }

    if (invitation.acceptedAt || invitation.expiresAt.getTime() <= Date.now()) {
      throw new AppError('TOKEN_INVALID_OR_EXPIRED', 'This invitation is invalid or has expired.');
    }

    const [member] = await this.prisma.$transaction([
      this.prisma.organizationMember.create({
        data: { organizationId: invitation.organizationId, userId: user.id, role: invitation.role },
        include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
      }),
      this.prisma.organizationInvitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } }),
    ]);
    await this.audit.record({
      actorUserId: user.id,
      organizationId: invitation.organizationId,
      action: 'ORGANIZATION_MEMBER_JOINED',
      resourceType: 'organization_member',
      resourceId: user.id,
    });
    return member;
  }

  async updateMemberRole(organizationId: string, targetUserId: string, role: 'MEMBER' | 'VIEWER', actorUserId: string): Promise<OrganizationMember> {
    const membership = await this.requireMember(organizationId, targetUserId);
    if (membership.role === 'OWNER') throw new AppError('FORBIDDEN', 'The organization owner’s role cannot be changed here.');

    const updated = await this.prisma.organizationMember.update({
      where: { organizationId_userId: { organizationId, userId: targetUserId } },
      data: { role },
    });
    await this.audit.record({
      actorUserId,
      organizationId,
      action: 'ORGANIZATION_MEMBER_ROLE_CHANGED',
      resourceType: 'organization_member',
      resourceId: targetUserId,
      oldValue: { role: membership.role },
      newValue: { role: updated.role },
    });
    return updated;
  }

  async removeMember(organizationId: string, targetUserId: string, actorUserId: string): Promise<void> {
    const membership = await this.requireMember(organizationId, targetUserId);
    if (membership.role === 'OWNER') throw new AppError('FORBIDDEN', 'The organization owner cannot be removed.');

    await this.prisma.organizationMember.delete({ where: { organizationId_userId: { organizationId, userId: targetUserId } } });
    await this.audit.record({
      actorUserId,
      organizationId,
      action: 'ORGANIZATION_MEMBER_REMOVED',
      resourceType: 'organization_member',
      resourceId: targetUserId,
    });
  }

  private async requireOrganization(organizationId: string): Promise<Organization> {
    const organization = await this.prisma.organization.findFirst({ where: { id: organizationId, deletedAt: null } });
    if (!organization) throw new AppError('ORGANIZATION_NOT_FOUND', 'Organization not found.');
    return organization;
  }

  private async requireMember(organizationId: string, userId: string): Promise<OrganizationMember> {
    const membership = await this.prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId, userId } } });
    if (!membership) throw new AppError('NOT_FOUND', 'This person is not a member of the organization.');
    return membership;
  }

  private async uniqueSlug(tx: Prisma.TransactionClient, seed: string): Promise<string> {
    const base = slugify(seed);
    const existing = await tx.organization.findUnique({ where: { slug: base }, select: { slug: true } });
    return existing ? withRandomSuffix(base) : base;
  }
}
