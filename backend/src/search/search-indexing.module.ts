import { Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config.service';
import { PrismaService } from '../database/prisma.service';
import { IndexTenderHandler } from './index-tender.handler';
import { PostgresSearchIndexer } from './postgres-search.indexer';
import { SearchIndexer } from './search-indexer';

/** Worker-side search indexing. The provider is chosen by SEARCH_PROVIDER. */
@Module({
  providers: [
    {
      provide: SearchIndexer,
      inject: [AppConfig, PrismaService],
      useFactory: (config: AppConfig, prisma: PrismaService): SearchIndexer => {
        if (config.get('SEARCH_PROVIDER') === 'opensearch') {
          // Failing at boot beats silently dropping index updates.
          throw new Error('SEARCH_PROVIDER=opensearch: the OpenSearch indexer arrives in Phase 4. Use SEARCH_PROVIDER=postgres.');
        }
        return new PostgresSearchIndexer(prisma);
      },
    },
    IndexTenderHandler,
  ],
})
export class SearchIndexingModule {}
