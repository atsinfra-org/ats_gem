import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

/**
 * Reads staff roles/permissions from the database on every check (docs/ARCHITECTURE.md §5.4):
 * "a role's permission set is cached in Redis" in the target design, but Phase 2 queries directly —
 * these guards only run on staff-gated admin routes (low traffic relative to the public API), and
 * a real-time read means a permission an admin just revoked takes effect immediately rather than
 * waiting for a cache TTL. Caching can be added later without changing this interface.
 */
@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async getPermissionKeys(userId: string): Promise<Set<string>> {
    const rows = await this.prisma.userRole.findMany({
      where: { userId },
      select: { role: { select: { rolePermissions: { select: { permission: { select: { key: true } } } } } } },
    });
    const keys = new Set<string>();
    for (const { role } of rows) for (const rp of role.rolePermissions) keys.add(rp.permission.key);
    return keys;
  }

  async getStaffRoleKeys(userId: string): Promise<string[]> {
    const rows = await this.prisma.userRole.findMany({ where: { userId }, select: { role: { select: { key: true } } } });
    return rows.map((r) => r.role.key);
  }
}
