import { Injectable } from '@nestjs/common';
import { AuditLogService } from '../../audit/audit-log.service';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';

export interface MergeEntitiesInput {
  sourceEntityId: string;
  targetEntityId: string;
  actorUserId: string;
}

/**
 * Admin-facing procuring-entity operations: listing, and merging two entities that were resolved
 * as separate but turned out to be the same organization. Merging never deletes a row - it is the
 * one destructive-looking operation in Phase 3, and docs/ARCHITECTURE.md Sec 19.3 is explicit that
 * it must not be: the losing entity is kept, marked MERGED, and every dependent row is re-pointed
 * at the survivor inside one transaction, with a cycle check first (a merge chain must never loop).
 */
@Injectable()
export class ProcuringEntitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  list(params: { stateCode?: string; status?: 'ACTIVE' | 'MERGED' | 'INACTIVE'; search?: string; take: number; skip: number }) {
    const where: Prisma.ProcuringEntityWhereInput = {
      stateCode: params.stateCode,
      status: params.status,
      name: params.search ? { contains: params.search, mode: 'insensitive' } : undefined,
    };
    return this.prisma.$transaction([
      this.prisma.procuringEntity.count({ where }),
      this.prisma.procuringEntity.findMany({ where, orderBy: { name: 'asc' }, take: params.take, skip: params.skip }),
    ]);
  }

  async merge(input: MergeEntitiesInput): Promise<void> {
    const { sourceEntityId, targetEntityId, actorUserId } = input;
    if (sourceEntityId === targetEntityId) throw new AppError('VALIDATION_FAILED', 'An entity cannot be merged into itself.');

    await this.prisma.$transaction(async (tx) => {
      const [source, target] = await Promise.all([
        tx.procuringEntity.findUniqueOrThrow({ where: { id: sourceEntityId } }),
        tx.procuringEntity.findUniqueOrThrow({ where: { id: targetEntityId } }),
      ]);
      if (source.status === 'MERGED') throw new AppError('VALIDATION_FAILED', 'Source entity is already merged.');
      if (target.status === 'MERGED') throw new AppError('VALIDATION_FAILED', 'Cannot merge into an entity that is itself merged.');

      // Cycle guard: walking either entity's merge/parent-ish chain must never reach the other.
      // mergedIntoId chains are the only ones that can form post-merge, but we check both merge and
      // parent chains defensively since a future admin action could otherwise wire a loop through them.
      await this.assertNoCycle(tx, targetEntityId, sourceEntityId, 'mergedIntoId');
      await this.assertNoCycle(tx, targetEntityId, sourceEntityId, 'parentId');

      await tx.sourceEntityMapping.updateMany({ where: { procuringEntityId: sourceEntityId }, data: { procuringEntityId: targetEntityId } });
      await tx.tender.updateMany({ where: { procuringEntityId: sourceEntityId }, data: { procuringEntityId: targetEntityId } });
      await tx.procuringEntityAlias.updateMany({ where: { procuringEntityId: sourceEntityId }, data: { procuringEntityId: targetEntityId } });
      // The losing entity's own name becomes an alias of the survivor, so future exact-name lookups
      // for it still resolve correctly instead of silently falling through to fuzzy/auto-create.
      await tx.procuringEntityAlias.upsert({
        where: { aliasNormalized: source.nameNormalized },
        create: { procuringEntityId: targetEntityId, alias: source.name, aliasNormalized: source.nameNormalized },
        update: { procuringEntityId: targetEntityId },
      });
      await tx.procuringEntity.update({ where: { id: sourceEntityId }, data: { status: 'MERGED', mergedIntoId: targetEntityId } });

      await this.audit.record(
        {
          actorUserId,
          action: 'PROCURING_ENTITY_MERGED',
          resourceType: 'ProcuringEntity',
          resourceId: sourceEntityId,
          oldValue: { status: source.status },
          newValue: { status: 'MERGED', mergedIntoId: targetEntityId },
        },
        tx,
      );
    });
  }

  private async assertNoCycle(tx: Prisma.TransactionClient, startId: string, mustNotReachId: string, chain: 'mergedIntoId' | 'parentId'): Promise<void> {
    let currentId: string | null = startId;
    for (let hop = 0; hop < 20 && currentId; hop++) {
      if (currentId === mustNotReachId) throw new AppError('VALIDATION_FAILED', 'That merge would create a cycle.');
      const row: { mergedIntoId: string | null; parentId: string | null } = await tx.procuringEntity.findUniqueOrThrow({
        where: { id: currentId },
        select: { mergedIntoId: true, parentId: true },
      });
      currentId = chain === 'mergedIntoId' ? row.mergedIntoId : row.parentId;
    }
  }
}
