import type { JobsOptions } from 'bullmq';
import { QUEUE_SETTINGS } from './queue.constants';
import { JOB_DEFINITIONS, type JobName } from './job.registry';

/**
 * Retry and retention policy for a job, derived from its queue. Passed explicitly on every add
 * (including flow children and scheduler templates, which do not inherit queue defaults).
 */
export function jobOptionsFor(name: JobName): JobsOptions {
  const settings = QUEUE_SETTINGS[JOB_DEFINITIONS[name].queue];
  return {
    attempts: settings.attempts,
    backoff: settings.attempts > 1 ? { type: 'exponential', delay: settings.backoffMs, jitter: 0.2 } : undefined,
    removeOnComplete: { age: settings.keepCompletedSeconds, count: 10_000 },
    removeOnFail: { age: settings.keepFailedSeconds },
  };
}
