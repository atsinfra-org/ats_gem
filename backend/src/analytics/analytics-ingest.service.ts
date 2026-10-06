import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../config/app-config.service';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { ANALYTICS_METADATA_SCHEMAS } from './analytics-event-schemas';
import { AnalyticsSessionService } from './analytics-session.service';
import type { TrackEventDto } from './dto/track-event.dto';

export interface IngestResult {
  accepted: number;
  rejected: number;
}

const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const MAX_BACKDATE_MS = 24 * 3_600_000;

/**
 * The single write path for `analytics_events` (docs/ARCHITECTURE.md Sec 22.2). Runs inline on the request
 * (no queue): each event is one small, indexed-only insert with server-validated, bounded metadata, so it
 * adds a few milliseconds, not a network hop to a broker. A failure here is caught by the controller and
 * never surfaces to the caller as an error - analytics must not be able to break the feature it is attached to.
 */
@Injectable()
export class AnalyticsIngestService {
  private readonly logger = new Logger(AnalyticsIngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: AnalyticsSessionService,
    private readonly config: AppConfig,
  ) {}

  async ingest(events: TrackEventDto[], ctx: { userId?: string; organizationId?: string; correlationId?: string }, now: Date = new Date()): Promise<IngestResult> {
    const max = this.config.get('ANALYTICS_MAX_BATCH_SIZE');
    const batch = events.slice(0, max);
    let rejected = events.length > max ? events.length - max : 0;

    const anonymousIds = [...new Set(batch.map((e) => e.anonymousId))];
    const sessionByAnon = new Map<string, string>();
    for (const anonymousId of anonymousIds) {
      const first = batch.find((e) => e.anonymousId === anonymousId)!;
      try {
        const occurredAt = clamp(first.occurredAt, now);
        sessionByAnon.set(anonymousId, await this.sessions.touch(anonymousId, ctx.userId, first, occurredAt));
      } catch (err) {
        this.logger.warn({ msg: 'analytics session touch failed', error: describeError(err) });
      }
    }

    const rows: Prisma.AnalyticsEventCreateManyInput[] = [];
    for (const event of batch) {
      const schema = ANALYTICS_METADATA_SCHEMAS[event.name];
      const parsed = schema.safeParse(event.metadata ?? {});
      if (!parsed.success) {
        rejected++;
        this.logger.warn({ msg: 'analytics event rejected: invalid metadata', name: event.name, issues: parsed.error.issues.slice(0, 3).map((i) => i.path.join('.')) });
        continue;
      }
      rows.push({
        eventName: event.name,
        anonymousId: event.anonymousId,
        sessionId: sessionByAnon.get(event.anonymousId) ?? null,
        userId: ctx.userId ?? null,
        organizationId: ctx.organizationId ?? null,
        entityType: event.entityType ?? null,
        entityId: event.entityId ?? null,
        path: event.path?.slice(0, 300) ?? null,
        metadata: parsed.data,
        occurredAt: clamp(event.occurredAt, now),
        receivedAt: now,
        correlationId: ctx.correlationId ?? null,
      });
    }

    if (rows.length > 0) {
      await this.prisma.analyticsEvent.createMany({ data: rows });
      const bySession = new Map<string, TrackEventDto[]>();
      for (const event of batch) {
        const sid = sessionByAnon.get(event.anonymousId);
        if (!sid) continue;
        const list = bySession.get(sid);
        if (list) list.push(event);
        else bySession.set(sid, [event]);
      }
      await Promise.all([...bySession].map(([sid, list]) => this.sessions.recordCounts(sid, list).catch((err: unknown) => this.logger.warn({ msg: 'session count update failed', error: describeError(err) }))));
    }
    return { accepted: rows.length, rejected };
  }
}

/** Clamps a client-reported time to [now - 24h, now + 5m] so a forged or clock-skewed value cannot land in the wrong rollup day. */
function clamp(occurredAt: string | undefined, now: Date): Date {
  if (!occurredAt) return now;
  const t = new Date(occurredAt).getTime();
  if (Number.isNaN(t)) return now;
  return new Date(Math.min(Math.max(t, now.getTime() - MAX_BACKDATE_MS), now.getTime() + MAX_CLOCK_SKEW_MS));
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200);
}
