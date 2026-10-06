import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { PermanentJobError } from '../../queues/job-errors';
import type { JobPayload } from '../../queues/job.registry';
import { JobProcessor, type JobContext, type JobHandler, type JobResult } from '../../workers/job-handler';
import { AdapterRegistry } from '../adapters/adapter.registry';
import { CrawlRunsService } from '../crawl-runs.service';
import { TenderIngestionService } from '../ingestion/tender-ingestion.service';
import { NormalizedTenderSchema } from '../normalization/normalized-tender';
import { ParseError } from '../normalization/parsers';
import { crawlContext } from './discover-source.handler';

/**
 * Fetches, normalizes and stores one tender. Transient fetch errors are retried by BullMQ;
 * records that cannot be normalized are data problems, not outages, so they are reported as
 * `invalid` (counted as skipped on the run) instead of being retried.
 */
@Injectable()
@JobProcessor('crawler.ingest-tender')
export class IngestTenderHandler implements JobHandler<'crawler.ingest-tender'> {
  constructor(
    private readonly runs: CrawlRunsService,
    private readonly adapters: AdapterRegistry,
    private readonly ingestion: TenderIngestionService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(IngestTenderHandler.name);
  }

  async handle(payload: JobPayload<'crawler.ingest-tender'>, ctx: JobContext): Promise<JobResult> {
    const source = await this.runs.loadSource(payload.sourceId);
    if (!source) throw new PermanentJobError(`Source ${payload.sourceId} does not exist`);
    const adapter = this.adapters.get(source.adapterKey);

    const raw = await adapter.fetchTender(crawlContext(source, ctx.attempt), payload.ref);

    let reason: string | undefined;
    let parsed: ReturnType<typeof NormalizedTenderSchema.safeParse> | undefined;
    try {
      parsed = NormalizedTenderSchema.safeParse(adapter.normalize(raw));
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        reason = `${issue?.path.join('.') || 'record'}: ${issue?.message ?? 'invalid'}`;
      }
    } catch (err) {
      if (!(err instanceof ParseError)) throw err;
      reason = err.message;
    }
    if (reason !== undefined || !parsed?.success) {
      this.logger.warn({ externalId: payload.ref.externalId, reason }, 'tender record failed normalization; skipped');
      return { outcome: 'invalid', reason: reason ?? 'invalid' };
    }

    const result = await this.ingestion.ingest({ sourceId: source.id, raw, normalized: parsed.data });
    return {
      outcome: result.outcome,
      tenderId: result.tenderId,
      changedFields: result.changedFields.length > 0 ? result.changedFields.join(',') : null,
    };
  }
}
