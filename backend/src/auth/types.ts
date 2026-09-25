/**
 * Access token claims (ADR-11): `sub` (user), `org` (the user's personal organization — see the
 * "current organization" note in docs/ARCHITECTURE.md §17.4), `roles` (staff role keys, empty for
 * ordinary customers), `sid` (the session row active when the token was minted; carried for audit
 * correlation only — access tokens are stateless and are never looked up in the database).
 */
export interface AccessTokenPayload {
  sub: string;
  org: string;
  roles: string[];
  sid: string;
}

/** `req.user` after `JwtAuthGuard` runs. */
export interface AuthenticatedUser {
  id: string;
  organizationId: string;
  staffRoles: string[];
  sessionId: string;
}

declare module 'express' {
  interface Request {
    user?: AuthenticatedUser;
  }
}
