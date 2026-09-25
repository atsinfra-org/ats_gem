import type { JobName } from '../queues/job.registry';
import type { QueueName } from '../queues/queue.constants';

/** A schedule the platform wants to exist, derived from the database. */
export interface DesiredSchedule {
  /** BullMQ job-scheduler ID: `sched.<job_schedules.key>` or `crawl.<tender_sources.id>`. */
  id: string;
  queue: QueueName;
  jobName: JobName;
  /** Cron pattern (evaluated in `tz`) — mutually exclusive with `every`. */
  pattern?: string;
  every?: number;
  tz?: string;
  payload: unknown;
  origin: 'platform' | 'source';
}

/** A schedule currently registered in BullMQ. */
export interface ExistingSchedule {
  id: string;
  jobName: string;
  pattern?: string;
  every?: number;
  tz?: string;
  payload: unknown;
}

/** Only schedulers with these ID prefixes are managed (created/removed) by reconciliation. */
export const MANAGED_SCHEDULE_PREFIXES = ['sched.', 'crawl.'] as const;

export function isManagedSchedule(id: string): boolean {
  return MANAGED_SCHEDULE_PREFIXES.some((p) => id.startsWith(p));
}

export interface RejectedSchedule {
  key: string;
  reason: string;
}

export interface ReconcileResult {
  desired: number;
  upserted: string[];
  removed: string[];
  unchanged: number;
  failed: { id: string; reason: string }[];
  rejected: RejectedSchedule[];
}
