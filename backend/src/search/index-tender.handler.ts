import { Injectable } from '@nestjs/common';
import type { JobPayload } from '../queues/job.registry';
import { JobProcessor, type JobHandler, type JobResult } from '../workers/job-handler';
import { SearchIndexer } from './search-indexer';

@Injectable()
@JobProcessor('search.index-tender')
export class IndexTenderHandler implements JobHandler<'search.index-tender'> {
  constructor(private readonly indexer: SearchIndexer) {}

  async handle(payload: JobPayload<'search.index-tender'>): Promise<JobResult> {
    const result = await this.indexer.indexTender(payload.tenderId);
    return { provider: this.indexer.provider, indexed: result.indexed, reason: result.reason ?? null };
  }
}
