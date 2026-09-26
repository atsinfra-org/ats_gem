import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { normalizeQuery, type NormalizedQuery } from './query-normalizer';

/** A "popular" term must have been searched by at least this many distinct users - one user's history is never surfaced to others. */
export const POPULAR_MIN_DISTINCT_USERS = 3;

export interface Suggestions {
  recent: { id: string; query: string }[];
  references: { tenderId: string; reference: string; title: string }[];
  entities: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  states: { code: string; name: string }[];
  popular: { query: string }[];
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, '\\$&');

function safeNormalize(raw: string | undefined): NormalizedQuery | null {
  try {
    return normalizeQuery(raw);
  } catch {
    return null;
  }
}

/** Deterministic suggestions from real data only: history, references, entities, categories, states, aggregated popular terms. */
@Injectable()
export class SearchSuggestionsService {
  constructor(private readonly prisma: PrismaService) {}

  async suggest(rawQuery: string | undefined, userId: string | undefined): Promise<Suggestions> {
    const nq = safeNormalize(rawQuery);
    const out: Suggestions = { recent: [], references: [], entities: [], categories: [], states: [], popular: [] };

    if (userId) {
      out.recent = (
        await this.prisma.searchHistory.findMany({
          where: { userId, queryNormalized: nq ? { startsWith: nq.text } : { not: '' } },
          orderBy: { lastSearchedAt: 'desc' },
          take: 5,
          select: { id: true, queryNormalized: true },
        })
      ).map((r) => ({ id: r.id, query: r.queryNormalized }));
    }
    if (!nq || nq.text.length < 2) return out;

    const like = `%${escapeLike(nq.text)}%`;
    const prefix = `${escapeLike(nq.text)}%`;
    const refPrefix = `${nq.referenceKey}%`;

    const [refs, entities, cats, states, popular] = await Promise.all([
      nq.referenceKey.length >= 3
        ? this.prisma.$queryRaw<{ id: string; reference_number: string; title: string }[]>`
            SELECT id::text, reference_number, title FROM tenders
            WHERE deleted_at IS NULL AND duplicate_of_id IS NULL AND reference_number_normalized LIKE ${refPrefix}::text
            ORDER BY reference_number_normalized LIMIT 5`
        : Promise.resolve([]),
      this.prisma.$queryRaw<{ id: string; name: string }[]>`
        SELECT id::text, name FROM procuring_entities
        WHERE status = 'ACTIVE' AND name_normalized ILIKE ${like}::text
        ORDER BY (name_normalized ILIKE ${prefix}::text) DESC, length(name), name LIMIT 5`,
      this.prisma.$queryRaw<{ id: string; name: string }[]>`
        SELECT id::text, name FROM categories WHERE is_active AND name ILIKE ${like}::text ORDER BY (name ILIKE ${prefix}::text) DESC, name LIMIT 5`,
      this.prisma.$queryRaw<{ code: string; name: string }[]>`
        SELECT code::text, name FROM states WHERE name ILIKE ${prefix}::text ORDER BY name LIMIT 4`,
      this.prisma.$queryRaw<{ q: string }[]>`
        SELECT query_normalized AS q FROM search_history
        WHERE query_normalized LIKE ${prefix}::text AND query_normalized <> '' AND last_searched_at > now() - interval '30 days'
        GROUP BY query_normalized HAVING count(DISTINCT user_id) >= ${POPULAR_MIN_DISTINCT_USERS}::int
        ORDER BY count(DISTINCT user_id) DESC, query_normalized LIMIT 5`,
    ]);
    out.references = refs.map((r) => ({ tenderId: r.id, reference: r.reference_number, title: r.title }));
    out.entities = entities;
    out.categories = cats;
    out.states = states;
    out.popular = popular.map((p) => ({ query: p.q }));
    return out;
  }

  /** Server-side entity picker for the advanced filter (never ships the whole entity table to the browser). */
  async searchEntities(rawQuery: string | undefined): Promise<{ id: string; name: string; stateCode: string | null }[]> {
    const nq = safeNormalize(rawQuery);
    if (!nq || nq.text.length < 2) return [];
    const like = `%${escapeLike(nq.text)}%`;
    return this.prisma.$queryRaw<{ id: string; name: string; stateCode: string | null }[]>`
      SELECT id::text, name, state_code::text AS "stateCode" FROM procuring_entities
      WHERE status = 'ACTIVE' AND name_normalized ILIKE ${like}::text ORDER BY length(name), name LIMIT 10`;
  }

  /** Resolves display names for entity ids in a shared URL (max 20 valid UUIDs; anything else is ignored). */
  async entitiesByIds(raw: string): Promise<{ id: string; name: string; stateCode: string | null }[]> {
    const ids = [...new Set(raw.split(',').map((v) => v.trim()).filter((v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)))].slice(0, 20);
    if (ids.length === 0) return [];
    return this.prisma.$queryRaw<{ id: string; name: string; stateCode: string | null }[]>`
      SELECT id::text, name, state_code::text AS "stateCode" FROM procuring_entities WHERE status = 'ACTIVE' AND id = ANY(${ids}::uuid[]) ORDER BY name`;
  }

  /** Distinct city names present on live tenders (real data, not a list), with counts; min 2 characters. */
  async searchCities(rawQuery: string | undefined, stateCode: string | undefined): Promise<{ name: string; count: number }[]> {
    const nq = safeNormalize(rawQuery);
    if (!nq || nq.text.length < 2) return [];
    const like = `%${escapeLike(nq.text)}%`;
    const state = stateCode && /^[A-Z]{2}$/.test(stateCode) ? stateCode : null;
    return this.prisma.$queryRaw<{ name: string; count: number }[]>`
      SELECT min(city) AS name, count(*)::int AS count FROM tenders
      WHERE deleted_at IS NULL AND duplicate_of_id IS NULL AND city IS NOT NULL AND city <> ''
        AND lower(city) LIKE ${like}::text AND (${state}::text IS NULL OR state_code = ${state}::text)
      GROUP BY lower(city) ORDER BY (lower(city) LIKE ${escapeLike(nq.text) + '%'}::text) DESC, count(*) DESC, min(city) LIMIT 20`;
  }
}
