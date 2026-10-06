import { Injectable } from '@nestjs/common';
import { AuditLogService } from '../../audit/audit-log.service';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../database/prisma.service';
import { OutboxService } from '../../outbox/outbox.service';

export interface CreateCorrigendumInput {
  tenderId: string;
  sourceId?: string;
  sourceReference?: string;
  title: string;
  description?: string;
  publishedAt: Date;
  effectiveAt?: Date;
  sourceUrl?: string;
  documentId?: string;
  affectedFields?: string[];
}

/**
 * Corrigendum/change-notice records (docs/ARCHITECTURE.md Sec 19). Distinct from `TenderVersion`
 * (Phase 3, which records *what actually changed* on the canonical row) - this is the source's own
 * *notice* of a change, kept verbatim. Recording one also writes a matching `CORRIGENDUM` timeline
 * event, so the timeline stays the single place to see "everything that happened to this tender"
 * without the two models drifting out of sync.
 */
@Injectable()
export class CorrigendaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly outbox: OutboxService,
  ) {}

  list(tenderId: string, params: { take: number; skip: number }) {
    const where = { tenderId };
    return this.prisma.$transaction([
      this.prisma.tenderCorrigendum.count({ where }),
      this.prisma.tenderCorrigendum.findMany({ where, orderBy: { publishedAt: 'desc' }, take: params.take, skip: params.skip }),
    ]);
  }

  async get(tenderId: string, id: string) {
    const c = await this.prisma.tenderCorrigendum.findFirst({ where: { id, tenderId } });
    if (!c) throw new AppError('NOT_FOUND', 'Corrigendum not found.');
    return c;
  }

  async create(input: CreateCorrigendumInput, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const corrigendum = await tx.tenderCorrigendum.create({
        data: {
          tenderId: input.tenderId,
          sourceId: input.sourceId ?? null,
          sourceReference: input.sourceReference ?? null,
          title: input.title,
          description: input.description ?? null,
          publishedAt: input.publishedAt,
          effectiveAt: input.effectiveAt ?? null,
          sourceUrl: input.sourceUrl ?? null,
          documentId: input.documentId ?? null,
          affectedFields: input.affectedFields ?? [],
        },
      });
      const existingEvent = await tx.tenderEvent.findFirst({ where: { tenderId: input.tenderId, eventType: 'CORRIGENDUM', eventAt: input.publishedAt } });
      if (!existingEvent) {
        await tx.tenderEvent.create({
          data: { tenderId: input.tenderId, eventType: 'CORRIGENDUM', eventAt: input.publishedAt, title: input.title, description: input.description ?? null, sourceReference: input.sourceReference ?? null },
        });
      }
      await this.outbox.record(tx, 'tender.corrigendum_created', { tenderId: input.tenderId, corrigendumId: corrigendum.id });
      await this.audit.record({ actorUserId, action: 'TENDER_CORRIGENDUM_CREATED', resourceType: 'TenderCorrigendum', resourceId: corrigendum.id, newValue: { title: corrigendum.title, publishedAt: corrigendum.publishedAt.toISOString() } }, tx);
      return corrigendum;
    });
  }
}
