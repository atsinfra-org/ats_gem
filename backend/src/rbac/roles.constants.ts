import type { OrganizationRole } from '../generated/prisma/enums';

/**
 * Staff/platform roles (ADR-07). Ordinary customers hold none of these — their access comes only
 * from `organization_members.role` (below) plus their organization's subscription entitlements
 * (Phase 8). These are seed data (`roles` table), never hard-coded checks; this list exists so
 * `SeedService` and tests have one place to read it from.
 */
export const STAFF_ROLE_KEYS = ['SUPER_ADMIN', 'ADMIN', 'MODERATOR', 'CRAWLER_MANAGER', 'SUPPORT'] as const;
export type StaffRoleKey = (typeof STAFF_ROLE_KEYS)[number];

/** Starter permission set (Phase 9 owns the full admin surface). Keys are free-form, seeded data. */
export const PERMISSION_KEYS = [
  'admin.access',
  'tender.update',
  'tender.flag',
  'source.manage',
  'user.suspend',
  'organization.view_all',
  'audit.view',
  'role.manage',
  'entity.merge',
  'duplicate.review',
  'tender.correct',
  'analytics.view',
] as const;
export type PermissionKey = (typeof PERMISSION_KEYS)[number];

/** Default role → permission grants, applied by `SeedService` (additive; never removes a grant an admin added). */
export const DEFAULT_ROLE_PERMISSIONS: Record<StaffRoleKey, readonly PermissionKey[]> = {
  SUPER_ADMIN: PERMISSION_KEYS,
  ADMIN: [
    'admin.access',
    'tender.update',
    'tender.flag',
    'source.manage',
    'user.suspend',
    'organization.view_all',
    'audit.view',
    'entity.merge',
    'duplicate.review',
    'tender.correct',
    'analytics.view',
  ],
  MODERATOR: ['admin.access', 'tender.flag', 'audit.view', 'duplicate.review'],
  CRAWLER_MANAGER: ['admin.access', 'source.manage'],
  SUPPORT: ['admin.access', 'organization.view_all', 'analytics.view'],
};

/**
 * Organization roles (ADR-07) — a separate axis from staff roles: OWNER (members, billing,
 * settings), MEMBER (full product use), VIEWER (read-only). `@RequireOrgRole('MEMBER')` accepts
 * MEMBER or OWNER; only OWNER-only actions require `@RequireOrgRole('OWNER')`.
 */
export const ORGANIZATION_ROLE_RANK: Record<OrganizationRole, number> = {
  VIEWER: 0,
  MEMBER: 1,
  OWNER: 2,
};

export function orgRoleSatisfies(actual: OrganizationRole, required: OrganizationRole): boolean {
  return ORGANIZATION_ROLE_RANK[actual] >= ORGANIZATION_ROLE_RANK[required];
}
