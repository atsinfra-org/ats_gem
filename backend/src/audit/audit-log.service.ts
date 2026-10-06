import { Injectable } from '@nestjs/common';
import { currentCorrelationId } from '../common/context/correlation';
import { PrismaService } from '../database/prisma.service';
import type { Prisma } from '../generated/prisma/client';

export interface RecordAuditLogInput {
  actorUserId?: string | null;
  organizationId?: string | null;
  /** e.g. `USER_SUSPENDED`, `TENDER_UPDATED` (docs/DATABASE.md §9) — free text, not an enum. */
  action: string;
  resourceType: string;
  resourceId?: string | null;
  /** Must already be redacted: never a password, token, secret or credential. */
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Append-only audit trail. `record()` is the only write this service exposes — there is no
 * update/delete, by design (docs/DATABASE.md §9). Pass `tx` to write in the same transaction as
 * the change being audited, so the log entry exists if and only if the change committed.
 */
@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordAuditLogInput, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    await client.auditLog.create({
      data: {
        actorUserId: input.actorUserId ?? null,
        organizationId: input.organizationId ?? null,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        oldValue: (input.oldValue ?? undefined) as Prisma.InputJsonValue,
        newValue: (input.newValue ?? undefined) as Prisma.InputJsonValue,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        requestId: currentCorrelationId() ?? null,
      },
    });
  }
}
