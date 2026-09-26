import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import type { Money } from '../common/money';
import { AppConfig } from '../config/app-config.service';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { REDIS } from '../redis/redis.module';

const CACHE_TTL_SECONDS = 300;
const TOP_BUYERS = 6;
const PORTALS = 6;

/**
 * "Live" = open for bids right now: the same visibility rules as search (not deleted, not a confirmed
 * duplicate) plus an open status whose deadline has not already passed (status is recomputed by a job,
 * so the deadline check covers the gap between a deadline passing and the next recompute).
 */
const LIVE = Prisma.sql`t.deleted_at IS NULL AND t.duplicate_of_id IS NULL AND t.status IN ('OPEN', 'CLOSING_SOON') AND (t.closing_at IS NULL OR t.closing_at > now())`;
const CLOSING_THIS_WEEK = Prisma.sql`t.closing_at < now() + interval '7 days' AND t.currency = 'INR'`;
const BUYER_NAME = Prisma.sql`COALESCE(pe.name, NULLIF(btrim(t.department), ''))`;

/** INR bands, lower bound inclusive; only tenders with a disclosed INR value are counted. */
const VALUE_BANDS = [
  { key: 'UNDER_10L', min: null, max: '1000000' },
  { key: '10L_TO_1CR', min: '1000000', max: '10000000' },
  { key: '1CR_TO_10CR', min: '10000000', max: '100000000' },
  { key: '10CR_TO_100CR', min: '100000000', max: '1000000000' },
  { key: 'OVER_100CR', min: '1000000000', max: null },
] as const;

export type PortalStatus = 'ok' | 'delayed' | 'down';

export interface MarketSnapshot {
  liveTenders: number;
  closingThisWeek: Money;
  sources: number;
  lastCrawlAt: string | null;
  states: { code: string; name: string; type: string; live: number; closingThisWeek: Money; topBuyer: string | null }[];
  topBuyers: { id: string; name: string; shortName: string | null; live: number; value: Money }[];
  valueBands: { key: string; min: string | null; max: string | null; count: number }[];
  portals: { id: string; name: string; status: PortalStatus; lastSyncedAt: string | null; today: number }[];
  computedAt: string;
}

export interface WireItem {
  id: string;
  title: string;
  department: string | null;
  value: Money | null;
  state: { code: string; name: string } | null;
  publishedAt: string;
}

export interface ClosingItem {
  id: string;
  title: string;
  department: string | null;
  closingAt: string;
}

const inr = (amount: string): Money => ({ amount, currency: 'INR' });

function portalStatus(health: string): PortalStatus {
  if (health === 'HEALTHY') return 'ok';
  if (health === 'UNKNOWN' || health === 'DEGRADED') return 'delayed';
  return 'down';
}

/**
 * Public aggregates for the landing page (docs/API-CONTRACT.md §6). The snapshot is a handful of
 * aggregate queries over live tenders, cached in Redis for 5 minutes; Redis is optional here (a miss
 * or an outage just recomputes). Wire and closing are single indexed queries and are not cached.
 */
@Injectable()
export class MarketService {
  private readonly logger = new Logger(MarketService.name);
  private inflight: Promise<MarketSnapshot> | null = null;
  /** Namespaced like the queues, so environments and test runs sharing one Redis never read each other's snapshot. */
  private readonly cacheKey: string;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    config: AppConfig,
  ) {
    this.cacheKey = `${config.get('QUEUE_PREFIX')}:market:snapshot:v1`;
  }

  async snapshot(): Promise<MarketSnapshot> {
    const cached = await this.readCache();
    if (cached) return cached;
    // Concurrent misses share one computation instead of each running the aggregates.
    this.inflight ??= this.compute()
      .then(async (snapshot) => {
        await this.writeCache(snapshot);
        return snapshot;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  async wire(limit: number, state?: string): Promise<WireItem[]> {
    const rows = await this.prisma.$queryRaw<
      { id: string; title: string; department: string | null; value: string | null; currency: string; stateCode: string | null; stateName: string | null; publishedAt: Date }[]
    >`
      SELECT t.id::text AS id, t.title, ${BUYER_NAME} AS department, t.estimated_value::text AS value, t.currency::text AS currency,
             t.state_code::text AS "stateCode", s.name AS "stateName", t.published_at AS "publishedAt"
      FROM tenders t
      LEFT JOIN procuring_entities pe ON pe.id = t.procuring_entity_id
      LEFT JOIN states s ON s.code = t.state_code
      WHERE ${LIVE} ${state ? Prisma.sql`AND t.state_code = ${state}::char(2)` : Prisma.empty}
      ORDER BY t.published_at DESC, t.id DESC
      LIMIT ${limit}`;
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      department: r.department,
      value: r.value === null ? null : { amount: r.value, currency: r.currency },
      state: r.stateCode && r.stateName ? { code: r.stateCode, name: r.stateName } : null,
      publishedAt: r.publishedAt.toISOString(),
    }));
  }

  async closing(limit: number): Promise<ClosingItem[]> {
    const rows = await this.prisma.$queryRaw<{ id: string; title: string; department: string | null; closingAt: Date }[]>`
      SELECT t.id::text AS id, t.title, ${BUYER_NAME} AS department, t.closing_at AS "closingAt"
      FROM tenders t
      LEFT JOIN procuring_entities pe ON pe.id = t.procuring_entity_id
      WHERE ${LIVE} AND t.closing_at IS NOT NULL
      ORDER BY t.closing_at ASC, t.id
      LIMIT ${limit}`;
    return rows.map((r) => ({ id: r.id, title: r.title, department: r.department, closingAt: r.closingAt.toISOString() }));
  }

  private async compute(): Promise<MarketSnapshot> {
    const bandCounts = VALUE_BANDS.map((b) => {
      const conds = [Prisma.sql`t.currency = 'INR'`];
      if (b.min) conds.push(Prisma.sql`t.estimated_value >= ${b.min}::numeric`);
      if (b.max) conds.push(Prisma.sql`t.estimated_value < ${b.max}::numeric`);
      return Prisma.sql`count(*) FILTER (WHERE ${Prisma.join(conds, ' AND ')})::int`;
    });

    const [[totals], states, stateBuyers, topBuyers, [sources], portals] = await Promise.all([
      this.prisma.$queryRaw<{ live: number; closing: string; bands: number[] }[]>`
        SELECT count(*)::int AS live,
               COALESCE(sum(t.estimated_value) FILTER (WHERE ${CLOSING_THIS_WEEK}), 0)::numeric(20,2)::text AS closing,
               ARRAY[${Prisma.join(bandCounts)}] AS bands
        FROM tenders t
        WHERE ${LIVE}`,
      this.prisma.$queryRaw<{ code: string; name: string; type: string; live: number; closing: string }[]>`
        SELECT s.code::text AS code, s.name, s.type::text AS type, count(t.id)::int AS live,
               COALESCE(sum(t.estimated_value) FILTER (WHERE ${CLOSING_THIS_WEEK}), 0)::numeric(20,2)::text AS closing
        FROM states s
        LEFT JOIN tenders t ON t.state_code = s.code AND ${LIVE}
        GROUP BY s.code, s.name, s.type
        ORDER BY s.name`,
      // The issuer with the most live tenders in each state; unresolved tenders fall back to their raw department.
      this.prisma.$queryRaw<{ stateCode: string; buyer: string }[]>`
        SELECT DISTINCT ON (x.state_code) x.state_code AS "stateCode", x.buyer
        FROM (
          SELECT t.state_code::text AS state_code, COALESCE(pe.short_name, ${BUYER_NAME}) AS buyer, count(*) AS n
          FROM tenders t
          LEFT JOIN procuring_entities pe ON pe.id = t.procuring_entity_id
          WHERE ${LIVE} AND t.state_code IS NOT NULL AND ${BUYER_NAME} IS NOT NULL
          GROUP BY 1, 2
        ) x
        ORDER BY x.state_code, x.n DESC, x.buyer`,
      this.prisma.$queryRaw<{ id: string; name: string; shortName: string | null; live: number; value: string }[]>`
        SELECT pe.id::text AS id, pe.name, pe.short_name AS "shortName", count(*)::int AS live,
               COALESCE(sum(t.estimated_value) FILTER (WHERE t.currency = 'INR'), 0)::numeric(20,2)::text AS value
        FROM tenders t
        JOIN procuring_entities pe ON pe.id = t.procuring_entity_id
        WHERE ${LIVE}
        GROUP BY pe.id, pe.name, pe.short_name
        ORDER BY live DESC, pe.name
        LIMIT ${TOP_BUYERS}`,
      this.prisma.$queryRaw<{ count: number; lastCrawlAt: Date | null }[]>`
        SELECT count(*)::int AS count, max(last_successful_run_at) AS "lastCrawlAt"
        FROM tender_sources
        WHERE is_active AND deleted_at IS NULL`,
      // "Today" is the IST calendar day: records first seen from each source since local midnight.
      this.prisma.$queryRaw<{ id: string; name: string; health: string; lastSyncedAt: Date | null; today: number }[]>`
        WITH today AS (
          SELECT r.source_id, count(*)::int AS n
          FROM tender_source_records r
          WHERE r.first_seen_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')
          GROUP BY r.source_id
        )
        SELECT src.id::text AS id, src.name, src.health_status::text AS health, src.last_successful_run_at AS "lastSyncedAt",
               COALESCE(today.n, 0)::int AS today
        FROM tender_sources src
        LEFT JOIN today ON today.source_id = src.id
        WHERE src.is_active AND src.deleted_at IS NULL
        ORDER BY today DESC, src.last_successful_run_at DESC NULLS LAST, src.name
        LIMIT ${PORTALS}`,
    ]);

    const buyerByState = new Map(stateBuyers.map((b) => [b.stateCode, b.buyer]));
    return {
      liveTenders: totals.live,
      closingThisWeek: inr(totals.closing),
      sources: sources.count,
      lastCrawlAt: sources.lastCrawlAt?.toISOString() ?? null,
      states: states.map((s) => ({ code: s.code, name: s.name, type: s.type, live: s.live, closingThisWeek: inr(s.closing), topBuyer: buyerByState.get(s.code) ?? null })),
      topBuyers: topBuyers.map((b) => ({ id: b.id, name: b.name, shortName: b.shortName, live: b.live, value: inr(b.value) })),
      valueBands: VALUE_BANDS.map((b, i) => ({ key: b.key, min: b.min, max: b.max, count: totals.bands[i] ?? 0 })),
      portals: portals.map((p) => ({ id: p.id, name: p.name, status: portalStatus(p.health), lastSyncedAt: p.lastSyncedAt?.toISOString() ?? null, today: p.today })),
      computedAt: new Date().toISOString(),
    };
  }

  private async readCache(): Promise<MarketSnapshot | null> {
    try {
      const raw = await this.redis.get(this.cacheKey);
      return raw ? (JSON.parse(raw) as MarketSnapshot) : null;
    } catch (err) {
      this.logger.debug(`Snapshot cache read skipped: ${(err as Error).message}`);
      return null;
    }
  }

  private async writeCache(snapshot: MarketSnapshot): Promise<void> {
    try {
      await this.redis.set(this.cacheKey, JSON.stringify(snapshot), 'EX', CACHE_TTL_SECONDS);
    } catch (err) {
      this.logger.debug(`Snapshot cache write skipped: ${(err as Error).message}`);
    }
  }
}
