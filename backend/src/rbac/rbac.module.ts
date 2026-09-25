import { Global, Module } from '@nestjs/common';
import { OrgRoleGuard } from './org-role.guard';
import { PermissionsGuard } from './permissions.guard';
import { PermissionsService } from './permissions.service';

/**
 * Provides the RBAC building blocks everywhere. The guards are *not* registered as global
 * `APP_GUARD`s here — `ApiModule` does that explicitly, in the order authentication → permissions
 * → org role, since NestJS runs global guards in declaration order and `req.user` must exist
 * before either of these can check it.
 */
@Global()
@Module({
  providers: [PermissionsService, PermissionsGuard, OrgRoleGuard],
  exports: [PermissionsService, PermissionsGuard, OrgRoleGuard],
})
export class RbacModule {}
