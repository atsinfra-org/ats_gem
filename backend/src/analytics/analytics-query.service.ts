import { Injectable } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import { PrismaService } from '../database/prisma.service';
import { ROLLUP_METRICS, type RollupMetric } from './analytics-rollup.service';

export interface DateRange {
  from: Date;
  to: Date;
}

export interface TrendPoint {
  date: string;
  count: number;
}

export interface OverviewResult {
  range: { from: string; to: string };
  metrics: Record<RollupMetric, number>;
}

const MAX_RANGE_DAYS = 366;

/** Validates and clamps a `from`/`to` pair (date-only, UTC) so a request cannot force scanning an unbounded range. */
export function parseRange(from: string | undefined, to: string | undefined): DateRange {
  const now = new Date();
  const end = to ? new Date(`${to}T00:00:00.000Z`) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = from ? new Date(`${from}T00:00:00.000Z`) : new Date(end.getTime() - 29 * 86_400_000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new AppError('VALIDATION_FAILED', 'Invalid date range.', [{ field: 'from', code: 'INVALID', message: 'expected YYYY-MM-DD' }]);
  if (start > end) throw new AppError('VALIDATION_FAILED', 'from must not be after to.', [{ field: 'from', code: 'RANGE_INVERTED', message: 'from after to' }]);
  if ((end.getTime() - start.getTime()) / 86_400_000 > MAX_RANGE_DAYS) {
    throw new AppError('VALIDATION_FAILED', `Range cannot exceed ${MAX_RANGE_DAYS} days.`, [{ field: 'to', code: 'RANGE_TOO_WIDE', message: 'range too wide' }]);
  }
  return { from: start, to: end };
}

/**
 * Reads from `analytics_daily_rollups` only - never scans raw `analytics_events`/`search_events` on request
 * (docs/ARCHITECTURE.md Sec 22.6). `dimension` is always a value the caller is authorized for: "global" for
 * staff, or the caller's own organization id - never taken as a free parameter from the request.
 */
@Injectable()
export class AnalyticsQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(dimension: string, range: DateRange): Promise<OverviewResult> {
    const rows = await this.prisma.analyticsDailyRollup.groupBy({
      by: ['metric'],
      where: { dimension, date: { gte: range.from, lte: range.to } },
      _sum: { count: true },
    });
    const metrics = Object.fromEntries(ROLLUP_METRICS.map((m) => [m, 0])) as Record<RollupMetric, number>;
    for (const r of rows) if ((ROLLUP_METRICS as readonly string[]).includes(r.metric)) metrics[r.metric as RollupMetric] = r._sum.count ?? 0;
    return { range: { from: isoDate(range.from), to: isoDate(range.to) }, metrics };
  }

  async trend(dimension: string, metric: string, range: DateRange): Promise<TrendPoint[]> {
    if (!(ROLLUP_METRICS as readonly string[]).includes(metric)) {
      throw new AppError('VALIDATION_FAILED', 'Unknown metric.', [{ field: 'metric', code: 'INVALID', message: 'unknown metric' }]);
    }
    const rows = await this.prisma.analyticsDailyRollup.findMany({
      where: { dimension, metric, date: { gte: range.from, lte: range.to } },
      orderBy: { date: 'asc' },
      select: { date: true, count: true },
    });
    return rows.map((r) => ({ date: isoDate(r.date), count: r.count }));
  }

  /** A signed-in user's own recent activity - never another user's (the caller id always comes from the token). */
  async myActivitySummary(userId: string, range: DateRange) {
    const rows = await this.prisma.analyticsEvent.groupBy({
      by: ['eventName'],
      where: { userId, occurredAt: { gte: range.from, lte: new Date(range.to.getTime() + 86_400_000) } },
      _count: { _all: true },
    });
    return { range: { from: isoDate(range.from), to: isoDate(range.to) }, events: Object.fromEntries(rows.map((r) => [r.eventName, r._count._all])) };
  }
}

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);
