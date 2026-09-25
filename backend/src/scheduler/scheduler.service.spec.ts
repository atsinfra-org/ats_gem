import type Redis from 'ioredis';
import type { PinoLogger } from 'nestjs-pino';
import type { AppConfig } from '../config/app-config.service';
import type { QueueName } from '../queues/queue.constants';
import type { ScheduleCatalog } from './schedule-catalog.service';
import { SchedulerBackend } from './scheduler.backend';
import { SchedulerService } from './scheduler.service';
import type { DesiredSchedule, ExistingSchedule, RejectedSchedule } from './schedule.types';

class MemoryBackend extends SchedulerBackend {
  readonly store = new Map<QueueName, Map<string, ExistingSchedule>>();
  readonly calls: string[] = [];
  failOn = new Set<string>();

  list(queue: QueueName): Promise<ExistingSchedule[]> {
    return Promise.resolve([...(this.store.get(queue)?.values() ?? [])]);
  }

  upsert(s: DesiredSchedule): Promise<void> {
    this.calls.push(`upsert:${s.id}`);
    if (this.failOn.has(s.id)) return Promise.reject(new Error('Invalid cron expression'));
    const queue = this.store.get(s.queue) ?? new Map<string, ExistingSchedule>();
    queue.set(s.id, { id: s.id, jobName: s.jobName, pattern: s.pattern, every: s.every, tz: s.tz, payload: s.payload });
    this.store.set(s.queue, queue);
    return Promise.resolve();
  }

  remove(queue: QueueName, id: string): Promise<void> {
    this.calls.push(`remove:${id}`);
    this.store.get(queue)?.delete(id);
    return Promise.resolve();
  }

  seed(queue: QueueName, s: ExistingSchedule): void {
    const q = this.store.get(queue) ?? new Map<string, ExistingSchedule>();
    q.set(s.id, s);
    this.store.set(queue, q);
  }
}

const sourceId = '0199a3b2-0000-7000-8000-000000000001';

const cleanup: DesiredSchedule = {
  id: 'sched.outbox-cleanup',
  queue: 'maintenance',
  jobName: 'maintenance.outbox-cleanup',
  pattern: '30 3 * * *',
  tz: 'Asia/Kolkata',
  payload: {},
  origin: 'platform',
};
const crawl: DesiredSchedule = {
  id: `crawl.${sourceId}`,
  queue: 'crawler.discovery',
  jobName: 'crawler.discover-source',
  pattern: '*/30 * * * *',
  tz: 'Asia/Kolkata',
  payload: { sourceId, trigger: 'SCHEDULE' },
  origin: 'source',
};

function setup(schedules: DesiredSchedule[], rejected: RejectedSchedule[] = []) {
  const state = { schedules, rejected };
  const catalog = { load: () => Promise.resolve({ schedules: state.schedules, rejected: state.rejected }) } as unknown as ScheduleCatalog;
  const backend = new MemoryBackend();
  const config = { get: (key: string) => ({ QUEUE_PREFIX: 'test', SCHEDULER_SYNC_INTERVAL_MS: 60_000 })[key] } as unknown as AppConfig;
  const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as PinoLogger;
  const service = new SchedulerService(catalog, backend, config, logger, {} as Redis, { runLoop: false });
  return { service, backend, state, logger };
}

describe('SchedulerService.reconcile', () => {
  it('registers every desired schedule', async () => {
    const { service, backend } = setup([cleanup, crawl]);
    const result = await service.reconcile();
    expect(result).toMatchObject({ desired: 2, upserted: [cleanup.id, crawl.id], removed: [], unchanged: 0, failed: [] });
    expect(backend.store.get('crawler.discovery')?.get(crawl.id)?.payload).toEqual({ sourceId, trigger: 'SCHEDULE' });
  });

  it('is idempotent: a second pass changes nothing', async () => {
    const { service, backend } = setup([cleanup, crawl]);
    await service.reconcile();
    backend.calls.length = 0;
    const result = await service.reconcile();
    expect(result).toMatchObject({ upserted: [], removed: [], unchanged: 2 });
    expect(backend.calls).toEqual([]);
  });

  it('updates schedules whose cron, timezone or payload changed', async () => {
    const { service, state } = setup([cleanup, crawl]);
    await service.reconcile();
    state.schedules = [{ ...cleanup, pattern: '0 4 * * *' }, { ...crawl, tz: 'UTC' }];
    const result = await service.reconcile();
    expect(result.upserted).toEqual([cleanup.id, crawl.id]);
  });

  it('removes managed schedules that are no longer desired, but never foreign ones', async () => {
    const { service, backend, state } = setup([cleanup, crawl]);
    await service.reconcile();
    backend.seed('maintenance', { id: 'someone-elses-scheduler', jobName: 'x', every: 1000, payload: {} });
    state.schedules = [cleanup];
    const result = await service.reconcile();
    expect(result.removed).toEqual([crawl.id]);
    expect(backend.store.get('maintenance')?.has('someone-elses-scheduler')).toBe(true);
  });

  it('moves a schedule whose job now lives on another queue', async () => {
    const { service, backend } = setup([cleanup]);
    backend.seed('email', { id: cleanup.id, jobName: cleanup.jobName, pattern: cleanup.pattern, tz: cleanup.tz, payload: {} });
    const result = await service.reconcile();
    expect(result.removed).toEqual([cleanup.id]);
    expect(result.upserted).toEqual([cleanup.id]);
    expect(backend.store.get('maintenance')?.has(cleanup.id)).toBe(true);
  });

  it('reports a schedule BullMQ refuses and keeps registering the rest', async () => {
    const { service, backend, logger } = setup([cleanup, crawl]);
    backend.failOn.add(crawl.id);
    const result = await service.reconcile();
    expect(result.upserted).toEqual([cleanup.id]);
    expect(result.failed).toEqual([{ id: crawl.id, reason: 'Invalid cron expression' }]);
    expect(logger.error).toHaveBeenCalled();
  });

  it('surfaces rows the catalog rejected', async () => {
    const { service, logger } = setup([], [{ key: 'bad', reason: 'unknown job "x"' }]);
    const result = await service.reconcile();
    expect(result.rejected).toEqual([{ key: 'bad', reason: 'unknown job "x"' }]);
    expect(logger.warn).toHaveBeenCalled();
  });
});
