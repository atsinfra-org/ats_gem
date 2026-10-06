import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthenticatedUser } from '../../auth/types';
import { ApiPayload } from '../../common/http/api-response';
import { RequirePermissions } from '../../rbac/require-permissions.decorator';
import { ProcuringEntitiesService } from './procuring-entities.service';

class MergeEntitiesDto {
  @IsUUID()
  targetEntityId!: string;
}

/**
 * Minimal admin surface for Phase 3's entity resolution (docs/ARCHITECTURE.md Sec 19): list what
 * has been resolved so far, and merge two entities the resolver kept separate but that turned out
 * to be the same organization. Not a full admin UI - just the API the brief asks for (Sec 26).
 */
@ApiTags('procuring-entities')
@ApiBearerAuth()
@Controller('procuring-entities')
export class ProcuringEntitiesController {
  constructor(private readonly entities: ProcuringEntitiesService) {}

  @Get()
  @RequirePermissions('admin.access')
  async list(@Query('state') state?: string, @Query('search') search?: string, @Query('page') page = '1', @Query('pageSize') pageSize = '20') {
    const take = Math.min(Number(pageSize) || 20, 100);
    const skip = ((Number(page) || 1) - 1) * take;
    const [total, rows] = await this.entities.list({ stateCode: state, search, take, skip });
    return new ApiPayload(rows, { pagination: { page: Number(page) || 1, pageSize: take, total, totalPages: Math.ceil(total / take) } });
  }

  @Post(':id/merge')
  @HttpCode(200)
  @RequirePermissions('entity.merge')
  async merge(@Param('id', ParseUUIDPipe) sourceEntityId: string, @Body() dto: MergeEntitiesDto, @CurrentUser() user: AuthenticatedUser) {
    await this.entities.merge({ sourceEntityId, targetEntityId: dto.targetEntityId, actorUserId: user.id });
    return null;
  }
}
