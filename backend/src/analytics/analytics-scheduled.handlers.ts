import { Injectable } from '@nestjs/common';
import { JobProcessor, type JobHandler, type JobResult } from '../workers/job-handler';
import { AnalyticsPurgeService } from './analytics-purge.service';
import { AnalyticsRollupService } from './analytics-rollup.service';

/** Rebuilds yesterday's (and, defensively, today's so far) daily rollups. Scheduled nightly; safe to rerun. */
@Injectable()
@JobProcessor('analytics.rollup')
export class AnalyticsRollupHandler implements JobHandler<'analytics.rollup'> {
  constructor(private readonly rollup: AnalyticsRollupService) {}

  async handle(): Promise<JobResult> {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 86_400_000);
    const [y, t] = await Promise.all([this.rollup.run(yesterday), this.rollup.run(now)]);
    return { yesterdayRows: y.rowsWritten, todayRows: t.rowsWritten };
  }
}

@Injectable()
@JobProcessor('analytics.purge-events')
export class AnalyticsPurgeHandler implements JobHandler<'analytics.purge-events'> {
  constructor(private readonly purger: AnalyticsPurgeService) {}

  async handle(): Promise<JobResult> {
    const r = await this.purger.purge();
    return { deletedEvents: r.deletedEvents, deletedSessions: r.deletedSessions, deletedRollups: r.deletedRollups };
  }
}
