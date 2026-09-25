import { UnrecoverableError, type Job } from 'bullmq';
import { currentCorrelationId } from '../common/context/correlation';
import type { JobEnvelope } from '../queues/job-envelope';
import { PermanentJobError } from '../queues/job-errors';
import type { JobName } from '../queues/job.registry';
import type { JobContext, JobHandler } from './job-handler';
import { JobRunner, type DeadLetterRecord, type JobLogger } from './job-runner';

const sourceId = '0199a3b2-0000-7000-8000-000000000001';

function fakeJob(overrides: Partial<{ name: string; payload: unknown; attempts: number; attemptsMade: number; meta: JobEnvelope['meta'] }> = {}) {
  return {
    id: 'job-1',
    name: overrides.name ?? 'crawler.discover-source',
    queueName: 'crawler.discovery',
    data: {
      payload: 'payload' in overrides ? overrides.payload : { sourceId, trigger: 'MANUAL' },
      meta: overrides.meta ?? { origin: 'api', correlationId: 'req-12345678' },
    },
    opts: { attempts: overrides.attempts ?? 3 },
    attemptsMade: overrides.attemptsMade ?? 0,
    timestamp: 1_000,
  } as unknown as Job<JobEnvelope>;
}

function fakeLogger() {
  const lines: { level: string; obj: Record<string, unknown>; msg: string }[] = [];
  const logger: JobLogger = {
    info: (obj, msg) => lines.push({ level: 'info', obj: obj as Record<string, unknown>, msg }),
    warn: (obj, msg) => lines.push({ level: 'warn', obj: obj as Record<string, unknown>, msg }),
    error: (obj, msg) => lines.push({ level: 'error', obj: obj as Record<string, unknown>, msg }),
    runInContext: (fn) => fn(),
  };
  return { logger, lines };
}

function setup(handle: JobHandler['handle']) {
  const { logger, lines } = fakeLogger();
  const deadLetters: DeadLetterRecord[] = [];
  const handlers = new Map<JobName, JobHandler>([['crawler.discover-source', { handle }]]);
  let clock = 1_000;
  const runner = new JobRunner({
    handlers,
    logger,
    deadLetter: (record) => {
      deadLetters.push(record);
      return Promise.resolve();
    },
    now: () => (clock += 25),
  });
  return { runner, lines, deadLetters };
}

describe('JobRunner', () => {
  it('runs the handler with a validated payload and logs start/finish with job context', async () => {
    let seen: { payload: unknown; ctx: JobContext; correlation?: string } | undefined;
    const { runner, lines } = setup((payload, ctx) => {
      seen = { payload, ctx, correlation: currentCorrelationId() };
      return Promise.resolve({ created: 3 });
    });

    await expect(runner.run(fakeJob())).resolves.toEqual({ created: 3 });

    expect(seen?.payload).toEqual({ sourceId, trigger: 'MANUAL' });
    expect(seen?.ctx).toMatchObject({ attempt: 1, maxAttempts: 3, isFinalAttempt: false, correlationId: 'req-12345678' });
    expect(seen?.correlation).toBe('req-12345678');
    expect(lines.map((l) => l.msg)).toEqual(['job started', 'job completed']);
    expect(lines[1].obj).toMatchObject({
      queue: 'crawler.discovery',
      jobName: 'crawler.discover-source',
      jobId: 'job-1',
      sourceId,
      durationMs: 25,
      result: { created: 3 },
    });
  });

  it('gives each scheduled firing its own correlation id', async () => {
    let correlation: string | undefined;
    const { runner } = setup(() => {
      correlation = currentCorrelationId();
      return Promise.resolve();
    });
    await runner.run(fakeJob({ meta: { origin: 'scheduler', correlationId: 'schedule.crawl.x' } }));
    expect(correlation).toBe('schedule.crawl.x.job-1');
  });

  it('rethrows transient failures for BullMQ to retry, without dead-lettering', async () => {
    const { runner, lines, deadLetters } = setup(() => Promise.reject(new Error('timeout')));
    await expect(runner.run(fakeJob({ attemptsMade: 0 }))).rejects.toThrow('timeout');
    expect(deadLetters).toHaveLength(0);
    expect(lines.at(-1)).toMatchObject({ level: 'warn', msg: 'job failed; will retry', obj: { willRetry: true, attempt: 1 } });
  });

  it('dead-letters a job that fails its final attempt', async () => {
    const { runner, lines, deadLetters } = setup(() => Promise.reject(new Error('still down')));
    await expect(runner.run(fakeJob({ attemptsMade: 2 }))).rejects.toThrow('still down');
    expect(lines.at(-1)).toMatchObject({ level: 'error', msg: 'job failed permanently', obj: { attempt: 3, willRetry: false } });
    expect(deadLetters).toEqual([
      expect.objectContaining({
        queue: 'crawler.discovery',
        jobName: 'crawler.discover-source',
        jobId: 'job-1',
        attemptsMade: 3,
        failedReason: 'still down',
        correlationId: 'req-12345678',
      }),
    ]);
  });

  it('stops retrying on a permanent error and dead-letters immediately', async () => {
    const { runner, deadLetters } = setup(() => Promise.reject(new PermanentJobError('source deleted')));
    await expect(runner.run(fakeJob({ attemptsMade: 0 }))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(deadLetters).toHaveLength(1);
  });

  it('rejects invalid payloads without calling the handler', async () => {
    const handle = vi.fn();
    const { runner, deadLetters } = setup(handle);
    await expect(runner.run(fakeJob({ payload: { sourceId: 'nope', trigger: 'MANUAL' } }))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(handle).not.toHaveBeenCalled();
    expect(deadLetters[0].failedReason).toContain('Invalid payload');
  });

  it('rejects unknown job names and jobs without a handler in this process', async () => {
    const { runner } = setup(() => Promise.resolve());
    await expect(runner.run(fakeJob({ name: 'mystery.job' }))).rejects.toThrow('Unknown job name');
    await expect(runner.run(fakeJob({ name: 'email.send', payload: { to: 'a@b.co', template: 'x' } }))).rejects.toThrow(
      'No handler registered',
    );
  });

  it('survives a failing dead-letter write (the job stays in the failed set)', async () => {
    const { logger, lines } = fakeLogger();
    const runner = new JobRunner({
      handlers: new Map([['crawler.discover-source', { handle: () => Promise.reject(new PermanentJobError('x')) }]]),
      logger,
      deadLetter: () => Promise.reject(new Error('redis down')),
    });
    await expect(runner.run(fakeJob())).rejects.toBeInstanceOf(UnrecoverableError);
    expect(lines.at(-1)?.msg).toBe('dead-letter enqueue failed');
  });
});
