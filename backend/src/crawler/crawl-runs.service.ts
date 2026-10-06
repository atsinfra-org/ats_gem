import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import type { CrawlRun } from '../generated/prisma/client';
import type { CrawlTrigger, SourceHealthStatus } from '../generated/prisma/enums';
import type { CrawlSource } from './adapters/source-adapter';

/** A RUNNING run older than this is treated as abandoned (worker died) and no longer blocks new crawls. */
export const STALE_RUN_MS = 6 * 3_600_000;

export interface LoadedSource extends CrawlSource {
  adapterKey: string;
  isActive: boolean;
  crawlEnabled: boolean;
}

export interface OpenRunInput {
  sourceId: string;
  trigger: CrawlTrigger;
  triggeredBy?: string;
  jobId: string;
  correlationId: string;
}

export interface RunTally {
  created: number;
  updated: number;
  unchanged: number;
  invalid: number;
  suppressed: number;
  errors: number;
}

export type RunOutcome = 'success' | 'partial' | 'failure';

export function emptyTally(): RunTally {
  return { created: 0, updated: 0, unchanged: 0, invalid: 0, suppressed: 0, errors: 0 };
}

/** Folds child ingestion results (and ignored child failures) into run counters. */
export function tallyOutcomes(results: unknown[], failedChildren: number): RunTally {
  const tally = emptyTally();
  tally.errors = failedChildren;
  for (const result of results) {
    const outcome = (result as { outcome?: unknown } | null)?.outcome;
    if (outcome === 'created' || outcome === 'updated' || outcome === 'unchanged' || outcome === 'invalid' || outcome === 'suppressed') {
      tally[outcome] += 1;
    }
  }
  return tally;
}

export function runOutcome(tally: RunTally): RunOutcome {
  const total = tally.created + tally.updated + tally.unchanged + tally.invalid + tally.suppressed + tally.errors;
  if (tally.errors === 0) return 'success';
  return tally.errors === total ? 'failure' : 'partial';
}

/** Crawl run lifecycle and source health bookkeeping. */
@Injectable()
export class CrawlRunsService {
  constructor(private readonly prisma: PrismaService) {}

  async loadSource(sourceId: string): Promise<LoadedSource | null> {
    const source = await this.prisma.tenderSource.findFirst({
      where: { id: sourceId, deletedAt: null },
      select: { id: true, slug: true, adapterKey: true, isActive: true, crawlEnabled: true, crawlConfig: true },
    });
    if (!source) return null;
    const config = source.crawlConfig && typeof source.crawlConfig === 'object' && !Array.isArray(source.crawlConfig)
      ? (source.crawlConfig as Record<string, unknown>)
      : {};
    return { ...source, config };
  }

  /**
   * Returns the run for this job, creating it on the first attempt (retries resume the same run).
   * The source row is locked so two crawls of one source cannot start concurrently: if another
   * run is still in progress, this one is recorded as CANCELLED and `blockedBy` names the other.
   */
  async open(input: OpenRunInput, now = new Date()): Promise<{ run: CrawlRun; blockedBy?: string }> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tender_sources WHERE id = ${input.sourceId}::uuid FOR UPDATE`;

      const existing = await tx.crawlRun.findFirst({ where: { sourceId: input.sourceId, jobId: input.jobId } });
      if (existing) {
        const run = await tx.crawlRun.update({
          where: { id: existing.id },
          data: { status: 'RUNNING', failureReason: null },
        });
        return { run };
      }

      const active = await tx.crawlRun.findFirst({
        where: {
          sourceId: input.sourceId,
          status: { in: ['RUNNING', 'RETRYING'] },
          startedAt: { gte: new Date(now.getTime() - STALE_RUN_MS) },
        },
        select: { id: true },
      });
      const run = await tx.crawlRun.create({
        data: {
          sourceId: input.sourceId,
          trigger: input.trigger,
          triggeredBy: input.triggeredBy ?? null,
          jobId: input.jobId,
          correlationId: input.correlationId,
          startedAt: now,
          ...(active
            ? { status: 'CANCELLED', completedAt: now, durationMs: 0, failureReason: `Skipped: run ${active.id} is still in progress` }
            : { status: 'RUNNING' }),
        },
      });
      return { run, blockedBy: active?.id };
    });
  }

  async recordFound(runId: string, recordsFound: number): Promise<void> {
    await this.prisma.crawlRun.update({ where: { id: runId }, data: { recordsFound } });
  }

  /** A failed attempt: RETRYING while BullMQ will retry, FAILED (terminal) on the final attempt. */
  async fail(runId: string, reason: string, final: boolean, now = new Date()): Promise<void> {
    const run = await this.prisma.crawlRun.findUniqueOrThrow({ where: { id: runId }, select: { startedAt: true } });
    await this.prisma.crawlRun.update({
      where: { id: runId },
      data: final
        ? { status: 'FAILED', failureReason: reason.slice(0, 1_000), completedAt: now, durationMs: elapsed(run.startedAt, now) }
        : { status: 'RETRYING', failureReason: reason.slice(0, 1_000) },
    });
  }

  /** Terminal bookkeeping from aggregated child results. Absolute values, so re-running is harmless. */
  async finalize(runId: string, tally: RunTally, now = new Date()): Promise<{ run: CrawlRun; outcome: RunOutcome }> {
    const current = await this.prisma.crawlRun.findUniqueOrThrow({ where: { id: runId }, select: { startedAt: true } });
    const outcome = runOutcome(tally);
    const run = await this.prisma.crawlRun.update({
      where: { id: runId },
      data: {
        status: outcome === 'failure' ? 'FAILED' : 'COMPLETED',
        completedAt: now,
        durationMs: elapsed(current.startedAt, now),
        recordsCreated: tally.created,
        recordsUpdated: tally.updated,
        // found = created + updated + skipped + errors; "skipped" covers unchanged, invalid and suppressed records.
        recordsSkipped: tally.unchanged + tally.invalid + tally.suppressed,
        errorCount: tally.errors,
        failureReason: outcome === 'failure' ? 'Every tender in the run failed' : null,
      },
    });
    return { run, outcome };
  }

  /**
   * Updates run timestamps and health on the source. An admin-set DISABLED status is never
   * overwritten by crawl results.
   */
  async recordSourceOutcome(sourceId: string, outcome: RunOutcome, health?: SourceHealthStatus, now = new Date()): Promise<void> {
    const status: SourceHealthStatus = health ?? (outcome === 'success' ? 'HEALTHY' : 'DEGRADED');
    await this.prisma.$transaction([
      this.prisma.tenderSource.update({
        where: { id: sourceId },
        data: outcome === 'failure' ? { lastFailedRunAt: now } : { lastSuccessfulRunAt: now },
      }),
      this.prisma.tenderSource.updateMany({
        where: { id: sourceId, healthStatus: { not: 'DISABLED' } },
        data: { healthStatus: status, healthCheckedAt: now },
      }),
    ]);
  }
}

function elapsed(startedAt: Date | null, now: Date): number | null {
  return startedAt ? Math.max(0, now.getTime() - startedAt.getTime()) : null;
}
