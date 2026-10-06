import { Injectable } from '@nestjs/common';
import { currentCorrelationId } from '../common/context/correlation';
import type { Prisma } from '../generated/prisma/client';
import { DOMAIN_EVENT_AGGREGATES, DOMAIN_EVENT_SCHEMAS, type DomainEventPayload, type DomainEventType } from './domain-events';

/**
 * Writes domain events into the outbox **inside the caller's transaction**, so an event exists
 * if and only if the business change committed. Never publish to queues directly from services.
 */
@Injectable()
export class OutboxService {
  async record<T extends DomainEventType>(
    tx: Prisma.TransactionClient,
    eventType: T,
    payload: DomainEventPayload<T>,
  ): Promise<string> {
    const parsed = DOMAIN_EVENT_SCHEMAS[eventType].parse(payload) as DomainEventPayload<T>;
    const aggregate = DOMAIN_EVENT_AGGREGATES[eventType];
    const row = await tx.outboxEvent.create({
      data: {
        eventType,
        aggregateType: aggregate.type,
        aggregateId: aggregate.id(parsed),
        payload: parsed,
        correlationId: currentCorrelationId() ?? null,
      },
      select: { id: true },
    });
    return row.id;
  }
}
