import { SetMetadata } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { JobName, JobPayload } from '../queues/job.registry';
import type { JobEnvelope } from '../queues/job-envelope';

export interface JobContext {
  jobId: string;
  queue: string;
  jobName: JobName;
  /** 1-based attempt number of this execution. */
  attempt: number;
  maxAttempts: number;
  /** True when a failure now will not be retried; handlers use it to finalize state (e.g. mark a run failed). */
  isFinalAttempt: boolean;
  correlationId: string;
  /** Raw BullMQ job, for flow operations such as reading child results. */
  job: Job<JobEnvelope>;
}

/**
 * Handlers return a small summary (counts, outcome) that is logged and stored as the job result.
 * Never return secrets or large objects.
 */
export type JobResult = void | Record<string, string | number | boolean | null>;

export interface JobHandler<N extends JobName = JobName> {
  handle(payload: JobPayload<N>, ctx: JobContext): Promise<JobResult>;
}

export const JOB_HANDLER_METADATA = 'ats:job-handler';

/** Marks a provider as the handler for one job name; discovered by WorkerHost at startup. */
export const JobProcessor = (name: JobName): ClassDecorator => SetMetadata(JOB_HANDLER_METADATA, name);
