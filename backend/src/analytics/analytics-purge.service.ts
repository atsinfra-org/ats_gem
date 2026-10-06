import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../config/app-config.service';
import { PrismaService } from '../database/prisma.service';

const EVENT_BATCH_SIZE = 5_000;

export interface PurgeReport {
  deletedEvents: number;
  deletedSessions: number;
  deletedRollups: number;
  batches: number;
  eventRetentionDays: number;
  rollupRetentionDays: number;
  cutoff: string;
  rollupCutoff: string;
  durationMs: number;
}

/**
 * Retention for Phase 10's own tables - distinct from Phase 7's `SEARCH_EVENT_RETENTION_DAYS` /
 * `maintenance.search-events-purge`, which this never touches. Three independent windows (docs/ARCHITECTURE.md
 * Sec 22.7): raw `analytics_events` (`ANALYTICS_EVENT_RETENTION_DAYS`, default 90 - short, because rollups already
 * preserve the aggregate numbers), `analytics_sessions` (same window, sessions are cheap and small), and
 * `analytics_daily_rollups` (`ANALYTICS_ROLLUP_RETENTION_DAYS`, default 400 - long, since these are tiny one-row-
 * per-metric-per-day summaries meant for year-over-year trend views). Batched with `FOR UPDATE SKIP LOCKED`, same
 * shape as `SearchEventsPurgeService`: never a long lock, safe to rerun.
 */
@Injectable()
export class AnalyticsPurgeService {
  private readonly logger = new Logger(AnalyticsPurgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  async purge(opts: { now?: Date; batchSize?: number } = {}): Promise<PurgeReport> {
    const eventRetentionDays = this.config.get('ANALYTICS_EVENT_RETENTION_DAYS');
    const rollupRetentionDays = this.config.get('ANALYTICS_ROLLUP_RETENTION_DAYS');
    const batchSize = opts.batchSize ?? EVENT_BATCH_SIZE;
    const now = opts.now ?? new Date();
    const cutoff = new Date(now.getTime() - eventRetentionDays * 86_400_000);
    const rollupCutoff = new Date(now.getTime() - rollupRetentionDays * 86_400_000);
    const started = Date.now();

    let deletedEvents = 0;
    let batches = 0;
    try {
      for (;;) {
        const count = await this.prisma.$executeRaw`
          DELETE FROM analytics_events
          WHERE id IN (SELECT id FROM analytics_events WHERE occurred_at < ${cutoff} ORDER BY occurred_at LIMIT ${batchSize} FOR UPDATE SKIP LOCKED)`;
        if (count === 0) break;
        deletedEvents += count;
        batches++;
        if (count < batchSize) break;
      }
      const deletedSessions = await this.prisma.$executeRaw`DELETE FROM analytics_sessions WHERE last_activity_at < ${cutoff}`;
      const deletedRollups = await this.prisma.$executeRaw`DELETE FROM analytics_daily_rollups WHERE date < ${new Date(rollupCutoff.toISOString().slice(0, 10))}`;

      const report: PurgeReport = {
        deletedEvents,
        deletedSessions,
        deletedRollups,
        batches,
        eventRetentionDays,
        rollupRetentionDays,
        cutoff: cutoff.toISOString(),
        rollupCutoff: rollupCutoff.toISOString(),
        durationMs: Date.now() - started,
      };
      await this.prisma.analyticsProcessingRun.create({ data: { kind: 'PURGE', status: 'COMPLETED', completedAt: new Date(), processed: deletedEvents + deletedSessions + deletedRollups, details: { ...report } } });
      this.logger.log({ msg: 'analytics purge completed', ...report });
      return report;
    } catch (err) {
      await this.prisma.analyticsProcessingRun.create({ data: { kind: 'PURGE', status: 'FAILED', completedAt: new Date(), failed: 1, processed: deletedEvents, details: { error: err instanceof Error ? err.message.slice(0, 300) : String(err) } } });
      this.logger.error({ msg: 'analytics purge failed', deletedSoFar: deletedEvents, error: err instanceof Error ? err.message.slice(0, 200) : String(err) });
      throw err;
    }
  }
}
