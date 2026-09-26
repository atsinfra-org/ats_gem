import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { OptionalUser } from '../auth/optional-user.decorator';
import { Public } from '../auth/public.decorator';
import type { AuthenticatedUser } from '../auth/types';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { CreateSearchEventDto } from './dto/search-event.dto';
import { SearchEventsService } from './search-events.service';
import { SearchHistoryService } from './search-history.service';
import { SearchIndexService } from './search-index.service';
import { SearchSuggestionsService } from './search-suggestions.service';

/** Search support endpoints (docs/API-CONTRACT.md Sec 5.3). `GET /search/tenders` itself lives on the tenders controller. */
@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(
    private readonly suggestions: SearchSuggestionsService,
    private readonly history: SearchHistoryService,
    private readonly events: SearchEventsService,
    private readonly index: SearchIndexService,
  ) {}

  @Public()
  @RateLimit('search')
  @Get('suggestions')
  suggest(@Query('q') q: string | undefined, @OptionalUser() user?: AuthenticatedUser) {
    return this.suggestions.suggest(q, user?.id);
  }

  @Public()
  @RateLimit('search')
  @Get('entities')
  entities(@Query('q') q: string | undefined, @Query('ids') ids?: string) {
    return ids ? this.suggestions.entitiesByIds(ids) : this.suggestions.searchEntities(q);
  }

  @Public()
  @RateLimit('search')
  @Get('cities')
  cities(@Query('q') q: string | undefined, @Query('state') state?: string) {
    return this.suggestions.searchCities(q, state);
  }

  @ApiBearerAuth()
  @Get('history')
  listHistory(@CurrentUser() user: AuthenticatedUser, @Query('limit') limit?: string) {
    return this.history.list(user.id, Number(limit) || 20);
  }

  @ApiBearerAuth()
  @Delete('history')
  clearHistory(@CurrentUser() user: AuthenticatedUser) {
    return this.history.clear(user.id);
  }

  @ApiBearerAuth()
  @Delete('history/:id')
  async removeHistory(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.history.remove(user.id, id);
    return null;
  }

  @Public()
  @RateLimit('search')
  @Post('events')
  @HttpCode(202)
  async recordEvent(@Body() dto: CreateSearchEventDto, @OptionalUser() user?: AuthenticatedUser) {
    await this.events.record(dto, user ? { id: user.id, organizationId: user.organizationId } : undefined);
    return null;
  }

  /** Coarse subsystem health: counts only, no internals or connection details. */
  @Public()
  @Get('health')
  health() {
    return this.index.health();
  }
}
