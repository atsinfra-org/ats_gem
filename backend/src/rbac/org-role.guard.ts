import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppError } from '../common/errors/app-error';
import { PrismaService } from '../database/prisma.service';
import type { OrganizationRole } from '../generated/prisma/enums';
import { ORG_ROLE_KEY } from './require-org-role.decorator';
import { orgRoleSatisfies } from './roles.constants';

/** Enforces `@RequireOrgRole(...)` against the caller's membership in their current organization. */
@Injectable()
export class OrgRoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<OrganizationRole | undefined>(ORG_ROLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const req = context.switchToHttp().getRequest<Request>();
    if (!req.user) throw new ForbiddenException();

    const membership = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: req.user.organizationId, userId: req.user.id } },
    });
    if (!membership || !orgRoleSatisfies(membership.role, required)) {
      throw new AppError('FORBIDDEN', `This action requires the ${required} role in your organization.`);
    }
    return true;
  }
}
