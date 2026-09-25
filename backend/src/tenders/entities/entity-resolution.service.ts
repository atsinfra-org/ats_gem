import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { normalizeEntityName } from './entity-normalization';

export interface EntityResolutionResult {
  /** null only when the raw name was empty, or a fuzzy pass found more than one plausible match. */
  procuringEntityId: string | null;
  ambiguous: boolean;
}

const FUZZY_THRESHOLD = 0.85;

/**
 * Resolves a source's free-text procuring-entity name to a canonical `ProcuringEntity`, following
 * the layered strategy in docs/ARCHITECTURE.md Sec 19: reuse a known (source, name) mapping, then an
 * exact normalized-name match, then a curated alias, then a *conservative* trigram-similarity match
 * (only within the same state, and only when exactly one candidate clears the threshold - two or
 * more candidates means "don't guess", not "pick the best one"), and only then create a brand-new
 * entity. Every resolution but the ambiguous case is written to `source_entity_mappings` so the same
 * (source, raw name) pair always resolves the same way afterwards without recomputing it.
 *
 * Must run inside the caller's ingestion transaction (`tx`) so the mapping and the tender it
 * resolves for commit atomically.
 */
@Injectable()
export class EntityResolutionService {
  async resolve(tx: Prisma.TransactionClient, sourceId: string, rawName: string, stateCode: string | null): Promise<EntityResolutionResult> {
    const normalized = normalizeEntityName(rawName);
    if (!normalized) return { procuringEntityId: null, ambiguous: false };

    const existingMapping = await tx.sourceEntityMapping.findUnique({
      where: { sourceId_sourceEntityNormalized: { sourceId, sourceEntityNormalized: normalized } },
    });
    if (existingMapping) {
      const resolved = existingMapping.procuringEntityId ? await this.resolveSurvivor(tx, existingMapping.procuringEntityId) : null;
      return { procuringEntityId: resolved, ambiguous: false };
    }

    const exact = await tx.procuringEntity.findFirst({
      where: { nameNormalized: normalized, stateCode, status: { not: 'MERGED' } },
      select: { id: true },
    });
    if (exact) {
      await this.recordMapping(tx, sourceId, rawName, normalized, exact.id, 'EXACT_NORMALIZED_NAME', '1.000');
      return { procuringEntityId: exact.id, ambiguous: false };
    }

    const alias = await tx.procuringEntityAlias.findFirst({
      where: { aliasNormalized: normalized },
      select: { procuringEntityId: true },
    });
    if (alias) {
      const resolved = await this.resolveSurvivor(tx, alias.procuringEntityId);
      await this.recordMapping(tx, sourceId, rawName, normalized, resolved, 'ALIAS', '0.950');
      return { procuringEntityId: resolved, ambiguous: false };
    }

    const fuzzy = await tx.$queryRaw<{ id: string; similarity: number }[]>`
      SELECT id, similarity(name_normalized, ${normalized}) AS similarity
      FROM procuring_entities
      WHERE status <> 'MERGED'
        AND ((state_code IS NULL AND ${stateCode}::char(2) IS NULL) OR state_code = ${stateCode})
        AND similarity(name_normalized, ${normalized}) >= ${FUZZY_THRESHOLD}
      ORDER BY similarity DESC
      LIMIT 2`;
    if (fuzzy.length === 1) {
      await this.recordMapping(tx, sourceId, rawName, normalized, fuzzy[0].id, 'FUZZY', fuzzy[0].similarity.toFixed(3));
      return { procuringEntityId: fuzzy[0].id, ambiguous: false };
    }
    if (fuzzy.length > 1) return { procuringEntityId: null, ambiguous: true };

    const created = await tx.procuringEntity.create({
      data: { name: rawName.trim(), nameNormalized: normalized, entityType: 'OTHER', stateCode, status: 'ACTIVE' },
      select: { id: true },
    });
    // Reuses EXACT_NORMALIZED_NAME: after creation the normalized name now matches this entity
    // exactly, and the enum has no separate "auto-created" value (docs/DATABASE.md Sec 4).
    await this.recordMapping(tx, sourceId, rawName, normalized, created.id, 'EXACT_NORMALIZED_NAME', '1.000');
    return { procuringEntityId: created.id, ambiguous: false };
  }

  /** Follows `mergedIntoId` to the surviving entity, guarding against (should-be-impossible) cycles. */
  private async resolveSurvivor(tx: Prisma.TransactionClient, entityId: string): Promise<string> {
    let currentId = entityId;
    for (let hop = 0; hop < 10; hop++) {
      const entity = await tx.procuringEntity.findUniqueOrThrow({ where: { id: currentId }, select: { mergedIntoId: true } });
      if (!entity.mergedIntoId) return currentId;
      currentId = entity.mergedIntoId;
    }
    return currentId;
  }

  private async recordMapping(
    tx: Prisma.TransactionClient,
    sourceId: string,
    rawName: string,
    normalized: string,
    procuringEntityId: string,
    method: 'EXACT_NORMALIZED_NAME' | 'ALIAS' | 'FUZZY',
    confidence: string,
  ): Promise<void> {
    await tx.sourceEntityMapping.upsert({
      where: { sourceId_sourceEntityNormalized: { sourceId, sourceEntityNormalized: normalized } },
      create: { sourceId, sourceEntityName: rawName.trim(), sourceEntityNormalized: normalized, procuringEntityId, method, confidence },
      update: {},
    });
  }
}
