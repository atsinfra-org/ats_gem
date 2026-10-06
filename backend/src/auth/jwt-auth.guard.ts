import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { TokenService } from './token.service';
import { IS_PUBLIC_KEY } from './public.decorator';

const BEARER_PREFIX = 'Bearer ';

/**
 * Global guard: every route requires a valid access token unless marked `@Public()`. This is a
 * deliberate fail-closed default ("backend authorization is mandatory") rather than an opt-in
 * `@UseGuards` per controller, so a route can never end up unauthenticated by omission.
 *
 * Verifies the JWT only — it does not query the database on every request. Account suspension and
 * role changes therefore take effect on the next token refresh (at most `JWT_ACCESS_TTL`, 15 min by
 * default) rather than instantly; `AuthService.refresh` re-checks the user's status on every
 * rotation, which is the actual enforcement point for anything longer-lived than that window.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;

    if (isPublic) {
      // Best-effort: a public route (e.g. tender search) may still personalize its response for a
      // signed-in caller. An absent, malformed or expired token is not an error here — it just
      // means the request proceeds anonymously; use `OptionalUser`, not `CurrentUser`, to read it.
      if (header?.startsWith(BEARER_PREFIX)) {
        try {
          const payload = this.tokens.verifyAccessToken(header.slice(BEARER_PREFIX.length));
          req.user = { id: payload.sub, organizationId: payload.org, staffRoles: payload.roles, sessionId: payload.sid };
        } catch {
          // Ignored: falls through as anonymous.
        }
      }
      return true;
    }

    if (!header?.startsWith(BEARER_PREFIX)) throw new UnauthorizedException();
    const payload = this.tokens.verifyAccessToken(header.slice(BEARER_PREFIX.length));
    req.user = { id: payload.sub, organizationId: payload.org, staffRoles: payload.roles, sessionId: payload.sid };
    return true;
  }
}
