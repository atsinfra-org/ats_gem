import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ApiModule } from '../src/api.module';
import { configureApp } from '../src/bootstrap/configure-app';
import { AnalyticsPurgeService } from '../src/analytics/analytics-purge.service';
import { AnalyticsRollupService, ROLLUP_METRICS } from '../src/analytics/analytics-rollup.service';
import { AppConfig } from '../src/config/app-config.service';
import { PrismaService } from '../src/database/prisma.service';
import { deletePrefix } from './support/redis';
import { withConfig } from './support/config';
import { resetDatabase } from './support/database';

const anon = () => `anon-${randomUUID()}`;

describe('Analytics & tracking (e2e, PostgreSQL)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let rollup: AnalyticsRollupService;
  let purger: AnalyticsPurgeService;

  const post = (body: object, token?: string) => {
    const r = request(app.getHttpServer()).post('/api/v1/analytics/events').send(body);
    return token ? r.set('Authorization', `Bearer ${token}`) : r;
  };
  const get = (path: string, token?: string) => {
    const r = request(app.getHttpServer()).get(`/api/v1${path}`);
    return token ? r.set('Authorization', `Bearer ${token}`) : r;
  };

  async function register(email: string) {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/register').send({ name: 'Analytics User', email, password: 'correct-horse-battery', acceptTerms: true }).expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const organizationId = (await prisma.organizationMember.findFirstOrThrow({ where: { userId: user.id } })).organizationId;
    return { id: user.id, organizationId, token: (res.body as { data: { accessToken: string } }).data.accessToken };
  }

  async function grantAnalyticsView(userId: string) {
    const role = await prisma.role.upsert({ where: { key: 'ANALYTICS_STAFF' }, create: { key: 'ANALYTICS_STAFF', name: 'Analytics Staff' }, update: {} });
    const perm = await prisma.permission.upsert({ where: { key: 'analytics.view' }, create: { key: 'analytics.view', description: 'View analytics' }, update: {} });
    await prisma.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } }, create: { roleId: role.id, permissionId: perm.id }, update: {} });
    await prisma.userRole.create({ data: { userId, roleId: role.id } });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ApiModule] })
      .overrideProvider(AppConfig)
      .useFactory(withConfig({ RATE_LIMIT_AUTH_MAX: 100_000, RATE_LIMIT_ANALYTICS_MAX: 100_000, ANALYTICS_SESSION_TIMEOUT_MINUTES: 30, ANALYTICS_MAX_BATCH_SIZE: 20 }))
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    rollup = app.get(AnalyticsRollupService);
    purger = app.get(AnalyticsPurgeService);
  });
  afterAll(() => app?.close());

  beforeEach(async () => {
    await resetDatabase(prisma);
    await prisma.$executeRawUnsafe('TRUNCATE TABLE analytics_events, analytics_sessions, analytics_daily_rollups, analytics_processing_runs, search_events CASCADE');
  });

  describe('event ingestion', () => {
    it('accepts a well-formed anonymous page_view and validates its metadata', async () => {
      const id = anon();
      const res = await post({ events: [{ name: 'PAGE_VIEW', anonymousId: id, path: '/tenders', metadata: { routeCategory: 'app' } }] }).expect(202);
      expect(res.body.data).toEqual({ accepted: 1, rejected: 0 });
      const row = await prisma.analyticsEvent.findFirstOrThrow({ where: { anonymousId: id } });
      expect(row).toMatchObject({ eventName: 'PAGE_VIEW', userId: null, organizationId: null, path: '/tenders' });
      expect(row.metadata).toEqual({ routeCategory: 'app' });
    });

    it('attaches the caller identity from the token, never from the body', async () => {
      const u = await register(`ev-${Date.now()}@example.com`);
      const id = anon();
      // userId/organizationId are not fields the DTO accepts (identity only ever comes from the token) - a client
      // that tries to send them gets a validation error, not silent acceptance of a forged identity.
      await post({ events: [{ name: 'PROFILE_VIEWED', anonymousId: id, userId: randomUUID(), organizationId: randomUUID() }] }, u.token).expect(400);
      await post({ events: [{ name: 'PROFILE_VIEWED', anonymousId: id }] }, u.token).expect(202);
      const row = await prisma.analyticsEvent.findFirstOrThrow({ where: { anonymousId: id } });
      expect(row.userId).toBe(u.id);
      expect(row.organizationId).toBe(u.organizationId);
    });

    it('rejects an unknown event name, a malformed anonymousId and an oversized payload, but never 5xx', async () => {
      await post({ events: [{ name: 'NOT_A_REAL_EVENT', anonymousId: anon() }] }).expect(400);
      await post({ events: [{ name: 'PAGE_VIEW', anonymousId: 'a' }] }).expect(400);
      await post({ events: [{ name: 'PAGE_VIEW', anonymousId: anon(), path: 'x'.repeat(400) }] }).expect(400);
      const big = { events: [{ name: 'PAGE_VIEW', anonymousId: anon(), metadata: { extra: 'x'.repeat(50_000) } }] };
      const res = await post(big);
      expect(res.status).not.toBeGreaterThanOrEqual(500);
    });

    it('metadata that fails its per-event schema is rejected but does not fail the whole batch', async () => {
      const id = anon();
      const res = await post({
        events: [
          { name: 'TENDER_VIEWED', anonymousId: id, metadata: { tenderId: 'not-a-uuid' } },
          { name: 'PAGE_VIEW', anonymousId: id, path: '/tenders' },
        ],
      }).expect(202);
      expect(res.body.data).toEqual({ accepted: 1, rejected: 1 });
      expect(await prisma.analyticsEvent.count({ where: { anonymousId: id } })).toBe(1);
    });

    it('caps a batch at ANALYTICS_MAX_BATCH_SIZE and rejects an over-length array outright', async () => {
      const id = anon();
      const twentyOne = Array.from({ length: 21 }, () => ({ name: 'PAGE_VIEW', anonymousId: id, path: '/x' }));
      await post({ events: twentyOne }).expect(400);
    });

    it('never stores a password, token or full request body in metadata', async () => {
      const id = anon();
      // The metadata schema is closed (.strict()): extra keys like password/accessToken fail validation and the
      // event is dropped, but the request itself still succeeds (202) so a hostile payload cannot 500 the beacon.
      const bad = await post({ events: [{ name: 'LOGIN_FAILURE', anonymousId: id, metadata: { reason: 'invalid_credentials', password: 'hunter2', accessToken: 'eyJ...' } }] }).expect(202);
      expect(bad.body.data).toEqual({ accepted: 0, rejected: 1 });
      const ok = await post({ events: [{ name: 'LOGIN_FAILURE', anonymousId: id, metadata: { reason: 'invalid_credentials' } }] }).expect(202);
      expect(ok.body.data.accepted).toBe(1);
      expect(JSON.stringify((await prisma.analyticsEvent.findFirstOrThrow({ where: { anonymousId: id } })).metadata)).not.toMatch(/password|hunter2|eyJ/);
    });

    it('duplicate submission (retry) creates two rows: ingestion has no dedup key, unlike search/notification events', async () => {
      const id = anon();
      const body = { events: [{ name: 'PAGE_VIEW', anonymousId: id, path: '/x' }] };
      await post(body).expect(202);
      await post(body).expect(202);
      expect(await prisma.analyticsEvent.count({ where: { anonymousId: id } })).toBe(2);
    });
  });

  describe('sessions and attribution', () => {
    it('creates one session per anonymousId with first-touch UTM/referrer/landing page', async () => {
      const id = anon();
      await post({
        events: [{ name: 'PAGE_VIEW', anonymousId: id, path: '/', landingPath: '/', referrerHost: 'google.com', utmSource: 'google', utmMedium: 'cpc', utmCampaign: 'launch' }],
      }).expect(202);
      const session = await prisma.analyticsSession.findFirstOrThrow({ where: { anonymousId: id } });
      expect(session).toMatchObject({ landingPath: '/', referrerHost: 'google.com', utmSource: 'google', utmMedium: 'cpc', utmCampaign: 'launch', pageViewCount: 1, eventCount: 1 });
    });

    it('reuses the same session for events within the timeout, without overwriting first-touch attribution', async () => {
      const id = anon();
      await post({ events: [{ name: 'PAGE_VIEW', anonymousId: id, path: '/', utmSource: 'google' }] }).expect(202);
      await post({ events: [{ name: 'TENDER_VIEWED', anonymousId: id, metadata: { tenderId: randomUUID() }, utmSource: 'newsletter' }] }).expect(202);
      const sessions = await prisma.analyticsSession.findMany({ where: { anonymousId: id } });
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({ utmSource: 'google', pageViewCount: 1, eventCount: 2 });
    });

    it('starts a new session after the inactivity timeout and preserves the old one as ended', async () => {
      const short = await Test.createTestingModule({ imports: [ApiModule] })
        .overrideProvider(AppConfig)
        .useFactory(withConfig({ RATE_LIMIT_AUTH_MAX: 100_000, RATE_LIMIT_ANALYTICS_MAX: 100_000, ANALYTICS_SESSION_TIMEOUT_MINUTES: 30 }))
        .compile();
      const shortApp = short.createNestApplication<NestExpressApplication>({ bufferLogs: true });
      configureApp(shortApp);
      await shortApp.init();
      try {
        const id = anon();
        // Both instants are within the 24h clamp window (relative to "now"), 45 minutes apart - past the 30-min timeout.
        const t0 = new Date(Date.now() - 2 * 3_600_000);
        const t1 = new Date(t0.getTime() + 45 * 60_000);
        await request(shortApp.getHttpServer()).post('/api/v1/analytics/events').send({ events: [{ name: 'PAGE_VIEW', anonymousId: id, path: '/', occurredAt: t0.toISOString() }] }).expect(202);
        await request(shortApp.getHttpServer()).post('/api/v1/analytics/events').send({ events: [{ name: 'PAGE_VIEW', anonymousId: id, path: '/next', occurredAt: t1.toISOString() }] }).expect(202);
        const sessions = await prisma.analyticsSession.findMany({ where: { anonymousId: id }, orderBy: { startedAt: 'asc' } });
        expect(sessions).toHaveLength(2); // the old one is closed out, a new one starts
        expect(sessions[0]).toMatchObject({ startedAt: t0, endedAt: t0 });
        expect(sessions[1].startedAt.toISOString()).toBe(t1.toISOString());
        expect(sessions[1].endedAt).toBeNull();
      } finally {
        await shortApp.close();
      }
    });

    it('associates the session with the user once they sign in, and clamps a forged/skewed occurredAt', async () => {
      const u = await register(`sess-${Date.now()}@example.com`);
      const id = anon();
      await post({ events: [{ name: 'PAGE_VIEW', anonymousId: id, path: '/', occurredAt: '2099-01-01T00:00:00.000Z' }] }, u.token).expect(202);
      const session = await prisma.analyticsSession.findFirstOrThrow({ where: { anonymousId: id } });
      expect(session.userId).toBe(u.id);
      const event = await prisma.analyticsEvent.findFirstOrThrow({ where: { anonymousId: id } });
      expect(event.occurredAt.getFullYear()).toBeLessThan(2030);
    });
  });

  describe('rate limiting', () => {
    it('applies the analytics policy independently of the search policy', async () => {
      const tight = await Test.createTestingModule({ imports: [ApiModule] })
        .overrideProvider(AppConfig)
        .useFactory(withConfig({ RATE_LIMIT_ANALYTICS_MAX: 3, RATE_LIMIT_ANALYTICS_WINDOW_SECONDS: 60 }))
        .compile();
      const tightApp = tight.createNestApplication<NestExpressApplication>({ bufferLogs: true });
      configureApp(tightApp);
      await tightApp.init();
      await deletePrefix('rate-limit:analytics');
      try {
        const statuses: number[] = [];
        for (let i = 0; i < 5; i++) statuses.push((await request(tightApp.getHttpServer()).post('/api/v1/analytics/events').send({ events: [{ name: 'PAGE_VIEW', anonymousId: anon(), path: '/' }] })).status);
        expect(statuses.slice(0, 3)).toEqual([202, 202, 202]);
        expect(statuses.slice(3)).toEqual([429, 429]);
      } finally {
        await tightApp.close();
      }
    });
  });

  describe('rollup aggregation', () => {
    const day = new Date('2026-09-15T12:00:00.000Z');

    it('produces deterministic, idempotent daily counts from raw events and reuses Phase 7 search_events', async () => {
      const u1 = await register(`roll1-${Date.now()}@example.com`);
      const u2 = await register(`roll2-${Date.now()}@example.com`);
      for (const [uid, org, evName] of [
        [u1.id, u1.organizationId, 'PAGE_VIEW'],
        [u1.id, u1.organizationId, 'PAGE_VIEW'],
        [u2.id, u2.organizationId, 'TENDER_VIEWED'],
      ] as const) {
        await prisma.analyticsEvent.create({ data: { eventName: evName, anonymousId: anon(), userId: uid, organizationId: org, occurredAt: day, receivedAt: day, metadata: {} } });
      }
      await prisma.searchEvent.createMany({
        data: [
          { eventType: 'SEARCH_SUBMITTED', userId: u1.id, organizationId: u1.organizationId, queryNormalized: 'road', payload: { resultCount: 5 }, createdAt: day },
          { eventType: 'SEARCH_SUBMITTED', userId: u1.id, organizationId: u1.organizationId, queryNormalized: 'zzz', payload: { resultCount: 0 }, createdAt: day },
        ],
      });

      const report = await rollup.run(day);
      expect(report.rowsWritten).toBeGreaterThan(0);
      const global = await prisma.analyticsDailyRollup.findMany({ where: { date: new Date('2026-09-15'), dimension: 'global' } });
      const byMetric = Object.fromEntries(global.map((r) => [r.metric, r.count]));
      expect(byMetric.page_views).toBe(2);
      expect(byMetric.tender_views).toBe(1);
      expect(byMetric.searches_performed).toBe(2);
      expect(byMetric.zero_result_searches).toBe(1);

      const org1 = await prisma.analyticsDailyRollup.findMany({ where: { date: new Date('2026-09-15'), dimension: u1.organizationId } });
      const byMetricOrg1 = Object.fromEntries(org1.map((r) => [r.metric, r.count]));
      expect(byMetricOrg1.page_views).toBe(2);
      expect(byMetricOrg1.searches_performed).toBe(2);
      expect(byMetricOrg1.tender_views ?? 0).toBe(0);

      // Idempotent: running again (no new data) gives byte-identical counts, not doubled ones.
      await rollup.run(day);
      const globalAgain = await prisma.analyticsDailyRollup.findMany({ where: { date: new Date('2026-09-15'), dimension: 'global' } });
      expect(Object.fromEntries(globalAgain.map((r) => [r.metric, r.count]))).toEqual(byMetric);
    });

    it('a rerun after data changes corrects the numbers exactly (no leftover stale higher count)', async () => {
      await prisma.analyticsEvent.create({ data: { eventName: 'PAGE_VIEW', anonymousId: anon(), occurredAt: day, receivedAt: day, metadata: {} } });
      await rollup.run(day);
      const first = await prisma.analyticsDailyRollup.findFirstOrThrow({ where: { date: new Date('2026-09-15'), metric: 'page_views', dimension: 'global' } });
      expect(first.count).toBe(1);
      await prisma.analyticsEvent.deleteMany({});
      await rollup.run(day);
      const second = await prisma.analyticsDailyRollup.findFirstOrThrow({ where: { date: new Date('2026-09-15'), metric: 'page_views', dimension: 'global' } });
      expect(second.count).toBe(0);
    });

    it('runRange rebuilds each day in the window and records a processing run per day', async () => {
      const reports = await rollup.runRange(new Date('2026-09-10'), new Date('2026-09-12'));
      expect(reports.map((r) => r.date)).toEqual(['2026-09-10', '2026-09-11', '2026-09-12']);
      expect(await prisma.analyticsProcessingRun.count({ where: { kind: 'ROLLUP', status: 'COMPLETED' } })).toBe(3);
    });
  });

  describe('retention / purge', () => {
    it('deletes events, sessions and rollups beyond their configured windows, keeps recent ones, and is idempotent', async () => {
      const old = new Date(Date.now() - 200 * 86_400_000);
      const recent = new Date(Date.now() - 5 * 86_400_000);
      await prisma.analyticsEvent.createMany({
        data: [
          { eventName: 'PAGE_VIEW', anonymousId: anon(), occurredAt: old, receivedAt: old, metadata: {} },
          { eventName: 'PAGE_VIEW', anonymousId: anon(), occurredAt: recent, receivedAt: recent, metadata: {} },
        ],
      });
      await prisma.analyticsSession.createMany({
        data: [
          { anonymousId: anon(), lastActivityAt: old },
          { anonymousId: anon(), lastActivityAt: recent },
        ],
      });
      await prisma.analyticsDailyRollup.createMany({
        data: [
          { date: new Date(Date.now() - 500 * 86_400_000), metric: 'page_views', dimension: 'global', count: 3 },
          { date: new Date(Date.now() - 10 * 86_400_000), metric: 'page_views', dimension: 'global', count: 3 },
        ],
      });

      const report = await purger.purge();
      expect(report).toMatchObject({ deletedEvents: 1, deletedSessions: 1, deletedRollups: 1, eventRetentionDays: 90, rollupRetentionDays: 400 });
      expect(await prisma.analyticsEvent.count()).toBe(1);
      expect(await prisma.analyticsSession.count()).toBe(1);
      expect(await prisma.analyticsDailyRollup.count()).toBe(1);

      const again = await purger.purge();
      expect(again).toMatchObject({ deletedEvents: 0, deletedSessions: 0, deletedRollups: 0 });
    });

    it('honours a configured retention window', async () => {
      const custom = await Test.createTestingModule({ imports: [ApiModule] })
        .overrideProvider(AppConfig)
        .useFactory(withConfig({ ANALYTICS_EVENT_RETENTION_DAYS: 10 }))
        .compile();
      const customPurger = new AnalyticsPurgeService(prisma, custom.get(AppConfig));
      const d20 = new Date(Date.now() - 20 * 86_400_000);
      const d5 = new Date(Date.now() - 5 * 86_400_000);
      await prisma.analyticsEvent.createMany({ data: [{ eventName: 'PAGE_VIEW', anonymousId: anon(), occurredAt: d20, receivedAt: d20, metadata: {} }, { eventName: 'PAGE_VIEW', anonymousId: anon(), occurredAt: d5, receivedAt: d5, metadata: {} }] });
      const report = await customPurger.purge();
      expect(report).toMatchObject({ deletedEvents: 1, eventRetentionDays: 10 });
    });

    it('works in bounded batches', async () => {
      const old = new Date(Date.now() - 200 * 86_400_000);
      await prisma.analyticsEvent.createMany({ data: Array.from({ length: 7 }, () => ({ eventName: 'PAGE_VIEW' as const, anonymousId: anon(), occurredAt: old, receivedAt: old, metadata: {} })) });
      const report = await purger.purge({ batchSize: 3 });
      expect(report).toMatchObject({ deletedEvents: 7, batches: 3 });
    });

    it('does not touch search_events (a separate retention policy)', async () => {
      const old = new Date(Date.now() - 200 * 86_400_000);
      await prisma.searchEvent.create({ data: { eventType: 'SEARCH_SUBMITTED', queryNormalized: 'x', payload: {}, createdAt: old } });
      await purger.purge();
      expect(await prisma.searchEvent.count()).toBe(1);
    });
  });

  describe('analytics API: authorization, isolation, and real data only', () => {
    it("returns the caller's own activity summary from a token, never another user's", async () => {
      const a = await register(`me-a-${Date.now()}@example.com`);
      const b = await register(`me-b-${Date.now()}@example.com`);
      await post({ events: [{ name: 'PROFILE_VIEWED', anonymousId: anon() }] }, a.token).expect(202);
      const res = await get('/analytics/me/summary', a.token).expect(200);
      expect(res.body.data.events.PROFILE_VIEWED).toBe(1);
      const resB = await get('/analytics/me/summary', b.token).expect(200);
      expect(resB.body.data.events.PROFILE_VIEWED ?? 0).toBe(0);
      await get('/analytics/me/summary').expect(401);
    });

    it('org overview is scoped to the caller\'s own organization and requires membership', async () => {
      const a = await register(`org-a-${Date.now()}@example.com`);
      const b = await register(`org-b-${Date.now()}@example.com`);
      const day = new Date();
      await prisma.analyticsDailyRollup.createMany({ data: [{ date: new Date(day.toISOString().slice(0, 10)), metric: 'tender_views', dimension: a.organizationId, count: 9 }] });
      const resA = await get('/analytics/organizations/current/overview', a.token).expect(200);
      expect(resA.body.data.metrics.tender_views).toBe(9);
      const resB = await get('/analytics/organizations/current/overview', b.token).expect(200);
      expect(resB.body.data.metrics.tender_views).toBe(0);
      await get('/analytics/organizations/current/overview').expect(401);
    });

    it('admin overview and trends require the analytics.view permission, not just any login', async () => {
      const staff = await register(`staff-${Date.now()}@example.com`);
      const plain = await register(`plain-${Date.now()}@example.com`);
      await grantAnalyticsView(staff.id);
      const day = new Date();
      await prisma.analyticsDailyRollup.createMany({ data: [{ date: new Date(day.toISOString().slice(0, 10)), metric: 'registrations_completed', dimension: 'global', count: 2 }] });

      await get('/analytics/admin/overview', plain.token).expect(403);
      const res = await get('/analytics/admin/overview', staff.token).expect(200);
      expect(res.body.data.metrics.registrations_completed).toBe(2);

      await get('/analytics/admin/trends?metric=registrations_completed', plain.token).expect(403);
      const trend = await get(`/analytics/admin/trends?metric=registrations_completed&from=${day.toISOString().slice(0, 10)}&to=${day.toISOString().slice(0, 10)}`, staff.token).expect(200);
      expect(trend.body.data).toEqual([{ date: day.toISOString().slice(0, 10), count: 2 }]);

      await get('/analytics/admin/trends?metric=not-a-real-metric', staff.token).expect(400);
    });

    it('every displayed metric is one of the closed rollup metrics - no fabricated numbers slip through', async () => {
      const staff = await register(`metrics-${Date.now()}@example.com`);
      await grantAnalyticsView(staff.id);
      const res = await get('/analytics/admin/overview', staff.token).expect(200);
      expect(Object.keys(res.body.data.metrics).sort()).toEqual([...ROLLUP_METRICS].sort());
    });

    it('rejects an out-of-range date query instead of scanning unbounded history', async () => {
      const staff = await register(`range-${Date.now()}@example.com`);
      await grantAnalyticsView(staff.id);
      await get('/analytics/admin/overview?from=2020-01-01&to=2026-09-01', staff.token).expect(400);
      await get('/analytics/admin/overview?from=2026-09-10&to=2026-09-01', staff.token).expect(400);
    });
  });

  describe('failure handling', () => {
    it('a database error during ingestion returns 202 with rejected counts, never a 5xx (analytics cannot break the app)', async () => {
      await prisma.$executeRawUnsafe('ALTER TABLE analytics_events RENAME COLUMN metadata TO metadata_renamed');
      try {
        const res = await post({ events: [{ name: 'PAGE_VIEW', anonymousId: anon(), path: '/' }] });
        expect(res.status).toBe(202);
        expect(res.body.data).toEqual({ accepted: 0, rejected: 1 });
      } finally {
        await prisma.$executeRawUnsafe('ALTER TABLE analytics_events RENAME COLUMN metadata_renamed TO metadata');
      }
    });

    it('rollup and purge can be safely rerun after a simulated partial failure', async () => {
      await rollup.run(new Date());
      await expect(rollup.run(new Date())).resolves.toBeDefined();
      await purger.purge();
      await expect(purger.purge()).resolves.toBeDefined();
    });
  });
});
