import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { sha256Hex } from '../../common/stable-json';
import { PermanentJobError } from '../../queues/job-errors';
import type { JobPayload } from '../../queues/job.registry';
import { QueueProducer } from '../../queues/queue.producer';
import { JobProcessor, type JobContext, type JobHandler, type JobResult } from '../../workers/job-handler';
import { AdapterRegistry } from '../adapters/adapter.registry';
import type { CrawlContext, SourceAdapter, TenderRef } from '../adapters/source-adapter';
import { CrawlRunsService, emptyTally, type LoadedSource } from '../crawl-runs.service';

/** Safety valves against a misbehaving adapter paginating forever. */
export const MAX_DISCOVERY_PAGES = 1_000;
export const MAX_REFS_PER_RUN = 20_000;

/** Deterministic child job id: re-dispatching the same run never duplicates ingestion jobs. */
export function ingestJobId(crawlRunId: string, externalId: string): string {
  return `ingest.${crawlRunId}.${sha256Hex(externalId).slice(0, 32)}`;
}

export function finalizeJobId(crawlRunId: string): string {
  return `finalize.${crawlRunId}`;
}

export function crawlContext(source: LoadedSource, attempt: number): CrawlContext {
  return {
    source: { id: source.id, slug: source.slug, config: source.config },
    attempt,
    signal: new AbortController().signal,
  };
}

/**
 * First stage of a crawl: opens a crawl run, lists the source's tenders through its adapter and
 * fans out one ingestion job per tender, with a finalize job that runs after all of them.
 *
 *   discover-source ──▶ ingest-tender × N ──▶ finalize-run
 */
@Injectable()
@JobProcessor('crawler.discover-source')
export class DiscoverSourceHandler implements JobHandler<'crawler.discover-source'> {
  constructor(
    private readonly runs: CrawlRunsService,
    private readonly adapters: AdapterRegistry,
    private readonly producer: QueueProducer,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(DiscoverSourceHandler.name);
  }

  async handle(payload: JobPayload<'crawler.discover-source'>, ctx: JobContext): Promise<JobResult> {
    const source = await this.runs.loadSource(payload.sourceId);
    if (!source) throw new PermanentJobError(`Source ${payload.sourceId} does not exist`);
    if (!source.isActive) return { outcome: 'skipped', reason: 'source-inactive' };
    if (payload.trigger === 'SCHEDULE' && !source.crawlEnabled) return { outcome: 'skipped', reason: 'crawl-disabled' };
    const adapter = this.adapters.get(source.adapterKey);

    const { run, blockedBy } = await this.runs.open({
      sourceId: source.id,
      trigger: payload.trigger,
      triggeredBy: payload.requestedBy,
      jobId: ctx.jobId,
      correlationId: ctx.correlationId,
    });
    if (blockedBy) {
      this.logger.warn({ crawlRunId: run.id, blockedBy }, 'crawl skipped: another run for this source is in progress');
      return { outcome: 'skipped', reason: 'run-in-progress', crawlRunId: run.id, blockedBy };
    }

    const crawlCtx = crawlContext(source, ctx.attempt);
    try {
      await adapter.initialize(crawlCtx);
      const auth = await adapter.authenticate(crawlCtx);
      if (auth.status === 'NEEDS_MANUAL_ACTION' || auth.status === 'FAILED') {
        // Never work around an access control: stop, record why, and flag the source for an admin.
        await this.runs.fail(run.id, `Authentication: ${auth.reason}`, true);
        await this.runs.recordSourceOutcome(
          source.id,
          'failure',
          auth.status === 'NEEDS_MANUAL_ACTION' ? 'NEEDS_MANUAL_ACTION' : 'AUTH_REQUIRED',
        );
        return { outcome: 'auth-blocked', crawlRunId: run.id, authStatus: auth.status };
      }

      const refs = await this.discoverAll(adapter, crawlCtx);
      await this.runs.recordFound(run.id, refs.length);

      if (refs.length === 0) {
        await this.runs.finalize(run.id, emptyTally());
        await this.runs.recordSourceOutcome(source.id, 'success');
        return { outcome: 'completed', crawlRunId: run.id, recordsFound: 0 };
      }

      await this.producer.enqueueFlow(
        {
          name: 'crawler.finalize-run',
          payload: { sourceId: source.id, crawlRunId: run.id },
          jobId: finalizeJobId(run.id),
        },
        refs.map((ref) => ({
          name: 'crawler.ingest-tender' as const,
          payload: { sourceId: source.id, crawlRunId: run.id, ref },
          jobId: ingestJobId(run.id, ref.externalId),
          // One bad tender must not block the run; finalize counts it as an error instead.
          tolerateFailure: true,
        })),
        { correlationId: ctx.correlationId, origin: 'worker' },
      );
      return { outcome: 'dispatched', crawlRunId: run.id, recordsFound: refs.length };
    } catch (err) {
      const final = ctx.isFinalAttempt || err instanceof PermanentJobError;
      await this.runs.fail(run.id, err instanceof Error ? err.message : String(err), final);
      if (final) await this.runs.recordSourceOutcome(source.id, 'failure');
      throw err;
    }
  }

  private async discoverAll(adapter: SourceAdapter, crawlCtx: CrawlContext): Promise<TenderRef[]> {
    const refs = new Map<string, TenderRef>();
    let cursor: string | undefined;
    for (let page = 1; page <= MAX_DISCOVERY_PAGES; page++) {
      const result = await adapter.search(crawlCtx, cursor);
      for (const ref of result.refs) refs.set(ref.externalId, ref);
      if (refs.size > MAX_REFS_PER_RUN) {
        throw new PermanentJobError(`Discovery returned more than ${MAX_REFS_PER_RUN} tenders; check the adapter`);
      }
      cursor = result.nextCursor;
      if (!cursor) return [...refs.values()];
    }
    throw new PermanentJobError(`Discovery exceeded ${MAX_DISCOVERY_PAGES} pages; check the adapter`);
  }
}
