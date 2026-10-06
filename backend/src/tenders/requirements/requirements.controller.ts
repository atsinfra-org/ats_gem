import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public } from '../../auth/public.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthenticatedUser } from '../../auth/types';
import { ApiPayload } from '../../common/http/api-response';
import type { RequirementType } from '../../generated/prisma/enums';
import { RequirePermissions } from '../../rbac/require-permissions.decorator';
import { CreateRequirementDto, UpdateRequirementDto } from './dto/upsert-requirement.dto';
import { RequirementsService } from './requirements.service';

/** Read is public (same visibility as the tender itself); mutation requires `tender.update` (Phase 2/3's existing tender-edit permission - no new permission sprawl for what is, structurally, editing tender data). */
@ApiTags('tender-requirements')
@Controller('tenders/:tenderId/requirements')
export class RequirementsController {
  constructor(private readonly requirements: RequirementsService) {}

  @Public()
  @Get()
  async list(@Param('tenderId', ParseUUIDPipe) tenderId: string, @Query('type') type?: RequirementType, @Query('page') page = '1', @Query('pageSize') pageSize = '20') {
    const take = Math.min(Number(pageSize) || 20, 100);
    const skip = ((Number(page) || 1) - 1) * take;
    const [total, rows] = await this.requirements.list(tenderId, { type, take, skip });
    return new ApiPayload(rows.map(toResponse), { pagination: { page: Number(page) || 1, pageSize: take, total, totalPages: Math.ceil(total / take) } });
  }

  @Public()
  @Get(':id')
  async detail(@Param('tenderId', ParseUUIDPipe) tenderId: string, @Param('id', ParseUUIDPipe) id: string) {
    return toResponse(await this.requirements.get(tenderId, id));
  }

  @ApiBearerAuth()
  @Post()
  @RequirePermissions('tender.update')
  async create(@Param('tenderId', ParseUUIDPipe) tenderId: string, @Body() dto: CreateRequirementDto, @CurrentUser() user: AuthenticatedUser) {
    return toResponse(await this.requirements.create({ tenderId, ...dto }, user.id));
  }

  @ApiBearerAuth()
  @Patch(':id')
  @RequirePermissions('tender.update')
  async update(@Param('tenderId', ParseUUIDPipe) tenderId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRequirementDto, @CurrentUser() user: AuthenticatedUser) {
    return toResponse(await this.requirements.update(tenderId, id, dto, user.id));
  }

  @ApiBearerAuth()
  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions('tender.update')
  async remove(@Param('tenderId', ParseUUIDPipe) tenderId: string, @Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    await this.requirements.delete(tenderId, id, user.id);
    return null;
  }
}

function toResponse(r: { id: string; type: string; title: string; description: string | null; value: { toFixed(dp: number): string } | null; unit: string | null; isMandatory: boolean; sourceReference: string | null; createdAt: Date; updatedAt: Date }) {
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    description: r.description,
    value: r.value ? r.value.toFixed(2) : null,
    unit: r.unit,
    isMandatory: r.isMandatory,
    sourceReference: r.sourceReference,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
