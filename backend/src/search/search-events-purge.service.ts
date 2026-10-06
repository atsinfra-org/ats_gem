import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../config/app-config.service';
import { PrismaService } from '../database/prisma.service';

export const PURGE_BATCH_SIZE = 5_000;

export interface PurgeReport {
  deleted: number;
  batches: number;
  retentionDays: number;
  cutoff: string;
  durationMs: number;
}

/**
 * Retention for `search_events` (docs/ARCHITECTURE.md Sec 20.9). Deletes rows with `created_at < now - retention`
 * in short batches: each batch is its own statement/transaction and skips rows locked by another purge, so it never
 * holds a long lock or blocks the inserts that search traffic produces, and concurrent or repeated runs are safe.
 * Only `search_events` is touched; `search_history` (user-managed) is not.
 */
@Injectable()
export class SearchEventsPurgeService {
  private readonly logger = new Logger(SearchEventsPurgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  async purge(opts: { now?: Date; batchSize?: number } = {}): Promise<PurgeReport> {
    const retentionDays = this.config.get('SEARCH_EVENT_RETENTION_DAYS');
    const batchSize = opts.batchSize ?? PURGE_BATCH_SIZE;
    const cutoff = new Date((opts.now ?? new Date()).getTime() - retentionDays * 86_400_000);
    const started = Date.now();
    let deleted = 0;
    let batches = 0;
    try {
      for (;;) {
        const count = await this.prisma.$executeRaw`
          DELETE FROM search_events
          WHERE id IN (SELECT id FROM search_events WHERE created_at < ${cutoff} ORDER BY created_at LIMIT ${batchSize} FOR UPDATE SKIP LOCKED)`;
        if (count === 0) break;
        deleted += count;
        batches++;
        if (count < batchSize) break;
      }
    } catch (err) {
      this.logger.error({ msg: 'search event purge failed', deletedSoFar: deleted, batches, retentionDays, error: err instanceof Error ? err.message.split('\n').slice(-1)[0] : String(err) });
      throw err;
    }
    const report = { deleted, batches, retentionDays, cutoff: cutoff.toISOString(), durationMs: Date.now() - started };
    this.logger.log({ msg: 'search event purge completed', ...report });
    return report;
  }
}
