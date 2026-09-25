import { Injectable } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type Redis from 'ioredis';
import { AppConfigModule } from '../src/config/config.module';
import { DatabaseModule } from '../src/database/database.module';
import { PrismaService } from '../src/database/prisma.service';
import { LoggingModule } from '../src/logging/logging.module';
import type { JobPayload } from '../src/queues/job.registry';
import { QueueProducer } from '../src/queues/queue.producer';
import { QueuesModule } from '../src/queues/queues.module';
import { REDIS, RedisModule } from '../src/redis/redis.module';
import { LeaderLock } from '../src/scheduler/leader-lock';
import { SchedulerModule } from '../src/scheduler/scheduler.module';
import { SchedulerService } from '../src/scheduler/scheduler.service';
import { JobProcessor, type JobContext, type JobHandler, type JobResult } from '../src/workers/job-handler';
import { WorkerRuntimeModule } from '../src/workers/worker-runtime.module';
import { resetDatabase } from './support/database';
import { inject } from 'vitest';
import { deletePrefix, waitFor } from './support/redis';

const redisUp = inject('redisUp');

const probes: JobContext[] = [];

/** Stands in for the real health-check job so the test can observe scheduled dispatch. */
@Injectable()
@JobProcessor('maintenance.sources-health-check')
class ProbeHandler implements JobHandler<'maintenance.sources-health-check'> {
  handle(_payload: JobPayload<'maintenance.sources-health-check'>, ctx: JobContext): Promise<JobResult> {
    probes.push(ctx);
    return Promise.resolve({ probed: true });
  }
}

describe.skipIf(!redisUp)('Scheduler (e2e, PostgreSQL + Redis)', () => {
  let app: TestingModule;
  let prisma: PrismaService;
  let scheduler: SchedulerService;
  let producer: QueueProducer;

  async function schedulerIds(queue: 'maintenance' | 'crawler.discovery'): Promise<string[]> {
    return (await producer.queue(queue).getJobSchedulers(0, -1, true)).map((s) => s.key).sort();
  }

  async function mockSource(crawlSchedule: string | null, crawlEnabled = true) {
    return prisma.tenderSource.create({
      data: { name: 'Mock', slug: `mock-${Math.random().toString(36).slice(2, 8)}`, sourceType: 'MOCK', adapterKey: 'mock', crawlEnabled, crawlSchedule },
    });
  }

  beforeAll(async () => {
    app = await Test.createTestingModule({
      imports: [
        AppConfigModule,
        LoggingModule,
        DatabaseModule,
        RedisModule,
        QueuesModule,
        WorkerRuntimeModule,
        SchedulerModule.forRoot({ runLoop: false }),
      ],
      providers: [ProbeHandler],
    }).compile();
    await app.init();
    prisma = app.get(PrismaService);
    scheduler = app.get(SchedulerService);
    producer = app.get(QueueProducer);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await scheduler.reconcile(); // clears schedulers left by the previous test
    probes.length = 0;
  });

  afterAll(async () => {
    await app?.close();
    await deletePrefix(process.env.QUEUE_PREFIX!);
  });

  it('registers platform and source schedules from the database — no portal is hard-coded', async () => {
    await prisma.jobSchedule.create({
      data: { key: 'nightly-cleanup', queue: 'maintenance', jobName: 'maintenance.outbox-cleanup', cron: '30 3 * * *' },
    });
    await prisma.jobSchedule.create({
      data: { key: 'wrong-queue', queue: 'email', jobName: 'maintenance.outbox-cleanup', everyMs: 60_000 },
    });
    await prisma.jobSchedule.create({
      data: { key: 'disabled', queue: 'maintenance', jobName: 'maintenance.outbox-cleanup', everyMs: 60_000, enabled: false },
    });
    const source = await mockSource('*/30 * * * *');
    await mockSource(null); // manual-only source: no schedule
    await mockSource('0 * * * *', false); // crawling disabled: no schedule

    const result = await scheduler.reconcile();
    expect(result.upserted.sort()).toEqual([`crawl.${source.id}`, 'sched.nightly-cleanup'].sort());
    expect(result.rejected).toEqual([{ key: 'wrong-queue', reason: expect.stringContaining('belongs to queue "maintenance"') }]);

    expect(await schedulerIds('maintenance')).toEqual(['sched.nightly-cleanup']);
    expect(await schedulerIds('crawler.discovery')).toEqual([`crawl.${source.id}`]);
    const [crawl] = await producer.queue('crawler.discovery').getJobSchedulers(0, -1, true);
    expect(crawl).toMatchObject({ pattern: '*/30 * * * *', tz: 'Asia/Kolkata', name: 'crawler.discover-source' });
    expect(crawl.template?.data).toMatchObject({ payload: { sourceId: source.id, trigger: 'SCHEDULE' }, meta: { origin: 'scheduler' } });
  });

  it('is idempotent and follows database changes (update, disable, invalid cron)', async () => {
    const source = await mockSource('*/30 * * * *');
    await scheduler.reconcile();
    await expect(scheduler.reconcile()).resolves.toMatchObject({ upserted: [], removed: [], unchanged: 1 });

    await prisma.tenderSource.update({ where: { id: source.id }, data: { crawlSchedule: '0 */2 * * *' } });
    await expect(scheduler.reconcile()).resolves.toMatchObject({ upserted: [`crawl.${source.id}`] });
    const [updated] = await producer.queue('crawler.discovery').getJobSchedulers(0, -1, true);
    expect(updated.pattern).toBe('0 */2 * * *');

    await prisma.tenderSource.update({ where: { id: source.id }, data: { crawlSchedule: 'not a cron' } });
    await expect(scheduler.reconcile()).resolves.toMatchObject({ failed: [{ id: `crawl.${source.id}`, reason: expect.any(String) }] });

    await prisma.tenderSource.update({ where: { id: source.id }, data: { crawlEnabled: false } });
    await expect(scheduler.reconcile()).resolves.toMatchObject({ removed: [`crawl.${source.id}`] });
    expect(await schedulerIds('crawler.discovery')).toEqual([]);
  });

  it('dispatches scheduled jobs through BullMQ to a worker (the scheduler itself runs nothing)', async () => {
    await prisma.jobSchedule.create({
      data: { key: 'probe', queue: 'maintenance', jobName: 'maintenance.sources-health-check', everyMs: 1_000 },
    });
    await scheduler.reconcile();
    await waitFor(() => Promise.resolve(probes.length >= 2), 10_000);

    expect(probes[0].job.data.meta).toMatchObject({ origin: 'scheduler', correlationId: 'schedule.sched.probe' });
    // Every firing gets its own correlation id derived from the schedule.
    expect(probes[0].correlationId).toMatch(/^schedule\.sched\.probe\..+/);
    expect(probes[0].correlationId).not.toBe(probes[1].correlationId);

    await prisma.jobSchedule.update({ where: { key: 'probe' }, data: { enabled: false } });
    await expect(scheduler.reconcile()).resolves.toMatchObject({ removed: ['sched.probe'] });
  });

  it('elects a single leader across scheduler replicas', async () => {
    const redis = app.get<Redis>(REDIS);
    const key = `${process.env.QUEUE_PREFIX}:scheduler:leader-test`;
    const a = new LeaderLock(redis, key, 5_000);
    const b = new LeaderLock(redis, key, 5_000);

    expect(await a.acquireOrRenew()).toBe(true);
    expect(await b.acquireOrRenew()).toBe(false);
    expect(await a.acquireOrRenew()).toBe(true); // renewal
    await b.release(); // a non-holder cannot release
    expect(await b.acquireOrRenew()).toBe(false);
    await a.release();
    expect(await b.acquireOrRenew()).toBe(true);
  });
});
