import { Injectable } from '@nestjs/common';
import { sha256Hex, stableStringify } from '../../common/stable-json';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { OutboxService } from '../../outbox/outbox.service';
import type { RawTender } from '../adapters/source-adapter';
import type { ValidNormalizedTender } from '../normalization/normalized-tender';
import { normalizeReference } from '../normalization/parsers';
import { computeTenderStatus } from './tender-status';

export type IngestOutcome = 'created' | 'updated' | 'unchanged' | 'suppressed';

export interface IngestInput {
  sourceId: string;
  raw: RawTender;
  normalized: ValidNormalizedTender;
}

export interface IngestResult {
  outcome: IngestOutcome;
  tenderId: string;
  changedFields: string[];
}

/** Normalized fields that map onto tender columns; a change in any of them is a tender update. */
const TRACKED_FIELDS = [
  'referenceNumber',
  'title',
  'description',
  'department',
  'stateCode',
  'city',
  'locationText',
  'estimatedValue',
  'emdAmount',
  'tenderFee',
  'currency',
  'publishedAt',
  'closingAt',
  'openingAt',
  'lifecycle',
  'sourceUrl',
] as const satisfies readonly (keyof ValidNormalizedTender)[];

interface LockedRecord {
  id: string;
  tender_id: string;
  payload_hash: string;
  normalized_payload: Record<string, unknown>;
}

export function payloadHash(normalized: ValidNormalizedTender): string {
  return sha256Hex(stableStringify(normalized));
}

export function changedFields(previous: Record<string, unknown>, next: ValidNormalizedTender): string[] {
  const nextRecord = next as Record<string, unknown>;
  return TRACKED_FIELDS.filter((field) => stableStringify(previous[field] ?? null) !== stableStringify(nextRecord[field] ?? null));
}

function tenderColumns(n: ValidNormalizedTender) {
  return {
    referenceNumber: n.referenceNumber ?? null,
    referenceNumberNormalized: n.referenceNumber ? normalizeReference(n.referenceNumber) : null,
    title: n.title,
    description: n.description ?? null,
    department: n.department ?? null,
    stateCode: n.stateCode ?? null,
    city: n.city ?? null,
    locationText: n.locationText ?? null,
    // Decimal columns take the exact string; no float conversion anywhere on the path.
    estimatedValue: n.estimatedValue ?? null,
    emdAmount: n.emdAmount ?? null,
    tenderFee: n.tenderFee ?? null,
    currency: n.currency,
    publishedAt: new Date(n.publishedAt),
    closingAt: n.closingAt ? new Date(n.closingAt) : null,
    openingAt: n.openingAt ? new Date(n.openingAt) : null,
    lifecycle: n.lifecycle,
    primarySourceUrl: n.sourceUrl ?? null,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * Writes one normalized tender idempotently. The (source, external id) pair is the dedupe key and
 * the SHA-256 of the canonical normalized payload decides whether anything changed:
 *
 *   new pair       → create tender + source record, emit tender.created
 *   same hash      → touch last_seen_at only, no event
 *   different hash → update tender, emit tender.updated (+ tender.closed on transition)
 *
 * The domain change and its outbox event commit in one transaction. The source record row is
 * locked (`FOR UPDATE`) so concurrent crawls of the same tender serialize; two concurrent
 * first-time inserts collide on the unique key, and the loser retries onto the update path.
 *
 * Phase 1 maps one source record to one tender. Cross-source de-duplication (merging the same
 * tender published on several portals) arrives with the taxonomy work in Phase 3.
 */
@Injectable()
export class TenderIngestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  async ingest(input: IngestInput, now: Date = new Date()): Promise<IngestResult> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.prisma.$transaction((tx) => this.ingestInTx(tx, input, now), { timeout: 15_000 });
      } catch (err) {
        if (attempt < 3 && isUniqueViolation(err)) continue;
        throw err;
      }
    }
  }

  private async ingestInTx(tx: Prisma.TransactionClient, input: IngestInput, now: Date): Promise<IngestResult> {
    const { sourceId, raw, normalized } = input;
    const hash = payloadHash(normalized);
    const [existing] = await tx.$queryRaw<LockedRecord[]>`
      SELECT id, tender_id, payload_hash, normalized_payload
      FROM tender_source_records
      WHERE source_id = ${sourceId}::uuid AND external_tender_id = ${normalized.externalId}
      FOR UPDATE`;

    const columns = tenderColumns(normalized);
    const status = computeTenderStatus(columns, now);
    const rawPayload = raw.data as Prisma.InputJsonValue;
    const normalizedPayload = normalized as Prisma.InputJsonValue;

    if (!existing) {
      const tender = await tx.tender.create({
        data: { ...columns, status, statusComputedAt: now, lastSyncedAt: now },
        select: { id: true },
      });
      await tx.tenderSourceRecord.create({
        data: {
          tenderId: tender.id,
          sourceId,
          externalTenderId: normalized.externalId,
          sourceUrl: normalized.sourceUrl ?? null,
          payloadHash: hash,
          rawPayload,
          normalizedPayload,
          firstSeenAt: now,
          lastSeenAt: now,
          lastChangedAt: now,
        },
      });
      await this.outbox.record(tx, 'tender.created', { tenderId: tender.id, sourceId });
      return { outcome: 'created', tenderId: tender.id, changedFields: [] };
    }

    if (existing.payload_hash === hash) {
      await tx.tenderSourceRecord.update({ where: { id: existing.id }, data: { lastSeenAt: now } });
      return { outcome: 'unchanged', tenderId: existing.tender_id, changedFields: [] };
    }

    const current = await tx.tender.findUniqueOrThrow({
      where: { id: existing.tender_id },
      select: { status: true, deletedAt: true },
    });
    const fields = changedFields(existing.normalized_payload, normalized);

    await tx.tenderSourceRecord.update({
      where: { id: existing.id },
      data: {
        sourceUrl: normalized.sourceUrl ?? null,
        payloadHash: hash,
        rawPayload,
        normalizedPayload,
        lastSeenAt: now,
        lastChangedAt: now,
      },
    });

    // An admin-deleted tender stays deleted: the source record keeps tracking it, the tender is not revived.
    if (current.deletedAt) return { outcome: 'suppressed', tenderId: existing.tender_id, changedFields: fields };

    await tx.tender.update({
      where: { id: existing.tender_id },
      data: { ...columns, status, statusComputedAt: now, lastSyncedAt: now },
    });
    if (fields.length > 0) {
      await this.outbox.record(tx, 'tender.updated', { tenderId: existing.tender_id, changedFields: fields });
    }
    if (status === 'CLOSED' && current.status !== 'CLOSED') {
      await this.outbox.record(tx, 'tender.closed', {
        tenderId: existing.tender_id,
        closedAt: (columns.closingAt ?? now).toISOString(),
      });
    }
    return { outcome: 'updated', tenderId: existing.tender_id, changedFields: fields };
  }
}
