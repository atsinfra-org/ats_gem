import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsIngestService } from './analytics-ingest.service';
import { AnalyticsPurgeHandler, AnalyticsRollupHandler } from './analytics-scheduled.handlers';
import { AnalyticsPurgeService } from './analytics-purge.service';
import { AnalyticsQueryService } from './analytics-query.service';
import { AnalyticsRollupService } from './analytics-rollup.service';
import { AnalyticsSessionService } from './analytics-session.service';

/** API side: ingestion beacon + reporting endpoints. */
@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsIngestService, AnalyticsSessionService, AnalyticsQueryService, AnalyticsRollupService, AnalyticsPurgeService],
  exports: [AnalyticsRollupService, AnalyticsPurgeService],
})
export class AnalyticsModule {}

/** Worker side: scheduled rollup + retention jobs. */
@Module({
  providers: [AnalyticsRollupService, AnalyticsPurgeService, AnalyticsRollupHandler, AnalyticsPurgeHandler],
})
export class AnalyticsWorkerModule {}
