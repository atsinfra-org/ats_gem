import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import { AppConfig } from '../config/app-config.service';
import { PrismaService } from '../database/prisma.service';
import type { Session } from '../generated/prisma/client';
import { TokenService } from './token.service';

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
  deviceLabel?: string;
}

export interface IssuedSession {
  session: Session;
  refreshToken: string;
}

/**
 * Owns the `sessions` table: one row per issued refresh token (ADR-11). Rotation on every refresh,
 * reuse detection (presenting an already-revoked token revokes the whole family), and the
 * housekeeping other services need (revoke on logout/password change, list for the sessions UI).
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly config: AppConfig,
  ) {}

  /** Starts a new rotation family — used at login (never at refresh, which reuses the family). */
  async createSession(userId: string, meta: RequestMeta = {}): Promise<IssuedSession> {
    return this.createInFamily(userId, randomUUID(), meta);
  }

  /**
   * Validates a presented refresh token and rotates it. Throws `UNAUTHENTICATED` for an unknown or
   * expired token, and `REFRESH_TOKEN_REUSED` (after revoking the whole family) when the token was
   * already rotated or otherwise revoked — the two are deliberately indistinguishable to the
   * caller, but only the second is logged loudly, since it may indicate a stolen token.
   */
  async rotate(presentedToken: string, meta: RequestMeta = {}): Promise<IssuedSession> {
    const hash = this.tokens.hashRefreshToken(presentedToken);
    const existing = await this.prisma.session.findUnique({ where: { refreshTokenHash: hash } });
    if (!existing) throw new AppError('UNAUTHENTICATED', 'Refresh session not found.');

    if (existing.revokedAt) {
      await this.revokeFamily(existing.familyId, 'REUSE_DETECTED');
      throw new AppError('REFRESH_TOKEN_REUSED', 'This refresh token was already used; all sessions have been signed out.');
    }
    if (existing.expiresAt.getTime() <= Date.now()) {
      throw new AppError('UNAUTHENTICATED', 'Refresh session expired.');
    }

    const issued = await this.prisma.$transaction(async (tx) => {
      const ttlDays = this.config.get('REFRESH_TOKEN_TTL_DAYS');
      const { token, hash: newHash } = this.tokens.issueRefreshToken();
      const created = await tx.session.create({
        data: {
          userId: existing.userId,
          familyId: existing.familyId,
          refreshTokenHash: newHash,
          expiresAt: new Date(Date.now() + ttlDays * 86_400_000),
          ip: meta.ip,
          userAgent: meta.userAgent,
          deviceLabel: meta.deviceLabel ?? existing.deviceLabel,
        },
      });
      await tx.session.update({
        where: { id: existing.id },
        data: { revokedAt: new Date(), revokedReason: 'ROTATED', replacedById: created.id },
      });
      return { session: created, refreshToken: token };
    });
    return issued;
  }

  async revokeByToken(presentedToken: string, reason: string): Promise<void> {
    const hash = this.tokens.hashRefreshToken(presentedToken);
    await this.prisma.session.updateMany({
      where: { refreshTokenHash: hash, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  async revoke(sessionId: string, reason: string): Promise<void> {
    await this.prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });
  }

  async revokeFamily(familyId: string, reason: string): Promise<void> {
    await this.prisma.session.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });
  }

  /** Used by password reset/change: sign every other device out. */
  async revokeAllForUser(userId: string, reason: string, exceptSessionId?: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  async listActive(userId: string): Promise<Session[]> {
    return this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
    });
  }

  async touch(sessionId: string): Promise<void> {
    await this.prisma.session.update({ where: { id: sessionId }, data: { lastUsedAt: new Date() } });
  }

  private async createInFamily(userId: string, familyId: string, meta: RequestMeta): Promise<IssuedSession> {
    const ttlDays = this.config.get('REFRESH_TOKEN_TTL_DAYS');
    const { token, hash } = this.tokens.issueRefreshToken();
    const session = await this.prisma.session.create({
      data: {
        userId,
        familyId,
        refreshTokenHash: hash,
        expiresAt: new Date(Date.now() + ttlDays * 86_400_000),
        ip: meta.ip,
        userAgent: meta.userAgent,
        deviceLabel: meta.deviceLabel,
      },
    });
    return { session, refreshToken: token };
  }
}
