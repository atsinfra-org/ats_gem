import { Injectable } from '@nestjs/common';
import { AuditLogService } from '../../audit/audit-log.service';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';

/**
 * Fields an administrator may correct directly on a canonical tender (docs/ARCHITECTURE.md Sec 19
 * "administrative corrections"). Deliberately excludes anything owned by an automated process:
 * `lifecycle`/`status` (derived, Phase 1), `procuringEntityId`/`duplicateOfId` (Phase 3 resolution/
 * dedup engines), `referenceNumber*` (identity key). Correcting one of those belongs to its own
 * engine (entity merge, duplicate-candidate resolution), not a generic field patch.
 */
export interface CorrectableTenderFields {
  title?: string;
  description?: string;
  estimatedValue?: string;
  emdAmount?: string;
  tenderFee?: string;
  closingAt?: Date;
  openingAt?: Date;
  stateCode?: string;
  city?: string;
  locationText?: string;
}

const CORRECTABLE_KEYS = ['title', 'description', 'estimatedValue', 'emdAmount', 'tenderFee', 'closingAt', 'openingAt', 'stateCode', 'city', 'locationText'] as const;

/**
 * Controlled admin correction of canonical tender data. Never a silent overwrite: every change is
 * audited with old value, new value, actor and a required reason (docs/ARCHITECTURE.md Sec 19),
 * via the existing Phase 2 `AuditLogService` - no second audit mechanism.
 */
@Injectable()
export class TenderCorrectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  async correct(tenderId: string, changes: CorrectableTenderFields, reason: string, actorUserId: string): Promise<void> {
    const fields = CORRECTABLE_KEYS.filter((key) => changes[key] !== undefined);
    if (fields.length === 0) throw new AppError('VALIDATION_FAILED', 'No correctable fields were provided.');

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.tender.findFirst({ where: { id: tenderId, deletedAt: null } });
      if (!existing) throw new AppError('TENDER_NOT_FOUND', 'Tender not found.');

      const data: Prisma.TenderUpdateInput = {};
      const oldValue: Record<string, unknown> = {};
      const newValue: Record<string, unknown> = {};
      for (const key of fields) {
        const existingValue = existing[key as keyof typeof existing];
        oldValue[key] = existingValue instanceof Date ? existingValue.toISOString() : (existingValue?.toString() ?? null);
        const nextValue = changes[key];
        newValue[key] = nextValue instanceof Date ? nextValue.toISOString() : nextValue;
        Object.assign(data, { [key]: nextValue });
      }

      await tx.tender.update({ where: { id: tenderId }, data });
      await this.audit.record(
        {
          actorUserId,
          action: 'TENDER_CORRECTED',
          resourceType: 'Tender',
          resourceId: tenderId,
          oldValue: { ...oldValue, reason },
          newValue,
        },
        tx,
      );
    });
  }
}
