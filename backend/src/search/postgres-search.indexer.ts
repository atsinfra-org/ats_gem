import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SearchIndexer, type IndexResult } from './search-indexer';

/**
 * Postgres full-text search needs no separate index write: from Phase 4 the tender's tsvector is
 * a generated column maintained by Postgres itself in the same transaction as the row. This
 * indexer therefore only confirms the tender exists; the queue hop is kept so switching to
 * OpenSearch later changes the implementation, not the pipeline.
 */
@Injectable()
export class PostgresSearchIndexer extends SearchIndexer {
  readonly provider = 'postgres';

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async indexTender(tenderId: string): Promise<IndexResult> {
    const exists = await this.prisma.tender.count({ where: { id: tenderId } });
    return exists ? { indexed: true, reason: 'maintained-by-postgres' } : { indexed: false, reason: 'tender-not-found' };
  }
}
