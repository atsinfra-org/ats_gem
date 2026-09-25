import { Injectable } from '@nestjs/common';
import { AuditLogService } from '../../audit/audit-log.service';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../database/prisma.service';

export interface ResolveDuplicateInput {
  candidateId: string;
  resolution: 'CONFIRMED' | 'REJECTED';
  actorUserId: string;
  notes?: string;
}

/**
 * Admin review queue for `DuplicateCandidate` rows the deduplication engine could not confidently
 * auto-link (docs/ARCHITECTURE.md Sec 6.5). Confirming re-points the loser's source records onto the
 * canonical tender and archives it; rejecting just records the decision - neither ever deletes a row.
 */
@Injectable()
export class DuplicateCandidatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  list(params: { status?: 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'AUTO_CONFIRMED'; take: number; skip: number }) {
    const where = { status: params.status };
    return this.prisma.$transaction([
      this.prisma.duplicateCandidate.count({ where }),
      this.prisma.duplicateCandidate.findMany({
        where,
        include: { tender: { select: { id: true, title: true } }, candidateTender: { select: { id: true, title: true } } },
        orderBy: { createdAt: 'desc' },
        take: params.take,
        skip: params.skip,
      }),
    ]);
  }

  async resolve(input: ResolveDuplicateInput): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const candidate = await tx.duplicateCandidate.findUniqueOrThrow({ where: { id: input.candidateId } });
      if (candidate.status !== 'PENDING') throw new AppError('VALIDATION_FAILED', 'This candidate has already been reviewed.');

      if (input.resolution === 'CONFIRMED') {
        // The lower-UUID tender (tenderId) is kept as canonical by convention (DB CHECK constraint);
        // the other one's source records move onto it and it is archived, never deleted.
        await tx.tenderSourceRecord.updateMany({ where: { tenderId: candidate.candidateTenderId }, data: { tenderId: candidate.tenderId } });
        await tx.tender.update({
          where: { id: candidate.candidateTenderId },
          data: { duplicateOfId: candidate.tenderId, lifecycle: 'ARCHIVED', status: 'ARCHIVED', statusComputedAt: new Date() },
        });
      }

      await tx.duplicateCandidate.update({
        where: { id: input.candidateId },
        data: { status: input.resolution, reviewedBy: input.actorUserId, reviewedAt: new Date(), notes: input.notes ?? null },
      });

      await this.audit.record(
        {
          actorUserId: input.actorUserId,
          action: `DUPLICATE_CANDIDATE_${input.resolution}`,
          resourceType: 'DuplicateCandidate',
          resourceId: input.candidateId,
          newValue: { tenderId: candidate.tenderId, candidateTenderId: candidate.candidateTenderId },
        },
        tx,
      );
    });
  }
}
