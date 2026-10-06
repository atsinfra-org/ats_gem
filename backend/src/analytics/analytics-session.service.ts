import { Injectable } from '@nestjs/common';
import { AppConfig } from '../config/app-config.service';
import { PrismaService } from '../database/prisma.service';
import type { TrackEventDto } from './dto/track-event.dto';

/**
 * One row per (anonymous browser | signed-in user) between activity gaps of
 * `ANALYTICS_SESSION_TIMEOUT_MINUTES` (default 30 - long enough to survive reading a tender page, short
 * enough that a forgotten tab does not keep "inflating" a session for hours). An anonymous id can have many
 * session rows over time (each timeout starts a new one); `anonymousId` is therefore not unique, and the
 * "current" session is whichever row for that id has the most recent activity. First-touch attribution only:
 * UTM/referrer/landing page are recorded once, on a session's first event, and never overwritten - see
 * docs/ARCHITECTURE.md Sec 22.5 for why last-touch was not implemented (it would need a second attribution
 * table and this phase has no consumer for it).
 */
@Injectable()
export class AnalyticsSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  async touch(anonymousId: string, userId: string | undefined, first: TrackEventDto, occurredAt: Date): Promise<string> {
    const timeoutMs = this.config.get('ANALYTICS_SESSION_TIMEOUT_MINUTES') * 60_000;
    const existing = await this.prisma.analyticsSession.findFirst({ where: { anonymousId }, orderBy: { lastActivityAt: 'desc' } });
    if (existing && occurredAt.getTime() - existing.lastActivityAt.getTime() < timeoutMs) {
      await this.prisma.analyticsSession.update({
        where: { id: existing.id },
        data: { lastActivityAt: occurredAt, userId: userId ?? existing.userId ?? undefined },
      });
      return existing.id;
    }
    if (existing && !existing.endedAt) await this.prisma.analyticsSession.update({ where: { id: existing.id }, data: { endedAt: existing.lastActivityAt } });
    const created = await this.prisma.analyticsSession.create({
      data: {
        anonymousId,
        userId,
        startedAt: occurredAt,
        lastActivityAt: occurredAt,
        landingPath: first.landingPath?.slice(0, 300) ?? first.path?.slice(0, 300),
        referrerHost: first.referrerHost?.slice(0, 200),
        utmSource: first.utmSource?.slice(0, 100),
        utmMedium: first.utmMedium?.slice(0, 100),
        utmCampaign: first.utmCampaign?.slice(0, 150),
        utmTerm: first.utmTerm?.slice(0, 150),
        utmContent: first.utmContent?.slice(0, 150),
      },
    });
    return created.id;
  }

  async recordCounts(sessionId: string, events: TrackEventDto[]): Promise<void> {
    const pageViews = events.filter((e) => e.name === 'PAGE_VIEW').length;
    await this.prisma.analyticsSession.update({
      where: { id: sessionId },
      data: { eventCount: { increment: events.length }, pageViewCount: { increment: pageViews } },
    });
  }
}
