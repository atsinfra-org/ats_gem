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

const toNotifications = (event: OutboxEventRecord, subject: { type: string; id: string }): RoutedJob[] => [
  { name: 'notification.dispatch', payload: { eventId: event.id, eventType: event.eventType, subject } },
];

/**
 * Event → job fan-out. A route lists every job an event triggers. Events whose consumers arrive
 * in later phases route to nothing yet; they are still marked published and kept for audit and
 * replay (see OUTBOX_RETENTION_DAYS).
 *
 *   tender.created/updated/closed → search.indexing (Phase 1) + notification.dispatch (Phase 8)
 *   tender.corrigendum_created, user.security_event → notification.dispatch (Phase 8)
 *   document.created       → document.processing (Phase 6)
 *   user/organization.*    → welcome email, audit (Phase 2)
 *   subscription/payment.* → entitlement refresh, invoices (Phase 8)
 */
export const OUTBOX_ROUTES: { [T in DomainEventType]: Route<T> } = {
  'tender.created': (e) => [...toSearchIndex(e), ...toNotifications(e, { type: 'tender', id: e.payload.tenderId })],
  'tender.updated': (e) => [...toSearchIndex(e), ...toNotifications(e, { type: 'tender', id: e.payload.tenderId })],
  'tender.closed': (e) => [...toSearchIndex(e), ...toNotifications(e, { type: 'tender', id: e.payload.tenderId })],
  'tender.source_linked': toSearchIndex,
  'tender.corrigendum_created': (e) => toNotifications(e, { type: 'tender', id: e.payload.tenderId }),
  'user.security_event': (e) => toNotifications(e, { type: 'user', id: e.payload.userId }),
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
