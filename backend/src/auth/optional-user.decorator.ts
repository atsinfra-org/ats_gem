import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from './types';

/** For `@Public()` routes that personalize their response when a valid token is present, but must
 * still work for anonymous callers. Never throws — resolves to `undefined` when signed out. */
export const OptionalUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthenticatedUser | undefined => {
  return ctx.switchToHttp().getRequest<Request>().user;
});
