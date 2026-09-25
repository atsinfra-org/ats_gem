import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { EntityResolutionService } from './entities/entity-resolution.service';

export interface BackfillReport {
  tendersProcessed: number;
  entitiesResolved: number;
  entitiesAmbiguous: number;
  qualityIssuesCreated: number;
  skipped: number;
}

/**
 * One-shot, idempotent backfill for tenders ingested before Phase 3 existed (docs/ARCHITECTURE.md
 * Sec 26): resolves a procuring entity from the free-text `department` for any tender that does not
 * already have one, and records the same non-blocking data-quality checks ingestion now runs, for
 * any tender that has none yet. Safe to run more than once - a tender already resolved or already
 * checked is skipped, so re-running only picks up what an earlier run missed or what changed since.
 */
@Injectable()
export class BackfillService {
  private readonly logger = new Logger(BackfillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly entityResolution: EntityResolutionService,
  ) {}

  async run(): Promise<BackfillReport> {
    const report: BackfillReport = { tendersProcessed: 0, entitiesResolved: 0, entitiesAmbiguous: 0, qualityIssuesCreated: 0, skipped: 0 };

    const tenders = await this.prisma.tender.findMany({
      where: { deletedAt: null },
      select: { id: true, department: true, stateCode: true, procuringEntityId: true, referenceNumber: true, estimatedValue: true, publishedAt: true, closingAt: true },
    });

    for (const tender of tenders) {
      report.tendersProcessed++;
      let didWork = false;
      await this.prisma.$transaction(async (tx) => {
        if (!tender.procuringEntityId && tender.department) {
          const sourceRecord = await tx.tenderSourceRecord.findFirst({ where: { tenderId: tender.id }, select: { sourceId: true } });
          if (sourceRecord) {
            const resolution = await this.entityResolution.resolve(tx, sourceRecord.sourceId, tender.department, tender.stateCode);
            if (resolution.ambiguous) report.entitiesAmbiguous++;
            if (resolution.procuringEntityId) {
              await tx.tender.update({ where: { id: tender.id }, data: { procuringEntityId: resolution.procuringEntityId } });
              report.entitiesResolved++;
              didWork = true;
            }
          }
        }

        const hasIssues = await tx.tenderQualityIssue.count({ where: { tenderId: tender.id } });
        if (hasIssues === 0) {
          const issues: { severity: 'INFO' | 'WARNING'; code: string; message: string }[] = [];
          if (!tender.referenceNumber) issues.push({ severity: 'WARNING', code: 'MISSING_REFERENCE_NUMBER', message: 'No reference number was provided by the source.' });
          if (!tender.estimatedValue) issues.push({ severity: 'INFO', code: 'MISSING_ESTIMATED_VALUE', message: 'No estimated value was provided by the source.' });
          if (issues.length > 0) {
            await tx.tenderQualityIssue.createMany({ data: issues.map((i) => ({ tenderId: tender.id, severity: i.severity, code: i.code, message: i.message })) });
            report.qualityIssuesCreated += issues.length;
            didWork = true;
          }
        }
      });
      if (!didWork) report.skipped++;
    }

    this.logger.log({ msg: 'Phase 3 backfill complete', ...report });
    return report;
  }

  /**
   * One-shot, idempotent backfill for tenders ingested before Phase 4 existed: seeds the timeline
   * (PUBLISHED/SUBMISSION_DEADLINE/OPENING, from the tender's own columns) and the two data-quality
   * checks Phase 4 added (`MISSING_DEADLINE`, `MISSING_LOCATION`). Checked per-code, not per-tender
   * (unlike the Phase 3 backfill above), so re-running after adding yet another check in a future
   * phase would still pick up only what is missing, not skip a tender just because it already has
   * some other, older issue recorded.
   */
  async runPhase4(): Promise<{ tendersProcessed: number; eventsCreated: number; qualityIssuesCreated: number; skipped: number }> {
    const report = { tendersProcessed: 0, eventsCreated: 0, qualityIssuesCreated: 0, skipped: 0 };

    const tenders = await this.prisma.tender.findMany({
      where: { deletedAt: null },
      select: { id: true, publishedAt: true, closingAt: true, openingAt: true, referenceNumber: true, estimatedValue: true, stateCode: true, city: true, locationText: true },
    });

    for (const tender of tenders) {
      report.tendersProcessed++;
      let didWork = false;
      await this.prisma.$transaction(async (tx) => {
        const events: { eventType: 'PUBLISHED' | 'SUBMISSION_DEADLINE' | 'OPENING'; eventAt: Date }[] = [{ eventType: 'PUBLISHED', eventAt: tender.publishedAt }];
        if (tender.closingAt) events.push({ eventType: 'SUBMISSION_DEADLINE', eventAt: tender.closingAt });
        if (tender.openingAt) events.push({ eventType: 'OPENING', eventAt: tender.openingAt });
        const created = await tx.tenderEvent.createMany({
          data: events.map((e) => ({ tenderId: tender.id, eventType: e.eventType, eventAt: e.eventAt })),
          skipDuplicates: true,
        });
        report.eventsCreated += created.count;
        if (created.count > 0) didWork = true;

        const missingDeadline = !tender.closingAt && (await tx.tenderQualityIssue.count({ where: { tenderId: tender.id, code: 'MISSING_DEADLINE' } })) === 0;
        const missingLocation =
          !tender.stateCode &&
          !tender.city &&
          !tender.locationText &&
          (await tx.tenderQualityIssue.count({ where: { tenderId: tender.id, code: 'MISSING_LOCATION' } })) === 0;

        const issues: { severity: 'INFO' | 'WARNING'; code: string; message: string }[] = [];
        if (missingDeadline) issues.push({ severity: 'WARNING', code: 'MISSING_DEADLINE', message: 'No submission deadline was provided by the source.' });
        if (missingLocation) issues.push({ severity: 'INFO', code: 'MISSING_LOCATION', message: 'No state, city or location text was provided by the source.' });
        if (issues.length > 0) {
          await tx.tenderQualityIssue.createMany({ data: issues.map((i) => ({ tenderId: tender.id, severity: i.severity, code: i.code, message: i.message })) });
          report.qualityIssuesCreated += issues.length;
          didWork = true;
        }
      });
      if (!didWork) report.skipped++;
    }

    this.logger.log({ msg: 'Phase 4 backfill complete', ...report });
    return report;
  }
}
