import { Injectable } from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service';
import { AppError } from '../common/errors/app-error';
import { AppConfig } from '../config/app-config.service';
import { PrismaService } from '../database/prisma.service';
import type { Session, User } from '../generated/prisma/client';
import { OrganizationsService } from '../organizations/organizations.service';
import { OutboxService } from '../outbox/outbox.service';
import { QueueProducer } from '../queues/queue.producer';
import { PermissionsService } from '../rbac/permissions.service';
import { toPublicUser, type PublicUser } from '../users/user.mapper';
import { AuthTokenService } from './auth-token.service';
import type { ChangePasswordDto } from './dto/change-password.dto';
import type { ForgotPasswordDto } from './dto/forgot-password.dto';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';
import type { ResetPasswordDto } from './dto/reset-password.dto';
import type { VerifyEmailDto } from './dto/verify-email.dto';
import { LoginThrottleService } from './login-throttle.service';
import { PasswordService } from './password.service';
import { type RequestMeta, SessionService } from './session.service';
import { CURRENT_TERMS_VERSION } from './terms.constants';
import type { IssuedAccessToken } from './token.service';
import { TokenService } from './token.service';

/** A precomputed Argon2id hash, verified on every login attempt against an unknown email so that
 * "no such account" and "wrong password" take the same amount of time (no user enumeration). */
const DUMMY_PASSWORD_HASH = '$argon2id$v=19$m=19456,t=2,p=1$JEQgJwS6RSW3qBwv1MHjWw$HJaV69nIzI/Auc3LvI9e/bMOO5U+Y36WmZDvxFjO0X4';

export interface AuthResult {
  user: PublicUser;
  organizationId: string;
  accessToken: IssuedAccessToken;
  session: Session;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly password: PasswordService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly authTokens: AuthTokenService,
    private readonly loginThrottle: LoginThrottleService,
    private readonly organizations: OrganizationsService,
    private readonly permissions: PermissionsService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditLogService,
    private readonly queue: QueueProducer,
    private readonly config: AppConfig,
  ) {}

  async register(dto: RegisterDto, meta: RequestMeta): Promise<AuthResult> {
    const email = dto.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw new AppError('EMAIL_ALREADY_REGISTERED', 'An account with this email already exists.');

    const passwordHash = await this.password.hash(dto.password);
    const { user, organizationId } = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { email, passwordHash, name: dto.name, termsAcceptedAt: new Date(), termsVersion: CURRENT_TERMS_VERSION },
      });
      const organization = await this.organizations.createPersonalOrganization(tx, created);
      await this.outbox.record(tx, 'user.created', { userId: created.id });
      return { user: created, organizationId: organization.id };
    });

    const { session, refreshToken } = await this.sessions.createSession(user.id, meta);
    const accessToken = await this.issueAccessToken(user.id, organizationId, session.id);
    await this.sendVerificationEmail(user);

    return { user: toPublicUser(user), organizationId, accessToken, session, refreshToken };
  }

  async login(dto: LoginDto, meta: RequestMeta): Promise<AuthResult> {
    const email = dto.email.toLowerCase();
    const ip = meta.ip ?? 'unknown';
    const throttle = await this.loginThrottle.check(ip, email);
    if (throttle.locked) {
      throw new AppError('ACCOUNT_LOCKED', 'Too many failed attempts. Try again later.', [
        { field: 'password', code: 'TOO_MANY_ATTEMPTS', message: 'Account temporarily locked.', retryAt: throttle.retryAt?.toISOString() },
      ]);
    }

    const user = await this.prisma.user.findFirst({ where: { email, deletedAt: null } });
    const passwordOk = await this.password.verify(user?.passwordHash ?? DUMMY_PASSWORD_HASH, dto.password);
    if (!user?.passwordHash || !passwordOk) {
      await this.loginThrottle.recordFailure(ip, email);
      throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password.');
    }
    if (user.status === 'SUSPENDED') throw new AppError('ACCOUNT_SUSPENDED', 'This account has been suspended.');

    await this.loginThrottle.reset(ip, email);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const organizationId = await this.organizations.resolvePersonalOrganizationId(user.id);
    const { session, refreshToken } = await this.sessions.createSession(user.id, meta);
    const accessToken = await this.issueAccessToken(user.id, organizationId, session.id);
    return { user: toPublicUser(user), organizationId, accessToken, session, refreshToken };
  }

  /** Rotates the refresh token and re-checks the user's status (see `JwtAuthGuard`'s doc comment). */
  async refresh(refreshToken: string, meta: RequestMeta): Promise<{ user: PublicUser; organizationId: string; accessToken: IssuedAccessToken; session: Session; refreshToken: string }> {
    const rotated = await this.sessions.rotate(refreshToken, meta);
    const user = await this.prisma.user.findFirst({ where: { id: rotated.session.userId, deletedAt: null } });
    if (!user || user.status === 'SUSPENDED') {
      await this.sessions.revokeFamily(rotated.session.familyId, 'ADMIN_REVOKED');
      throw new AppError('ACCOUNT_SUSPENDED', 'This account has been suspended.');
    }
    const organizationId = await this.organizations.resolvePersonalOrganizationId(user.id);
    const accessToken = await this.issueAccessToken(user.id, organizationId, rotated.session.id);
    return { user: toPublicUser(user), organizationId, accessToken, session: rotated.session, refreshToken: rotated.refreshToken };
  }

  /**
   * Mints a new access token scoped to a different organization the user belongs to (the same
   * session/refresh token keeps working — only the JWT's `org` claim changes). Without this, a
   * user who accepts an invitation into a team organization would have no way to ever act in it:
   * every other token-issuing flow (register/login/refresh) always resolves to the user's personal
   * organization (docs/ARCHITECTURE.md §17.4).
   */
  async switchOrganization(userId: string, organizationId: string, sessionId: string): Promise<IssuedAccessToken> {
    const membership = await this.prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId, userId } } });
    if (!membership) throw new AppError('FORBIDDEN', 'You are not a member of this organization.');
    return this.issueAccessToken(userId, organizationId, sessionId);
  }

  /** Revokes by the access token's session id and, if present, by the refresh cookie — whichever
   * one is still active covers the common case; revoking an already-revoked row is a no-op. */
  async logout(sessionId: string, refreshToken: string | undefined): Promise<void> {
    await this.sessions.revoke(sessionId, 'LOGOUT');
    if (refreshToken) await this.sessions.revokeByToken(refreshToken, 'LOGOUT');
  }

  async listSessions(userId: string): Promise<Session[]> {
    return this.sessions.listActive(userId);
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const session = await this.prisma.session.findFirst({ where: { id: sessionId, userId } });
    if (!session) throw new AppError('NOT_FOUND', 'Session not found.');
    await this.sessions.revoke(sessionId, 'ADMIN_REVOKED');
  }

  async verifyEmail(dto: VerifyEmailDto): Promise<void> {
    const userId = await this.authTokens.consume(dto.token, 'EMAIL_VERIFY');
    await this.prisma.user.update({ where: { id: userId }, data: { isEmailVerified: true } });
  }

  async resendVerification(userId: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.isEmailVerified) return;
    await this.authTokens.invalidateOutstanding(userId, 'EMAIL_VERIFY');
    await this.sendVerificationEmail(user);
  }

  /** Always resolves without revealing whether the email exists (no user enumeration). */
  async forgotPassword(dto: ForgotPasswordDto): Promise<void> {
    const email = dto.email.toLowerCase();
    const user = await this.prisma.user.findFirst({ where: { email, deletedAt: null, passwordHash: { not: null } } });
    if (!user) return;
    await this.authTokens.invalidateOutstanding(user.id, 'PASSWORD_RESET');
    const token = await this.authTokens.issue(user.id, 'PASSWORD_RESET');
    await this.queue.enqueue('email.send', {
      to: user.email,
      template: 'password-reset',
      variables: { resetUrl: this.buildFrontendLink('/reset-password', token) },
    });
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const userId = await this.authTokens.consume(dto.token, 'PASSWORD_RESET');
    const passwordHash = await this.password.hash(dto.password);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    await this.sessions.revokeAllForUser(userId, 'PASSWORD_RESET');
    await this.audit.record({ actorUserId: userId, action: 'PASSWORD_RESET', resourceType: 'user', resourceId: userId });
  }

  async changePassword(userId: string, currentSessionId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const ok = user.passwordHash ? await this.password.verify(user.passwordHash, dto.currentPassword) : false;
    if (!ok) throw new AppError('INVALID_CREDENTIALS', 'Current password is incorrect.');

    const passwordHash = await this.password.hash(dto.newPassword);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    await this.sessions.revokeAllForUser(userId, 'PASSWORD_RESET', currentSessionId);
    await this.audit.record({ actorUserId: userId, action: 'PASSWORD_CHANGED', resourceType: 'user', resourceId: userId });
  }

  private async issueAccessToken(userId: string, organizationId: string, sessionId: string): Promise<IssuedAccessToken> {
    const roles = await this.permissions.getStaffRoleKeys(userId);
    return this.tokens.signAccessToken({ sub: userId, org: organizationId, roles, sid: sessionId });
  }

  private async sendVerificationEmail(user: User): Promise<void> {
    const token = await this.authTokens.issue(user.id, 'EMAIL_VERIFY');
    await this.queue.enqueue('email.send', {
      to: user.email,
      template: 'verify-email',
      variables: { verifyUrl: this.buildFrontendLink('/verify-email', token), name: user.name },
    });
  }

  private buildFrontendLink(path: string, token: string): string {
    const url = new URL(path, this.config.get('FRONTEND_URL'));
    url.searchParams.set('token', token);
    return url.toString();
  }
}
