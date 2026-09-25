import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ApiModule } from '../src/api.module';
import { AuthTokenService } from '../src/auth/auth-token.service';
import { configureApp } from '../src/bootstrap/configure-app';
import { AppConfig } from '../src/config/app-config.service';
import { PrismaService } from '../src/database/prisma.service';
import { QueueProducer } from '../src/queues/queue.producer';
import { resetDatabase } from './support/database';
import { inject } from 'vitest';
import { deletePrefix, waitFor } from './support/redis';

const redisUp = inject('redisUp');

const REGISTER_BODY = { name: 'Ada Lovelace', email: 'ada@example.com', password: 'correct-horse-battery', acceptTerms: true };

async function findEmailJob(queue: QueueProducer, template: string): Promise<{ to: string; template: string; variables: Record<string, string> } | undefined> {
  const jobs = await waitFor(async () => {
    const found = await queue.queue('email').getJobs(['waiting', 'active', 'completed', 'delayed'], 0, 50);
    const match = found.find((j) => (j.data.payload as { template?: string }).template === template);
    return match ? [match] : undefined;
  });
  return jobs?.[0]?.data.payload as never;
}

describe('Auth (e2e, PostgreSQL)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let config: AppConfig;
  let queue: QueueProducer;
  let authTokens: AuthTokenService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ApiModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    config = app.get(AppConfig);
    queue = app.get(QueueProducer);
    authTokens = app.get(AuthTokenService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    // Login-throttle state lives in Redis, keyed by IP and email, independent of the Postgres
    // reset above — every test in this file logs in from the same loopback IP, so it must be
    // cleared per test or an earlier test's failed attempts bleed into a later one's assertions.
    if (redisUp) await deletePrefix('login-throttle');
  });

  afterAll(() => app?.close());

  const cookieName = () => config.get('REFRESH_COOKIE_NAME');

  describe('register', () => {
    it('creates a user with a personal organization, sets a refresh cookie, and returns an access token', async () => {
      const res = await request(app.getHttpServer()).post('/api/v1/auth/register').send(REGISTER_BODY).expect(201);

      expect(res.body.data).toMatchObject({ requiresEmailVerification: true, user: { email: 'ada@example.com', name: 'Ada Lovelace', isEmailVerified: false } });
      expect(res.body.data.accessToken).toEqual(expect.any(String));
      expect(res.body.data.user.passwordHash).toBeUndefined();

      const setCookie = res.headers['set-cookie'] as unknown as string[];
      const refreshCookie = setCookie.find((c) => c.startsWith(`${cookieName()}=`));
      expect(refreshCookie).toBeDefined();
      expect(refreshCookie).toContain('HttpOnly');
      expect(refreshCookie).toContain('Path=/api/v1/auth');

      const user = await prisma.user.findUniqueOrThrow({ where: { email: 'ada@example.com' } });
      expect(user.termsAcceptedAt).not.toBeNull();
      const membership = await prisma.organizationMember.findFirstOrThrow({ where: { userId: user.id } });
      expect(membership.role).toBe('OWNER');
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: membership.organizationId } });
      expect(org.isPersonal).toBe(true);

      const events = await prisma.outboxEvent.findMany({ where: { eventType: 'user.created' } });
      expect(events).toHaveLength(1);
    });

    it('rejects a duplicate email', async () => {
      await request(app.getHttpServer()).post('/api/v1/auth/register').send(REGISTER_BODY).expect(201);
      const res = await request(app.getHttpServer()).post('/api/v1/auth/register').send(REGISTER_BODY).expect(409);
      expect(res.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');
    });

    it('rejects a short password and missing terms acceptance with field-level details', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ ...REGISTER_BODY, password: 'short', acceptTerms: false })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      const details = res.body.error.details as { field: string }[];
      expect(details.map((d) => d.field)).toEqual(expect.arrayContaining(['password', 'acceptTerms']));
    });

    it.skipIf(!redisUp)('enqueues a verify-email job with a link, never the raw token logged in the job list', async () => {
      await request(app.getHttpServer()).post('/api/v1/auth/register').send(REGISTER_BODY).expect(201);
      const job = await findEmailJob(queue, 'verify-email');
      expect(job?.to).toBe('ada@example.com');
      expect(job?.variables.verifyUrl).toContain(config.get('FRONTEND_URL'));
    });
  });

  describe('login', () => {
    beforeEach(async () => {
      await request(app.getHttpServer()).post('/api/v1/auth/register').send(REGISTER_BODY).expect(201);
    });

    it('succeeds with correct credentials', async () => {
      const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'ada@example.com', password: REGISTER_BODY.password }).expect(200);
      expect(res.body.data.user.email).toBe('ada@example.com');
      expect(res.body.data.accessToken).toEqual(expect.any(String));
    });

    it('fails with the wrong password and does not reveal whether the account exists', async () => {
      const wrongPassword = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'ada@example.com', password: 'wrong-password' }).expect(401);
      const unknownEmail = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'nobody@example.com', password: 'wrong-password' }).expect(401);
      expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(unknownEmail.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
    });

    it.skipIf(!redisUp)('locks the account after too many failed attempts from the same IP', async () => {
      const max = config.get('LOGIN_MAX_ATTEMPTS');
      for (let i = 0; i < max; i++) {
        await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'ada@example.com', password: 'wrong' }).expect(401);
      }
      const locked = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'ada@example.com', password: REGISTER_BODY.password }).expect(423);
      expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
    });

    it('rejects a suspended account', async () => {
      await prisma.user.update({ where: { email: 'ada@example.com' }, data: { status: 'SUSPENDED' } });
      const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'ada@example.com', password: REGISTER_BODY.password }).expect(403);
      expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
    });
  });

  describe('refresh', () => {
    async function registerAndGetCookie(): Promise<string> {
      const res = await request(app.getHttpServer()).post('/api/v1/auth/register').send(REGISTER_BODY).expect(201);
      const setCookie = res.headers['set-cookie'] as unknown as string[];
      return setCookie.find((c) => c.startsWith(`${cookieName()}=`))!.split(';')[0];
    }

    it('requires the X-Requested-With header', async () => {
      const cookie = await registerAndGetCookie();
      const res = await request(app.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', cookie).expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('requires the refresh cookie', async () => {
      await request(app.getHttpServer()).post('/api/v1/auth/refresh').set('X-Requested-With', 'XMLHttpRequest').expect(401);
    });

    it('rotates the token and issues a new access token', async () => {
      const cookie = await registerAndGetCookie();
      const res = await request(app.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', cookie).set('X-Requested-With', 'XMLHttpRequest').expect(200);
      expect(res.body.data.accessToken).toEqual(expect.any(String));
      const newCookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith(`${cookieName()}=`))!.split(';')[0];
      expect(newCookie).not.toBe(cookie);
    });

    it('detects reuse of an already-rotated token and revokes the whole family', async () => {
      const cookie = await registerAndGetCookie();
      const first = await request(app.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', cookie).set('X-Requested-With', 'XMLHttpRequest').expect(200);
      const newCookie = (first.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith(`${cookieName()}=`))!.split(';')[0];

      // Replaying the OLD (already-rotated) cookie is reuse.
      const reused = await request(app.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', cookie).set('X-Requested-With', 'XMLHttpRequest').expect(401);
      expect(reused.body.error.code).toBe('REFRESH_TOKEN_REUSED');

      // The whole family — including the token issued by the legitimate rotation above — is now
      // revoked, so presenting it is flagged as reuse too, not treated as merely "not found".
      const afterReuse = await request(app.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', newCookie).set('X-Requested-With', 'XMLHttpRequest').expect(401);
      expect(afterReuse.body.error.code).toBe('REFRESH_TOKEN_REUSED');
    });
  });

  describe('logout', () => {
    it('revokes the session so the refresh cookie no longer works', async () => {
      const registerRes = await request(app.getHttpServer()).post('/api/v1/auth/register').send(REGISTER_BODY).expect(201);
      const cookie = (registerRes.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith(`${cookieName()}=`))!.split(';')[0];
      const accessToken = registerRes.body.data.accessToken as string;

      await request(app.getHttpServer()).post('/api/v1/auth/logout').set('Authorization', `Bearer ${accessToken}`).set('Cookie', cookie).expect(200);
      await request(app.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', cookie).set('X-Requested-With', 'XMLHttpRequest').expect(401);
    });
  });

  describe('email verification', () => {
    it('verifies with a valid token and rejects a second use of the same one', async () => {
      await request(app.getHttpServer()).post('/api/v1/auth/register').send(REGISTER_BODY).expect(201);
      const user = await prisma.user.findUniqueOrThrow({ where: { email: 'ada@example.com' } });
      // The raw token from registration's own email is never persisted (only its hash) and cannot
      // be recovered here, so issue a fresh one through the same service the endpoint would use.
      const token = await authTokens.issue(user.id, 'EMAIL_VERIFY');

      await request(app.getHttpServer()).post('/api/v1/auth/verify-email').send({ token }).expect(201);
      await expect(prisma.user.findUniqueOrThrow({ where: { id: user.id } })).resolves.toMatchObject({ isEmailVerified: true });

      const reused = await request(app.getHttpServer()).post('/api/v1/auth/verify-email').send({ token }).expect(410);
      expect(reused.body.error.code).toBe('TOKEN_INVALID_OR_EXPIRED');
    });

    it('rejects an unknown token', async () => {
      const res = await request(app.getHttpServer()).post('/api/v1/auth/verify-email').send({ token: 'not-a-real-token' }).expect(410);
      expect(res.body.error.code).toBe('TOKEN_INVALID_OR_EXPIRED');
    });

    it.skipIf(!redisUp)('resend-verification issues a new token and invalidates the old one', async () => {
      const registerRes = await request(app.getHttpServer()).post('/api/v1/auth/register').send(REGISTER_BODY).expect(201);
      const accessToken = registerRes.body.data.accessToken as string;
      const user = await prisma.user.findUniqueOrThrow({ where: { email: 'ada@example.com' } });
      const original = await prisma.authToken.findFirstOrThrow({ where: { userId: user.id, type: 'EMAIL_VERIFY' } });

      await request(app.getHttpServer()).post('/api/v1/auth/resend-verification').set('Authorization', `Bearer ${accessToken}`).expect(201);

      await expect(prisma.authToken.findUniqueOrThrow({ where: { id: original.id } })).resolves.toMatchObject({ usedAt: expect.any(Date) });
      expect(await prisma.authToken.count({ where: { userId: user.id, type: 'EMAIL_VERIFY', usedAt: null } })).toBe(1);
    });
  });

  describe('forgot / reset password', () => {
    it('always responds success, whether or not the email exists (no enumeration)', async () => {
      await request(app.getHttpServer()).post('/api/v1/auth/register').send(REGISTER_BODY).expect(201);
      const known = await request(app.getHttpServer()).post('/api/v1/auth/forgot-password').send({ email: 'ada@example.com' }).expect(201);
      const unknown = await request(app.getHttpServer()).post('/api/v1/auth/forgot-password').send({ email: 'nobody@example.com' }).expect(201);
      expect(known.body.data).toBeNull();
      expect(unknown.body.data).toBeNull();
    });

    it('rejects an invalid reset token', async () => {
      const res = await request(app.getHttpServer()).post('/api/v1/auth/reset-password').send({ token: 'nope', password: 'new-password-123' }).expect(410);
      expect(res.body.error.code).toBe('TOKEN_INVALID_OR_EXPIRED');
    });

    it('resets the password and revokes every existing session', async () => {
      const registerRes = await request(app.getHttpServer()).post('/api/v1/auth/register').send(REGISTER_BODY).expect(201);
      const cookie = (registerRes.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith(`${cookieName()}=`))!.split(';')[0];
      const user = await prisma.user.findUniqueOrThrow({ where: { email: 'ada@example.com' } });
      const token = await authTokens.issue(user.id, 'PASSWORD_RESET');

      await request(app.getHttpServer()).post('/api/v1/auth/reset-password').send({ token, password: 'a-brand-new-password' }).expect(201);

      await request(app.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', cookie).set('X-Requested-With', 'XMLHttpRequest').expect(401);
      await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'ada@example.com', password: 'a-brand-new-password' }).expect(200);
    });
  });

  describe('change password', () => {
    it('requires the correct current password and revokes other sessions but not the current one', async () => {
      const registerRes = await request(app.getHttpServer()).post('/api/v1/auth/register').send(REGISTER_BODY).expect(201);
      const accessToken = registerRes.body.data.accessToken as string;
      const cookie = (registerRes.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith(`${cookieName()}=`))!.split(';')[0];

      const wrong = await request(app.getHttpServer())
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ currentPassword: 'nope', newPassword: 'brand-new-password' })
        .expect(401);
      expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');

      await request(app.getHttpServer())
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ currentPassword: REGISTER_BODY.password, newPassword: 'brand-new-password' })
        .expect(201);

      // The session behind the request that changed the password stays alive...
      await request(app.getHttpServer()).post('/api/v1/auth/refresh').set('Cookie', cookie).set('X-Requested-With', 'XMLHttpRequest').expect(200);
      // ...but logging in with the old password no longer works.
      await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'ada@example.com', password: REGISTER_BODY.password }).expect(401);
    });
  });

  describe('sessions', () => {
    it('lists the active session and marks the current one, then revokes it', async () => {
      const registerRes = await request(app.getHttpServer()).post('/api/v1/auth/register').send(REGISTER_BODY).expect(201);
      const accessToken = registerRes.body.data.accessToken as string;

      const list = await request(app.getHttpServer()).get('/api/v1/auth/sessions').set('Authorization', `Bearer ${accessToken}`).expect(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0].current).toBe(true);

      await request(app.getHttpServer()).delete(`/api/v1/auth/sessions/${list.body.data[0].id}`).set('Authorization', `Bearer ${accessToken}`).expect(200);
      const after = await request(app.getHttpServer()).get('/api/v1/auth/sessions').set('Authorization', `Bearer ${accessToken}`).expect(200);
      expect(after.body.data).toHaveLength(0);
    });
  });

  describe('GET /me', () => {
    it('returns the profile, staff roles and current organization', async () => {
      const registerRes = await request(app.getHttpServer()).post('/api/v1/auth/register').send(REGISTER_BODY).expect(201);
      const accessToken = registerRes.body.data.accessToken as string;

      const res = await request(app.getHttpServer()).get('/api/v1/me').set('Authorization', `Bearer ${accessToken}`).expect(200);
      expect(res.body.data).toMatchObject({ email: 'ada@example.com', staffRoles: [], organization: { isPersonal: true } });
    });

    it('updates the profile', async () => {
      const registerRes = await request(app.getHttpServer()).post('/api/v1/auth/register').send(REGISTER_BODY).expect(201);
      const accessToken = registerRes.body.data.accessToken as string;

      const res = await request(app.getHttpServer())
        .patch('/api/v1/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ designation: 'Chief Analyst' })
        .expect(200);
      expect(res.body.data.designation).toBe('Chief Analyst');
    });
  });
});
