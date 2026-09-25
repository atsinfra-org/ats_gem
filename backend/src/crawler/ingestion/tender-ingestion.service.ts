import { Injectable } from '@nestjs/common';
import { sha256Hex, stableStringify } from '../../common/stable-json';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { OutboxService } from '../../outbox/outbox.service';
import { EntityResolutionService } from '../../tenders/entities/entity-resolution.service';
import type { RawTender } from '../adapters/source-adapter';
import { DeduplicationEngine } from '../dedup/deduplication-engine';
import type { ValidNormalizedTender } from '../normalization/normalized-tender';
import { normalizeReference } from '../normalization/parsers';
import { computeTenderStatus } from './tender-status';

export type IngestOutcome = 'created' | 'updated' | 'unchanged' | 'suppressed' | 'linked';

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
    sourceStatusRaw: n.sourceStatusRaw ?? null,
  };
}

function versionDiff(previous: Record<string, unknown>, next: ValidNormalizedTender, fields: string[]): Prisma.InputJsonValue {
  const nextRecord = next as Record<string, unknown>;
  return Object.fromEntries(fields.map((field) => [field, { from: previous[field] ?? null, to: nextRecord[field] ?? null }]));
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
    private readonly entityResolution: EntityResolutionService,
    private readonly dedup: DeduplicationEngine,
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
      const entityResolution = normalized.department
        ? await this.entityResolution.resolve(tx, sourceId, normalized.department, normalized.stateCode ?? null)
        : { procuringEntityId: null, ambiguous: false };
      const { procuringEntityId, ambiguous: ambiguousEntity } = entityResolution;

      const dedupOutcome = await this.dedup.evaluate(tx, {
        referenceNumberNormalized: columns.referenceNumberNormalized,
        procuringEntityId,
        stateCode: columns.stateCode,
        title: columns.title,
        publishedAt: columns.publishedAt,
        estimatedValue: columns.estimatedValue,
      });

      if (dedupOutcome.kind === 'exact' || dedupOutcome.kind === 'auto-link') {
        const canonicalId = dedupOutcome.tenderId;
        await tx.tenderSourceRecord.create({
          data: {
            tenderId: canonicalId,
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
        if (dedupOutcome.kind === 'auto-link') {
          await this.recordDuplicateCandidate(tx, canonicalId, dedupOutcome.tenderId, dedupOutcome.score, dedupOutcome.signals, 'AUTO_CONFIRMED');
        }
        await this.outbox.record(tx, 'tender.source_linked', { tenderId: canonicalId, sourceId, outcome: dedupOutcome.kind });
        return { outcome: 'linked', tenderId: canonicalId, changedFields: [] };
      }

      const tender = await tx.tender.create({
        data: { ...columns, procuringEntityId, status, statusComputedAt: now, lastSyncedAt: now },
        select: { id: true },
      });
      const sourceRecord = await tx.tenderSourceRecord.create({
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
        select: { id: true },
      });
      await tx.tenderVersion.create({
        data: {
          tenderId: tender.id,
          version: 1,
          changeType: 'INITIAL',
          diff: versionDiff({}, normalized, [...TRACKED_FIELDS]),
          sourceRecordId: sourceRecord.id,
        },
      });
      if (dedupOutcome.kind === 'candidate') {
        await this.recordDuplicateCandidate(tx, tender.id, dedupOutcome.tenderId, dedupOutcome.score, dedupOutcome.signals, 'PENDING');
      }
      await this.recordQualityIssues(tx, tender.id, sourceRecord.id, normalized, ambiguousEntity, now);
      await this.recordTimelineEvents(tx, tender.id, normalized);
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

    const procuringEntityId = normalized.department
      ? (await this.entityResolution.resolve(tx, sourceId, normalized.department, normalized.stateCode ?? null)).procuringEntityId
      : null;

    await tx.tender.update({
      where: { id: existing.tender_id },
      data: { ...columns, procuringEntityId, status, statusComputedAt: now, lastSyncedAt: now },
    });
    if (fields.length > 0) {
      await this.outbox.record(tx, 'tender.updated', { tenderId: existing.tender_id, changedFields: fields });
      const changeType = fields.includes('closingAt') ? 'CORRIGENDUM' : normalized.lifecycle === 'CANCELLED' ? 'CANCELLATION' : 'UPDATE';
      const lastVersion = await tx.tenderVersion.findFirst({ where: { tenderId: existing.tender_id }, orderBy: { version: 'desc' }, select: { version: true } });
      await tx.tenderVersion.create({
        data: {
          tenderId: existing.tender_id,
          version: (lastVersion?.version ?? 0) + 1,
          changeType,
          diff: versionDiff(existing.normalized_payload, normalized, fields),
          sourceRecordId: existing.id,
        },
      });
      if (fields.includes('closingAt') && columns.closingAt) {
        await tx.tenderEvent.createMany({ data: [{ tenderId: existing.tender_id, eventType: 'EXTENDED', eventAt: now }], skipDuplicates: true });
      }
    }
    if (status === 'CLOSED' && current.status !== 'CLOSED') {
      await this.outbox.record(tx, 'tender.closed', {
        tenderId: existing.tender_id,
        closedAt: (columns.closingAt ?? now).toISOString(),
      });
    }
    return { outcome: 'updated', tenderId: existing.tender_id, changedFields: fields };
  }

  /** `duplicate_candidates.tender_id < candidate_tender_id` is a DB CHECK constraint (Sec 26): order the pair. */
  private async recordDuplicateCandidate(
    tx: Prisma.TransactionClient,
    newTenderId: string,
    matchedTenderId: string,
    score: string,
    signals: Record<string, unknown>,
    status: 'PENDING' | 'AUTO_CONFIRMED',
  ): Promise<void> {
    const [tenderId, candidateTenderId] = newTenderId < matchedTenderId ? [newTenderId, matchedTenderId] : [matchedTenderId, newTenderId];
    await tx.duplicateCandidate.create({
      data: { tenderId, candidateTenderId, score, signals: signals as Prisma.InputJsonValue, status },
    });
  }

  /** Non-blocking data-quality findings (docs/ARCHITECTURE.md Sec 19.4): recording one never rejects the tender. */
  private async recordQualityIssues(
    tx: Prisma.TransactionClient,
    tenderId: string,
    sourceRecordId: string,
    normalized: ValidNormalizedTender,
    ambiguousEntity: boolean,
    now: Date,
  ): Promise<void> {
    const issues: { severity: 'INFO' | 'WARNING' | 'ERROR'; code: string; message: string }[] = [];
    if (!normalized.referenceNumber) issues.push({ severity: 'WARNING', code: 'MISSING_REFERENCE_NUMBER', message: 'No reference number was provided by the source.' });
    if (!normalized.estimatedValue) issues.push({ severity: 'INFO', code: 'MISSING_ESTIMATED_VALUE', message: 'No estimated value was provided by the source.' });
    if (ambiguousEntity) issues.push({ severity: 'WARNING', code: 'AMBIGUOUS_PROCURING_ENTITY', message: 'The procuring-entity name matched more than one existing entity; left unresolved for manual review.' });
    if (!normalized.closingAt) issues.push({ severity: 'WARNING', code: 'MISSING_DEADLINE', message: 'No submission deadline was provided by the source.' });
    if (!normalized.stateCode && !normalized.city && !normalized.locationText) issues.push({ severity: 'INFO', code: 'MISSING_LOCATION', message: 'No state, city or location text was provided by the source.' });
    if (normalized.emdAmount && normalized.estimatedValue && Number(normalized.emdAmount) > Number(normalized.estimatedValue)) {
      issues.push({ severity: 'WARNING', code: 'SUSPICIOUS_EMD_VALUE_RATIO', message: 'EMD amount is greater than the estimated tender value.' });
    }
    if (normalized.closingAt) {
      const days = (new Date(normalized.closingAt).getTime() - new Date(normalized.publishedAt).getTime()) / 86_400_000;
      if (days < 2) issues.push({ severity: 'INFO', code: 'SHORT_BIDDING_WINDOW', message: `Only ${days.toFixed(1)} day(s) between publication and closing.` });
    }
    if (issues.length === 0) return;
    await tx.tenderQualityIssue.createMany({
      data: issues.map((issue) => ({ tenderId, sourceRecordId, severity: issue.severity, code: issue.code, message: issue.message, detectedAt: now })),
    });
  }

  /** Seeds the timeline (docs/ARCHITECTURE.md Sec 19) from fields the tender is created with. */
  private async recordTimelineEvents(tx: Prisma.TransactionClient, tenderId: string, normalized: ValidNormalizedTender): Promise<void> {
    const events: { eventType: 'PUBLISHED' | 'SUBMISSION_DEADLINE' | 'OPENING'; eventAt: Date }[] = [{ eventType: 'PUBLISHED', eventAt: new Date(normalized.publishedAt) }];
    if (normalized.closingAt) events.push({ eventType: 'SUBMISSION_DEADLINE', eventAt: new Date(normalized.closingAt) });
    if (normalized.openingAt) events.push({ eventType: 'OPENING', eventAt: new Date(normalized.openingAt) });
    await tx.tenderEvent.createMany({ data: events.map((e) => ({ tenderId, eventType: e.eventType, eventAt: e.eventAt })), skipDuplicates: true });
  }
}
