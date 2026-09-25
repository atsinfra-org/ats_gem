import { Module } from '@nestjs/common';
import { AdapterRegistry, SOURCE_ADAPTERS } from './adapters/adapter.registry';
import { MockSourceAdapter } from './adapters/mock/mock-source.adapter';
import { CrawlRunsService } from './crawl-runs.service';
import { DiscoverSourceHandler } from './handlers/discover-source.handler';
import { FinalizeRunHandler } from './handlers/finalize-run.handler';
import { IngestTenderHandler } from './handlers/ingest-tender.handler';
import { SourcesHealthCheckHandler } from './handlers/sources-health-check.handler';
import { TenderIngestionService } from './ingestion/tender-ingestion.service';

/**
 * Crawler engine (worker side). Real portal adapters are added to SOURCE_ADAPTERS only after the
 * per-portal onboarding review in docs/ARCHITECTURE.md §14; Phase 1 ships the mock adapter only.
 */
@Module({
  providers: [
    MockSourceAdapter,
    { provide: SOURCE_ADAPTERS, useFactory: (mock: MockSourceAdapter) => [mock], inject: [MockSourceAdapter] },
    AdapterRegistry,
    CrawlRunsService,
    TenderIngestionService,
    DiscoverSourceHandler,
    IngestTenderHandler,
    FinalizeRunHandler,
    SourcesHealthCheckHandler,
  ],
  exports: [CrawlRunsService, TenderIngestionService, AdapterRegistry],
})
export class CrawlerModule {}
