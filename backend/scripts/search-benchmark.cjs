/* Search latency benchmark. Only runs against a database whose name contains "bench" (synthetic data). */
const { NestFactory } = require('@nestjs/core');
const { ApiModule } = require('../dist/api.module');
const { SearchService } = require('../dist/search/search.service');
const { SearchIndexService } = require('../dist/search/search-index.service');
const { plainToInstance } = require('class-transformer');
const { ListTendersQueryDto } = require('../dist/tenders/dto/list-tenders.query.dto');

const dbName = new URL(process.env.DATABASE_URL).pathname;
if (!/bench/i.test(dbName)) {
  console.error('Refusing to run: DATABASE_URL must point at a *bench* database.');
  process.exit(2);
}

const ITER = Number(process.env.BENCH_ITER ?? 60);
const pct = (a, p) => a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))];

const scenarios = [
  ['browse (no query, newest)', {}],
  ['keyword: "road construction"', { q: 'road construction' }],
  ['keyword prefix: "constr"', { q: 'constr' }],
  ['keyword rare multi-term: "transformer culvert Guwahati"', { q: 'transformer culvert Guwahati' }],
  ['typo: "constructon"', { q: 'constructon' }],
  ['reference exact: BENCH/2023/0123456', { q: 'BENCH/2023/0123456' }],
  ['reference partial: 0123456', { reference: '0123456' }],
  ['filter state=MH', { state: 'MH' }],
  ['filters state+status+value range', { state: ['MH', 'UP'], status: ['OPEN'], minValue: '1000000', maxValue: '50000000' }],
  ['filter category (parent expansion)', { category: ['__CAT__'] }],
  ['filter entity', { procuringEntity: ['__ENT__'] }],
  ['filter source', { source: ['__SRC__'] }],
  ['date range closing (IST)', { closingFrom: '2026-10-01', closingTo: '2026-10-31' }],
  ['keyword + filters + sort closingSoonest', { q: 'road', state: 'MH', status: 'OPEN', sort: 'closingSoonest' }],
  ['keyword + sort valueHigh', { q: 'solar', sort: 'valueHigh' }],
  ['deep page (page 200, size 20)', { q: 'road', page: 200 }],
  ['no match', { q: 'zzzzqqqq' }],
];

(async () => {
  const app = await NestFactory.createApplicationContext(ApiModule, { logger: false });
  const svc = app.get(SearchService);
  const prisma = app.get(require('../dist/database/prisma.service').PrismaService);
  const cat = (await prisma.category.findFirst()).id;
  const ent = (await prisma.$queryRaw`SELECT procuring_entity_id::text AS id FROM tenders WHERE procuring_entity_id IS NOT NULL LIMIT 1`)[0].id;
  const src = (await prisma.tenderSource.findFirst()).id;
  const fill = (o) => JSON.parse(JSON.stringify(o).replace('__CAT__', cat).replace('__ENT__', ent).replace('__SRC__', src));
  const total = await prisma.tender.count();
  console.log(JSON.stringify({ dataset: 'synthetic', tenders: total, iterations: ITER }));

  const run = (q) => {
    const dto = plainToInstance(ListTendersQueryDto, fill(q));
    return svc.search(dto, { page: Number(dto.page ?? 1), pageSize: 20 });
  };
  const results = [];
  for (const [name, q] of scenarios) {
    for (let i = 0; i < 3; i++) await run(q);
    const times = [];
    let count = 0;
    for (let i = 0; i < ITER; i++) {
      const t0 = process.hrtime.bigint();
      const out = await run(q);
      times.push(Number(process.hrtime.bigint() - t0) / 1e6);
      count = out.total ?? out.hits?.length;
    }
    times.sort((a, b) => a - b);
    results.push({ scenario: name, total: count, p50: +pct(times, 50).toFixed(1), p95: +pct(times, 95).toFixed(1), p99: +pct(times, 99).toFixed(1), max: +times[times.length - 1].toFixed(1) });
  }
  console.table(results);

  for (const conc of [10, 25]) {
    const q = scenarios[1][1];
    const t0 = Date.now();
    const lat = [];
    let done = 0;
    await Promise.all(
      Array.from({ length: conc }, async () => {
        for (let i = 0; i < 20; i++) {
          const s = process.hrtime.bigint();
          await run(q);
          lat.push(Number(process.hrtime.bigint() - s) / 1e6);
          done++;
        }
      }),
    );
    lat.sort((a, b) => a - b);
    console.log(JSON.stringify({ concurrency: conc, requests: done, seconds: (Date.now() - t0) / 1000, rps: +(done / ((Date.now() - t0) / 1000)).toFixed(1), p50: +pct(lat, 50).toFixed(1), p95: +pct(lat, 95).toFixed(1), p99: +pct(lat, 99).toFixed(1) }));
  }

  if (process.env.BENCH_REINDEX === '1') {
    const r = await app.get(SearchIndexService).reindex({ batchSize: 5000 });
    console.log(JSON.stringify({ reindex: { processed: r.processed, batches: r.batches, seconds: r.durationMs / 1000, perSec: r.throughputPerSec } }));
  }
  await app.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
