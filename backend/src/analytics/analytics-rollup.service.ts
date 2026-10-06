import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export const ROLLUP_METRICS = [
  'page_views',
  'sessions_started',
  'registrations_completed',
  'logins',
  'tender_views',
  'tender_saves',
  'document_downloads',
  'notification_clicks',
  'searches_performed',
  'zero_result_searches',
] as const;
export type RollupMetric = (typeof ROLLUP_METRICS)[number];

export interface RollupReport {
  runId: string;
  date: string;
  dimensions: number;
  rowsWritten: number;
  durationMs: number;
}

const dayBounds = (date: Date): { from: Date; to: Date } => {
  const from = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  return { from, to: new Date(from.getTime() + 86_400_000) };
};

/**
 * Rebuilds one UTC day of `analytics_daily_rollups` from the raw event tables (docs/ARCHITECTURE.md Sec 22.6).
 * Deterministic and idempotent: every metric is a plain `count(*)` for that day, written with `upsert` (overwrite,
 * never increment), so running the same day twice - or a thousand times - always leaves the same numbers. Search
 * metrics are read from the existing Phase 7 `search_events` table, not duplicated into a second event store.
 */
@Injectable()
export class AnalyticsRollupService {
  private readonly logger = new Logger(AnalyticsRollupService.name);

  constructor(private readonly prisma: PrismaService) {}

  async run(date: Date): Promise<RollupReport> {
    const started = Date.now();
    const { from, to } = dayBounds(date);
    const dateOnly = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
    const run = await this.prisma.analyticsProcessingRun.create({ data: { kind: 'ROLLUP', status: 'RUNNING', details: { date: dateOnly.toISOString().slice(0, 10) } } });

    try {
      const counts = new Map<string, number>(); // key = `${metric}|${dimension}`
      const bump = (metric: RollupMetric, dimension: string, n: number) => {
        if (n === 0) return;
        counts.set(`${metric}|${dimension}`, (counts.get(`${metric}|${dimension}`) ?? 0) + n);
      };

      const [pageViews, sessionsStarted, eventsByOrg, searchByOrg] = await Promise.all([
        this.prisma.$queryRaw<{ org: string | null; n: bigint }[]>`
          SELECT organization_id::text AS org, count(*) AS n FROM analytics_events
          WHERE event_name = 'PAGE_VIEW' AND occurred_at >= ${from} AND occurred_at < ${to} GROUP BY 1`,
        this.prisma.analyticsSession.count({ where: { startedAt: { gte: from, lt: to } } }),
        this.prisma.$queryRaw<{ event_name: string; org: string | null; n: bigint }[]>`
          SELECT event_name, organization_id::text AS org, count(*) AS n FROM analytics_events
          WHERE event_name IN ('REGISTRATION_COMPLETED','LOGIN_SUCCESS','TENDER_VIEWED','TENDER_SAVED','DOCUMENT_DOWNLOADED','NOTIFICATION_CLICKED')
            AND occurred_at >= ${from} AND occurred_at < ${to}
          GROUP BY 1, 2`,
        this.prisma.$queryRaw<{ org: string | null; total: bigint; zero: bigint }[]>`
          SELECT organization_id::text AS org, count(*) AS total, count(*) FILTER (WHERE (payload->>'resultCount')::int = 0) AS zero
          FROM search_events WHERE event_type = 'SEARCH_SUBMITTED' AND created_at >= ${from} AND created_at < ${to}
          GROUP BY 1`,
      ]);

      for (const r of pageViews) {
        bump('page_views', 'global', Number(r.n));
        if (r.org) bump('page_views', r.org, Number(r.n));
      }
      bump('sessions_started', 'global', sessionsStarted);

      const EVENT_TO_METRIC: Record<string, RollupMetric> = {
        REGISTRATION_COMPLETED: 'registrations_completed',
        LOGIN_SUCCESS: 'logins',
        TENDER_VIEWED: 'tender_views',
        TENDER_SAVED: 'tender_saves',
        DOCUMENT_DOWNLOADED: 'document_downloads',
        NOTIFICATION_CLICKED: 'notification_clicks',
      };
      for (const r of eventsByOrg) {
        const metric = EVENT_TO_METRIC[r.event_name];
        if (!metric) continue;
        bump(metric, 'global', Number(r.n));
        if (r.org) bump(metric, r.org, Number(r.n));
      }

      for (const r of searchByOrg) {
        bump('searches_performed', 'global', Number(r.total));
        bump('zero_result_searches', 'global', Number(r.zero));
        if (r.org) {
          bump('searches_performed', r.org, Number(r.total));
          bump('zero_result_searches', r.org, Number(r.zero));
        }
      }

      // Zero out metrics that had rows yesterday but none today, so a rollup rerun after data changes is still exact.
      const dimensions = new Set([...counts.keys()].map((k) => k.split('|')[1]));
      const existing = await this.prisma.analyticsDailyRollup.findMany({ where: { date: dateOnly }, select: { metric: true, dimension: true } });
      for (const e of existing) dimensions.add(e.dimension);
      const allKeys = new Set<string>(counts.keys());
      for (const dim of dimensions) for (const m of ROLLUP_METRICS) allKeys.add(`${m}|${dim}`);

      let rowsWritten = 0;
      for (const key of allKeys) {
        const [metric, dimension] = key.split('|') as [RollupMetric, string];
        const count = counts.get(key) ?? 0;
        await this.prisma.analyticsDailyRollup.upsert({
          where: { date_metric_dimension: { date: dateOnly, metric, dimension } },
          create: { date: dateOnly, metric, dimension, count },
          update: { count },
        });
        rowsWritten++;
      }

      const report: RollupReport = { runId: run.id, date: dateOnly.toISOString().slice(0, 10), dimensions: dimensions.size, rowsWritten, durationMs: Date.now() - started };
      await this.prisma.analyticsProcessingRun.update({ where: { id: run.id }, data: { status: 'COMPLETED', completedAt: new Date(), processed: rowsWritten, details: { ...report } } });
      this.logger.log({ msg: 'analytics rollup completed', ...report });
      return report;
    } catch (err) {
      await this.prisma.analyticsProcessingRun.update({ where: { id: run.id }, data: { status: 'FAILED', completedAt: new Date(), failed: 1, details: { error: err instanceof Error ? err.message.slice(0, 300) : String(err) } } });
      throw err;
    }
  }

  /** Rebuilds each day in [from, to] inclusive (UTC), in order. Used by the CLI for backfill/manual rebuild. */
  async runRange(from: Date, to: Date): Promise<RollupReport[]> {
    const reports: RollupReport[] = [];
    for (let d = new Date(from); d <= to; d = new Date(d.getTime() + 86_400_000)) reports.push(await this.run(d));
    return reports;
  }
}
