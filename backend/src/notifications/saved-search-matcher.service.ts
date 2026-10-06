import { Injectable, Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { createHash } from 'node:crypto';
import { AppConfig } from '../config/app-config.service';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { SearchService } from '../search/search.service';
import { ListTendersQueryDto } from '../tenders/dto/list-tenders.query.dto';

export interface SavedSearchMatch {
  savedSearchId: string;
  name: string;
  userId: string;
  organizationId: string;
  alertFrequency: 'IMMEDIATE' | 'DAILY';
}

interface CandidateRow {
  id: string;
  name: string;
  criteria: unknown;
  alert_frequency: 'IMMEDIATE' | 'DAILY';
  user_id: string;
  organization_id: string;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Which alert-enabled saved searches match one tender - using the Phase 7 search semantics, not a second matcher.
 *
 * Strategy (docs/ARCHITECTURE.md Sec 21.5): identical criteria across users/orgs are evaluated once (grouped by a
 * canonical hash); each distinct criteria set becomes the *same strict WHERE the search endpoint builds*
 * (`SearchService.strictMatchWhere`), pinned to the single tender by primary key; groups are evaluated in chunks in one
 * statement (`SELECT k WHERE EXISTS(...) UNION ALL ...`). Cost is O(distinct criteria) primary-key lookups per event -
 * never a scan of the tender table, never one search per (tender, search) pair over the full corpus.
 * The typo-tolerant fallback is result-set-relative and therefore not part of match semantics: alerts match exactly
 * what strict search lists.
 */
@Injectable()
export class SavedSearchMatcherService {
  private readonly logger = new Logger(SavedSearchMatcherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly search: SearchService,
    private readonly config: AppConfig,
  ) {}

  async match(tenderId: string): Promise<SavedSearchMatch[]> {
    // Recipients are the search's creator, who must still be an active member of the search's organization.
    const rows = await this.prisma.$queryRaw<CandidateRow[]>`
      SELECT ss.id::text AS id, ss.name, ss.criteria, ss.alert_frequency::text AS alert_frequency, ss.created_by::text AS user_id, ss.organization_id::text AS organization_id
      FROM saved_searches ss
      JOIN users u ON u.id = ss.created_by AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
      JOIN organization_members om ON om.organization_id = ss.organization_id AND om.user_id = ss.created_by
      WHERE ss.is_active AND ss.alert_frequency <> 'OFF'`;
    if (rows.length === 0) return [];

    const groups = new Map<string, { criteria: unknown; rows: CandidateRow[] }>();
    for (const r of rows) {
      const key = createHash('sha1').update(canonical(r.criteria)).digest('hex');
      const g = groups.get(key);
      if (g) g.rows.push(r);
      else groups.set(key, { criteria: r.criteria, rows: [r] });
    }

    const prepared: { rows: CandidateRow[]; where: Prisma.Sql }[] = [];
    for (const g of groups.values()) {
      try {
        const dto = plainToInstance(ListTendersQueryDto, g.criteria as object);
        // Same validators the search endpoint applies: a stored criteria set that would be rejected there is skipped here.
        if (validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).length > 0) throw new Error('criteria failed validation');
        prepared.push({ rows: g.rows, where: await this.search.strictMatchWhere(dto) });
      } catch (err) {
        // A stored criteria set that no longer validates must not stop everyone else's alerts.
        this.logger.warn({ msg: 'saved search criteria skipped', savedSearchIds: g.rows.map((r) => r.id).slice(0, 5), error: err instanceof Error ? err.message.slice(0, 120) : 'invalid' });
      }
    }

    const matched: CandidateRow[] = [];
    const chunk = this.config.get('NOTIFY_MATCH_CHUNK_SIZE');
    const slices: (typeof prepared)[] = [];
    for (let i = 0; i < prepared.length; i += chunk) slices.push(prepared.slice(i, i + chunk));
    // A few chunks run concurrently on separate pooled connections; results are merged in order.
    const MATCH_PARALLELISM = 4;
    for (let w = 0; w < slices.length; w += MATCH_PARALLELISM) {
      await Promise.all(slices.slice(w, w + MATCH_PARALLELISM).map((slice) => this.evaluateChunk(tenderId, slice, matched)));
    }
    return matched.map((r) => ({ savedSearchId: r.id, name: r.name, userId: r.user_id, organizationId: r.organization_id, alertFrequency: r.alert_frequency }));
  }

  private async evaluateChunk(tenderId: string, slice: { rows: CandidateRow[]; where: Prisma.Sql }[], matched: CandidateRow[]): Promise<void> {
      const parts = slice.map((p, k) => Prisma.sql`SELECT ${k}::int AS k WHERE EXISTS (SELECT 1 FROM tenders t WHERE t.id = ${tenderId}::uuid AND ${p.where})`);
      try {
        const hit = await this.prisma.$queryRaw<{ k: number }[]>(Prisma.sql`${Prisma.join(parts, ' UNION ALL ')}`);
        for (const h of hit) matched.push(...slice[h.k].rows);
      } catch {
        // One bad criteria set must not sink its chunk: evaluate the chunk one group at a time and skip only the broken ones.
        for (const [k, p] of slice.entries()) {
          try {
            const hit = await this.prisma.$queryRaw<{ k: number }[]>(Prisma.sql`${parts[k]}`);
            if (hit.length > 0) matched.push(...p.rows);
          } catch (err) {
            this.logger.warn({ msg: 'saved search evaluation skipped', savedSearchIds: p.rows.map((r) => r.id).slice(0, 5), error: err instanceof Error ? err.message.slice(0, 120) : 'error' });
          }
        }
      }
    }
}
