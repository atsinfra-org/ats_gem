import { Injectable, Logger } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import type { ListTendersQueryDto, SearchSort } from '../tenders/dto/list-tenders.query.dto';
import { assertMoneyRange, assertRange, lowerBound, upperBoundExclusive } from './date-bounds';
import { normalizeQuery, type NormalizedQuery } from './query-normalizer';

export type MatchReason = 'REFERENCE_EXACT' | 'REFERENCE_PREFIX' | 'REFERENCE_PARTIAL' | 'TITLE_PHRASE' | 'TITLE_TERMS' | 'ENTITY' | 'OTHER_FIELDS' | 'FUZZY';

export interface SearchHit {
  id: string;
  reason: MatchReason | null;
}

export interface SearchOutcome {
  hits: SearchHit[];
  total: number;
  /** True when more than MAX_COUNT rows match - `total` is then the cap, not the exact count. */
  totalCapped: boolean;
  sort: EffectiveSort;
  ranked: boolean;
}

type EffectiveSort = SearchSort | 'oldest';

/** Counting and paging are both bounded so a broad query cannot turn into a full-table scan. */
/** Relevance ranking scores at most this many (newest) matching tenders per query. */
export const RANK_WINDOW = 20_000;
/** Fuzzy scoring (trigram similarity per row) is costlier, so its window is smaller. */
export const FUZZY_RANK_WINDOW = 2_000;
/** Typo-tolerant matching is added only when strict matching finds fewer results than this. */
export const FUZZY_FALLBACK_BELOW = 3;
export const MAX_COUNT = 10_000;
const STATEMENT_TIMEOUT_MS = 8_000;

/** Ranking tiers. Higher wins; ties fall back to full-text rank, then newest, then id (fully deterministic). */
const TIER_WEIGHT: Record<MatchReason, number> = {
  REFERENCE_EXACT: 1000,
  REFERENCE_PREFIX: 600,
  REFERENCE_PARTIAL: 350,
  TITLE_PHRASE: 300,
  TITLE_TERMS: 200,
  ENTITY: 120,
  OTHER_FIELDS: 60,
  FUZZY: 10,
};

const ORDER_BY: Record<EffectiveSort, string> = {
  relevance: 'r.score DESC, r.published_at DESC, r.id DESC',
  newest: 'r.published_at DESC, r.id DESC',
  oldest: 'r.published_at ASC, r.id ASC',
  closingSoonest: 'r.closing_at ASC NULLS LAST, r.id ASC',
  closingLatest: 'r.closing_at DESC NULLS LAST, r.id DESC',
  valueHigh: 'r.estimated_value DESC NULLS LAST, r.id DESC',
  valueLow: 'r.estimated_value ASC NULLS LAST, r.id ASC',
};

/**
 * Deterministic tender search over PostgreSQL full-text (`tenders.search_vector`, weighted A-D, 'simple'
 * config) + trigram similarity (typo tolerance) + normalized reference matching. See
 * docs/ARCHITECTURE.md Sec 20 for the architecture decision and the exact ranking rules. Returns ids and
 * the *reason* each row matched; hydration into API summaries stays in `TendersService`.
 */
@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Normalizes and validates the query model; shared by `search` and the saved-search matcher so semantics cannot diverge. */
  private prepare(query: ListTendersQueryDto): {
    nq: NormalizedQuery | null;
    referenceKey: string | undefined;
    published: { from?: Date; to?: Date };
    closing: { from?: Date; to?: Date };
    opening: { from?: Date; to?: Date };
  } {
    let nq: NormalizedQuery | null;
    try {
      nq = normalizeQuery(query.q);
    } catch (err) {
      throw new AppError('VALIDATION_FAILED', err instanceof RangeError ? err.message : 'Invalid search query.', [{ field: 'q', code: 'QUERY_TOO_LONG', message: 'Query is too long' }]);
    }
    if (nq && nq.tokens.length === 0) nq = null; // punctuation-only input carries no searchable intent
    const refNorm = normalizeQuery(query.reference);
    const referenceKey = refNorm?.referenceKey || undefined;

    const published = { from: lowerBound(query.publishedFrom), to: upperBoundExclusive(query.publishedTo) };
    const closing = { from: lowerBound(query.closingFrom), to: upperBoundExclusive(query.closingTo) };
    const opening = { from: lowerBound(query.openingFrom), to: upperBoundExclusive(query.openingTo) };
    assertRange('published', published.from, published.to);
    assertRange('closing', closing.from, closing.to);
    assertRange('opening', opening.from, opening.to);
    assertMoneyRange('value', query.minValue, query.maxValue);
    assertMoneyRange('emd', query.minEmd, query.maxEmd);
    assertMoneyRange('fee', query.minFee, query.maxFee);

    return { nq, referenceKey, published, closing, opening };
  }

  /**
   * The strict WHERE for a criteria set, aliased on `t` (tenders). This is exactly the filter `search` applies before
   * its typo-tolerant fallback, so a saved search matches a tender iff the same search would list it. Used by the alert
   * matcher; the fuzzy fallback is result-set-relative ("only when fewer than 3 rows") and is deliberately not applied.
   */
  async strictMatchWhere(query: ListTendersQueryDto): Promise<Prisma.Sql> {
    const { nq, referenceKey, published, closing, opening } = this.prepare(query);
    const categoryIds = query.category?.length
      ? await this.prisma.$transaction((tx) => this.expandCategories(tx, query.category as string[]))
      : undefined;
    return Prisma.join(this.buildWhere(query, { nq, referenceKey, categoryIds, published, closing, opening, fuzzy: false }), ' AND ');
  }

  async search(query: ListTendersQueryDto, opts: { page: number; pageSize: number }): Promise<SearchOutcome> {
    const { nq, referenceKey, published, closing, opening } = this.prepare(query);

    const offset = (opts.page - 1) * opts.pageSize;
    if (offset >= MAX_COUNT) {
      throw new AppError('VALIDATION_FAILED', `Results beyond the first ${MAX_COUNT.toLocaleString('en-IN')} cannot be paged - narrow your search with filters.`, [{ field: 'page', code: 'PAGE_TOO_DEEP', message: 'page too deep' }]);
    }

    const ranked = nq !== null || referenceKey !== undefined;
    const sort = this.effectiveSort(query, ranked);

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
        await tx.$executeRawUnsafe('SET LOCAL pg_trgm.word_similarity_threshold = 0.55');

        const categoryIds = query.category?.length ? await this.expandCategories(tx, query.category) : undefined;
        const countWith = async (fuzzy: boolean) => {
          const sql = Prisma.join(this.buildWhere(query, { nq, referenceKey, categoryIds, published, closing, opening, fuzzy }), ' AND ');
          const rows = await tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM (SELECT 1 FROM tenders t WHERE ${sql} LIMIT ${MAX_COUNT + 1}) c`;
          return { sql, n: rows[0]?.n ?? 0, fuzzy };
        };
        // Strict (exact/prefix full-text + reference) matching first; typo-tolerant matching only when that finds
        // almost nothing, so common queries never pay for the trigram scan.
        let counting = await countWith(false);
        if (nq && counting.n < FUZZY_FALLBACK_BELOW) counting = await countWith(true);
        const whereSql = counting.sql;
        const counted = counting.n;
        const totalCapped = counted > MAX_COUNT;
        const total = totalCapped ? MAX_COUNT : counted;
        if (total === 0 || offset >= total) return { hits: [], total, totalCapped, sort, ranked };

        const order = Prisma.raw(ORDER_BY[sort]);
        const { reasonSql, scoreSql } = this.rankingSql(nq, referenceKey, counting.fuzzy);
        let ids: string[];
        if (ranked && sort === 'relevance') {
          // Score only a bounded candidate window (the newest RANK_WINDOW matches, plus exact reference matches),
          // so a very broad query cannot force scoring hundreds of thousands of rows. See docs/ARCHITECTURE.md Sec 20.
          const key = referenceKey ?? nq?.referenceKey ?? '';
          const exact = key.length >= 3 ? Prisma.sql`UNION (SELECT t.id FROM tenders t WHERE ${whereSql} AND t.reference_number_normalized = ${key}::text)` : Prisma.empty;
          const rows = await tx.$queryRaw<{ id: string }[]>`
            WITH cand AS (
              (SELECT t.id FROM tenders t WHERE ${whereSql} ORDER BY t.published_at DESC, t.id DESC LIMIT ${counting.fuzzy ? FUZZY_RANK_WINDOW : RANK_WINDOW})
              ${exact}
            )
            SELECT r.id FROM (
              SELECT t.id, t.published_at, t.closing_at, t.estimated_value, ${scoreSql} AS score
              FROM cand JOIN tenders t ON t.id = cand.id
            ) r
            ORDER BY ${order}
            LIMIT ${opts.pageSize} OFFSET ${offset}`;
          ids = rows.map((r) => r.id);
        } else {
          const rows = await tx.$queryRaw<{ id: string }[]>`
            SELECT r.id FROM (
              SELECT t.id, t.published_at, t.closing_at, t.estimated_value FROM tenders t WHERE ${whereSql}
            ) r
            ORDER BY ${order}
            LIMIT ${opts.pageSize} OFFSET ${offset}`;
          ids = rows.map((r) => r.id);
        }
        const reasons = new Map<string, MatchReason | null>();
        if (ranked && ids.length > 0) {
          const rr = await tx.$queryRaw<{ id: string; reason: MatchReason }[]>`SELECT t.id, ${reasonSql} AS reason FROM tenders t WHERE t.id = ANY(${ids}::uuid[])`;
          for (const r of rr) reasons.set(r.id, r.reason);
        }
        return { hits: ids.map((id) => ({ id, reason: reasons.get(id) ?? null })), total, totalCapped, sort, ranked };
      });
    } catch (err) {
      if (err instanceof AppError) throw err;
      this.logger.error({ msg: 'search query failed', error: err instanceof Error ? err.message.split('\n').slice(-2).join(' ') : String(err) });
      throw new AppError('DEPENDENCY_UNAVAILABLE', 'Search is temporarily unavailable. Please try again in a moment.');
    }
  }

  private effectiveSort(query: ListTendersQueryDto, ranked: boolean): EffectiveSort {
    let sort: EffectiveSort | undefined = query.sort;
    if (!sort && query.sortBy) {
      const desc = (query.sortOrder ?? 'desc') === 'desc';
      sort = query.sortBy === 'closingAt' ? (desc ? 'closingLatest' : 'closingSoonest') : query.sortBy === 'estimatedValue' ? (desc ? 'valueHigh' : 'valueLow') : desc ? 'newest' : 'oldest';
    }
    sort ??= 'relevance';
    // "relevance" with nothing to rank on is defined as newest-first (documented), never an arbitrary order.
    return sort === 'relevance' && !ranked ? 'newest' : sort;
  }

  private async expandCategories(tx: Prisma.TransactionClient, ids: string[]): Promise<string[]> {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id::text AS id FROM categories WHERE id = ANY(${ids}::uuid[]) OR parent_id = ANY(${ids}::uuid[])`;
    return rows.length ? rows.map((r) => r.id) : ids;
  }

  private buildWhere(
    q: ListTendersQueryDto,
    ctx: {
      nq: NormalizedQuery | null;
      referenceKey: string | undefined;
      categoryIds: string[] | undefined;
      published: { from?: Date; to?: Date };
      closing: { from?: Date; to?: Date };
      opening: { from?: Date; to?: Date };
      fuzzy: boolean;
    },
  ): Prisma.Sql[] {
    const w: Prisma.Sql[] = [Prisma.sql`t.deleted_at IS NULL`, Prisma.sql`t.duplicate_of_id IS NULL`];

    if (ctx.nq) {
      const { tsquery, text, referenceKey } = ctx.nq;
      const parts = [Prisma.sql`t.search_vector @@ to_tsquery('simple', ${tsquery}::text)`];
      if (ctx.fuzzy) parts.push(Prisma.sql`${text}::text <% t.title`);
      if (referenceKey.length >= 3) parts.push(Prisma.sql`t.reference_number_normalized LIKE ${referenceKey + '%'}::text`);
      if (referenceKey.length >= 4) parts.push(Prisma.sql`t.reference_number_normalized LIKE ${'%' + referenceKey + '%'}::text`);
      w.push(Prisma.sql`(${Prisma.join(parts, ' OR ')})`);
    }
    if (ctx.referenceKey) {
      w.push(Prisma.sql`(t.reference_number_normalized = ${ctx.referenceKey}::text OR t.reference_number_normalized LIKE ${ctx.referenceKey + '%'}::text)`);
    }
    if (q.state?.length) w.push(Prisma.sql`t.state_code::text = ANY(${q.state}::text[])`);
    if (q.district?.length) w.push(Prisma.sql`t.district_id = ANY(${q.district}::uuid[])`);
    if (q.city?.length) w.push(Prisma.sql`lower(t.city) = ANY(${q.city.map((c) => c.toLowerCase())}::text[])`);
    if (ctx.categoryIds) w.push(Prisma.sql`(t.category_id = ANY(${ctx.categoryIds}::uuid[]) OR t.sub_category_id = ANY(${ctx.categoryIds}::uuid[]))`);
    if (q.procuringEntity?.length) w.push(Prisma.sql`t.procuring_entity_id = ANY(${q.procuringEntity}::uuid[])`);
    if (q.tenderType?.length) w.push(Prisma.sql`t.tender_type_key = ANY(${q.tenderType}::text[])`);
    if (q.status?.length) w.push(Prisma.sql`t.status::text = ANY(${q.status}::text[])`);
    if (q.source?.length) w.push(Prisma.sql`EXISTS (SELECT 1 FROM tender_source_records sr WHERE sr.tender_id = t.id AND sr.source_id = ANY(${q.source}::uuid[]))`);

    // Exact decimals: compared as numeric in the database, never as JS floats.
    const money = (col: string, min?: string, max?: string) => {
      if (min !== undefined) w.push(Prisma.sql`${Prisma.raw(col)} >= ${min}::numeric`);
      if (max !== undefined) w.push(Prisma.sql`${Prisma.raw(col)} <= ${max}::numeric`);
    };
    money('t.estimated_value', q.minValue, q.maxValue);
    money('t.emd_amount', q.minEmd, q.maxEmd);
    money('t.tender_fee', q.minFee, q.maxFee);

    const range = (col: string, r: { from?: Date; to?: Date }) => {
      if (r.from) w.push(Prisma.sql`${Prisma.raw(col)} >= ${r.from}`);
      if (r.to) w.push(Prisma.sql`${Prisma.raw(col)} < ${r.to}`);
    };
    range('t.published_at', ctx.published);
    range('t.closing_at', ctx.closing);
    range('t.opening_at', ctx.opening);
    return w;
  }

  private rankingSql(nq: NormalizedQuery | null, referenceKey: string | undefined, fuzzy: boolean): { reasonSql: Prisma.Sql; scoreSql: Prisma.Sql } {
    if (!nq && !referenceKey) return { reasonSql: Prisma.sql`NULL::text`, scoreSql: Prisma.sql`0` };
    const key = referenceKey ?? nq!.referenceKey;
    // Branches are assembled in JS (no boolean bind parameters) in strict priority order.
    const branches: { reason: MatchReason; cond: Prisma.Sql }[] = [];
    if (key.length >= 3) {
      branches.push({ reason: 'REFERENCE_EXACT', cond: Prisma.sql`t.reference_number_normalized = ${key}::text` });
      branches.push({ reason: 'REFERENCE_PREFIX', cond: Prisma.sql`t.reference_number_normalized LIKE ${key + '%'}::text` });
    }
    if (key.length >= 4) branches.push({ reason: 'REFERENCE_PARTIAL', cond: Prisma.sql`t.reference_number_normalized LIKE ${'%' + key + '%'}::text` });
    if (nq) {
      const tsq = Prisma.sql`to_tsquery('simple', ${nq.tsquery}::text)`;
      branches.push({ reason: 'TITLE_PHRASE', cond: Prisma.sql`position(${nq.text}::text in lower(t.title)) > 0` });
      // Weight-restricted queries against the stored vector (title/reference = A, entity/department = B): no per-row re-parsing.
      const weighted = (w: string) => Prisma.sql`to_tsquery('simple', ${nq.tokens.map((t) => `${t}:*${w}`).join(' & ')}::text)`;
      branches.push({ reason: 'TITLE_TERMS', cond: Prisma.sql`t.search_vector @@ ${weighted('A')}` });
      branches.push({ reason: 'ENTITY', cond: Prisma.sql`t.search_vector @@ ${weighted('B')}` });
      branches.push({ reason: 'OTHER_FIELDS', cond: Prisma.sql`t.search_vector @@ ${tsq}` });
    }
    const reasonSql = Prisma.sql`CASE ${Prisma.join(branches.map((b) => Prisma.sql`WHEN ${b.cond} THEN ${Prisma.raw("'" + b.reason + "'")}`), ' ')} ELSE 'FUZZY' END`;
    const weightCase = Prisma.sql`CASE ${Prisma.join(branches.map((b) => Prisma.sql`WHEN ${b.cond} THEN ${Prisma.raw(String(TIER_WEIGHT[b.reason]))}`), ' ')} ELSE ${Prisma.raw(String(TIER_WEIGHT.FUZZY))} END`;
    // Inside a tier, ties fall to recency (ORDER BY ... published_at DESC, id DESC); fuzzy hits add trigram similarity.
    // ts_rank_cd was measured at ~40us/row with prefix queries (6x the rest of the query) and is deliberately not used.
    const scoreSql = nq
      ? Prisma.sql`(${weightCase})::float8 + ${fuzzy ? Prisma.sql`20 * word_similarity(${nq.text}::text, t.title)` : Prisma.sql`0`}`
      : Prisma.sql`(${weightCase})::float8`;
    return { reasonSql, scoreSql };
  }
}
