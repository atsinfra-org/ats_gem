import { Injectable } from '@nestjs/common';
import { JobProcessor, type JobHandler, type JobResult } from '../workers/job-handler';
import { SearchEventsPurgeService } from './search-events-purge.service';

/** Scheduled retention purge for search analytics events (schedule key `search-events-purge`). */
@Injectable()
@JobProcessor('maintenance.search-events-purge')
export class SearchEventsPurgeHandler implements JobHandler<'maintenance.search-events-purge'> {
  constructor(private readonly purger: SearchEventsPurgeService) {}

  async handle(): Promise<JobResult> {
    const { deleted, batches, retentionDays } = await this.purger.purge();
    return { deleted, batches, retentionDays };
  }
}
