/**
 * Queue topology (docs/ARCHITECTURE.md §6.2). Names are stable identifiers stored in Redis and in
 * job_schedules rows, so never rename one without a migration plan.
 */
export const QueueName = {
  CRAWLER_DISCOVERY: 'crawler.discovery',
  CRAWLER_TENDER: 'crawler.tender',
  DOCUMENT_PROCESSING: 'document.processing',
  SEARCH_INDEXING: 'search.indexing',
  NOTIFICATIONS: 'notifications',
  EMAIL: 'email',
  MAINTENANCE: 'maintenance',
  /** Holding queue for jobs that exhausted their retries; inspected/replayed by admins, never consumed. */
  DEAD_LETTER: 'dead-letter',
} as const;

export type QueueName = (typeof QueueName)[keyof typeof QueueName];

export const ALL_QUEUES = Object.values(QueueName) as QueueName[];

export interface QueueSettings {
  /** Total attempts including the first run. */
  attempts: number;
  /** Base delay for exponential backoff: delay × 2^(attempt−1), ±20 % jitter. */
  backoffMs: number;
  /** Jobs processed in parallel per worker process. */
  concurrency: number;
  /** How long finished jobs are kept (also the jobId de-duplication window). */
  keepCompletedSeconds: number;
  keepFailedSeconds: number;
}

const HOUR = 3_600;
const DAY = 24 * HOUR;

export const QUEUE_SETTINGS: Record<QueueName, QueueSettings> = {
  'crawler.discovery': { attempts: 3, backoffMs: 30_000, concurrency: 2, keepCompletedSeconds: DAY, keepFailedSeconds: 14 * DAY },
  'crawler.tender': { attempts: 5, backoffMs: 10_000, concurrency: 5, keepCompletedSeconds: DAY, keepFailedSeconds: 14 * DAY },
  'document.processing': { attempts: 5, backoffMs: 30_000, concurrency: 2, keepCompletedSeconds: DAY, keepFailedSeconds: 14 * DAY },
  'search.indexing': { attempts: 8, backoffMs: 5_000, concurrency: 10, keepCompletedSeconds: DAY, keepFailedSeconds: 7 * DAY },
  notifications: { attempts: 5, backoffMs: 10_000, concurrency: 10, keepCompletedSeconds: DAY, keepFailedSeconds: 7 * DAY },
  email: { attempts: 6, backoffMs: 30_000, concurrency: 5, keepCompletedSeconds: DAY, keepFailedSeconds: 7 * DAY },
  maintenance: { attempts: 3, backoffMs: 60_000, concurrency: 1, keepCompletedSeconds: 7 * DAY, keepFailedSeconds: 30 * DAY },
  'dead-letter': { attempts: 1, backoffMs: 0, concurrency: 1, keepCompletedSeconds: 30 * DAY, keepFailedSeconds: 30 * DAY },
};
