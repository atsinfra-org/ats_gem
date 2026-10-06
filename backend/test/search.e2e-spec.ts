import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ApiModule } from '../src/api.module';
import { configureApp } from '../src/bootstrap/configure-app';
import { PrismaService } from '../src/database/prisma.service';
import type { Prisma } from '../src/generated/prisma/client';
import { SearchIndexService } from '../src/search/search-index.service';
import { withConfig } from './support/config';
import { deletePrefix } from './support/redis';
import { resetDatabase } from './support/database';
import { AppConfig } from '../src/config/app-config.service';

type Row = { id: string; title: string; matchReason: string | null; referenceNumber: string | null };

describe('Search & discovery (e2e, PostgreSQL)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let index: SearchIndexService;
  let sourceId: string;
  let sourceB: string;
  let entityId: string;
  let parentCat: string;
  let childCat: string;

  const get = (path: string, token?: string) => {
    const r = request(app.getHttpServer()).get(`/api/v1${path}`);
    return token ? r.set('Authorization', `Bearer ${token}`) : r;
  };
  const search = async (qs: string, token?: string) => {
    const res = await get(`/search/tenders?${qs}`, token).expect(200);
    return { rows: res.body.data as Row[], meta: res.body.meta as { pagination: { total: number; totalPages: number; totalCapped: boolean; page: number }; sort: string; ranked: boolean } };
  };
  const titles = (rows: Row[]) => rows.map((r) => r.title);

  async function tender(over: Partial<Prisma.TenderUncheckedCreateInput> & { title: string }, withSource = sourceId) {
    const created = await prisma.tender.create({
      data: { publishedAt: new Date('2026-09-10T00:00:00Z'), currency: 'INR', status: 'OPEN', statusComputedAt: new Date(), lastSyncedAt: new Date(), lifecycle: 'ACTIVE', ...over },
    });
    await prisma.tenderSourceRecord.create({
      data: { tenderId: created.id, sourceId: withSource, externalTenderId: `ext-${created.id}`, payloadHash: 'a'.repeat(64), rawPayload: {}, normalizedPayload: {}, firstSeenAt: new Date(), lastSeenAt: new Date(), lastChangedAt: new Date() },
    });
    return created;
  }

  async function register(email: string) {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/register').send({ name: 'Search User', email, password: 'correct-horse-battery', acceptTerms: true }).expect(201);
    return { id: res.body.data.user.id as string, token: res.body.data.accessToken as string };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ApiModule] })
      .overrideProvider(AppConfig)
      .useFactory(withConfig({ RATE_LIMIT_AUTH_MAX: 100_000, RATE_LIMIT_SEARCH_MAX: 100_000 }))
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    index = app.get(SearchIndexService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await prisma.$executeRawUnsafe('TRUNCATE TABLE search_history, search_events, search_index_runs, categories, districts CASCADE');
    sourceId = (await prisma.tenderSource.create({ data: { name: 'Source A', slug: `a-${Math.random().toString(36).slice(2, 8)}`, sourceType: 'MOCK', adapterKey: 'mock', crawlConfig: {} } })).id;
    sourceB = (await prisma.tenderSource.create({ data: { name: 'Source B', slug: `b-${Math.random().toString(36).slice(2, 8)}`, sourceType: 'MOCK', adapterKey: 'mock', crawlConfig: {} } })).id;
    entityId = (await prisma.procuringEntity.create({ data: { name: 'Delhi Jal Board', nameNormalized: 'delhi jal board', entityType: 'OTHER', stateCode: 'DL' } })).id;
    parentCat = (await prisma.category.create({ data: { name: 'Construction & Infrastructure', slug: 'construction' } })).id;
    childCat = (await prisma.category.create({ data: { name: 'Roads & Bridges', slug: 'roads', parentId: parentCat } })).id;
  });

  afterAll(() => app?.close());

  describe('keyword search & normalization', () => {
    it('finds tokenized equivalents of "road construction" and ignores case/whitespace/punctuation', async () => {
      await tender({ title: 'Construction of 4-lane road near Pune' });
      await tender({ title: 'Road-construction works, phase 2' });
      await tender({ title: 'Supply of medical equipment' });
      for (const q of ['road construction', '  ROAD   Construction ', 'road,construction!']) {
        const { rows } = await search(`q=${encodeURIComponent(q)}`);
        expect(titles(rows).sort()).toEqual(['Construction of 4-lane road near Pune', 'Road-construction works, phase 2']);
      }
    });

    it('matches prefixes and tolerates typos', async () => {
      await tender({ title: 'Construction of bypass road' });
      expect(titles((await search('q=constr')).rows)).toEqual(['Construction of bypass road']);
      expect(titles((await search('q=constructon')).rows)).toEqual(['Construction of bypass road']);
    });

    it('matches on procuring entity, category and location fields (not just the title)', async () => {
      await tender({ title: 'Annual maintenance contract', procuringEntityId: entityId });
      await tender({ title: 'Widening works', categoryId: childCat, city: 'Guwahati' });
      expect(titles((await search('q=jal board')).rows)).toEqual(['Annual maintenance contract']);
      expect(titles((await search('q=roads')).rows)).toEqual(['Widening works']);
      expect(titles((await search('q=guwahati')).rows)).toEqual(['Widening works']);
    });

    it('is safe against injection-style input and rejects over-long queries', async () => {
      await tender({ title: 'Ordinary tender' });
      for (const q of ["'; DROP TABLE tenders;--", 'a & | ! <-> (', '\\']) {
        await get(`/search/tenders?q=${encodeURIComponent(q)}`).expect(200);
      }
      expect(await prisma.tender.count()).toBe(1);
      const res = await get(`/search/tenders?q=${'x'.repeat(401)}`).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      const long = await get(`/search/tenders?q=${'y'.repeat(300)}`).expect(400);
      expect(long.body.error.message).toMatch(/too long/i);
    });

    it('returns an empty page (not an error) for no matches', async () => {
      await tender({ title: 'Something else' });
      const { rows, meta } = await search('q=zzzzqqqq');
      expect(rows).toEqual([]);
      expect(meta.pagination.total).toBe(0);
    });
  });

  describe('reference search & ranking', () => {
    it('distinguishes exact, prefix and partial reference matches and ranks exact first', async () => {
      await tender({ title: 'Reference exact', referenceNumber: 'PWD/2026/0012', referenceNumberNormalized: 'PWD20260012' });
      await tender({ title: 'Reference prefix', referenceNumber: 'PWD/2026/0012-A', referenceNumberNormalized: 'PWD20260012A' });
      await tender({ title: 'Reference partial', referenceNumber: 'X/PWD/2026/0012', referenceNumberNormalized: 'XPWD20260012' });
      const { rows } = await search(`q=${encodeURIComponent('pwd/2026/0012')}`);
      expect(rows.map((r) => [r.title, r.matchReason])).toEqual([
        ['Reference exact', 'REFERENCE_EXACT'],
        ['Reference prefix', 'REFERENCE_PREFIX'],
        ['Reference partial', 'REFERENCE_PARTIAL'],
      ]);
    });

    it('the reference filter is punctuation-insensitive and exact-or-prefix', async () => {
      await tender({ title: 'A', referenceNumber: 'PWD/2026/0012', referenceNumberNormalized: 'PWD20260012' });
      await tender({ title: 'B', referenceNumber: 'OTHER/1', referenceNumberNormalized: 'OTHER1' });
      expect(titles((await search(`reference=${encodeURIComponent('pwd-2026-0012')}`)).rows)).toEqual(['A']);
      expect(titles((await search('reference=PWD2026')).rows)).toEqual(['A']);
    });

    it('ranks title phrase > title terms > entity-only match, deterministically, with reasons', async () => {
      await tender({ title: 'Solar rooftop project', procuringEntityId: entityId });
      await tender({ title: 'Delhi Jal Board maintenance' });
      await tender({ title: 'Annual contract', procuringEntityId: entityId, department: 'Delhi Jal Board' });
      await tender({ title: 'Works for Board of Delhi Jal' });
      const { rows, meta } = await search(`q=${encodeURIComponent('delhi jal board')}`);
      expect(meta.ranked).toBe(true);
      expect(rows[0]).toMatchObject({ title: 'Delhi Jal Board maintenance', matchReason: 'TITLE_PHRASE' });
      expect(rows[1].matchReason).toBe('TITLE_TERMS');
      expect(rows.some((r) => r.matchReason === 'ENTITY')).toBe(true);
      const again = await search(`q=${encodeURIComponent('delhi jal board')}`);
      expect(again.rows.map((r) => r.id)).toEqual(rows.map((r) => r.id));
    });
  });

  describe('filters', () => {
    it('multi-value state / status / tender type / city', async () => {
      await prisma.tenderType.createMany({ data: [{ key: 'OPEN', name: 'Open Tender' }, { key: 'EOI', name: 'EOI' }], skipDuplicates: true });
      await tender({ title: 'MH open', stateCode: 'MH', tenderTypeKey: 'OPEN', city: 'Pune' });
      await tender({ title: 'UP eoi', stateCode: 'UP', tenderTypeKey: 'EOI', status: 'CLOSED', city: 'Lucknow' });
      await tender({ title: 'DL other', stateCode: 'DL' });
      expect(titles((await search('state=MH,UP')).rows).sort()).toEqual(['MH open', 'UP eoi']);
      expect(titles((await search('state=MH&state=UP&status=CLOSED')).rows)).toEqual(['UP eoi']);
      expect(titles((await search('tenderType=EOI')).rows)).toEqual(['UP eoi']);
      expect(titles((await search('city=pune')).rows)).toEqual(['MH open']);
    });

    it('a parent category also matches its children; procuring entity and source filters work', async () => {
      await tender({ title: 'In child', categoryId: childCat, procuringEntityId: entityId });
      await tender({ title: 'In parent', categoryId: parentCat }, sourceB);
      await tender({ title: 'Uncategorised' });
      expect(titles((await search(`category=${parentCat}`)).rows).sort()).toEqual(['In child', 'In parent']);
      expect(titles((await search(`category=${childCat}`)).rows)).toEqual(['In child']);
      expect(titles((await search(`procuringEntity=${entityId}`)).rows)).toEqual(['In child']);
      expect(titles((await search(`source=${sourceB}`)).rows)).toEqual(['In parent']);
    });

    it('value, EMD and fee ranges compare exact decimals (no float error) and are inclusive', async () => {
      await tender({ title: 'v-a', estimatedValue: '100000.10', emdAmount: '2000.00', tenderFee: '500.00' });
      await tender({ title: 'v-b', estimatedValue: '100000.11', emdAmount: '2000.01', tenderFee: '500.01' });
      await tender({ title: 'v-c', estimatedValue: '99999.99' });
      expect(titles((await search('minValue=100000.10&maxValue=100000.10')).rows)).toEqual(['v-a']);
      expect(titles((await search('minValue=100000.11')).rows)).toEqual(['v-b']);
      expect(titles((await search('minEmd=2000.01')).rows)).toEqual(['v-b']);
      expect(titles((await search('maxFee=500')).rows)).toEqual(['v-a']);
      expect((await get('/search/tenders?minValue=200&maxValue=100')).status).toBe(400);
    });

    it('date ranges use IST calendar-day semantics for date-only values and reject inverted ranges', async () => {
      // 2026-10-05 20:00 UTC == 2026-10-06 01:30 IST
      await tender({ title: 'closes-oct6-ist', closingAt: new Date('2026-10-05T20:00:00Z') });
      await tender({ title: 'closes-oct5-ist', closingAt: new Date('2026-10-05T10:00:00Z') });
      expect(titles((await search('closingFrom=2026-10-06&closingTo=2026-10-06')).rows)).toEqual(['closes-oct6-ist']);
      expect(titles((await search('closingFrom=2026-10-05&closingTo=2026-10-05')).rows)).toEqual(['closes-oct5-ist']);
      expect(titles((await search('closingFrom=2026-10-05&closingTo=2026-10-06')).rows).sort()).toEqual(['closes-oct5-ist', 'closes-oct6-ist']);
      expect(titles((await search('closingFrom=2026-10-05T20:00:00.000Z&closingTo=2026-10-05T20:00:00.000Z')).rows)).toEqual(['closes-oct6-ist']);
      expect((await get('/search/tenders?closingFrom=2026-10-07&closingTo=2026-10-06')).status).toBe(400);
      await tender({ title: 'published-later', publishedAt: new Date('2026-09-20T00:00:00Z') });
      expect(titles((await search('publishedFrom=2026-09-15')).rows)).toEqual(['published-later']);
    });

    it('rejects invalid filter values', async () => {
      for (const qs of ['state=maharashtra', 'status=NOPE', 'category=not-a-uuid', 'minValue=abc', 'sort=random', 'pageSize=1000']) {
        expect((await get(`/search/tenders?${qs}`)).status).toBe(400);
      }
    });
  });

  describe('sorting & pagination', () => {
    it('sorts deterministically by each supported key; relevance without a query is newest-first', async () => {
      await tender({ title: 'a', publishedAt: new Date('2026-09-01T00:00:00Z'), closingAt: new Date('2026-10-20T00:00:00Z'), estimatedValue: '300.00' });
      await tender({ title: 'b', publishedAt: new Date('2026-09-03T00:00:00Z'), closingAt: new Date('2026-10-10T00:00:00Z'), estimatedValue: '100.00' });
      await tender({ title: 'c', publishedAt: new Date('2026-09-02T00:00:00Z'), estimatedValue: '200.00' });
      const order = async (sort: string) => titles((await search(`sort=${sort}`)).rows);
      expect(await order('newest')).toEqual(['b', 'c', 'a']);
      expect(await order('relevance')).toEqual(['b', 'c', 'a']);
      expect((await search('sort=relevance')).meta.sort).toBe('newest');
      expect(await order('closingSoonest')).toEqual(['b', 'a', 'c']);
      expect(await order('closingLatest')).toEqual(['a', 'b', 'c']);
      expect(await order('valueHigh')).toEqual(['a', 'c', 'b']);
      expect(await order('valueLow')).toEqual(['b', 'c', 'a']);
      expect(titles((await search('sortBy=estimatedValue&sortOrder=asc')).rows)).toEqual(['b', 'c', 'a']);
    });

    it('pages are stable and duplicate-free even when sort keys tie', async () => {
      for (let i = 0; i < 25; i++) await tender({ title: `tie ${i}` }); // identical publishedAt
      const seen = new Set<string>();
      for (let page = 1; page <= 3; page++) {
        const { rows, meta } = await search(`pageSize=10&page=${page}`, await (async () => (await register(`pager${page}-${Date.now()}@example.com`)).token)());
        expect(meta.pagination.total).toBe(25);
        for (const r of rows) {
          expect(seen.has(r.id)).toBe(false);
          seen.add(r.id);
        }
      }
      expect(seen.size).toBe(25);
      const { token } = await register(`pager-last-${Date.now()}@example.com`);
      expect((await search('pageSize=10&page=4', token)).rows).toEqual([]);
    });

    it('refuses pages beyond the pageable window with a helpful error', async () => {
      const { token } = await register(`deep-${Date.now()}@example.com`);
      const res = await get('/search/tenders?page=10000&pageSize=100', token).expect(400);
      expect(res.body.error.details[0].code).toBe('PAGE_TOO_DEEP');
    });

    it('caps anonymous callers to the first, small page', async () => {
      for (let i = 0; i < 30; i++) await tender({ title: `anon ${i}` });
      const { rows, meta } = await search('page=3&pageSize=100');
      expect(rows).toHaveLength(20);
      expect(meta.pagination.page).toBe(1);
    });
  });

  describe('indexing lifecycle', () => {
    it('a created tender is searchable immediately, and deduplicated/archived/deleted ones are not', async () => {
      const kept = await tender({ title: 'Lifecycle keeper' });
      const dup = await tender({ title: 'Lifecycle duplicate' });
      await prisma.tender.update({ where: { id: dup.id }, data: { duplicateOfId: kept.id } });
      const gone = await tender({ title: 'Lifecycle deleted' });
      await prisma.tender.update({ where: { id: gone.id }, data: { deletedAt: new Date() } });
      expect(titles((await search('q=lifecycle')).rows)).toEqual(['Lifecycle keeper']);
    });

    it('an update and an admin correction change what is found', async () => {
      const t = await tender({ title: 'Old wording alpha' });
      await prisma.tender.update({ where: { id: t.id }, data: { title: 'New wording beta' } });
      expect(await search('q=alpha').then((r) => r.rows)).toEqual([]);
      expect(titles((await search('q=beta')).rows)).toEqual(['New wording beta']);

      const admin = await register(`admin-${Date.now()}@example.com`);
      const role = await prisma.role.findFirstOrThrow({ where: { key: 'SUPER_ADMIN' } });
      await prisma.userRole.create({ data: { userId: admin.id, roleId: role.id } });
      await request(app.getHttpServer()).patch(`/api/v1/tenders/${t.id}/correct`).set('Authorization', `Bearer ${admin.token}`).send({ title: 'Corrected gamma title', reason: 'test' }).expect(200);
      expect(await search('q=beta').then((r) => r.rows)).toEqual([]);
      expect(titles((await search('q=gamma')).rows)).toEqual(['Corrected gamma title']);
    });

    it('merging entities keeps entity-name search correct', async () => {
      const loser = await prisma.procuringEntity.create({ data: { name: 'DJB Old Name', nameNormalized: 'djb old name', entityType: 'OTHER' } });
      await tender({ title: 'Entity carried tender', procuringEntityId: loser.id });
      expect(titles((await search('q=djb')).rows)).toEqual(['Entity carried tender']);
      await prisma.tender.updateMany({ where: { procuringEntityId: loser.id }, data: { procuringEntityId: entityId } });
      expect(titles((await search('q=jal')).rows)).toEqual(['Entity carried tender']);
      expect(await search('q=djb').then((r) => r.rows)).toEqual([]);
    });

    it('verify detects missing/stale vectors, reindex repairs them, and both are repeatable', async () => {
      const a = await tender({ title: 'Index alpha' });
      await tender({ title: 'Index beta' });
      expect((await index.verify()).consistent).toBe(true);
      await prisma.$executeRawUnsafe(`UPDATE tenders SET search_vector = NULL WHERE id = '${a.id}'`);
      await prisma.$executeRawUnsafe(`UPDATE tenders SET search_vector = to_tsvector('simple', 'garbage') WHERE title = 'Index beta'`);
      const bad = await index.verify();
      expect(bad).toMatchObject({ missingVector: 1, staleVector: 1, consistent: false });
      const report = await index.reindex({ batchSize: 100 });
      expect(report.processed).toBe(2);
      expect((await index.verify()).consistent).toBe(true);
      expect(titles((await search('q=alpha')).rows)).toEqual(['Index alpha']);
      const again = await index.reindex();
      expect(again.processed).toBe(2);
      expect(await prisma.tender.count()).toBe(2); // no duplicated rows
    });

    it('reindex processes in batches and records an observable run', async () => {
      for (let i = 0; i < 7; i++) await tender({ title: `batch ${i}` });
      const report = await index.reindex({ batchSize: 100 });
      expect(report.processed).toBe(7);
      const run = await prisma.searchIndexRun.findUniqueOrThrow({ where: { id: report.runId } });
      expect(run).toMatchObject({ kind: 'REINDEX', status: 'COMPLETED', processed: 7 });
    });

    it('the search.index-tender refresh is idempotent and picks up a renamed category', async () => {
      const t = await tender({ title: 'Categorised work', categoryId: childCat });
      expect(titles((await search('q=bridges')).rows)).toEqual(['Categorised work']);
      await prisma.category.update({ where: { id: childCat }, data: { name: 'Culverts' } });
      expect(await search('q=culverts').then((r) => r.rows)).toEqual([]); // the trigger cannot see this change...
      expect(await index.refreshTender(t.id)).toBe(true); // ...the indexing job does
      expect(await index.refreshTender(t.id)).toBe(true);
      expect(titles((await search('q=culverts')).rows)).toEqual(['Categorised work']);
      expect(await index.refreshTender('00000000-0000-7000-8000-000000000000')).toBe(false);
    });

    it('reports search health', async () => {
      await tender({ title: 'Health tender' });
      await index.reindex();
      const res = await get('/search/health').expect(200);
      expect(res.body.data).toMatchObject({ provider: 'postgres', available: true, totalTenders: 1, indexedTenders: 1, unindexedTenders: 0 });
      expect(res.body.data.lastRun.kind).toBe('REINDEX');
      expect(JSON.stringify(res.body)).not.toMatch(/postgres:\/\/|password|localhost/);
    });
  });

  type Sug = { entities: { name: string }[]; states: { code: string }[]; recent: { query: string }[]; popular: unknown[]; categories: { name: string }[]; references: unknown[] };

  describe('history, suggestions, events', () => {
    it('records history only for signed-in users, dedupes repeats, and scopes every read/delete to the owner', async () => {
      await tender({ title: 'History target road' });
      const u1 = await register(`h1-${Date.now()}@example.com`);
      const u2 = await register(`h2-${Date.now()}@example.com`);
      await search('q=road'); // anonymous: not stored
      await search('q=road', u1.token);
      await search('q=%20Road%20', u1.token); // same normalized query
      await search('q=road&state=MH', u1.token); // different filters => separate entry
      await new Promise((r) => setTimeout(r, 300));
      const list = (await get('/search/history', u1.token).expect(200)).body.data as { id: string; queryNormalized: string; searchCount: number }[];
      expect(list).toHaveLength(2);
      expect(list.find((h) => h.searchCount === 2)?.queryNormalized).toBe('road');
      expect((await get('/search/history', u2.token).expect(200)).body.data).toEqual([]);
      await request(app.getHttpServer()).delete(`/api/v1/search/history/${list[0].id}`).set('Authorization', `Bearer ${u2.token}`).expect(404);
      await request(app.getHttpServer()).delete(`/api/v1/search/history/${list[0].id}`).set('Authorization', `Bearer ${u1.token}`).expect(200);
      expect((await get('/search/history', u1.token)).body.data).toHaveLength(1);
      await request(app.getHttpServer()).delete('/api/v1/search/history').set('Authorization', `Bearer ${u1.token}`).expect(200);
      expect((await get('/search/history', u1.token)).body.data).toEqual([]);
      await get('/search/history').expect(401);
    });

    it('suggests references, entities, categories, states and own recent searches; popular terms require k distinct users', async () => {
      await prisma.state.upsert({ where: { code: 'DL' }, create: { code: 'DL', name: 'Delhi', type: 'UT' }, update: {} });
      await tender({ title: 'Ref tender', referenceNumber: 'DJB/2026/7', referenceNumberNormalized: 'DJB20267' });
      const users = [await register(`s1-${Date.now()}@example.com`), await register(`s2-${Date.now()}@example.com`), await register(`s3-${Date.now()}@example.com`)];
      await search('q=delhi%20works', users[0].token);
      await search('q=delhi%20works', users[1].token);
      await new Promise((r) => setTimeout(r, 300));
      const two = (await get('/search/suggestions?q=delhi', users[0].token).expect(200)).body.data as Sug;
      expect(two.entities.map((e) => e.name)).toContain('Delhi Jal Board');
      expect(two.states.map((s) => s.code)).toContain('DL');
      expect(two.recent.map((r) => r.query)).toContain('delhi works');
      expect(two.popular).toEqual([]);
      expect((await get('/search/suggestions?q=delhi', users[2].token)).body.data.recent).toEqual([]);
      await search('q=delhi%20works', users[2].token);
      await new Promise((r) => setTimeout(r, 300));
      expect((await get('/search/suggestions?q=delhi').expect(200)).body.data.popular).toEqual([{ query: 'delhi works' }]);
      const refs = (await get('/search/suggestions?q=djb/2026').expect(200)).body.data.references;
      expect(refs).toEqual([expect.objectContaining({ reference: 'DJB/2026/7' })]);
      expect(((await get('/search/suggestions?q=constr')).body.data as Sug).categories.map((c) => c.name)).toEqual(['Construction & Infrastructure']);
      const empty = (await get('/search/suggestions?q=a').expect(200)).body.data;
      expect(empty.entities).toEqual([]);
    });

    it('entity lookup is server-side, limited and requires 2+ characters', async () => {
      expect((await get('/search/entities?q=d').expect(200)).body.data).toEqual([]);
      expect((await get('/search/entities?q=jal').expect(200)).body.data).toEqual([expect.objectContaining({ name: 'Delhi Jal Board' })]);
    });

    it('stores valid analytics events (normalized, closed shape) and rejects malformed ones', async () => {
      const u = await register(`ev-${Date.now()}@example.com`);
      const post = (body: object, token?: string) => {
        const r = request(app.getHttpServer()).post('/api/v1/search/events').send(body);
        return token ? r.set('Authorization', `Bearer ${token}`) : r;
      };
      await post({ type: 'SEARCH_SUBMITTED', query: '  Road   Works ', resultCount: 12 }, u.token).expect(202);
      await post({ type: 'FILTER_APPLIED', name: 'state', value: 'MH' }).expect(202);
      const rows = await prisma.searchEvent.findMany({ orderBy: { createdAt: 'asc' } });
      expect(rows.map((r) => r.eventType)).toEqual(['SEARCH_SUBMITTED', 'FILTER_APPLIED']);
      expect(rows[0]).toMatchObject({ userId: u.id, queryNormalized: 'road works' });
      expect(rows[1].userId).toBeNull();
      await post({ type: 'NOT_A_TYPE' }).expect(400);
      await post({ type: 'SEARCH_SUBMITTED', password: 'hunter2', payload: { a: 1 } }).expect(400);
      await post({ type: 'RESULT_OPENED', value: 'x'.repeat(500) }).expect(400);
    });
  });

  describe('saved-search compatibility & meta', () => {
    it('accepts legacy criteria and the full enhanced criteria, rejects unknown/invalid fields', async () => {
      const u = await register(`ss-${Date.now()}@example.com`);
      const create = (criteria: object) => request(app.getHttpServer()).post('/api/v1/saved-searches').set('Authorization', `Bearer ${u.token}`).send({ name: 'S', criteria });
      await create({ q: 'road', state: 'MH', status: 'OPEN', publishedFrom: '2026-09-01' }).expect(201);
      const full = await create({ q: 'road', state: ['MH', 'UP'], category: [parentCat], minValue: '100.50', maxEmd: '5000', closingFrom: '2026-10-01', closingTo: '2026-10-31', sort: 'closingSoonest', tenderType: ['OPEN'] }).expect(201);
      expect(full.body.data.criteria.state).toEqual(['MH', 'UP']);
      expect(full.body.data.criteria.sort).toBe('closingSoonest');
      await create({ state: 'maharashtra' }).expect(400);
      await create({ minValue: 'lots' }).expect(400);
    });

    it('exposes sources and districts for filters without leaking crawl config', async () => {
      const sources = (await get('/meta/sources').expect(200)).body.data as Record<string, unknown>[];
      expect(sources.map((s) => s.name).sort()).toEqual(['Source A', 'Source B']);
      expect(Object.keys(sources[0]).sort()).toEqual(['id', 'name', 'slug']);
      expect((await get('/meta/districts?state=MH').expect(200)).body.data).toEqual([]);
    });
  });

  describe('failure handling', () => {
    it('degrades to a clean 503 (no internals) when the search query cannot run', async () => {
      await prisma.$executeRawUnsafe('ALTER TABLE tenders RENAME COLUMN search_vector TO search_vector_x');
      try {
        const res = await get('/search/tenders?q=anything').expect(503);
        expect(res.body.error.code).toBe('DEPENDENCY_UNAVAILABLE');
        expect(JSON.stringify(res.body)).not.toMatch(/search_vector|relation|column|SELECT|postgres/i);
        expect((await get('/search/tenders')).status).toBe(200); // browsing without a keyword still works
      } finally {
        await prisma.$executeRawUnsafe('ALTER TABLE tenders RENAME COLUMN search_vector_x TO search_vector');
      }
    });
  });
});

describe('Search rate limiting (e2e)', () => {
  it('returns 429 once the per-IP search budget is exhausted', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ApiModule] })
      .overrideProvider(AppConfig)
      .useFactory(withConfig({ RATE_LIMIT_SEARCH_MAX: 3, RATE_LIMIT_SEARCH_WINDOW_SECONDS: 60 }))
      .compile();
    await deletePrefix('rate-limit:search');
    const app2 = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
    configureApp(app2);
    await app2.init();
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) statuses.push((await request(app2.getHttpServer()).get('/api/v1/search/suggestions?q=abc')).status);
      expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
      expect(statuses.slice(3)).toEqual([429, 429]);
    } finally {
      await app2.close();
    }
  });
});
