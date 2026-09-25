import type { Job } from 'bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import { AppConfigModule } from '../src/config/config.module';
import { MockSourceAdapter } from '../src/crawler/adapters/mock/mock-source.adapter';
import { CrawlRunsService } from '../src/crawler/crawl-runs.service';
import { CrawlerModule } from '../src/crawler/crawler.module';
import { DiscoverSourceHandler } from '../src/crawler/handlers/discover-source.handler';
import { IngestTenderHandler } from '../src/crawler/handlers/ingest-tender.handler';
import { TenderIngestionService } from '../src/crawler/ingestion/tender-ingestion.service';
import { NormalizedTenderSchema } from '../src/crawler/normalization/normalized-tender';
import { DatabaseModule } from '../src/database/database.module';
import { PrismaService } from '../src/database/prisma.service';
import { LoggingModule } from '../src/logging/logging.module';
import { OutboxModule } from '../src/outbox/outbox.module';
import type { Prisma } from '../src/generated/prisma/client';
import { QueuesModule } from '../src/queues/queues.module';
import type { JobContext } from '../src/workers/job-handler';
import { resetDatabase } from './support/database';

const ANCHOR = new Date('2026-09-21T06:00:00Z');

function jobContext(overrides: Partial<JobContext> = {}): JobContext {
  return {
    jobId: 'test-job-1',
    queue: 'crawler.tender',
    jobName: 'crawler.ingest-tender',
    attempt: 1,
    maxAttempts: 3,
    isFinalAttempt: false,
    correlationId: 'test-correlation-0001',
    job: {} as Job,
    ...overrides,
  };
}

describe('Tender ingestion (e2e, PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let ingestion: TenderIngestionService;
  let runs: CrawlRunsService;
  const adapter = new MockSourceAdapter();
  let sourceId: string;

  async function createSource(mock: Prisma.InputJsonObject = {}, extra: Partial<Prisma.TenderSourceCreateInput> = {}) {
    const source = await prisma.tenderSource.create({
      data: {
        name: 'Mock Tender Portal',
        slug: `mock-${Math.random().toString(36).slice(2, 8)}`,
        sourceType: 'MOCK',
        adapterKey: 'mock',
        crawlConfig: { mock },
        ...extra,
      },
    });
    return source.id;
  }

  async function normalized(externalId: string, mock: Record<string, unknown> = {}) {
    const ctx = { source: { id: sourceId, slug: 'mock', config: { mock } }, attempt: 1, signal: new AbortController().signal };
    const raw = await adapter.fetchTender(ctx, { externalId });
    return { raw, normalized: NormalizedTenderSchema.parse(adapter.normalize(raw)) };
  }

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, LoggingModule, DatabaseModule, QueuesModule, OutboxModule, CrawlerModule],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    ingestion = moduleRef.get(TenderIngestionService);
    runs = moduleRef.get(CrawlRunsService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    sourceId = await createSource();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('creates a tender, its source record and a tender.created event in one transaction', async () => {
    const input = await normalized('MOCK-0001');
    const result = await ingestion.ingest({ sourceId, ...input }, ANCHOR);

    expect(result).toMatchObject({ outcome: 'created', changedFields: [] });
    const tender = await prisma.tender.findUniqueOrThrow({ where: { id: result.tenderId } });
    expect(tender.title).toBe(input.normalized.title);
    // Exact decimals end to end: the stored value prints back identically.
    expect(tender.estimatedValue?.toFixed(2)).toBe(input.normalized.estimatedValue);
    expect(tender.emdAmount?.toFixed(2)).toBe(input.normalized.emdAmount);
    expect(tender.currency).toBe('INR');
    expect(tender.referenceNumberNormalized).toMatch(/^[A-Z0-9]+$/);
    expect(tender.statusComputedAt).toEqual(ANCHOR);

    const record = await prisma.tenderSourceRecord.findFirstOrThrow({ where: { tenderId: result.tenderId } });
    expect(record).toMatchObject({ sourceId, externalTenderId: 'MOCK-0001', payloadHash: expect.stringMatching(/^[0-9a-f]{64}$/) });

    const events = await prisma.outboxEvent.findMany();
    expect(events).toEqual([
      expect.objectContaining({ eventType: 'tender.created', aggregateId: result.tenderId, payload: { tenderId: result.tenderId, sourceId } }),
    ]);
  });

  it('is idempotent: re-ingesting an unchanged tender writes no update and no event', async () => {
    const input = await normalized('MOCK-0001');
    const first = await ingestion.ingest({ sourceId, ...input }, ANCHOR);
    const later = new Date(ANCHOR.getTime() + 3_600_000);
    const second = await ingestion.ingest({ sourceId, ...input }, later);

    expect(second).toEqual({ outcome: 'unchanged', tenderId: first.tenderId, changedFields: [] });
    expect(await prisma.tender.count()).toBe(1);
    expect(await prisma.outboxEvent.count()).toBe(1);
    const record = await prisma.tenderSourceRecord.findFirstOrThrow();
    expect(record.lastSeenAt).toEqual(later);
    expect(record.lastChangedAt).toEqual(ANCHOR);
  });

  it('updates a changed tender and emits tender.updated with the changed fields', async () => {
    const created = await ingestion.ingest({ sourceId, ...(await normalized('MOCK-0001')) }, ANCHOR);
    const revised = await normalized('MOCK-0001', { revision: 1 });
    const result = await ingestion.ingest({ sourceId, ...revised }, ANCHOR);

    expect(result).toEqual({ outcome: 'updated', tenderId: created.tenderId, changedFields: ['closingAt', 'openingAt'] });
    const tender = await prisma.tender.findUniqueOrThrow({ where: { id: created.tenderId } });
    expect(tender.closingAt?.toISOString()).toBe(revised.normalized.closingAt);
    const updated = await prisma.outboxEvent.findFirstOrThrow({ where: { eventType: 'tender.updated' } });
    expect(updated.payload).toEqual({ tenderId: created.tenderId, changedFields: ['closingAt', 'openingAt'] });
  });

  it('emits tender.closed when an update moves the tender past its closing date', async () => {
    const created = await ingestion.ingest({ sourceId, ...(await normalized('MOCK-0001')) }, ANCHOR);
    const revised = await normalized('MOCK-0001', { revision: 1 });
    const afterClosing = new Date(Date.parse(revised.normalized.closingAt!) + 60_000);
    await ingestion.ingest({ sourceId, ...revised }, afterClosing);

    await expect(prisma.tender.findUniqueOrThrow({ where: { id: created.tenderId } })).resolves.toMatchObject({ status: 'CLOSED' });
    // updated + closed share one transaction (and one created_at), so compare as a set.
    const types = (await prisma.outboxEvent.findMany()).map((e) => e.eventType).sort();
    expect(types).toEqual(['tender.closed', 'tender.created', 'tender.updated']);
  });

  it('serializes concurrent ingestion of the same tender: exactly one create', async () => {
    const input = await normalized('MOCK-0002');
    const results = await Promise.all(Array.from({ length: 6 }, () => ingestion.ingest({ sourceId, ...input }, ANCHOR)));

    expect(results.filter((r) => r.outcome === 'created')).toHaveLength(1);
    expect(results.filter((r) => r.outcome === 'unchanged')).toHaveLength(5);
    expect(new Set(results.map((r) => r.tenderId)).size).toBe(1);
    expect(await prisma.tender.count()).toBe(1);
    expect(await prisma.outboxEvent.count()).toBe(1);
  });

  it('never revives a tender an admin deleted', async () => {
    const created = await ingestion.ingest({ sourceId, ...(await normalized('MOCK-0001')) }, ANCHOR);
    await prisma.tender.update({ where: { id: created.tenderId }, data: { deletedAt: new Date() } });
    const result = await ingestion.ingest({ sourceId, ...(await normalized('MOCK-0001', { revision: 1 })) }, ANCHOR);

    expect(result.outcome).toBe('suppressed');
    expect(await prisma.outboxEvent.count()).toBe(1);
    await expect(prisma.tender.findUniqueOrThrow({ where: { id: created.tenderId } })).resolves.toMatchObject({ deletedAt: expect.any(Date) });
  });

  describe('database constraints', () => {
    const tender = {
      title: 'Constraint probe',
      publishedAt: ANCHOR,
      status: 'OPEN' as const,
      statusComputedAt: ANCHOR,
      lastSyncedAt: ANCHOR,
    };

    it.each([
      ['negative money', { estimatedValue: '-1.00' }],
      ['lower-case currency', { currency: 'inr' }],
      ['unknown state code format', { stateCode: 'm1' }],
      ['closing before publishing', { closingAt: new Date(ANCHOR.getTime() - 1) }],
    ])('rejects %s', async (_label, data) => {
      await expect(prisma.tender.create({ data: { ...tender, ...data } })).rejects.toThrow();
    });

    it('requires exactly one of cron / every_ms on job schedules, and every_ms ≥ 1 s', async () => {
      const base = { queue: 'maintenance', jobName: 'maintenance.outbox-cleanup' };
      await expect(prisma.jobSchedule.create({ data: { ...base, key: 'neither' } })).rejects.toThrow();
      await expect(prisma.jobSchedule.create({ data: { ...base, key: 'both', cron: '* * * * *', everyMs: 60_000 } })).rejects.toThrow();
      await expect(prisma.jobSchedule.create({ data: { ...base, key: 'too-fast', everyMs: 10 } })).rejects.toThrow();
      await expect(prisma.jobSchedule.create({ data: { ...base, key: 'ok', everyMs: 60_000 } })).resolves.toBeDefined();
    });

    it('enforces one source record per (source, external id)', async () => {
      await ingestion.ingest({ sourceId, ...(await normalized('MOCK-0001')) }, ANCHOR);
      const existing = await prisma.tenderSourceRecord.findFirstOrThrow();
      await expect(
        prisma.tenderSourceRecord.create({
          data: {
            tenderId: existing.tenderId,
            sourceId: existing.sourceId,
            externalTenderId: existing.externalTenderId,
            payloadHash: existing.payloadHash,
            rawPayload: {},
            normalizedPayload: {},
            firstSeenAt: ANCHOR,
            lastSeenAt: ANCHOR,
            lastChangedAt: ANCHOR,
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe('crawl runs', () => {
    const open = (jobId: string) =>
      runs.open({ sourceId, trigger: 'MANUAL', jobId, correlationId: `corr-${jobId}` });

    it('resumes the same run when a job is retried', async () => {
      const first = await open('job-a');
      await runs.fail(first.run.id, 'timeout', false);
      await expect(prisma.crawlRun.findUniqueOrThrow({ where: { id: first.run.id } })).resolves.toMatchObject({ status: 'RETRYING' });
      const retry = await open('job-a');
      expect(retry.run.id).toBe(first.run.id);
      expect(retry.run.status).toBe('RUNNING');
      expect(await prisma.crawlRun.count()).toBe(1);
    });

    it('refuses to run two crawls of one source at the same time', async () => {
      const first = await open('job-a');
      const second = await open('job-b');
      expect(second.blockedBy).toBe(first.run.id);
      expect(second.run).toMatchObject({ status: 'CANCELLED', failureReason: expect.stringContaining('still in progress') });

      await runs.finalize(first.run.id, { created: 1, updated: 0, unchanged: 0, invalid: 0, suppressed: 0, errors: 0 });
      await expect(open('job-c')).resolves.toMatchObject({ blockedBy: undefined, run: { status: 'RUNNING' } });
    });

    it('ignores an abandoned run when deciding whether a crawl is in progress', async () => {
      const stale = await open('job-a');
      await prisma.crawlRun.update({ where: { id: stale.run.id }, data: { startedAt: new Date(Date.now() - 7 * 3_600_000) } });
      await expect(open('job-b')).resolves.toMatchObject({ blockedBy: undefined });
    });

    it('finalizes counters and source health idempotently', async () => {
      const { run } = await open('job-a');
      const tally = { created: 5, updated: 2, unchanged: 3, invalid: 1, suppressed: 0, errors: 1 };
      await runs.finalize(run.id, tally);
      const { run: again, outcome } = await runs.finalize(run.id, tally);
      expect(outcome).toBe('partial');
      expect(again).toMatchObject({ status: 'COMPLETED', recordsCreated: 5, recordsUpdated: 2, recordsSkipped: 4, errorCount: 1 });

      await runs.recordSourceOutcome(sourceId, outcome);
      await expect(prisma.tenderSource.findUniqueOrThrow({ where: { id: sourceId } })).resolves.toMatchObject({
        healthStatus: 'DEGRADED',
        lastSuccessfulRunAt: expect.any(Date),
      });
    });

    it('never overrides an admin-disabled source status', async () => {
      await prisma.tenderSource.update({ where: { id: sourceId }, data: { healthStatus: 'DISABLED' } });
      await runs.recordSourceOutcome(sourceId, 'success');
      await expect(prisma.tenderSource.findUniqueOrThrow({ where: { id: sourceId } })).resolves.toMatchObject({ healthStatus: 'DISABLED' });
    });
  });

  describe('crawler job handlers (no queue needed)', () => {
    it('ingest handler stores a tender and reports the outcome', async () => {
      const run = await runs.open({ sourceId, trigger: 'MANUAL', jobId: 'job-x', correlationId: 'c' });
      const handler = moduleRef.get(IngestTenderHandler);
      const payload = { sourceId, crawlRunId: run.run.id, ref: { externalId: 'MOCK-0003' } };
      await expect(handler.handle(payload, jobContext())).resolves.toMatchObject({ outcome: 'created' });
      await expect(handler.handle(payload, jobContext())).resolves.toMatchObject({ outcome: 'unchanged' });
    });

    it('ingest handler skips records that fail normalization instead of retrying them', async () => {
      const invalidSource = await createSource({ invalidExternalIds: ['MOCK-0004'] });
      const handler = moduleRef.get(IngestTenderHandler);
      const payload = { sourceId: invalidSource, crawlRunId: sourceId, ref: { externalId: 'MOCK-0004' } };
      await expect(handler.handle(payload, jobContext())).resolves.toMatchObject({ outcome: 'invalid', reason: expect.stringContaining('title') });
      expect(await prisma.tender.count()).toBe(0);
    });

    it('discover handler skips inactive sources and disabled schedules', async () => {
      const handler = moduleRef.get(DiscoverSourceHandler);
      const inactive = await createSource({}, { isActive: false });
      await expect(handler.handle({ sourceId: inactive, trigger: 'MANUAL' }, jobContext())).resolves.toMatchObject({
        outcome: 'skipped',
        reason: 'source-inactive',
      });
      await expect(handler.handle({ sourceId, trigger: 'SCHEDULE' }, jobContext())).resolves.toMatchObject({
        outcome: 'skipped',
        reason: 'crawl-disabled',
      });
      expect(await prisma.crawlRun.count()).toBe(0);
    });

    it('discover handler records a retrying run, then a failed run and degraded source on the final attempt', async () => {
      const down = await createSource({ unavailable: true });
      const handler = moduleRef.get(DiscoverSourceHandler);
      await expect(handler.handle({ sourceId: down, trigger: 'MANUAL' }, jobContext({ jobId: 'd-1' }))).rejects.toThrow('unavailable');
      await expect(prisma.crawlRun.findFirstOrThrow({ where: { sourceId: down } })).resolves.toMatchObject({ status: 'RETRYING' });

      await expect(
        handler.handle({ sourceId: down, trigger: 'MANUAL' }, jobContext({ jobId: 'd-1', attempt: 3, isFinalAttempt: true })),
      ).rejects.toThrow('unavailable');
      await expect(prisma.crawlRun.findFirstOrThrow({ where: { sourceId: down } })).resolves.toMatchObject({
        status: 'FAILED',
        failureReason: expect.stringContaining('unavailable'),
      });
      await expect(prisma.tenderSource.findUniqueOrThrow({ where: { id: down } })).resolves.toMatchObject({
        healthStatus: 'DEGRADED',
        lastFailedRunAt: expect.any(Date),
      });
      expect(await prisma.crawlRun.count({ where: { sourceId: down } })).toBe(1);
    });
  });
});
