import { Body, Controller, Get, HttpCode, Logger, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { OptionalUser } from '../auth/optional-user.decorator';
import { Public } from '../auth/public.decorator';
import type { AuthenticatedUser } from '../auth/types';
import { currentCorrelationId } from '../common/context/correlation';
import { RequireOrgRole } from '../rbac/require-org-role.decorator';
import { RequirePermissions } from '../rbac/require-permissions.decorator';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { AnalyticsIngestService } from './analytics-ingest.service';
import { AnalyticsQueryService, parseRange } from './analytics-query.service';
import { TrackEventsDto } from './dto/track-event.dto';

/** Ingestion and reporting for the analytics pipeline (docs/ARCHITECTURE.md Sec 22). */
@ApiTags('analytics')
@Controller('analytics')
export class AnalyticsController {
  private readonly logger = new Logger(AnalyticsController.name);

  constructor(
    private readonly ingest: AnalyticsIngestService,
    private readonly query: AnalyticsQueryService,
  ) {}

  /**
   * Public, rate-limited beacon. Works for anonymous and signed-in callers alike; a bearer token, when present,
   * attaches the caller's user/organization to the events. Analytics must never be able to break the page it is
   * attached to, so failures here are swallowed (logged, not thrown) and the response is always 202.
   */
  @Public()
  @RateLimit('analytics')
  @Post('events')
  @HttpCode(202)
  async track(@Body() dto: TrackEventsDto, @OptionalUser() user?: AuthenticatedUser) {
    try {
      const result = await this.ingest.ingest(dto.events, { userId: user?.id, organizationId: user?.organizationId, correlationId: currentCorrelationId() });
      return result;
    } catch (err) {
      this.logger.warn({ msg: 'analytics ingest failed', error: err instanceof Error ? err.message.slice(0, 200) : String(err) });
      return { accepted: 0, rejected: dto.events.length };
    }
  }

  @ApiBearerAuth()
  @Get('me/summary')
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  mySummary(@CurrentUser() user: AuthenticatedUser, @Query('from') from?: string, @Query('to') to?: string) {
    return this.query.myActivitySummary(user.id, parseRange(from, to));
  }

  @ApiBearerAuth()
  @Get('organizations/current/overview')
  @RequireOrgRole('VIEWER')
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  orgOverview(@CurrentUser() user: AuthenticatedUser, @Query('from') from?: string, @Query('to') to?: string) {
    return this.query.overview(user.organizationId, parseRange(from, to));
  }

  @ApiBearerAuth()
  @Get('admin/overview')
  @RequirePermissions('analytics.view')
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  adminOverview(@Query('from') from?: string, @Query('to') to?: string) {
    return this.query.overview('global', parseRange(from, to));
  }

  @ApiBearerAuth()
  @Get('admin/trends')
  @RequirePermissions('analytics.view')
  @ApiQuery({ name: 'metric', required: true })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  adminTrend(@Query('metric') metric: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.query.trend('global', metric, parseRange(from, to));
  }
}
