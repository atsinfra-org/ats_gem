import { z } from 'zod';

const uuid = z.uuid();
const decimalString = z.string().regex(/^\d+(\.\d{1,2})?$/);

/**
 * Domain events published through the transactional outbox. Payloads are small, versionless
 * facts (IDs and changed fields); consumers load current state from the database themselves.
 * Adding a field is backward compatible; removing or renaming one needs a new event type.
 */
export const DOMAIN_EVENT_SCHEMAS = {
  'tender.created': z.object({ tenderId: uuid, sourceId: uuid.nullable() }),
  'tender.updated': z.object({ tenderId: uuid, changedFields: z.array(z.string()).min(1) }),
  'tender.closed': z.object({ tenderId: uuid, closedAt: z.iso.datetime() }),
  'document.created': z.object({ documentId: uuid, tenderId: uuid }),
  'user.created': z.object({ userId: uuid }),
  'organization.created': z.object({ organizationId: uuid, ownerUserId: uuid }),
  'subscription.changed': z.object({
    subscriptionId: uuid,
    organizationId: uuid,
    fromPlan: z.string().nullable(),
    toPlan: z.string(),
  }),
  'payment.completed': z.object({
    paymentId: uuid,
    organizationId: uuid,
    amount: decimalString,
    currency: z.string().length(3),
  }),
} as const;

export type DomainEventType = keyof typeof DOMAIN_EVENT_SCHEMAS;
export type DomainEventPayload<T extends DomainEventType> = z.infer<(typeof DOMAIN_EVENT_SCHEMAS)[T]>;

/** Which aggregate each event belongs to, and how to read its ID from the payload. */
export const DOMAIN_EVENT_AGGREGATES: {
  [T in DomainEventType]: { type: string; id: (payload: DomainEventPayload<T>) => string };
} = {
  'tender.created': { type: 'tender', id: (p) => p.tenderId },
  'tender.updated': { type: 'tender', id: (p) => p.tenderId },
  'tender.closed': { type: 'tender', id: (p) => p.tenderId },
  'document.created': { type: 'document', id: (p) => p.documentId },
  'user.created': { type: 'user', id: (p) => p.userId },
  'organization.created': { type: 'organization', id: (p) => p.organizationId },
  'subscription.changed': { type: 'subscription', id: (p) => p.subscriptionId },
  'payment.completed': { type: 'payment', id: (p) => p.paymentId },
};

export function isDomainEventType(value: string): value is DomainEventType {
  return Object.hasOwn(DOMAIN_EVENT_SCHEMAS, value);
}
