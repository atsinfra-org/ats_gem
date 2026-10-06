import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';
import request from 'supertest';
import { ApiModule } from '../src/api.module';
import { configureApp } from '../src/bootstrap/configure-app';
import { AppConfig } from '../src/config/app-config.service';
import { PrismaService } from '../src/database/prisma.service';
import type { Prisma } from '../src/generated/prisma/client';
import { REDIS } from '../src/redis/redis.module';
import { resetDatabase } from './support/database';
import { redisAvailable } from './support/redis';

const DAY = 24 * 60 * 60 * 1000;

type Row = { title: string };

describe('Market data for the landing page (e2e, PostgreSQL)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let redis: Redis;
  let cacheKey: string;
  let hasRedis = false;
  let sourceId: string;
  let entityId: string;

  const get = (path: string) => request(app.getHttpServer()).get(`/api/v1${path}`);

  async function tender(over: Partial<Prisma.TenderUncheckedCreateInput> & { title: string }) {
    const t = await prisma.tender.create({
      data: { publishedAt: new Date(Date.now() - DAY), currency: 'INR', status: 'OPEN', statusComputedAt: new Date(), lastSyncedAt: new Date(), lifecycle: 'ACTIVE', ...over },
    });
    await prisma.tenderSourceRecord.create({
      data: { tenderId: t.id, sourceId, externalTenderId: `ext-${t.id}`, payloadHash: 'a'.repeat(64), rawPayload: {}, normalizedPayload: {}, firstSeenAt: new Date(), lastSeenAt: new Date(), lastChangedAt: new Date() },
    });
    return t;
  }

  beforeAll(async () => {
    hasRedis = await redisAvailable();
    const moduleRef = await Test.createTestingModule({ imports: [ApiModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(REDIS);
    cacheKey = `${app.get(AppConfig).get('QUEUE_PREFIX')}:market:snapshot:v1`;
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    if (hasRedis) await redis.del(cacheKey);
    for (const [code, name] of [['MH', 'Maharashtra'], ['UP', 'Uttar Pradesh']] as const) {
      await prisma.state.upsert({ where: { code }, create: { code, name, type: 'STATE' }, update: {} });
    }
    sourceId = (await prisma.tenderSource.create({ data: { name: 'GeM', slug: `s-${Math.random().toString(36).slice(2, 8)}`, sourceType: 'MOCK', adapterKey: 'mock', crawlConfig: {}, healthStatus: 'HEALTHY', lastSuccessfulRunAt: new Date() } })).id;
    entityId = (await prisma.procuringEntity.create({ data: { name: 'Pune Municipal Corporation', nameNormalized: 'pune municipal corporation', entityType: 'OTHER', stateCode: 'MH' } })).id;

    // Live: three tenders.
    await tender({ title: 'Road resurfacing, Pune', stateCode: 'MH', procuringEntityId: entityId, estimatedValue: '20000000', closingAt: new Date(Date.now() + 3 * DAY), publishedAt: new Date(Date.now() - 2 * DAY) });
    await tender({ title: 'School furniture, Pune', stateCode: 'MH', procuringEntityId: entityId, status: 'CLOSING_SOON', estimatedValue: '5000000', closingAt: new Date(Date.now() + 10 * DAY), publishedAt: new Date(Date.now() - 3 * DAY) });
    await tender({ title: 'Bridge repair, Lucknow', stateCode: 'UP', department: 'UP PWD', estimatedValue: '200000000', publishedAt: new Date(Date.now() - 60_000) });
    // Not live: each excluded for a different reason.
    await tender({ title: 'Closed tender', stateCode: 'MH', status: 'CLOSED', estimatedValue: '1', closingAt: new Date(Date.now() - 60 * 60_000) });
    await tender({ title: 'Deleted tender', stateCode: 'MH', deletedAt: new Date(), closingAt: new Date(Date.now() + DAY) });
    await tender({ title: 'Deadline passed, status not yet recomputed', stateCode: 'MH', closingAt: new Date(Date.now() - 60_000) });
    await tender({ title: 'Upcoming tender', stateCode: 'MH', status: 'UPCOMING', closingAt: new Date(Date.now() + DAY) });
    const canonical = await tender({ title: 'Canonical copy', stateCode: 'UP', status: 'CLOSED' });
    await tender({ title: 'Duplicate copy', stateCode: 'UP', duplicateOfId: canonical.id, closingAt: new Date(Date.now() + DAY) });
  });

  it('aggregates only live tenders: totals, per-state figures, buyers, value bands and portals', async () => {
    const res = await get('/market/snapshot').expect(200);
    const s = res.body.data;

    expect(s.liveTenders).toBe(3);
    expect(s.closingThisWeek).toEqual({ amount: '20000000.00', currency: 'INR' });
    expect(s.sources).toBe(1);
    expect(typeof s.lastCrawlAt).toBe('string');

    const byCode = Object.fromEntries((s.states as { code: string }[]).map((st) => [st.code, st]));
    expect(byCode.MH).toEqual({ code: 'MH', name: 'Maharashtra', type: 'STATE', live: 2, closingThisWeek: { amount: '20000000.00', currency: 'INR' }, topBuyer: 'Pune Municipal Corporation' });
    // No resolved entity: the raw department is the state's top buyer.
    expect(byCode.UP).toMatchObject({ live: 1, closingThisWeek: { amount: '0.00', currency: 'INR' }, topBuyer: 'UP PWD' });

    expect(s.topBuyers).toEqual([{ id: entityId, name: 'Pune Municipal Corporation', shortName: null, live: 2, value: { amount: '25000000.00', currency: 'INR' } }]);
    expect(Object.fromEntries((s.valueBands as { key: string; count: number }[]).map((b) => [b.key, b.count]))).toEqual({
      UNDER_10L: 0,
      '10L_TO_1CR': 1,
      '1CR_TO_10CR': 1,
      '10CR_TO_100CR': 1,
      OVER_100CR: 0,
    });
    // Every record was first seen today (IST), live or not.
    expect(s.portals).toEqual([{ id: sourceId, name: 'GeM', status: 'ok', lastSyncedAt: expect.any(String), today: 9 }]);
  });

  it('serves the snapshot from the Redis cache until it expires', async ({ skip }) => {
    if (!hasRedis) skip();
    expect((await get('/market/snapshot').expect(200)).body.data.liveTenders).toBe(3);
    await tender({ title: 'Published after the snapshot', stateCode: 'MH' });
    expect((await get('/market/snapshot').expect(200)).body.data.liveTenders).toBe(3);
    expect(await redis.ttl(cacheKey)).toBeGreaterThan(0);

    await redis.del(cacheKey);
    expect((await get('/market/snapshot').expect(200)).body.data.liveTenders).toBe(4);
  });

  it('wire lists live tenders newest first, optionally for one state', async () => {
    const all = (await get('/market/wire').expect(200)).body.data as Row[];
    expect(all.map((t) => t.title)).toEqual(['Bridge repair, Lucknow', 'Road resurfacing, Pune', 'School furniture, Pune']);
    expect(all[0]).toMatchObject({ department: 'UP PWD', value: { amount: '200000000.00', currency: 'INR' }, state: { code: 'UP', name: 'Uttar Pradesh' } });
    expect(all[1]).toMatchObject({ department: 'Pune Municipal Corporation', state: { code: 'MH', name: 'Maharashtra' } });

    const mh = (await get('/market/wire?state=MH&limit=1').expect(200)).body.data as Row[];
    expect(mh.map((t) => t.title)).toEqual(['Road resurfacing, Pune']);
  });

  it('closing board lists live tenders with a deadline, soonest first', async () => {
    const rows = (await get('/market/closing').expect(200)).body.data as (Row & { closingAt: string })[];
    expect(rows.map((t) => t.title)).toEqual(['Road resurfacing, Pune', 'School furniture, Pune']);
    expect(Date.parse(rows[0].closingAt)).toBeGreaterThan(Date.now());
  });

  it.each(['/market/wire?state=mh', '/market/wire?limit=0', '/market/wire?limit=51', '/market/closing?limit=21', '/market/closing?foo=1'])('rejects invalid query %s', async (path) => {
    const res = await get(path).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});
