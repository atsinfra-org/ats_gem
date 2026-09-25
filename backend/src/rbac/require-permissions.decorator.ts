import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from './roles.constants';

export const PERMISSIONS_KEY = 'ats:permissions';

/** Requires the caller's staff roles to grant every listed permission. See `PermissionsGuard`. */
export const RequirePermissions = (...keys: PermissionKey[]): MethodDecorator => SetMetadata(PERMISSIONS_KEY, keys);
