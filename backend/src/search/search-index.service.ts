import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';


export interface ReindexReport {
  runId: string;
  processed: number;
  failed: number;
  batches: number;
  durationMs: number;
  throughputPerSec: number;
  resumedFrom: string | null;
}

export interface VerifyReport {
  totalTenders: number;
  missingVector: number;
  staleVector: number;
  consistent: boolean;
}

export interface SearchHealth {
  provider: 'postgres';
  available: boolean;
  totalTenders: number;
  indexedTenders: number;
  unindexedTenders: number;
  lastRun: { kind: string; status: string; startedAt: string; completedAt: string | null; processed: number; failed: number } | null;
}

/**
 * Index lifecycle for the PostgreSQL search vector (docs/ARCHITECTURE.md Sec 20):
 *  - index/update: a BEFORE INSERT/UPDATE trigger on `tenders` keeps `search_vector` consistent in the
 *    same transaction, so ingestion, dedup, admin correction and entity merge need no extra step;
 *  - refresh: `refreshTender` (the `search.index-tender` job) recomputes one row - it also picks up
 *    changes the trigger cannot see (a renamed category/entity), and is idempotent;
 *  - delete/archive: search filters exclude deleted and duplicate rows at query time, so nothing is removed from the index;
 *  - rebuild: `reindex` recomputes every row in id-ordered batches, resumable from the last completed cursor;
 *  - verify: `verify` compares stored vectors with a fresh computation.
 */
@Injectable()
export class SearchIndexService {
  private readonly logger = new Logger(SearchIndexService.name);

  constructor(private readonly prisma: PrismaService) {}

  async refreshTender(tenderId: string): Promise<boolean> {
    const n = await this.prisma.$executeRaw`UPDATE tenders t SET search_vector = tender_search_vector_build(t) WHERE t.id = ${tenderId}::uuid`;
    return n > 0;
  }

  /** Safe to re-run at any time (recomputation is idempotent; no rows are dropped or duplicated). */
  async reindex(opts: { batchSize?: number; resume?: boolean; onProgress?: (processed: number) => void } = {}): Promise<ReindexReport> {
    const batchSize = Math.min(Math.max(opts.batchSize ?? 2000, 100), 20_000);
    let cursor: string | null = null;
    if (opts.resume) {
      const last = await this.prisma.searchIndexRun.findFirst({ where: { kind: 'REINDEX', status: 'FAILED' }, orderBy: { startedAt: 'desc' } });
      cursor = ((last?.details as { cursor?: string } | null)?.cursor) ?? null;
    }
    const resumedFrom = cursor;
    const run = await this.prisma.searchIndexRun.create({ data: { kind: 'REINDEX', status: 'RUNNING', details: { batchSize } } });
    const started = Date.now();
    let processed = 0;
    let failed = 0;
    let batches = 0;
    try {
      for (;;) {
        const rows: { id: string }[] = await this.prisma.$queryRaw<{ id: string }[]>`
          WITH batch AS (SELECT id FROM tenders WHERE (${cursor}::uuid IS NULL OR id > ${cursor}::uuid) ORDER BY id LIMIT ${batchSize})
          UPDATE tenders t SET search_vector = tender_search_vector_build(t) FROM batch WHERE t.id = batch.id RETURNING t.id::text AS id`;
        if (rows.length === 0) break;
        cursor = rows.reduce((max, r) => (r.id > max ? r.id : max), rows[0].id);
        processed += rows.length;
        batches++;
        opts.onProgress?.(processed);
        await this.prisma.searchIndexRun.update({ where: { id: run.id }, data: { processed, details: { batchSize, cursor } } });
      }
      await this.prisma.searchIndexRun.update({ where: { id: run.id }, data: { status: 'COMPLETED', completedAt: new Date(), processed, failed } });
    } catch (err) {
      failed++;
      this.logger.error({ msg: 'reindex failed', cursor, error: err instanceof Error ? err.message : String(err) });
      await this.prisma.searchIndexRun.update({ where: { id: run.id }, data: { status: 'FAILED', completedAt: new Date(), processed, failed, details: { batchSize, cursor, error: 'batch failed - re-run with --resume' } } });
      throw err;
    }
    const durationMs = Date.now() - started;
    return { runId: run.id, processed, failed, batches, durationMs, throughputPerSec: durationMs > 0 ? Math.round((processed * 1000) / durationMs) : processed, resumedFrom };
  }

  async verify(): Promise<VerifyReport> {
    const [row] = await this.prisma.$queryRaw<{ total: number; missing: number; stale: number }[]>`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE t.search_vector IS NULL)::int AS missing,
             count(*) FILTER (WHERE t.search_vector IS NOT NULL AND t.search_vector IS DISTINCT FROM tender_search_vector_build(t))::int AS stale
      FROM tenders t`;
    const report = { totalTenders: row.total, missingVector: row.missing, staleVector: row.stale, consistent: row.missing === 0 && row.stale === 0 };
    await this.prisma.searchIndexRun.create({ data: { kind: 'VERIFY', status: report.consistent ? 'COMPLETED' : 'INCONSISTENT', completedAt: new Date(), processed: row.total, failed: row.missing + row.stale, details: report } });
    return report;
  }

  async health(): Promise<SearchHealth> {
    try {
      const [row] = await this.prisma.$queryRaw<{ total: number; indexed: number }[]>`SELECT count(*)::int AS total, count(search_vector)::int AS indexed FROM tenders`;
      const last = await this.prisma.searchIndexRun.findFirst({ orderBy: { startedAt: 'desc' } });
      return {
        provider: 'postgres',
        available: true,
        totalTenders: row.total,
        indexedTenders: row.indexed,
        unindexedTenders: row.total - row.indexed,
        lastRun: last ? { kind: last.kind, status: last.status, startedAt: last.startedAt.toISOString(), completedAt: last.completedAt?.toISOString() ?? null, processed: last.processed, failed: last.failed } : null,
      };
    } catch {
      return { provider: 'postgres', available: false, totalTenders: 0, indexedTenders: 0, unindexedTenders: 0, lastRun: null };
    }
  }
}
