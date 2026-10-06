import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types';
import { ApiPayload } from '../common/http/api-response';
import { AppConfig } from '../config/app-config.service';
import { PrismaService } from '../database/prisma.service';
import { QueueProducer } from '../queues/queue.producer';
import { RequireOrgRole } from '../rbac/require-org-role.decorator';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { OrganizationsService } from './organizations.service';

@ApiTags('organizations')
@ApiBearerAuth()
@Controller()
export class OrganizationsController {
  constructor(
    private readonly organizations: OrganizationsService,
    private readonly prisma: PrismaService,
    private readonly queue: QueueProducer,
    private readonly config: AppConfig,
  ) {}

  @Get('organizations/current')
  @RequireOrgRole('VIEWER')
  getCurrent(@CurrentUser() user: AuthenticatedUser) {
    return this.organizations.getCurrent(user.organizationId);
  }

  @Patch('organizations/current')
  @RequireOrgRole('OWNER')
  updateCurrent(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateOrganizationDto) {
    return this.organizations.updateCurrent(user.organizationId, dto, user.id);
  }

  @Get('organizations/current/members')
  @RequireOrgRole('VIEWER')
  listMembers(@CurrentUser() user: AuthenticatedUser) {
    return this.organizations.listMembers(user.organizationId);
  }

  @Post('organizations/current/invitations')
  @RequireOrgRole('OWNER')
  async invite(@CurrentUser() user: AuthenticatedUser, @Body() dto: InviteMemberDto) {
    const [organization, { token, expiresAt }] = await Promise.all([
      this.organizations.getCurrent(user.organizationId),
      this.organizations.inviteMember(user.organizationId, dto, { id: user.id }),
    ]);
    const inviteUrl = new URL('/invite', this.config.get('FRONTEND_URL'));
    inviteUrl.searchParams.set('token', token);
    await this.queue.enqueue('email.send', {
      to: dto.email,
      template: 'organization-invite',
      variables: { inviteUrl: inviteUrl.toString(), organizationName: organization.name },
    });
    return new ApiPayload({ invited: true, expiresAt: expiresAt.toISOString() });
  }

  @Patch('organizations/current/members/:userId')
  @RequireOrgRole('OWNER')
  updateMember(@CurrentUser() user: AuthenticatedUser, @Param('userId', ParseUUIDPipe) userId: string, @Body() dto: UpdateMemberDto) {
    return this.organizations.updateMemberRole(user.organizationId, userId, dto.role, user.id);
  }

  @Delete('organizations/current/members/:userId')
  @RequireOrgRole('OWNER')
  removeMember(@CurrentUser() user: AuthenticatedUser, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.organizations.removeMember(user.organizationId, userId, user.id);
  }

  /** Accepting an invitation is not scoped to the caller's current organization, so it bypasses `@RequireOrgRole`. */
  @Post('organizations/invitations/accept')
  async acceptInvitation(@CurrentUser() user: AuthenticatedUser, @Body() dto: AcceptInvitationDto) {
    const account = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { id: true, email: true } });
    return this.organizations.acceptInvitation(dto.token, account);
  }
}
