import { Injectable } from '@nestjs/common';
import type { JobPayload } from '../../queues/job.registry';
import { JobProcessor, type JobContext, type JobHandler, type JobResult } from '../../workers/job-handler';
import { CrawlRunsService, tallyOutcomes } from '../crawl-runs.service';

/**
 * Runs once every ingestion child of a crawl has finished (successfully or not) and writes the
 * run's final counters from the children's results. Idempotent: it recomputes from BullMQ state.
 */
@Injectable()
@JobProcessor('crawler.finalize-run')
export class FinalizeRunHandler implements JobHandler<'crawler.finalize-run'> {
  constructor(private readonly runs: CrawlRunsService) {}

  async handle(payload: JobPayload<'crawler.finalize-run'>, ctx: JobContext): Promise<JobResult> {
    const [values, failures] = await Promise.all([ctx.job.getChildrenValues(), ctx.job.getIgnoredChildrenFailures()]);
    const tally = tallyOutcomes(Object.values(values), Object.keys(failures).length);
    const { run, outcome } = await this.runs.finalize(payload.crawlRunId, tally);
    await this.runs.recordSourceOutcome(payload.sourceId, outcome);
    return {
      outcome,
      crawlRunId: run.id,
      status: run.status,
      created: tally.created,
      updated: tally.updated,
      unchanged: tally.unchanged,
      invalid: tally.invalid,
      suppressed: tally.suppressed,
      errors: tally.errors,
      durationMs: run.durationMs,
    };
  }
}
