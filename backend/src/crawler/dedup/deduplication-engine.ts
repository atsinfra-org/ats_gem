import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';

export type DedupOutcome =
  | { kind: 'exact'; tenderId: string; signals: Record<string, unknown> }
  | { kind: 'auto-link'; tenderId: string; score: string; signals: Record<string, unknown> }
  | { kind: 'candidate'; tenderId: string; score: string; signals: Record<string, unknown> }
  | { kind: 'none' };

interface CandidateColumns {
  referenceNumberNormalized: string | null;
  procuringEntityId: string | null;
  stateCode: string | null;
  title: string;
  publishedAt: Date;
  estimatedValue: string | null;
}

const AUTO_LINK_THRESHOLD = 0.9;
const CANDIDATE_THRESHOLD = 0.7;
const DATE_WINDOW_DAYS = 7;
const VALUE_TOLERANCE_PCT = 0.05;

/**
 * Cross-source duplicate detection (docs/ARCHITECTURE.md Sec 6.5), run once per brand-new
 * (source, externalId) pair, before a new canonical `Tender` row is created for it:
 *
 *   Level 1 (exact)      same normalized reference number + same procuring entity      -> reuse
 *   Level 2/3 (fuzzy)     trigram title similarity, published within +/-7d, value within
 *                         +/-5%, same procuring entity or state -> composite score
 *     score >= 0.90  -> auto-link (reuse the existing tender, record an AUTO_CONFIRMED candidate)
 *     score >= 0.70  -> create the new tender anyway, but also record a PENDING candidate for review
 *     score <  0.70  -> create the new tender, no candidate row
 *
 * Never silently merges: every non-"none" outcome is explainable via the `signals` it returns, and
 * every fuzzy match is recorded as a `DuplicateCandidate` row even when auto-linked, so "why are
 * these considered duplicates" is always answerable later (docs/ARCHITECTURE.md Sec 6.5, "no
 * meaningless black-box duplicate flag").
 */
@Injectable()
export class DeduplicationEngine {
  async evaluate(tx: Prisma.TransactionClient, candidate: CandidateColumns): Promise<DedupOutcome> {
    if (candidate.referenceNumberNormalized && candidate.procuringEntityId) {
      const exact = await tx.tender.findFirst({
        where: {
          referenceNumberNormalized: candidate.referenceNumberNormalized,
          procuringEntityId: candidate.procuringEntityId,
          duplicateOfId: null,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (exact) {
        return {
          kind: 'exact',
          tenderId: exact.id,
          signals: { method: 'exact', matchedFields: ['referenceNumberNormalized', 'procuringEntityId'] },
        };
      }
    }

    const windowStart = new Date(candidate.publishedAt.getTime() - DATE_WINDOW_DAYS * 86_400_000);
    const windowEnd = new Date(candidate.publishedAt.getTime() + DATE_WINDOW_DAYS * 86_400_000);
    const fuzzy = await tx.$queryRaw<
      { id: string; title_similarity: number; procuring_entity_id: string | null; state_code: string | null; estimated_value: string | null }[]
    >`
      SELECT id, similarity(title, ${candidate.title}) AS title_similarity, procuring_entity_id, state_code, estimated_value::text AS estimated_value
      FROM tenders
      WHERE duplicate_of_id IS NULL
        AND deleted_at IS NULL
        AND published_at BETWEEN ${windowStart} AND ${windowEnd}
        AND similarity(title, ${candidate.title}) >= 0.3
        AND (
          (procuring_entity_id IS NOT NULL AND procuring_entity_id = ${candidate.procuringEntityId})
          OR (state_code IS NOT NULL AND state_code = ${candidate.stateCode})
        )
      ORDER BY title_similarity DESC
      LIMIT 5`;

    let best: { id: string; score: number; signals: Record<string, unknown> } | null = null;
    for (const row of fuzzy) {
      const sameEntity = row.procuring_entity_id !== null && row.procuring_entity_id === candidate.procuringEntityId;
      const sameState = row.state_code !== null && row.state_code === candidate.stateCode;
      const valueDeltaPct = valueDelta(candidate.estimatedValue, row.estimated_value);
      const withinValue = valueDeltaPct === null ? false : valueDeltaPct <= VALUE_TOLERANCE_PCT;

      // Weighted composite: title similarity carries most weight, entity/value/state corroborate it.
      let score = row.title_similarity * 0.6;
      if (sameEntity) score += 0.25;
      else if (sameState) score += 0.1;
      if (withinValue) score += 0.15;
      score = Math.min(score, 0.99);

      if (!best || score > best.score) {
        best = {
          id: row.id,
          score,
          signals: {
            method: 'composite',
            titleSimilarity: row.title_similarity,
            sameProcuringEntity: sameEntity,
            sameState,
            valueDeltaPct,
            matchedFields: [sameEntity ? 'procuringEntityId' : sameState ? 'stateCode' : null, 'title'].filter(Boolean),
          },
        };
      }
    }

    if (!best || best.score < CANDIDATE_THRESHOLD) return { kind: 'none' };
    const score = best.score.toFixed(3);
    return best.score >= AUTO_LINK_THRESHOLD
      ? { kind: 'auto-link', tenderId: best.id, score, signals: best.signals }
      : { kind: 'candidate', tenderId: best.id, score, signals: best.signals };
  }
}

function valueDelta(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb) || na === 0) return null;
  return Math.abs(na - nb) / na;
}
