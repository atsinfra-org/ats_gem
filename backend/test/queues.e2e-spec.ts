import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Queue, type Job } from 'bullmq';
import { runWithCorrelation } from '../src/common/context/correlation';
import { AppConfig } from '../src/config/app-config.service';
import { AppConfigModule } from '../src/config/config.module';
import { LoggingModule } from '../src/logging/logging.module';
import type { JobEnvelope } from '../src/queues/job-envelope';
import { PermanentJobError } from '../src/queues/job-errors';
import type { JobPayload } from '../src/queues/job.registry';
import type { QueueName } from '../src/queues/queue.constants';
import { QueueProducer } from '../src/queues/queue.producer';
import { QueuesModule } from '../src/queues/queues.module';
import { producerConnection } from '../src/queues/redis-connection';
import { JobProcessor, type JobContext, type JobHandler, type JobResult } from '../src/workers/job-handler';
import { WorkerHost } from '../src/workers/worker-host.service';
import { WorkerRuntimeModule } from '../src/workers/worker-runtime.module';
import { withConfig } from './support/config';
import { inject } from 'vitest';
import { deletePrefix, waitFor } from './support/redis';

const redisUp = inject('redisUp');

/** Behaviour of the email handler, swapped per test. */
const script: {
  email: (payload: JobPayload<'email.send'>, ctx: JobContext) => Promise<JobResult>;
  calls: { payload: JobPayload<'email.send'>; ctx: JobContext }[];
} = { email: () => Promise.resolve(), calls: [] };

@Injectable()
@JobProcessor('email.send')
class ScriptedEmailHandler implements JobHandler<'email.send'> {
  handle(payload: JobPayload<'email.send'>, ctx: JobContext): Promise<JobResult> {
    script.calls.push({ payload, ctx });
    return script.email(payload, ctx);
  }
}

@Injectable()
@JobProcessor('crawler.ingest-tender')
class FlowChildHandler implements JobHandler<'crawler.ingest-tender'> {
  handle(payload: JobPayload<'crawler.ingest-tender'>): Promise<JobResult> {
    if (payload.ref.externalId === 'bad') return Promise.reject(new PermanentJobError('unparseable tender'));
    return Promise.resolve({ outcome: 'created' });
  }
}

@Injectable()
@JobProcessor('crawler.finalize-run')
class FlowParentHandler implements JobHandler<'crawler.finalize-run'> {
  async handle(_payload: JobPayload<'crawler.finalize-run'>, ctx: JobContext): Promise<JobResult> {
    const [values, failures] = await Promise.all([ctx.job.getChildrenValues(), ctx.job.getIgnoredChildrenFailures()]);
    return { children: Object.keys(values).length, failures: Object.keys(failures).length, correlationId: ctx.correlationId };
  }
}

const HANDLERS = [ScriptedEmailHandler, FlowChildHandler, FlowParentHandler];
const email = { to: 'someone@example.com', template: 'welcome' };

async function workerApp(overrides: Parameters<typeof withConfig>[0] = {}): Promise<TestingModule> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppConfigModule, LoggingModule, QueuesModule, WorkerRuntimeModule],
    providers: HANDLERS,
  })
    .overrideProvider(AppConfig)
    .useFactory(withConfig(overrides))
    .compile();
  await moduleRef.init();
  return moduleRef;
}

describe.skipIf(!redisUp)('Queues and workers (e2e, Redis)', () => {
  let app: TestingModule;
  let producer: QueueProducer;
  const extraPrefixes: string[] = [];

  async function jobIn(queue: QueueName, id: string, states: string[], timeoutMs = 15_000): Promise<Job<JobEnvelope>> {
    return waitFor(async () => {
      const job = (await producer.queue(queue).getJob(id)) as Job<JobEnvelope> | undefined;
      return job && states.includes(await job.getState()) ? job : undefined;
    }, timeoutMs);
  }

  beforeAll(async () => {
    app = await workerApp();
    producer = app.get(QueueProducer);
  });

  beforeEach(() => {
    script.email = () => Promise.resolve();
    script.calls = [];
  });

  afterAll(async () => {
    await app?.close();
    for (const prefix of [process.env.QUEUE_PREFIX!, ...extraPrefixes]) await deletePrefix(prefix);
  });

  describe('producer', () => {
    it('validates payloads and job ids before anything reaches Redis', async () => {
      await expect(producer.enqueue('email.send', { to: 'not-an-email', template: 'welcome' })).rejects.toThrow();
      await expect(producer.enqueue('email.send', email, { jobId: 'has:colon' })).rejects.toThrow('Invalid job id');
      await expect(producer.queue('email').getJobCounts('waiting', 'active', 'completed')).resolves.toEqual({ waiting: 0, active: 0, completed: 0 });
    });

    it('applies the queue retry and retention policy to every job', async () => {
      script.email = () => new Promise((r) => setTimeout(() => r(undefined), 50));
      await producer.enqueue('email.send', email, { jobId: 'email-policy-1' });
      const job = await jobIn('email', 'email-policy-1', ['active', 'completed']);
      expect(job.opts).toMatchObject({ attempts: 6, backoff: { type: 'exponential', delay: 30_000 } });
    });

    it('ignores a second enqueue with the same job id (idempotent enqueue)', async () => {
      await producer.enqueue('email.send', email, { jobId: 'email-dedupe-1' });
      await producer.enqueue('email.send', email, { jobId: 'email-dedupe-1' });
      await jobIn('email', 'email-dedupe-1', ['completed']);
      await new Promise((r) => setTimeout(r, 300));
      expect(script.calls).toHaveLength(1);
    });
  });

  describe('consumer', () => {
    it('consumes a job, validating the payload and propagating the correlation id', async () => {
      script.email = () => Promise.resolve({ sent: true });
      await runWithCorrelation('req-queue-0001', () => producer.enqueue('email.send', email, { jobId: 'email-consume-1' }));
      const job = await jobIn('email', 'email-consume-1', ['completed']);

      expect(job.returnvalue).toEqual({ sent: true });
      expect(job.data.meta).toEqual({ origin: 'api', correlationId: 'req-queue-0001' });
      expect(script.calls[0].payload).toEqual({ ...email, variables: {} });
      expect(script.calls[0].ctx).toMatchObject({ correlationId: 'req-queue-0001', attempt: 1, maxAttempts: 6, isFinalAttempt: false });
    });

    it('retries a failing job with backoff until it succeeds', async () => {
      let runs = 0;
      script.email = () => (++runs < 3 ? Promise.reject(new Error('smtp timeout')) : Promise.resolve({ sent: true }));
      const envelope: JobEnvelope<'email.send'> = { payload: { ...email, variables: {} }, meta: { origin: 'test' } };
      await producer.queue('email').add('email.send', envelope, { jobId: 'email-retry-1', attempts: 4, backoff: { type: 'fixed', delay: 50 } });

      const job = await jobIn('email', 'email-retry-1', ['completed']);
      expect(job.returnvalue).toEqual({ sent: true });
      expect(script.calls.map((c) => c.ctx.attempt)).toEqual([1, 2, 3]);
      expect(script.calls.map((c) => c.ctx.isFinalAttempt)).toEqual([false, false, false]);
    });

    it('moves a job that exhausts its attempts to failed and records it in the dead-letter queue', async () => {
      script.email = () => Promise.reject(new Error('mailbox unavailable'));
      const envelope: JobEnvelope<'email.send'> = { payload: { ...email, variables: {} }, meta: { origin: 'test', correlationId: 'corr-dlq-0001' } };
      await producer.queue('email').add('email.send', envelope, { jobId: 'email-fail-1', attempts: 2, backoff: { type: 'fixed', delay: 50 } });

      const failed = await jobIn('email', 'email-fail-1', ['failed']);
      expect(failed.failedReason).toBe('mailbox unavailable');
      expect(script.calls.map((c) => c.ctx.isFinalAttempt)).toEqual([false, true]);

      const dlq = (await waitFor(() => producer.queue('dead-letter').getJob('dlq.email.email-fail-1'))) as Job<JobEnvelope<'dead-letter.record'>>;
      expect(dlq.data.payload).toMatchObject({
        queue: 'email',
        jobName: 'email.send',
        jobId: 'email-fail-1',
        attemptsMade: 2,
        failedReason: 'mailbox unavailable',
        correlationId: 'corr-dlq-0001',
      });
      // Dead-letter records are held for inspection, never consumed.
      expect(await dlq.getState()).toBe('waiting');
    });

    it('does not retry permanent errors', async () => {
      script.email = () => Promise.reject(new PermanentJobError('template does not exist'));
      await producer.enqueue('email.send', email, { jobId: 'email-permanent-1' });
      const failed = await jobIn('email', 'email-permanent-1', ['failed']);
      expect(failed.failedReason).toBe('template does not exist');
      expect(script.calls).toHaveLength(1);
      await expect(waitFor(() => producer.queue('dead-letter').getJob('dlq.email.email-permanent-1'))).resolves.toBeDefined();
    });

    it('lets a flow parent run after a tolerated child fails, with the failure visible to it', async () => {
      const runId = randomUUID();
      const sourceId = randomUUID();
      await producer.enqueueFlow(
        { name: 'crawler.finalize-run', payload: { sourceId, crawlRunId: runId }, jobId: `finalize.${runId}` },
        ['ok-1', 'bad', 'ok-2'].map((externalId) => ({
          name: 'crawler.ingest-tender' as const,
          payload: { sourceId, crawlRunId: runId, ref: { externalId } },
          jobId: `ingest.${runId}.${externalId}`,
          tolerateFailure: true,
        })),
        { origin: 'worker', correlationId: 'flow-corr-0001' },
      );
      const parent = await jobIn('crawler.discovery', `finalize.${runId}`, ['completed']);
      expect(parent.returnvalue).toEqual({ children: 2, failures: 1, correlationId: 'flow-corr-0001' });
    });
  });

  describe('worker lifecycle', () => {
    it('starts one worker per queue with handlers, honouring WORKER_QUEUES', async () => {
      expect(app.get(WorkerHost).status().map((s) => s.queue).sort()).toEqual(['crawler.discovery', 'crawler.tender', 'email']);
      expect(app.get(WorkerHost).isHealthy()).toBe(true);

      const prefix = `${process.env.QUEUE_PREFIX}-filter`;
      extraPrefixes.push(prefix);
      const filtered = await workerApp({ QUEUE_PREFIX: prefix, WORKER_QUEUES: ['crawler.tender'] });
      try {
        expect(filtered.get(WorkerHost).status().map((s) => s.queue)).toEqual(['crawler.tender']);
        await filtered.get(QueueProducer).enqueue('email.send', email, { jobId: 'email-unconsumed-1' });
        await new Promise((r) => setTimeout(r, 500));
        const job = await filtered.get(QueueProducer).queue('email').getJob('email-unconsumed-1');
        expect(await job?.getState()).toBe('waiting');
      } finally {
        await filtered.close();
      }
    });

    it('finishes in-flight jobs before shutting down', async () => {
      const prefix = `${process.env.QUEUE_PREFIX}-drain`;
      extraPrefixes.push(prefix);
      const local = await workerApp({ QUEUE_PREFIX: prefix, WORKER_SHUTDOWN_TIMEOUT_MS: 10_000 });
      let finished = false;
      script.email = async () => {
        await new Promise((r) => setTimeout(r, 800));
        finished = true;
        return { slow: true };
      };
      const localProducer = local.get(QueueProducer);
      await localProducer.enqueue('email.send', email, { jobId: 'email-drain-1' });
      await waitFor(async () => (await (await localProducer.queue('email').getJob('email-drain-1'))?.getState()) === 'active');

      await local.close();
      expect(finished).toBe(true);
      expect(local.get(WorkerHost).isHealthy()).toBe(false);

      const inspector = new Queue('email', { connection: producerConnection(process.env.REDIS_URL!), prefix });
      try {
        const job = await inspector.getJob('email-drain-1');
        expect(await job?.getState()).toBe('completed');
        expect(job?.returnvalue).toEqual({ slow: true });
      } finally {
        await inspector.close();
      }
    });
  });
});
