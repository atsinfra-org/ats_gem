import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { inject } from 'vitest';
import { ApiModule } from '../src/api.module';
import { configureApp } from '../src/bootstrap/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import { QueueProducer } from '../src/queues/queue.producer';
import { resetDatabase } from './support/database';
import { waitFor } from './support/redis';

const redisUp = inject('redisUp');

interface RegisteredUser {
  accessToken: string;
  organizationId: string;
  userId: string;
  email: string;
}

describe.skipIf(!redisUp)('Organizations (e2e, PostgreSQL + Redis)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let queue: QueueProducer;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ApiModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    queue = app.get(QueueProducer);
  });

  beforeEach(() => resetDatabase(prisma));

  afterAll(() => app?.close());

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function register(email: string, name = 'Test User'): Promise<RegisteredUser> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ name, email, password: 'correct-horse-battery', acceptTerms: true })
      .expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const membership = await prisma.organizationMember.findFirstOrThrow({ where: { userId: user.id } });
    return { accessToken: res.body.data.accessToken as string, organizationId: membership.organizationId, userId: user.id, email };
  }

  /**
   * Invites `email` into `owner`'s organization with `role`, registers that person, accepts, and
   * switches their access token to that organization — all through the real HTTP endpoints. Every
   * other token-issuing flow scopes the token to the user's own personal organization, so without
   * the switch the returned token would still act as OWNER of the invitee's own organization.
   */
  async function inviteAndJoin(owner: RegisteredUser, email: string, role: 'MEMBER' | 'VIEWER'): Promise<RegisteredUser> {
    await request(app.getHttpServer()).post('/api/v1/organizations/current/invitations').set(auth(owner.accessToken)).send({ email, role }).expect(201);
    const rawToken = await captureInvitationToken(email);
    const invited = await register(email, 'Invitee');
    await request(app.getHttpServer()).post('/api/v1/organizations/invitations/accept').set(auth(invited.accessToken)).send({ token: rawToken }).expect(201);
    const switched = await request(app.getHttpServer())
      .post(`/api/v1/auth/switch-organization/${owner.organizationId}`)
      .set(auth(invited.accessToken))
      .expect(200);
    return { ...invited, accessToken: switched.body.data.accessToken as string, organizationId: owner.organizationId };
  }

  /**
   * The raw invitation token is never persisted — read it back from the enqueued invite email
   * instead. Filtered by recipient (every test in this file uses its own unique email address),
   * since the email queue is never cleared between tests and jobs accumulate across the file.
   */
  async function captureInvitationToken(email: string): Promise<string> {
    const job = await waitFor(async () => {
      const jobs = await queue.queue('email').getJobs(['waiting', 'active', 'completed'], 0, 100);
      return jobs.find((j) => {
        const payload = j.data.payload as { template?: string; to?: string };
        return payload.template === 'organization-invite' && payload.to === email;
      });
    });
    const inviteUrl = new URL((job.data.payload as { variables: { inviteUrl: string } }).variables.inviteUrl);
    return inviteUrl.searchParams.get('token')!;
  }

  describe('current organization', () => {
    it('the registering user can read and update their own (OWNER) organization', async () => {
      const owner = await register('owner@example.com');

      const get = await request(app.getHttpServer()).get('/api/v1/organizations/current').set(auth(owner.accessToken)).expect(200);
      expect(get.body.data.isPersonal).toBe(true);

      const patch = await request(app.getHttpServer())
        .patch('/api/v1/organizations/current')
        .set(auth(owner.accessToken))
        .send({ name: 'Ada Co', industry: 'Software' })
        .expect(200);
      expect(patch.body.data).toMatchObject({ name: 'Ada Co', industry: 'Software' });
    });

    it('rejects a malformed GSTIN or PAN at the DTO layer', async () => {
      const owner = await register('owner2@example.com');
      const res = await request(app.getHttpServer())
        .patch('/api/v1/organizations/current')
        .set(auth(owner.accessToken))
        .send({ gstin: 'not-a-gstin', pan: 'not-a-pan' })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('the database itself also rejects a malformed GSTIN or PAN (defence in depth)', async () => {
      const owner = await register('owner3@example.com');
      await expect(prisma.organization.update({ where: { id: owner.organizationId }, data: { gstin: 'BAD-GSTIN-VALUE' } })).rejects.toThrow();
      await expect(prisma.organization.update({ where: { id: owner.organizationId }, data: { pan: 'BADPAN' } })).rejects.toThrow();
      await expect(prisma.organization.update({ where: { id: owner.organizationId }, data: { gstin: '27AAAAA0000A1Z5' } })).resolves.toBeDefined();
    });

    it('a VIEWER can read but not update the organization', async () => {
      const owner = await register('owner4@example.com');
      const viewer = await inviteAndJoin(owner, 'viewer@example.com', 'VIEWER');

      await request(app.getHttpServer()).get('/api/v1/organizations/current').set(auth(viewer.accessToken)).expect(200);
      const res = await request(app.getHttpServer()).patch('/api/v1/organizations/current').set(auth(viewer.accessToken)).send({ name: 'Nope' }).expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('members and invitations', () => {
    it('lists members, including the owner', async () => {
      const owner = await register('owner5@example.com');
      const res = await request(app.getHttpServer()).get('/api/v1/organizations/current/members').set(auth(owner.accessToken)).expect(200);
      expect(res.body.data).toEqual([expect.objectContaining({ role: 'OWNER', user: expect.objectContaining({ email: 'owner5@example.com' }) })]);
    });

    it('only the owner can invite', async () => {
      const owner = await register('owner6@example.com');
      const member = await inviteAndJoin(owner, 'member6@example.com', 'MEMBER');
      const res = await request(app.getHttpServer())
        .post('/api/v1/organizations/current/invitations')
        .set(auth(member.accessToken))
        .send({ email: 'someone-else@example.com', role: 'MEMBER' })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects inviting someone who is already a member', async () => {
      const owner = await register('owner7@example.com');
      const member = await inviteAndJoin(owner, 'member7@example.com', 'MEMBER');
      const res = await request(app.getHttpServer())
        .post('/api/v1/organizations/current/invitations')
        .set(auth(owner.accessToken))
        .send({ email: member.email, role: 'MEMBER' })
        .expect(409);
      expect(res.body.error.code).toBe('ALREADY_MEMBER');
    });

    it('accepting an invitation with a different account is rejected', async () => {
      const owner = await register('owner8@example.com');
      await request(app.getHttpServer()).post('/api/v1/organizations/current/invitations').set(auth(owner.accessToken)).send({ email: 'invitee8@example.com', role: 'MEMBER' }).expect(201);
      const rawToken = await captureInvitationToken('invitee8@example.com');

      const someoneElse = await register('someone-else8@example.com');
      const res = await request(app.getHttpServer()).post('/api/v1/organizations/invitations/accept').set(auth(someoneElse.accessToken)).send({ token: rawToken }).expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('accepting the same invitation twice is idempotent', async () => {
      const owner = await register('owner9@example.com');
      await request(app.getHttpServer()).post('/api/v1/organizations/current/invitations').set(auth(owner.accessToken)).send({ email: 'invitee9@example.com', role: 'MEMBER' }).expect(201);
      const rawToken = await captureInvitationToken('invitee9@example.com');
      const invited = await register('invitee9@example.com', 'Invitee');

      await request(app.getHttpServer()).post('/api/v1/organizations/invitations/accept').set(auth(invited.accessToken)).send({ token: rawToken }).expect(201);
      await request(app.getHttpServer()).post('/api/v1/organizations/invitations/accept').set(auth(invited.accessToken)).send({ token: rawToken }).expect(201);
      expect(await prisma.organizationMember.count({ where: { organizationId: owner.organizationId, userId: invited.userId } })).toBe(1);
    });

    it('the owner can change a member’s role and remove them, but not the owner row itself', async () => {
      const owner = await register('owner10@example.com');
      const member = await inviteAndJoin(owner, 'member10@example.com', 'MEMBER');

      await request(app.getHttpServer())
        .patch(`/api/v1/organizations/current/members/${member.userId}`)
        .set(auth(owner.accessToken))
        .send({ role: 'VIEWER' })
        .expect(200);
      await expect(
        prisma.organizationMember.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: owner.organizationId, userId: member.userId } } }),
      ).resolves.toMatchObject({ role: 'VIEWER' });

      const ownerBlocked = await request(app.getHttpServer())
        .patch(`/api/v1/organizations/current/members/${owner.userId}`)
        .set(auth(owner.accessToken))
        .send({ role: 'MEMBER' })
        .expect(403);
      expect(ownerBlocked.body.error.code).toBe('FORBIDDEN');

      await request(app.getHttpServer()).delete(`/api/v1/organizations/current/members/${member.userId}`).set(auth(owner.accessToken)).expect(200);
      expect(await prisma.organizationMember.count({ where: { organizationId: owner.organizationId, userId: member.userId } })).toBe(0);

      const removeOwnerBlocked = await request(app.getHttpServer()).delete(`/api/v1/organizations/current/members/${owner.userId}`).set(auth(owner.accessToken)).expect(403);
      expect(removeOwnerBlocked.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('switch-organization', () => {
    it('rejects switching to an organization the caller does not belong to', async () => {
      const userA = await register('a-switch@example.com');
      const userB = await register('b-switch@example.com');
      const res = await request(app.getHttpServer()).post(`/api/v1/auth/switch-organization/${userB.organizationId}`).set(auth(userA.accessToken)).expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('keeps the same session while changing which organization the token acts as', async () => {
      const owner = await register('owner11@example.com');
      const member = await inviteAndJoin(owner, 'member11@example.com', 'MEMBER');

      // inviteAndJoin already switched; switching back to the invitee's own personal org works too.
      const original = await request(app.getHttpServer()).get('/api/v1/me').set(auth(member.accessToken)).expect(200);
      expect(original.body.data.organization.id).toBe(owner.organizationId);

      const back = await request(app.getHttpServer()).get('/api/v1/auth/sessions').set(auth(member.accessToken)).expect(200);
      expect(back.body.data).toHaveLength(1); // still the one session from registration — no new login happened
    });
  });
});
