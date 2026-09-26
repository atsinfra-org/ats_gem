import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ApiModule } from '../src/api.module';
import { configureApp } from '../src/bootstrap/configure-app';
import { AppConfig } from '../src/config/app-config.service';
import { PrismaService } from '../src/database/prisma.service';
import type { Prisma } from '../src/generated/prisma/client';
import { withConfig } from './support/config';
import { resetDatabase } from './support/database';

type Row = { id: string; title: string };

describe('District & city search filters (e2e, PostgreSQL)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let sourceId: string;
  let entityA: string;
  let entityB: string;
  let catA: string;
  let distPune: string;
  let distNagpur: string;
  let distLucknow: string;

  const get = (path: string) => request(app.getHttpServer()).get(`/api/v1${path}`);
  let token = '';
  const search = async (qs: string, auth = false) => {
    const r = get(`/search/tenders?${qs}`);
    const res = await (auth ? r.set('Authorization', `Bearer ${token}`) : r).expect(200);
    return { rows: res.body.data as Row[], total: res.body.meta.pagination.total as number };
  };
  const titles = (rows: Row[]) => rows.map((r) => r.title).sort();

  async function tender(over: Partial<Prisma.TenderUncheckedCreateInput> & { title: string }) {
    const t = await prisma.tender.create({
      data: { publishedAt: new Date('2026-09-10T00:00:00Z'), currency: 'INR', status: 'OPEN', statusComputedAt: new Date(), lastSyncedAt: new Date(), lifecycle: 'ACTIVE', ...over },
    });
    await prisma.tenderSourceRecord.create({
      data: { tenderId: t.id, sourceId, externalTenderId: `ext-${t.id}`, payloadHash: 'a'.repeat(64), rawPayload: {}, normalizedPayload: {}, firstSeenAt: new Date(), lastSeenAt: new Date(), lastChangedAt: new Date() },
    });
    return t;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ApiModule] })
      .overrideProvider(AppConfig)
      .useFactory(withConfig({ RATE_LIMIT_SEARCH_MAX: 100_000 }))
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  async function signIn() {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/register').send({ name: 'Loc User', email: `loc-${Date.now()}@example.com`, password: 'correct-horse-battery', acceptTerms: true }).expect(201);
    token = (res.body as { data: { accessToken: string } }).data.accessToken;
  }
  afterAll(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE districts CASCADE');
    await app?.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await prisma.$executeRawUnsafe('TRUNCATE TABLE search_history, search_events, search_index_runs, categories, districts CASCADE');
    for (const [code, name] of [['MH', 'Maharashtra'], ['UP', 'Uttar Pradesh']] as const) {
      await prisma.state.upsert({ where: { code }, create: { code, name, type: 'STATE' }, update: {} });
    }
    sourceId = (await prisma.tenderSource.create({ data: { name: 'Src', slug: `s-${Math.random().toString(36).slice(2, 8)}`, sourceType: 'MOCK', adapterKey: 'mock', crawlConfig: {} } })).id;
    entityA = (await prisma.procuringEntity.create({ data: { name: 'Pune Municipal Corporation', nameNormalized: 'pune municipal corporation', entityType: 'OTHER', stateCode: 'MH' } })).id;
    entityB = (await prisma.procuringEntity.create({ data: { name: 'Nagpur Works Dept', nameNormalized: 'nagpur works dept', entityType: 'OTHER', stateCode: 'MH' } })).id;
    catA = (await prisma.category.create({ data: { name: 'Roads & Bridges', slug: 'roads' } })).id;
    distPune = (await prisma.district.create({ data: { stateCode: 'MH', name: 'Pune' } })).id;
    distNagpur = (await prisma.district.create({ data: { stateCode: 'MH', name: 'Nagpur' } })).id;
    distLucknow = (await prisma.district.create({ data: { stateCode: 'UP', name: 'Lucknow' } })).id;
  });

  describe('district filter', () => {
    beforeEach(async () => {
      await tender({ title: 'Road repair Pune', districtId: distPune, stateCode: 'MH', categoryId: catA, procuringEntityId: entityA, city: 'Pune' });
      await tender({ title: 'Bridge repair Pune', districtId: distPune, stateCode: 'MH', procuringEntityId: entityA, city: 'Pune' });
      await tender({ title: 'Road repair Nagpur', districtId: distNagpur, stateCode: 'MH', categoryId: catA, procuringEntityId: entityB, city: 'Nagpur' });
      await tender({ title: 'Road repair Lucknow', districtId: distLucknow, stateCode: 'UP', categoryId: catA, city: 'Lucknow' });
      await tender({ title: 'Road repair no district', stateCode: 'MH' });
    });

    it('filters by one district and by several', async () => {
      expect(titles((await search(`district=${distPune}`)).rows)).toEqual(['Bridge repair Pune', 'Road repair Pune']);
      expect(titles((await search(`district=${distPune},${distLucknow}`)).rows)).toEqual(['Bridge repair Pune', 'Road repair Lucknow', 'Road repair Pune']);
      expect(titles((await search(`district=${distPune}&district=${distNagpur}`)).rows)).toHaveLength(3);
    });

    it('combines with keyword, state, category and organization', async () => {
      expect(titles((await search(`q=road&district=${distPune}`)).rows)).toEqual(['Road repair Pune']);
      expect(titles((await search(`district=${distPune},${distLucknow}&state=UP`)).rows)).toEqual(['Road repair Lucknow']);
      expect(titles((await search(`district=${distPune},${distNagpur}&category=${catA}`)).rows)).toEqual(['Road repair Nagpur', 'Road repair Pune']);
      expect(titles((await search(`district=${distPune},${distNagpur}&procuringEntity=${entityB}`)).rows)).toEqual(['Road repair Nagpur']);
      expect(titles((await search(`district=${distPune}&state=UP`)).rows)).toEqual([]);
    });

    it('rejects malformed values and returns an empty page for an unknown district', async () => {
      expect((await get('/search/tenders?district=pune')).status).toBe(400);
      expect((await get(`/search/tenders?district=${distPune},nope`)).status).toBe(400);
      const unknown = await search('district=0198c1a2-3b4c-7d5e-8f60-123456789abc');
      expect(unknown).toEqual({ rows: [], total: 0 });
    });

    it('paginates stably', async () => {
      await signIn();
      const res = await Promise.all([1, 2, 3].map((page) => search(`district=${distPune},${distNagpur},${distLucknow}&pageSize=2&page=${page}`, true)));
      expect(res[0].total).toBe(4);
      const ids = res.flatMap((r) => r.rows.map((x) => x.id));
      expect(ids).toHaveLength(4);
      expect(new Set(ids).size).toBe(4);
      expect(res[2].rows).toEqual([]);
    });

    it('lists districts for the filter UI, scoped by state; empty without data', async () => {
      const mh = (await get('/meta/districts?state=MH').expect(200)).body.data as { name: string }[];
      expect(mh.map((d) => d.name)).toEqual(['Nagpur', 'Pune']);
      expect((await get('/meta/districts?state=UP').expect(200)).body.data).toHaveLength(1);
      expect((await get('/meta/districts?state=zz').expect(200)).body.data).toHaveLength(3);
      await prisma.$executeRawUnsafe('UPDATE tenders SET district_id = NULL');
      await prisma.$executeRawUnsafe('TRUNCATE TABLE districts CASCADE');
      expect((await get('/meta/districts?state=MH').expect(200)).body.data).toEqual([]);
    });
  });

  describe('city filter', () => {
    beforeEach(async () => {
      await tender({ title: 'Road repair Pune', city: 'Pune', stateCode: 'MH', categoryId: catA, procuringEntityId: entityA });
      await tender({ title: 'Bridge Pune', city: 'PUNE', stateCode: 'MH' });
      await tender({ title: 'Road repair Nagpur', city: 'Nagpur', stateCode: 'MH', categoryId: catA, procuringEntityId: entityB });
      await tender({ title: 'Road repair Lucknow', city: 'Lucknow', stateCode: 'UP' });
      await tender({ title: 'No city road', stateCode: 'MH' });
    });

    it('matches case-insensitively, exactly, singly and in lists', async () => {
      expect(titles((await search('city=pune')).rows)).toEqual(['Bridge Pune', 'Road repair Pune']);
      expect(titles((await search('city=PUNE,nagpur')).rows)).toHaveLength(3);
      expect(titles((await search('city=Pun')).rows)).toEqual([]);
    });

    it('combines with keyword, state, category and organization', async () => {
      expect(titles((await search('q=road&city=pune')).rows)).toEqual(['Road repair Pune']);
      expect(titles((await search('city=pune,lucknow&state=UP')).rows)).toEqual(['Road repair Lucknow']);
      expect(titles((await search(`city=pune,nagpur&category=${catA}`)).rows)).toEqual(['Road repair Nagpur', 'Road repair Pune']);
      expect(titles((await search(`city=pune,nagpur&procuringEntity=${entityA}`)).rows)).toEqual(['Road repair Pune']);
    });

    it('returns empty pages for unknown cities, rejects bad values, and paginates', async () => {
      expect(await search('city=atlantis')).toEqual({ rows: [], total: 0 });
      expect((await get(`/search/tenders?city=${'x'.repeat(101)}`)).status).toBe(400);
      expect((await get('/search/tenders?' + Array.from({ length: 21 }, (_, i) => `city=c${i}`).join('&'))).status).toBe(400);
      await signIn();
      const a = await search('city=pune,nagpur,lucknow&pageSize=2&page=1', true);
      const b = await search('city=pune,nagpur,lucknow&pageSize=2&page=2', true);
      expect(a.total).toBe(4);
      expect(new Set([...a.rows, ...b.rows].map((r) => r.id)).size).toBe(4);
    });

    it('treats hostile city text as data', async () => {
      const res = await search(`city=${encodeURIComponent("x'; DROP TABLE tenders;--")}`);
      expect(res.total).toBe(0);
      expect(await prisma.tender.count()).toBe(5);
    });
  });

  describe('GET /search/cities (server-side lookup)', () => {
    beforeEach(async () => {
      await tender({ title: 'a', city: 'Pune', stateCode: 'MH' });
      await tender({ title: 'b', city: 'PUNE', stateCode: 'MH' });
      await tender({ title: 'c', city: 'Punjab Town', stateCode: 'UP' });
      await tender({ title: 'd', city: 'Nagpur', stateCode: 'MH' });
      const dup = await tender({ title: 'dup', city: 'Punegone', stateCode: 'MH' });
      await prisma.tender.update({ where: { id: dup.id }, data: { deletedAt: new Date() } });
    });

    it('returns distinct real cities with counts, prefix matches first', async () => {
      const res = (await get('/search/cities?q=pun').expect(200)).body.data as { name: string; count: number }[];
      expect(res.map((c) => [c.name.toLowerCase(), c.count])).toEqual([['pune', 2], ['punjab town', 1]]);
    });

    it('scopes by state, requires two characters, and ignores deleted tenders', async () => {
      expect(((await get('/search/cities?q=pun&state=UP').expect(200)).body.data as { name: string }[]).map((c) => c.name)).toEqual(['Punjab Town']);
      expect((await get('/search/cities?q=p').expect(200)).body.data).toEqual([]);
      expect((await get('/search/cities').expect(200)).body.data).toEqual([]);
      expect((await get('/search/cities?q=punegone').expect(200)).body.data).toEqual([]);
    });

    it('is safe against LIKE wildcards and injection', async () => {
      expect((await get('/search/cities?q=%25%25').expect(200)).body.data).toEqual([]);
      expect((await get(`/search/cities?q=${encodeURIComponent("'; DROP TABLE tenders;--")}`).expect(200)).body.data).toEqual([]);
      expect(await prisma.tender.count()).toBe(5);
    });
  });

  describe('GET /search/entities?ids= (labels for shared links)', () => {
    it('resolves names for valid ids only, ignoring junk', async () => {
      const ok = (await get(`/search/entities?ids=${entityA},${entityB},not-a-uuid`).expect(200)).body.data as { id: string; name: string }[];
      expect(ok.map((e) => e.name)).toEqual(["Nagpur Works Dept", "Pune Municipal Corporation"]);
      expect((await get("/search/entities?ids=junk").expect(200)).body.data).toEqual([]);
      expect((await get("/search/entities?ids=0198c1a2-3b4c-7d5e-8f60-123456789abc").expect(200)).body.data).toEqual([]);
    });
  });
});
