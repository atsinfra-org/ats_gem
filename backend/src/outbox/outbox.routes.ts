import type { JobName, JobPayload } from '../queues/job.registry';
import type { DomainEventPayload, DomainEventType } from './domain-events';

export interface OutboxEventRecord<T extends DomainEventType = DomainEventType> {
  id: string;
  eventType: T;
  payload: DomainEventPayload<T>;
  correlationId: string | null;
}

export interface RoutedJob<N extends JobName = JobName> {
  name: N;
  payload: JobPayload<N>;
}

type Route<T extends DomainEventType> = (event: OutboxEventRecord<T>) => RoutedJob[];

const toSearchIndex = (event: OutboxEventRecord<'tender.created' | 'tender.updated' | 'tender.closed' | 'tender.source_linked'>): RoutedJob[] => [
  {
    name: 'search.index-tender',
    payload: { tenderId: event.payload.tenderId, eventId: event.id, eventType: event.eventType },
  },
];

/**
 * Event → job fan-out. A route lists every job an event triggers. Events whose consumers arrive
 * in later phases route to nothing yet; they are still marked published and kept for audit and
 * replay (see OUTBOX_RETENTION_DAYS).
 *
 *   tender.*               → search.indexing (Phase 1); alerts/notifications join in Phase 7
 *   document.created       → document.processing (Phase 6)
 *   user/organization.*    → welcome email, audit (Phase 2)
 *   subscription/payment.* → entitlement refresh, invoices (Phase 8)
 */
export const OUTBOX_ROUTES: { [T in DomainEventType]: Route<T> } = {
  'tender.created': toSearchIndex,
  'tender.updated': toSearchIndex,
  'tender.closed': toSearchIndex,
  'tender.source_linked': toSearchIndex,
  'document.created': () => [],
  'user.created': () => [],
  'organization.created': () => [],
  'subscription.changed': () => [],
  'payment.completed': () => [],
};

export function routeEvent(event: OutboxEventRecord): RoutedJob[] {
  return (OUTBOX_ROUTES[event.eventType] as Route<DomainEventType>)(event);
}

/** Deterministic job ID per (event, job) so re-publishing the same event never duplicates work. */
export function outboxJobId(eventId: string, jobName: JobName): string {
  return `evt.${eventId}.${jobName}`;
}
