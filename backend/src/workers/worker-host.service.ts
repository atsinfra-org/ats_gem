import { BeforeApplicationShutdown, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService, Reflector } from '@nestjs/core';
import { Worker } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import { describeError, LogThrottle } from '../common/errors/describe-error';
import { AppConfig } from '../config/app-config.service';
import type { JobEnvelope } from '../queues/job-envelope';
import { JOB_DEFINITIONS, type JobName } from '../queues/job.registry';
import { QUEUE_SETTINGS, type QueueName } from '../queues/queue.constants';
import { QueueProducer } from '../queues/queue.producer';
import { workerConnection } from '../queues/redis-connection';
import { JOB_HANDLER_METADATA, type JobHandler } from './job-handler';
import { JobRunner } from './job-runner';

export interface WorkerStatus {
  queue: QueueName;
  running: boolean;
  concurrency: number;
  jobNames: JobName[];
}

/**
 * Starts one BullMQ Worker per queue that has handlers in this process, filtered by
 * WORKER_QUEUES, and shuts them down gracefully: in-flight jobs finish before the process exits
 * (bounded by WORKER_SHUTDOWN_TIMEOUT_MS, after which remaining jobs are released for retry).
 */
@Injectable()
export class WorkerHost implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly workers = new Map<QueueName, { worker: Worker; jobNames: JobName[] }>();
  /** Every worker reconnects on its own; one warning per 30 s is enough to see Redis is down. */
  private readonly errorThrottle = new LogThrottle();
  private shuttingDown = false;

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly reflector: Reflector,
    private readonly config: AppConfig,
    private readonly producer: QueueProducer,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WorkerHost.name);
  }

  onApplicationBootstrap(): void {
    const handlers = this.discoverHandlers();
    const selected = this.config.get('WORKER_QUEUES');
    const all = selected.includes('*');

    const byQueue = new Map<QueueName, JobName[]>();
    for (const name of handlers.keys()) {
      const queue = JOB_DEFINITIONS[name].queue;
      if (all || selected.includes(queue)) byQueue.set(queue, [...(byQueue.get(queue) ?? []), name]);
    }

    const runner = new JobRunner({
      handlers,
      logger: this.logger,
      deadLetter: async (record) => {
        await this.producer.enqueue('dead-letter.record', record, {
          jobId: `dlq.${record.queue}.${record.jobId}`.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 200),
          origin: 'worker',
          correlationId: record.correlationId,
        });
      },
    });

    for (const [queue, jobNames] of byQueue) {
      const worker = new Worker<JobEnvelope>(queue, (job) => runner.run(job), {
        connection: workerConnection(this.config.get('REDIS_URL')),
        prefix: this.producer.prefix,
        concurrency: QUEUE_SETTINGS[queue].concurrency,
        // A job whose worker died is retried once as "stalled", then failed.
        maxStalledCount: 1,
      });
      worker.on('error', (err) => {
        if (this.errorThrottle.ready()) this.logger.warn({ queue, error: describeError(err) }, 'worker connection error; retrying');
      });
      worker.on('stalled', (jobId) => this.logger.warn({ queue, jobId }, 'job stalled; will be retried'));
      this.workers.set(queue, { worker, jobNames });
    }

    const unconsumed = [...byQueue.keys()].length === 0 ? 'none' : [...byQueue.keys()].join(', ');
    this.logger.info({ queues: [...byQueue.keys()], selection: selected }, `Workers started for: ${unconsumed}`);
  }

  status(): WorkerStatus[] {
    return [...this.workers.entries()].map(([queue, { worker, jobNames }]) => ({
      queue,
      running: worker.isRunning(),
      concurrency: worker.concurrency,
      jobNames,
    }));
  }

  isHealthy(): boolean {
    return !this.shuttingDown && this.status().every((s) => s.running);
  }

  async beforeApplicationShutdown(signal?: string): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    const timeoutMs = this.config.get('WORKER_SHUTDOWN_TIMEOUT_MS');
    this.logger.info({ signal, timeoutMs }, 'Stopping workers; waiting for in-flight jobs');

    await Promise.all(
      [...this.workers.entries()].map(async ([queue, { worker }]) => {
        let timer: NodeJS.Timeout | undefined;
        const graceful = worker.close().then(() => 'closed' as const);
        const timeout = new Promise<'timeout'>((resolve) => {
          timer = setTimeout(() => resolve('timeout'), timeoutMs);
        });
        const outcome = await Promise.race([graceful, timeout]);
        clearTimeout(timer);
        if (outcome === 'timeout') {
          this.logger.warn({ queue }, 'Worker did not drain in time; forcing close (active jobs will be retried)');
          await worker.close(true);
        }
      }),
    );
    this.logger.info({}, 'Workers stopped');
  }

  private discoverHandlers(): Map<JobName, JobHandler> {
    const handlers = new Map<JobName, JobHandler>();
    for (const wrapper of this.discovery.getProviders()) {
      const instance: unknown = wrapper.instance;
      const metatype = wrapper.metatype;
      if (!instance || !metatype) continue;
      const name = this.reflector.get<JobName | undefined>(JOB_HANDLER_METADATA, metatype);
      if (!name) continue;
      if (handlers.has(name)) throw new Error(`Duplicate job handler for "${name}"`);
      handlers.set(name, instance as JobHandler);
    }
    return handlers;
  }
}
