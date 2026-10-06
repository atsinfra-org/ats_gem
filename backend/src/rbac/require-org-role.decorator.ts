import { SetMetadata } from '@nestjs/common';
import type { OrganizationRole } from '../generated/prisma/enums';

export const ORG_ROLE_KEY = 'ats:org-role';

/**
 * Requires at least this role in the caller's current organization (OWNER > MEMBER > VIEWER — see
 * `orgRoleSatisfies`). "Current organization" is the one in the access token's `org` claim; see
 * `docs/ARCHITECTURE.md` §17.4 for the single-active-organization simplification this implies.
 */
export const RequireOrgRole = (role: OrganizationRole): MethodDecorator => SetMetadata(ORG_ROLE_KEY, role);
