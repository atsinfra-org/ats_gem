import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { FlowProducer, Queue, type FlowJob } from 'bullmq';
import { currentCorrelationId } from '../common/context/correlation';
import { describeError, LogThrottle } from '../common/errors/describe-error';
import { AppConfig } from '../config/app-config.service';
import type { JobEnvelope, JobOrigin } from './job-envelope';
import { jobOptionsFor } from './job-options';
import { JOB_DEFINITIONS, JOB_ID_PATTERN, JOB_SCHEMAS, type JobInput, type JobName, type JobPayload } from './job.registry';
import { producerConnection } from './redis-connection';
import { ALL_QUEUES, type QueueName } from './queue.constants';

export interface EnqueueOptions {
  /** Deterministic ID for idempotent enqueueing: a second add with the same ID is ignored. */
  jobId?: string;
  delay?: number;
  priority?: number;
  correlationId?: string;
  origin?: JobOrigin;
}

export interface EnqueuedJob {
  id: string;
  queue: QueueName;
  name: JobName;
}

export interface FlowNode<N extends JobName = JobName> {
  name: N;
  payload: JobInput<N>;
  jobId: string;
  /** Children only: let the parent proceed even if this child finally fails. */
  tolerateFailure?: boolean;
}

/**
 * The only way application code enqueues work. Validates payloads against the job registry,
 * applies each queue's retry/retention policy, and stamps correlation metadata.
 */
@Injectable()
export class QueueProducer implements OnApplicationShutdown {
  private readonly logger = new Logger(QueueProducer.name);
  private readonly queues = new Map<QueueName, Queue>();
  private flowProducer?: FlowProducer;
  /** One warning per 30 s across all queues, so an absent Redis doesn't flood the logs. */
  private readonly errorThrottle = new LogThrottle();

  constructor(private readonly config: AppConfig) {}

  get prefix(): string {
    return this.config.get('QUEUE_PREFIX');
  }

  /** Lazily creates the BullMQ Queue handle (producer side only; consumers live in workers). */
  queue(name: QueueName): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, {
        connection: producerConnection(this.config.get('REDIS_URL')),
        prefix: this.prefix,
      });
      queue.on('error', (err) => this.warnThrottled(`Queue "${name}" connection error: ${describeError(err)}`));
      this.queues.set(name, queue);
    }
    return queue;
  }

  allQueues(): Queue[] {
    return ALL_QUEUES.map((name) => this.queue(name));
  }

  async enqueue<N extends JobName>(name: N, payload: JobInput<N>, options: EnqueueOptions = {}): Promise<EnqueuedJob> {
    const data = this.envelope(name, payload, options);
    if (options.jobId !== undefined) assertJobId(options.jobId);
    const queueName = JOB_DEFINITIONS[name].queue;
    const job = await this.queue(queueName).add(name, data, {
      ...jobOptionsFor(name),
      jobId: options.jobId,
      delay: options.delay,
      priority: options.priority,
    });
    return { id: job.id ?? '', queue: queueName, name };
  }

  /**
   * Enqueues a parent job that runs only after all children have finished (BullMQ flow).
   * Used to fan out per-tender ingestion and then finalize the crawl run with aggregated results.
   */
  async enqueueFlow(parent: FlowNode, children: FlowNode[], options: Pick<EnqueueOptions, 'correlationId' | 'origin'> = {}): Promise<void> {
    const toFlowJob = (node: FlowNode, isChild: boolean): FlowJob => {
      assertJobId(node.jobId);
      return {
        name: node.name,
        queueName: JOB_DEFINITIONS[node.name].queue,
        data: this.envelope(node.name, node.payload, options),
        opts: {
          ...jobOptionsFor(node.name),
          jobId: node.jobId,
          ...(isChild && node.tolerateFailure ? { ignoreDependencyOnFailure: true } : {}),
        },
      };
    };
    if (!this.flowProducer) {
      this.flowProducer = new FlowProducer({
        connection: producerConnection(this.config.get('REDIS_URL')),
        prefix: this.prefix,
      });
      this.flowProducer.on('error', (err) => this.warnThrottled(`Flow producer connection error: ${describeError(err)}`));
    }
    await this.flowProducer.add({
      ...toFlowJob(parent, false),
      children: children.map((child) => toFlowJob(child, true)),
    });
  }

  private envelope<N extends JobName>(name: N, payload: JobInput<N>, options: EnqueueOptions): JobEnvelope<N> {
    // Validate on the way in too, so a bad payload fails at the call site, not later in a worker.
    const parsed = JOB_SCHEMAS[name].parse(payload) as JobPayload<N>;
    return {
      payload: parsed,
      meta: {
        correlationId: options.correlationId ?? currentCorrelationId(),
        origin: options.origin ?? 'api',
      },
    };
  }

  private warnThrottled(message: string): void {
    if (this.errorThrottle.ready()) this.logger.warn(`${message}; retrying`);
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([...this.queues.values()].map((q) => q.close()));
    await this.flowProducer?.close();
  }
}

function assertJobId(jobId: string): void {
  if (!JOB_ID_PATTERN.test(jobId)) {
    throw new Error(`Invalid job id "${jobId}": use letters, digits, ".", "_" or "-" (no ":")`);
  }
}
