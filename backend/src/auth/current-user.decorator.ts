import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from './types';

/** Injects `req.user`, set by `JwtAuthGuard`. Only usable on routes that require authentication. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
  const req = ctx.switchToHttp().getRequest<Request>();
  if (!req.user) throw new Error('CurrentUser used on a route without JwtAuthGuard');
  return req.user;
});
