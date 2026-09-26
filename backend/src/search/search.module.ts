import { Global, Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchEventsService } from './search-events.service';
import { SearchHistoryService } from './search-history.service';
import { SearchIndexService } from './search-index.service';
import { SearchService } from './search.service';
import { SearchSuggestionsService } from './search-suggestions.service';

/** Query-side search (API process) plus the index lifecycle service (also used by the CLI and worker). */
@Global()
@Module({
  controllers: [SearchController],
  providers: [SearchService, SearchSuggestionsService, SearchHistoryService, SearchEventsService, SearchIndexService],
  exports: [SearchService, SearchHistoryService, SearchIndexService],
})
export class SearchModule {}
