import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthenticatedUser } from '../../auth/types';
import { ApiPayload } from '../../common/http/api-response';
import { RequirePermissions } from '../../rbac/require-permissions.decorator';
import { DuplicateCandidatesService } from './duplicate-candidates.service';

class ResolveDuplicateDto {
  @IsIn(['CONFIRMED', 'REJECTED'])
  resolution!: 'CONFIRMED' | 'REJECTED';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

/** Minimal admin review-queue API for cross-source duplicate candidates (docs/ARCHITECTURE.md Sec 6.5). */
@ApiTags('duplicate-candidates')
@ApiBearerAuth()
@Controller('duplicate-candidates')
export class DuplicateCandidatesController {
  constructor(private readonly candidates: DuplicateCandidatesService) {}

  @Get()
  @RequirePermissions('duplicate.review')
  async list(@Query('status') status?: 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'AUTO_CONFIRMED', @Query('page') page = '1', @Query('pageSize') pageSize = '20') {
    const take = Math.min(Number(pageSize) || 20, 100);
    const skip = ((Number(page) || 1) - 1) * take;
    const [total, rows] = await this.candidates.list({ status, take, skip });
    return new ApiPayload(rows, { pagination: { page: Number(page) || 1, pageSize: take, total, totalPages: Math.ceil(total / take) } });
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @RequirePermissions('duplicate.review')
  async resolve(@Param('id', ParseUUIDPipe) candidateId: string, @Body() dto: ResolveDuplicateDto, @CurrentUser() user: AuthenticatedUser) {
    await this.candidates.resolve({ candidateId, resolution: dto.resolution, actorUserId: user.id, notes: dto.notes });
    return null;
  }
}
