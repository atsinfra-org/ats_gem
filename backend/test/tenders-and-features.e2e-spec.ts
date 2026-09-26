import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ApiModule } from '../src/api.module';
import { configureApp } from '../src/bootstrap/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import { SeedService } from '../src/database/seed.service';
import type { Prisma, Tender } from '../src/generated/prisma/client';
import { NotificationsService } from '../src/notifications/notifications.service';
import { resetDatabase } from './support/database';

describe('Tenders, taxonomy and user features (e2e, PostgreSQL)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let notifications: NotificationsService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ApiModule], providers: [SeedService] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    notifications = app.get(NotificationsService);
    // Taxonomy (states/categories/tender types) and RBAC (roles/permissions) are seeded once;
    // resetDatabase() in beforeEach deliberately never touches them (see test/support/database.ts).
    await app.get(SeedService).run();
  });

  beforeEach(() => resetDatabase(prisma));

  afterAll(() => app?.close());

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function register(email: string) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ name: 'Test User', email, password: 'correct-horse-battery', acceptTerms: true })
      .expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const organizationId = (await prisma.organizationMember.findFirstOrThrow({ where: { userId: user.id } })).organizationId;
    return { accessToken: res.body.data.accessToken as string, userId: user.id, organizationId };
  }

  async function createTender(overrides: Partial<Prisma.TenderCreateInput> = {}): Promise<Tender> {
    const now = new Date();
    return prisma.tender.create({
      data: {
        title: 'Construction of a bypass road',
        publishedAt: now,
        closingAt: new Date(now.getTime() + 7 * 86_400_000),
        status: 'OPEN',
        statusComputedAt: now,
        lastSyncedAt: now,
        stateCode: 'MH',
        currency: 'INR',
        ...overrides,
      },
    });
  }

  describe('taxonomy — /meta', () => {
    it('serves seeded states, categories and tender types without authentication', async () => {
      const states = await request(app.getHttpServer()).get('/api/v1/meta/states').expect(200);
      expect(states.body.data.length).toBe(36); // 28 states + 8 UTs
      expect(states.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'MH', name: 'Maharashtra', type: 'STATE' })]));

      const categories = await request(app.getHttpServer()).get('/api/v1/meta/categories').expect(200);
      const categoryList = categories.body.data as { isActive: boolean }[];
      expect(categoryList.length).toBeGreaterThan(0);
      expect(categoryList.every((c) => c.isActive)).toBe(true);

      const tenderTypes = await request(app.getHttpServer()).get('/api/v1/meta/tender-types').expect(200);
      expect(tenderTypes.body.data).toEqual(expect.arrayContaining([{ key: 'OPEN', name: 'Open Tender' }]));
    });
  });

  describe('search/tenders and detail', () => {
    it('filters by state and status, and paginates', async () => {
      await createTender({ title: 'Road work in Maharashtra', stateCode: 'MH', status: 'OPEN' });
      await createTender({ title: 'Hospital equipment in Delhi', stateCode: 'DL', status: 'CLOSED' });

      const res = await request(app.getHttpServer()).get('/api/v1/search/tenders').query({ state: 'MH', status: 'OPEN' }).expect(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].title).toBe('Road work in Maharashtra');
      expect(res.body.meta.pagination).toMatchObject({ page: 1, pageSize: 20, total: 1, totalPages: 1 });
    });

    it('caps anonymous callers to the first, small page even when they ask for more', async () => {
      for (let i = 0; i < 3; i++) await createTender({ title: `Tender ${i}` });
      const res = await request(app.getHttpServer()).get('/api/v1/search/tenders').query({ page: 5, pageSize: 100 }).expect(200);
      expect(res.body.meta.pagination).toMatchObject({ page: 1, pageSize: 20 });
    });

    it('reports isSaved only for a signed-in caller, and only for tenders they bookmarked', async () => {
      const tender = await createTender();
      const user = await register('search-user@example.com');
      await request(app.getHttpServer()).post('/api/v1/watchlist').set(auth(user.accessToken)).send({ tenderId: tender.id }).expect(201);

      const anon = await request(app.getHttpServer()).get('/api/v1/search/tenders').expect(200);
      expect(anon.body.data[0].isSaved).toBe(false);

      const signedIn = await request(app.getHttpServer()).get('/api/v1/search/tenders').set(auth(user.accessToken)).expect(200);
      expect(signedIn.body.data[0].isSaved).toBe(true);
    });

    it('GET /tenders/:id returns 404 for an unknown or soft-deleted tender', async () => {
      const tender = await createTender();
      await prisma.tender.update({ where: { id: tender.id }, data: { deletedAt: new Date() } });
      const res = await request(app.getHttpServer()).get(`/api/v1/tenders/${tender.id}`).expect(404);
      expect(res.body.error.code).toBe('TENDER_NOT_FOUND');
    });

    it('GET /tenders/:id returns the detail shape with money as {amount, currency}', async () => {
      const tender = await createTender({ estimatedValue: '1234567.50' });
      const res = await request(app.getHttpServer()).get(`/api/v1/tenders/${tender.id}`).expect(200);
      expect(res.body.data.estimatedValue).toEqual({ amount: '1234567.50', currency: 'INR' });
      expect(res.body.data.documents).toEqual([]);
    });
  });

  describe('saved searches', () => {
    it('CRUD is scoped to the caller’s organization', async () => {
      const owner = await register('saved-search-owner@example.com');
      const stranger = await register('saved-search-stranger@example.com');

      const created = await request(app.getHttpServer())
        .post('/api/v1/saved-searches')
        .set(auth(owner.accessToken))
        .send({ name: 'Roads in Maharashtra', criteria: { state: 'MH', status: 'OPEN' } })
        .expect(201);

      const list = await request(app.getHttpServer()).get('/api/v1/saved-searches').set(auth(owner.accessToken)).expect(200);
      expect(list.body.data).toHaveLength(1);

      const strangerList = await request(app.getHttpServer()).get('/api/v1/saved-searches').set(auth(stranger.accessToken)).expect(200);
      expect(strangerList.body.data).toHaveLength(0);

      const strangerUpdate = await request(app.getHttpServer())
        .patch(`/api/v1/saved-searches/${created.body.data.id}`)
        .set(auth(stranger.accessToken))
        .send({ name: 'Nope' })
        .expect(404);
      expect(strangerUpdate.body.error.code).toBe('SAVED_SEARCH_NOT_FOUND');

      await request(app.getHttpServer()).patch(`/api/v1/saved-searches/${created.body.data.id}`).set(auth(owner.accessToken)).send({ isActive: false }).expect(200);
      await request(app.getHttpServer()).delete(`/api/v1/saved-searches/${created.body.data.id}`).set(auth(owner.accessToken)).expect(200);
      expect(await prisma.savedSearch.count()).toBe(0);
    });

    it('rejects criteria with unknown fields', async () => {
      const owner = await register('saved-search-invalid@example.com');
      const res = await request(app.getHttpServer())
        .post('/api/v1/saved-searches')
        .set(auth(owner.accessToken))
        .send({ name: 'Bad', criteria: { notAField: 'x' } })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('watchlist', () => {
    it('adding the same tender twice is idempotent, and duplicates are prevented at the database level', async () => {
      const tender = await createTender();
      const user = await register('watchlist-user@example.com');

      const first = await request(app.getHttpServer()).post('/api/v1/watchlist').set(auth(user.accessToken)).send({ tenderId: tender.id }).expect(201);
      const second = await request(app.getHttpServer()).post('/api/v1/watchlist').set(auth(user.accessToken)).send({ tenderId: tender.id }).expect(201);
      expect(second.body.data.id).toBe(first.body.data.id);
      expect(await prisma.watchlistItem.count({ where: { userId: user.userId } })).toBe(1);

      await expect(prisma.watchlistItem.create({ data: { userId: user.userId, tenderId: tender.id } })).rejects.toThrow();
    });

    it('lists and removes bookmarks; removing one that was never bookmarked is a no-op', async () => {
      const tenderA = await createTender({ title: 'A' });
      const tenderB = await createTender({ title: 'B' });
      const user = await register('watchlist-user2@example.com');
      await request(app.getHttpServer()).post('/api/v1/watchlist').set(auth(user.accessToken)).send({ tenderId: tenderA.id }).expect(201);

      const list = await request(app.getHttpServer()).get('/api/v1/watchlist').set(auth(user.accessToken)).expect(200);
      expect(list.body.data).toHaveLength(1);

      await request(app.getHttpServer()).delete(`/api/v1/watchlist/${tenderB.id}`).set(auth(user.accessToken)).expect(200);
      await request(app.getHttpServer()).delete(`/api/v1/watchlist/${tenderA.id}`).set(auth(user.accessToken)).expect(200);
      expect(await prisma.watchlistItem.count({ where: { userId: user.userId } })).toBe(0);
    });

    it('rejects bookmarking a tender that does not exist', async () => {
      const user = await register('watchlist-user3@example.com');
      const res = await request(app.getHttpServer())
        .post('/api/v1/watchlist')
        .set(auth(user.accessToken))
        .send({ tenderId: '00000000-0000-7000-8000-000000000000' })
        .expect(404);
      expect(res.body.error.code).toBe('TENDER_NOT_FOUND');
    });
  });

  describe('notifications', () => {
    it('lists, reports an unread count, and supports marking one or all as read', async () => {
      const user = await register('notify-user@example.com');
      await notifications.createIfNew({ userId: user.userId, type: 'ACCOUNT', title: 'Welcome', message: 'Thanks for joining.', dedupKey: 'test:1' });
      await notifications.createIfNew({ userId: user.userId, type: 'ACCOUNT', title: 'Second', message: 'Another one.', dedupKey: 'test:2' });

      const list = await request(app.getHttpServer()).get('/api/v1/notifications').set(auth(user.accessToken)).expect(200);
      expect(list.body.data).toHaveLength(2);
      expect(list.body.meta.unreadCount).toBe(2);

      await request(app.getHttpServer()).patch(`/api/v1/notifications/${list.body.data[0].id}/read`).set(auth(user.accessToken)).expect(200);
      const afterOne = await request(app.getHttpServer()).get('/api/v1/notifications').set(auth(user.accessToken)).expect(200);
      expect(afterOne.body.meta.unreadCount).toBe(1);

      await request(app.getHttpServer()).patch('/api/v1/notifications/read-all').set(auth(user.accessToken)).expect(200);
      const afterAll = await request(app.getHttpServer()).get('/api/v1/notifications').set(auth(user.accessToken)).expect(200);
      expect(afterAll.body.meta.unreadCount).toBe(0);
    });

    it('never returns another user’s notifications', async () => {
      const owner = await register('notify-owner@example.com');
      const stranger = await register('notify-stranger@example.com');
      await notifications.createIfNew({ userId: owner.userId, type: 'ACCOUNT', title: 'Private', message: 'For owner only.', dedupKey: 'test:3' });

      const res = await request(app.getHttpServer()).get('/api/v1/notifications').set(auth(stranger.accessToken)).expect(200);
      expect(res.body.data).toHaveLength(0);
    });
  });
});
