import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import { sha256Hex } from '../common/stable-json';
import { PrismaService } from '../database/prisma.service';
import type { AuthTokenType } from '../generated/prisma/enums';

/**
 * Single-use, hashed, expiring tokens for flows that need a link in an email: verify-email,
 * password reset and (from `OrganizationsService`) invitation acceptance. `docs/ARCHITECTURE.md`
 * §5.3 sets the lifetimes: password reset is short-lived because it grants an account takeover if
 * intercepted; verify-email only flips a flag, so it can be longer.
 */
export const AUTH_TOKEN_TTL_MS: Record<AuthTokenType, number> = {
  EMAIL_VERIFY: 24 * 60 * 60_000,
  PASSWORD_RESET: 30 * 60_000,
  ORG_INVITE: 7 * 24 * 60 * 60_000,
};

@Injectable()
export class AuthTokenService {
  constructor(private readonly prisma: PrismaService) {}

  /** Raw token is returned once, for the email link; only its hash is stored. */
  async issue(userId: string, type: AuthTokenType): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.prisma.authToken.create({
      data: { userId, type, tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + AUTH_TOKEN_TTL_MS[type]) },
    });
    return token;
  }

  /** Marks the token used and returns the user it belongs to. Single-use: a second call fails. */
  async consume(token: string, type: AuthTokenType): Promise<string> {
    const row = await this.prisma.authToken.findUnique({ where: { tokenHash: sha256Hex(token) } });
    if (!row || row.type !== type || row.usedAt || row.expiresAt.getTime() <= Date.now()) {
      throw new AppError('TOKEN_INVALID_OR_EXPIRED', 'This link is invalid or has expired.');
    }
    await this.prisma.authToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    return row.userId;
  }

  /** Invalidates any outstanding token of this type (e.g. requesting a new one supersedes the old). */
  async invalidateOutstanding(userId: string, type: AuthTokenType): Promise<void> {
    await this.prisma.authToken.updateMany({ where: { userId, type, usedAt: null }, data: { usedAt: new Date() } });
  }
}
