import { Injectable, Logger } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import { PrismaService } from '../database/prisma.service';
import type { Prisma } from '../generated/prisma/client';
import { dedupKey, normalizeQuery } from './query-normalizer';

const MAX_HISTORY_PER_USER = 200;

/** Filters worth remembering with a search (never pagination or sort - those are view state). */
const HISTORY_FILTER_KEYS = ['state', 'district', 'city', 'category', 'procuringEntity', 'tenderType', 'status', 'source', 'minValue', 'maxValue', 'minEmd', 'maxEmd', 'minFee', 'maxFee', 'publishedFrom', 'publishedTo', 'closingFrom', 'closingTo', 'openingFrom', 'openingTo', 'reference'] as const;

/**
 * Per-user search history. Scope: the authenticated user only - every read/delete is keyed by
 * `userId`, and no endpoint returns another user's rows. Anonymous searches are NOT recorded
 * (there is no stable identity to scope them to, and storing them would create unattributable
 * personal data). Repeats of the same normalized query + filters bump a counter instead of adding rows.
 */
@Injectable()
export class SearchHistoryService {
  private readonly logger = new Logger(SearchHistoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Best-effort: recording history must never make a search fail. */
  async record(user: { id: string; organizationId?: string }, rawQuery: string | undefined, filters: Record<string, unknown>): Promise<void> {
    try {
      const nq = normalizeQuery(rawQuery);
      const kept: Record<string, unknown> = {};
      for (const k of HISTORY_FILTER_KEYS) if (filters[k] !== undefined) kept[k] = filters[k];
      if (!nq && Object.keys(kept).length === 0) return; // an empty "browse" is not a search worth remembering
      const key = dedupKey(nq?.text ?? '', kept);
      await this.prisma.searchHistory.upsert({
        where: { userId_dedupKey: { userId: user.id, dedupKey: key } },
        create: { userId: user.id, organizationId: user.organizationId ?? null, queryNormalized: nq?.text ?? '', filters: kept as Prisma.InputJsonValue, dedupKey: key },
        update: { searchCount: { increment: 1 }, lastSearchedAt: new Date() },
      });
      const over = await this.prisma.searchHistory.findMany({ where: { userId: user.id }, orderBy: { lastSearchedAt: 'desc' }, skip: MAX_HISTORY_PER_USER, select: { id: true } });
      if (over.length) await this.prisma.searchHistory.deleteMany({ where: { id: { in: over.map((o) => o.id) }, userId: user.id } });
    } catch (err) {
      this.logger.warn({ msg: 'search history write failed', error: err instanceof Error ? err.message : String(err) });
    }
  }

  list(userId: string, limit = 20) {
    return this.prisma.searchHistory.findMany({
      where: { userId },
      orderBy: { lastSearchedAt: 'desc' },
      take: Math.min(limit, 50),
      select: { id: true, queryNormalized: true, filters: true, searchCount: true, lastSearchedAt: true },
    });
  }

  async remove(userId: string, id: string): Promise<void> {
    const res = await this.prisma.searchHistory.deleteMany({ where: { id, userId } });
    if (res.count === 0) throw new AppError('NOT_FOUND', 'History item not found.');
  }

  async clear(userId: string): Promise<{ removed: number }> {
    const res = await this.prisma.searchHistory.deleteMany({ where: { userId } });
    return { removed: res.count };
  }
}
