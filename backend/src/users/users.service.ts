import { Injectable } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import { PrismaService } from '../database/prisma.service';
import { PermissionsService } from '../rbac/permissions.service';
import type { UpdateProfileDto } from './dto/update-profile.dto';
import { toPublicUser, type PublicUser } from './user.mapper';

export interface MeProfile extends PublicUser {
  staffRoles: string[];
  organization: { id: string; name: string; slug: string; isPersonal: boolean };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  /**
   * Full profile shape returned by `GET /me`. Plan summary and entitlements
   * (docs/API-CONTRACT.md §4) are omitted — billing lands in Phase 8.
   */
  async getProfile(userId: string, organizationId: string): Promise<MeProfile> {
    const [user, organization, staffRoles] = await Promise.all([
      this.prisma.user.findFirstOrThrow({ where: { id: userId, deletedAt: null } }),
      this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { id: true, name: true, slug: true, isPersonal: true } }),
      this.permissions.getStaffRoleKeys(userId),
    ]);
    return { ...toPublicUser(user), staffRoles, organization };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<PublicUser> {
    const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user) throw new AppError('NOT_FOUND', 'User not found.');
    const updated = await this.prisma.user.update({ where: { id: userId }, data: dto });
    return toPublicUser(updated);
  }
}
