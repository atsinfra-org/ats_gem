import { Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config.service';
import { IndexTenderHandler } from './index-tender.handler';
import { PostgresSearchIndexer } from './postgres-search.indexer';
import { SearchEventsPurgeHandler } from './search-events-purge.handler';
import { SearchEventsPurgeService } from './search-events-purge.service';
import { SearchIndexService } from './search-index.service';
import { SearchIndexer } from './search-indexer';

/** Worker-side search indexing. PostgreSQL is the only implemented provider (see docs/ARCHITECTURE.md Sec 20). */
@Module({
  providers: [
    SearchIndexService,
    {
      provide: SearchIndexer,
      inject: [AppConfig, SearchIndexService],
      useFactory: (config: AppConfig, index: SearchIndexService): SearchIndexer => {
        if (config.get('SEARCH_PROVIDER') === 'opensearch') {
          // Failing at boot beats silently dropping index updates.
          throw new Error('SEARCH_PROVIDER=opensearch is not implemented: search runs on PostgreSQL full-text search. Use SEARCH_PROVIDER=postgres.');
        }
        return new PostgresSearchIndexer(index);
      },
    },
    IndexTenderHandler,
    SearchEventsPurgeService,
    SearchEventsPurgeHandler,
  ],
})
export class SearchIndexingModule {}
