import { Injectable } from '@nestjs/common';
import { AuditLogService } from '../../audit/audit-log.service';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../database/prisma.service';
import type { TenderEventType } from '../../generated/prisma/enums';

export interface RecordEventInput {
  tenderId: string;
  eventType: TenderEventType;
  eventAt?: Date;
  title?: string;
  description?: string;
  sourceReference?: string;
}

/**
 * Normalized tender timeline (docs/ARCHITECTURE.md Sec 19). `record()` is upsert-shaped on
 * `(tenderId, eventType, eventAt)` (the DB unique constraint) so recording the same event twice -
 * e.g. a crawl re-observing "SUBMISSION_DEADLINE at 2026-10-05" - never creates a duplicate row.
 */
@Injectable()
export class TimelineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  async record(input: RecordEventInput) {
    const eventAt = input.eventAt ?? null;
    const existing = await this.prisma.tenderEvent.findFirst({ where: { tenderId: input.tenderId, eventType: input.eventType, eventAt } });
    if (existing) return existing;
    return this.prisma.tenderEvent.create({
      data: { tenderId: input.tenderId, eventType: input.eventType, eventAt, title: input.title ?? null, description: input.description ?? null, sourceReference: input.sourceReference ?? null },
    });
  }

  list(tenderId: string, params: { take: number; skip: number }) {
    const where = { tenderId };
    return this.prisma.$transaction([
      this.prisma.tenderEvent.count({ where }),
      // Chronological, but events with an unknown timestamp (`eventAt: null`) sort last rather than
      // first/crashing the sort - "handle events with incomplete timestamps safely" (brief Sec 27).
      this.prisma.tenderEvent.findMany({ where, orderBy: [{ eventAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }], take: params.take, skip: params.skip }),
    ]);
  }

  async get(tenderId: string, id: string) {
    const event = await this.prisma.tenderEvent.findFirst({ where: { id, tenderId } });
    if (!event) throw new AppError('NOT_FOUND', 'Event not found.');
    return event;
  }

  /** Administrative correction of an event's fields - permission-checked by the caller, audited here. */
  async correct(tenderId: string, id: string, changes: { eventAt?: Date | null; title?: string; description?: string }, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.tenderEvent.findFirst({ where: { id, tenderId } });
      if (!existing) throw new AppError('NOT_FOUND', 'Event not found.');
      const updated = await tx.tenderEvent.update({ where: { id }, data: changes });
      await this.audit.record(
        {
          actorUserId,
          action: 'TENDER_EVENT_CORRECTED',
          resourceType: 'TenderEvent',
          resourceId: id,
          oldValue: { eventAt: existing.eventAt?.toISOString() ?? null, title: existing.title, description: existing.description },
          newValue: { eventAt: updated.eventAt?.toISOString() ?? null, title: updated.title, description: updated.description },
        },
        tx,
      );
      return updated;
    });
  }
}
