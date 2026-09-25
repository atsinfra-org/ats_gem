import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppError } from '../common/errors/app-error';
import { PermissionsService } from './permissions.service';
import { PERMISSIONS_KEY } from './require-permissions.decorator';

/**
 * Enforces `@RequirePermissions(...)`. Runs after `JwtAuthGuard` (registered later in the global
 * guard chain — see `ApiModule`), so `req.user` is already set; routes without the decorator are
 * unaffected (staff permissions are opt-in per route, unlike authentication which is opt-out).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);
    if (!required?.length) return true;

    const req = context.switchToHttp().getRequest<Request>();
    if (!req.user) throw new ForbiddenException();

    const granted = await this.permissions.getPermissionKeys(req.user.id);
    const missing = required.filter((key) => !granted.has(key));
    if (missing.length > 0) {
      throw new AppError('FORBIDDEN', 'You do not have permission to perform this action.', [
        { code: 'MISSING_PERMISSION', message: `Missing: ${missing.join(', ')}`, field: 'permissions' },
      ]);
    }
    return true;
  }
}
