import { z } from 'zod';
import { QueueName } from './queue.constants';

const uuid = z.uuid();
const empty = z.object({}).strict();

/**
 * One schema per job name. Payload types are inferred from these, and workers validate every
 * payload before a handler runs — job data crosses a process boundary (Redis) and some of it is
 * authored in the database (job_schedules), so it is treated as untrusted input.
 *
 * Payloads carry identifiers and small facts only: never secrets, never whole documents.
 */
export const JOB_SCHEMAS = {
  'crawler.discover-source': z.object({
    sourceId: uuid,
    trigger: z.enum(['SCHEDULE', 'MANUAL', 'RETRY']),
    requestedBy: uuid.optional(),
  }),
  'crawler.ingest-tender': z.object({
    sourceId: uuid,
    crawlRunId: uuid,
    ref: z.object({ externalId: z.string().min(1).max(256), url: z.string().max(2048).optional() }),
  }),
  'crawler.finalize-run': z.object({ sourceId: uuid, crawlRunId: uuid }),
  // Consumer lands in Phase 6.
  'document.process': z.object({ documentId: uuid }),
  'search.index-tender': z.object({
    tenderId: uuid,
    eventId: uuid,
    eventType: z.enum(['tender.created', 'tender.updated', 'tender.closed', 'tender.source_linked']),
  }),
  // Consumer lands in Phase 7.
  'notification.dispatch': z.object({
    eventId: uuid,
    eventType: z.string().min(1),
    subject: z.object({ type: z.string(), id: z.string() }),
  }),
  'email.send': z.object({
    to: z.email(),
    template: z.string().regex(/^[a-z0-9-]+$/),
    variables: z.record(z.string(), z.string()).default({}),
  }),
  /** Phase 8: send one email delivery (a `notification_deliveries` row). */
  'notification.email': z.object({ deliveryId: uuid }),
  /** Phase 8: scheduled sweeps. */
  'notification.deadline-sweep': empty,
  'notification.send-digests': empty,
  'maintenance.outbox-cleanup': empty,
  'maintenance.sources-health-check': empty,
  'maintenance.search-events-purge': empty,
  'analytics.rollup': empty,
  'analytics.purge-events': empty,
  'dead-letter.record': z.object({
    queue: z.string(),
    jobName: z.string(),
    jobId: z.string(),
    attemptsMade: z.number().int(),
    failedReason: z.string(),
    failedAt: z.iso.datetime(),
    payload: z.unknown(),
    correlationId: z.string().optional(),
  }),
} as const;

export type JobName = keyof typeof JOB_SCHEMAS;
/** Payload as a handler receives it (defaults applied). */
export type JobPayload<N extends JobName> = z.infer<(typeof JOB_SCHEMAS)[N]>;
/** Payload as a producer supplies it (fields with defaults may be omitted). */
export type JobInput<N extends JobName> = z.input<(typeof JOB_SCHEMAS)[N]>;

export interface JobDefinition<N extends JobName> {
  queue: QueueName;
  /**
   * Fields added to every log line for this job (entity and source identifiers).
   * Must never return secrets or personal data.
   */
  logContext?: (payload: JobPayload<N>) => Record<string, string | undefined>;
}

export const JOB_DEFINITIONS: { [N in JobName]: JobDefinition<N> } = {
  'crawler.discover-source': {
    queue: QueueName.CRAWLER_DISCOVERY,
    logContext: (p) => ({ sourceId: p.sourceId, trigger: p.trigger }),
  },
  'crawler.ingest-tender': {
    queue: QueueName.CRAWLER_TENDER,
    logContext: (p) => ({ sourceId: p.sourceId, crawlRunId: p.crawlRunId, externalId: p.ref.externalId }),
  },
  'crawler.finalize-run': {
    queue: QueueName.CRAWLER_DISCOVERY,
    logContext: (p) => ({ sourceId: p.sourceId, crawlRunId: p.crawlRunId }),
  },
  'document.process': {
    queue: QueueName.DOCUMENT_PROCESSING,
    logContext: (p) => ({ documentId: p.documentId }),
  },
  'search.index-tender': {
    queue: QueueName.SEARCH_INDEXING,
    logContext: (p) => ({ tenderId: p.tenderId, eventId: p.eventId, eventType: p.eventType }),
  },
  'notification.dispatch': {
    queue: QueueName.NOTIFICATIONS,
    logContext: (p) => ({ eventId: p.eventId, eventType: p.eventType }),
  },
  'email.send': {
    queue: QueueName.EMAIL,
    // Deliberately excludes the recipient address.
    logContext: (p) => ({ template: p.template }),
  },
  'notification.email': { queue: QueueName.EMAIL, logContext: (p) => ({ deliveryId: p.deliveryId }) },
  'notification.deadline-sweep': { queue: QueueName.MAINTENANCE },
  'notification.send-digests': { queue: QueueName.MAINTENANCE },
  'maintenance.outbox-cleanup': { queue: QueueName.MAINTENANCE },
  'maintenance.sources-health-check': { queue: QueueName.MAINTENANCE },
  'maintenance.search-events-purge': { queue: QueueName.MAINTENANCE },
  'analytics.rollup': { queue: QueueName.MAINTENANCE },
  'analytics.purge-events': { queue: QueueName.MAINTENANCE },
  'dead-letter.record': {
    queue: QueueName.DEAD_LETTER,
    logContext: (p) => ({ originalQueue: p.queue, originalJobName: p.jobName, originalJobId: p.jobId }),
  },
};

export function isJobName(value: string): value is JobName {
  return Object.hasOwn(JOB_SCHEMAS, value);
}

export const JOB_ID_PATTERN = /^[A-Za-z0-9._-]{1,200}$/;
