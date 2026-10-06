import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/current-user.decorator';
import { Public } from '../../auth/public.decorator';
import type { AuthenticatedUser } from '../../auth/types';
import { ApiPayload } from '../../common/http/api-response';
import { RequirePermissions } from '../../rbac/require-permissions.decorator';
import { CorrectEventDto } from './dto/correct-event.dto';
import { TimelineService } from './timeline.service';

@ApiTags('tender-timeline')
@Controller('tenders/:tenderId/timeline')
export class TimelineController {
  constructor(private readonly timeline: TimelineService) {}

  @Public()
  @Get()
  async list(@Param('tenderId', ParseUUIDPipe) tenderId: string, @Query('page') page = '1', @Query('pageSize') pageSize = '50') {
    const take = Math.min(Number(pageSize) || 50, 200);
    const skip = ((Number(page) || 1) - 1) * take;
    const [total, rows] = await this.timeline.list(tenderId, { take, skip });
    const data = rows.map((e) => ({
      id: e.id,
      eventType: e.eventType,
      eventAt: e.eventAt?.toISOString() ?? null,
      title: e.title,
      description: e.description,
      sourceReference: e.sourceReference,
    }));
    return new ApiPayload(data, { pagination: { page: Number(page) || 1, pageSize: take, total, totalPages: Math.ceil(total / take) } });
  }

  @Public()
  @Get(':id')
  async detail(@Param('tenderId', ParseUUIDPipe) tenderId: string, @Param('id', ParseUUIDPipe) id: string) {
    const e = await this.timeline.get(tenderId, id);
    return { id: e.id, eventType: e.eventType, eventAt: e.eventAt?.toISOString() ?? null, title: e.title, description: e.description, sourceReference: e.sourceReference };
  }

  @ApiBearerAuth()
  @Patch(':id')
  @RequirePermissions('tender.update')
  async correct(@Param('tenderId', ParseUUIDPipe) tenderId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CorrectEventDto, @CurrentUser() user: AuthenticatedUser) {
    const e = await this.timeline.correct(tenderId, id, { eventAt: dto.eventAt ? new Date(dto.eventAt) : undefined, title: dto.title, description: dto.description }, user.id);
    return { id: e.id, eventType: e.eventType, eventAt: e.eventAt?.toISOString() ?? null, title: e.title, description: e.description };
  }
}
