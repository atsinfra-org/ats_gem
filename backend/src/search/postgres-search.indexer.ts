import { Injectable } from '@nestjs/common';
import { SearchIndexer, type IndexResult } from './search-indexer';
import { SearchIndexService } from './search-index.service';

/**
 * Recomputes one tender search vector. The DB trigger already keeps it current for changes to the
 * tender row itself; this job additionally catches changes the trigger cannot see (a renamed
 * category or entity) and gives every tender event an observable, retried, idempotent indexing step.
 */
@Injectable()
export class PostgresSearchIndexer extends SearchIndexer {
  readonly provider = 'postgres';

  constructor(private readonly index: SearchIndexService) {
    super();
  }

  async indexTender(tenderId: string): Promise<IndexResult> {
    return (await this.index.refreshTender(tenderId)) ? { indexed: true, reason: 'maintained-by-postgres' } : { indexed: false, reason: 'tender-not-found' };
  }
}
