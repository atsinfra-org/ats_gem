import { DOMAIN_EVENT_SCHEMAS, type DomainEventType } from './domain-events';
import { routeEvent } from './outbox.routes';
import { relayBackoffMs } from './outbox.relay';

const eventId = '0199a3b2-0000-7000-8000-00000000000e';
const tenderId = '0199a3b2-0000-7000-8000-00000000000a';

describe('outbox routing', () => {
  it.each(['tender.created', 'tender.updated', 'tender.closed'] as const)('%s → search indexing job', (eventType) => {
    const payload =
      eventType === 'tender.created'
        ? { tenderId, sourceId: null }
        : eventType === 'tender.updated'
          ? { tenderId, changedFields: ['title'] }
          : { tenderId, closedAt: '2026-09-24T09:30:00.000Z' };
    expect(routeEvent({ id: eventId, eventType, payload, correlationId: null })).toEqual([
      { name: 'search.index-tender', payload: { tenderId, eventId, eventType } },
    ]);
  });

  it('tender.source_linked → search indexing job', () => {
    const payload = { tenderId, sourceId: eventId, outcome: 'auto-link' as const };
    expect(routeEvent({ id: eventId, eventType: 'tender.source_linked', payload, correlationId: null })).toEqual([
      { name: 'search.index-tender', payload: { tenderId, eventId, eventType: 'tender.source_linked' } },
    ]);
  });

  it('events without a consumer yet route to nothing (still marked published)', () => {
    expect(routeEvent({ id: eventId, eventType: 'user.created', payload: { userId: tenderId }, correlationId: null })).toEqual([]);
  });

  it('defines a schema for every required domain event', () => {
    const required: DomainEventType[] = [
      'tender.created',
      'tender.updated',
      'tender.closed',
      'tender.source_linked',
      'document.created',
      'user.created',
      'organization.created',
      'subscription.changed',
      'payment.completed',
    ];
    expect(Object.keys(DOMAIN_EVENT_SCHEMAS).sort()).toEqual([...required].sort());
  });

  it('keeps payment amounts as exact decimal strings', () => {
    const schema = DOMAIN_EVENT_SCHEMAS['payment.completed'];
    const base = { paymentId: eventId, organizationId: tenderId, currency: 'INR' };
    expect(schema.safeParse({ ...base, amount: '4999.00' }).success).toBe(true);
    expect(schema.safeParse({ ...base, amount: 4999 }).success).toBe(false);
  });
});

describe('relay backoff', () => {
  it('grows exponentially from 1 s with ±20 % jitter', () => {
    expect(relayBackoffMs(1, () => 0.5)).toBe(1_000);
    expect(relayBackoffMs(2, () => 0.5)).toBe(2_000);
    expect(relayBackoffMs(5, () => 0.5)).toBe(16_000);
    expect(relayBackoffMs(1, () => 0)).toBe(800);
    expect(relayBackoffMs(1, () => 1)).toBe(1_200);
  });

  it('caps at 10 minutes', () => {
    expect(relayBackoffMs(50, () => 0.5)).toBe(600_000);
  });
});
