import type { JobName, JobPayload } from './job.registry';

export type JobOrigin = 'api' | 'worker' | 'scheduler' | 'outbox' | 'cli' | 'test';

export interface JobMeta {
  /** Request ID, outbox event ID or schedule ID that caused this job; propagated to child jobs. */
  correlationId?: string;
  origin: JobOrigin;
}

/** What is stored in `job.data`: the validated payload plus tracing metadata. */
export interface JobEnvelope<N extends JobName = JobName> {
  payload: JobPayload<N>;
  meta: JobMeta;
}
