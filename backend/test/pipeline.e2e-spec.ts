import { Test, type TestingModule } from '@nestjs/testing';
import type { Job } from 'bullmq';
import { AppConfig } from '../src/config/app-config.service';
import { CrawlDispatcher } from '../src/crawler/crawl-dispatcher.service';
import { PrismaService } from '../src/database/prisma.service';
import type { CrawlRun } from '../src/generated/prisma/client';
import type { JobEnvelope } from '../src/queues/job-envelope';
import { QueueProducer } from '../src/queues/queue.producer';
import { SchedulerModule } from '../src/scheduler/scheduler.module';
import { SchedulerService } from '../src/scheduler/scheduler.service';
import { WorkerModule } from '../src/worker.module';
import { ProcessHealthServer } from '../src/workers/process-health.server';
import { withConfig } from './support/config';
import { resetDatabase } from './support/database';
import { inject } from 'vitest';
import { deletePrefix, waitFor } from './support/redis';

const redisUp = inject('redisUp');

const MOCK = { totalTenders: 12, pageSize: 5, invalidExternalIds: ['MOCK-0006'] };

/**
 * The Phase 1 acceptance path, end to end with real PostgreSQL, Redis and BullMQ:
 *
 *   Scheduler → BullMQ → MockCrawler → Normalized tender → Database → Outbox event → Queue
 */
describe.skipIf(!redisUp)('Mock crawl pipeline (e2e, PostgreSQL + Redis)', () => {
  let app: TestingModule;
  let prisma: PrismaService;
  let producer: QueueProducer;
  let scheduler: SchedulerService;
  let sourceId: string;
  let slug: string;

  const finished = (run: CrawlRun | null) => run && ['COMPLETED', 'FAILED'].includes(run.status);

  async function idle(): Promise<void> {
    await waitFor(async () => (await prisma.crawlRun.count({ where: { status: { in: ['QUEUED', 'RUNNING', 'RETRYING'] } } })) === 0, 30_000);
  }

  async function indexedJobs(): Promise<number> {
    return (await producer.queue('search.indexing').getJobCounts('completed')).completed;
  }

  async function manualCrawl(): Promise<CrawlRun> {
    await idle();
    const { jobId } = await app.get(CrawlDispatcher).requestCrawl(slug, { origin: 'test' });
    return waitFor(async () => {
      const run = await prisma.crawlRun.findFirst({ where: { jobId } });
      return finished(run) ? run : undefined;
    }, 30_000);
  }

  beforeAll(async () => {
    app = await Test.createTestingModule({
      imports: [WorkerModule, SchedulerModule.forRoot({ runLoop: false })],
      providers: [CrawlDispatcher],
    })
      .overrideProvider(AppConfig)
      .useFactory(withConfig({ OUTBOX_RELAY_ENABLED: true, OUTBOX_POLL_INTERVAL_MS: 100 }))
      .compile();
    await app.init();
    prisma = app.get(PrismaService);
    producer = app.get(QueueProducer);
    scheduler = app.get(SchedulerService);

    await resetDatabase(prisma);
    slug = `mock-pipeline-${Date.now()}`;
    const source = await prisma.tenderSource.create({
      data: {
        name: 'Mock Tender Portal',
        slug,
        sourceType: 'MOCK',
        adapterKey: 'mock',
        crawlEnabled: true,
        // Six-field cron (with seconds) so the schedule fires within the test.
        crawlSchedule: '*/2 * * * * *',
        crawlConfig: { mock: MOCK },
      },
    });
    sourceId = source.id;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await deletePrefix(process.env.QUEUE_PREFIX!);
  });

  it('a scheduled crawl ingests tenders and fans their events out to the search queue', async () => {
    await expect(scheduler.reconcile()).resolves.toMatchObject({ upserted: [`crawl.${sourceId}`] });

    // As soon as the schedule has fired once, switch it off again.
    await waitFor(() => prisma.crawlRun.findFirst({ where: { sourceId } }), 15_000);
    await prisma.tenderSource.update({ where: { id: sourceId }, data: { crawlEnabled: false } });
    await expect(scheduler.reconcile()).resolves.toMatchObject({ removed: [`crawl.${sourceId}`] });

    const run = await waitFor(async () => {
      const first = await prisma.crawlRun.findFirst({ where: { sourceId }, orderBy: { createdAt: 'asc' } });
      return finished(first) ? first : undefined;
    }, 30_000);

    expect(run).toMatchObject({
      trigger: 'SCHEDULE',
      status: 'COMPLETED',
      recordsFound: 12,
      recordsCreated: 11,
      recordsUpdated: 0,
      recordsSkipped: 1, // MOCK-0006 fails normalization
      errorCount: 0,
      failureReason: null,
    });
    expect(run.jobId).toMatch(/^repeat:/);
    expect(run.durationMs).toBeGreaterThanOrEqual(0);

    expect(await prisma.tender.count()).toBe(11);
    await expect(prisma.tenderSource.findUniqueOrThrow({ where: { id: sourceId } })).resolves.toMatchObject({
      healthStatus: 'HEALTHY',
      lastSuccessfulRunAt: expect.any(Date),
    });

    // Outbox → relay → search.indexing queue → worker.
    await waitFor(async () => (await prisma.outboxEvent.count({ where: { publishedAt: null } })) === 0, 15_000);
    await waitFor(async () => (await indexedJobs()) === 11, 15_000);

    const events = await prisma.outboxEvent.findMany();
    expect(events).toHaveLength(11);
    expect(events.every((e) => e.eventType === 'tender.created')).toBe(true);
    // One correlation id threads the whole chain: schedule firing → crawl run → events → index jobs.
    expect(new Set(events.map((e) => e.correlationId))).toEqual(new Set([run.correlationId]));

    const indexJob = (await producer.queue('search.indexing').getJob(`evt.${events[0].id}.search.index-tender`)) as Job<JobEnvelope>;
    expect(indexJob.returnvalue).toEqual({ provider: 'postgres', indexed: true, reason: 'maintained-by-postgres' });
    expect(indexJob.data.meta).toEqual({ origin: 'outbox', correlationId: run.correlationId });
  }, 90_000);

  it('re-crawling unchanged data creates nothing and emits no events', async () => {
    const run = await manualCrawl();
    expect(run).toMatchObject({ trigger: 'MANUAL', status: 'COMPLETED', recordsCreated: 0, recordsUpdated: 0, recordsSkipped: 12 });
    expect(await prisma.tender.count()).toBe(11);
    expect(await prisma.outboxEvent.count()).toBe(11);
  }, 60_000);

  it('a changed tender is updated and re-indexed exactly once', async () => {
    await prisma.tenderSource.update({ where: { id: sourceId }, data: { crawlConfig: { mock: { ...MOCK, revision: 1 } } } });
    const run = await manualCrawl();

    // Revision 1 moves the deadline of every fourth tender: MOCK-0001, -0005 and -0009.
    expect(run).toMatchObject({ status: 'COMPLETED', recordsCreated: 0, recordsUpdated: 3, recordsSkipped: 9 });
    const updates = await prisma.outboxEvent.findMany({ where: { eventType: 'tender.updated' } });
    expect(updates).toHaveLength(3);
    expect(updates.every((e) => (e.payload as { changedFields: string[] }).changedFields.includes('closingAt'))).toBe(true);
    await waitFor(async () => (await indexedJobs()) === 14, 15_000);
  }, 60_000);

  it('the worker health endpoint reports ready with its dependencies and loops', async () => {
    const port = app.get(ProcessHealthServer).port();
    const live = await fetch(`http://127.0.0.1:${port}/health/live`);
    expect(live.status).toBe(200);
    const ready = await fetch(`http://127.0.0.1:${port}/health/ready`);
    expect(ready.status).toBe(200);
    await expect(ready.json()).resolves.toMatchObject({
      status: 'ok',
      checks: {
        database: { status: 'up' },
        redis: { status: 'up' },
        workers: { status: 'up' },
        outboxRelay: { status: 'up' },
      },
    });
  });
});
