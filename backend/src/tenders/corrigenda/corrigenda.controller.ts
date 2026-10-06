import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/current-user.decorator';
import { Public } from '../../auth/public.decorator';
import type { AuthenticatedUser } from '../../auth/types';
import { ApiPayload } from '../../common/http/api-response';
import { RequirePermissions } from '../../rbac/require-permissions.decorator';
import { CorrigendaService } from './corrigenda.service';
import { CreateCorrigendumDto } from './dto/create-corrigendum.dto';

@ApiTags('tender-corrigenda')
@Controller('tenders/:tenderId/corrigenda')
export class CorrigendaController {
  constructor(private readonly corrigenda: CorrigendaService) {}

  @Public()
  @Get()
  async list(@Param('tenderId', ParseUUIDPipe) tenderId: string, @Query('page') page = '1', @Query('pageSize') pageSize = '20') {
    const take = Math.min(Number(pageSize) || 20, 100);
    const skip = ((Number(page) || 1) - 1) * take;
    const [total, rows] = await this.corrigenda.list(tenderId, { take, skip });
    return new ApiPayload(rows.map(toResponse), { pagination: { page: Number(page) || 1, pageSize: take, total, totalPages: Math.ceil(total / take) } });
  }

  @Public()
  @Get(':id')
  async detail(@Param('tenderId', ParseUUIDPipe) tenderId: string, @Param('id', ParseUUIDPipe) id: string) {
    return toResponse(await this.corrigenda.get(tenderId, id));
  }

  @ApiBearerAuth()
  @Post()
  @RequirePermissions('tender.update')
  async create(@Param('tenderId', ParseUUIDPipe) tenderId: string, @Body() dto: CreateCorrigendumDto, @CurrentUser() user: AuthenticatedUser) {
    return toResponse(
      await this.corrigenda.create(
        { tenderId, ...dto, publishedAt: new Date(dto.publishedAt), effectiveAt: dto.effectiveAt ? new Date(dto.effectiveAt) : undefined },
        user.id,
      ),
    );
  }
}

function toResponse(c: {
  id: string;
  sourceId: string | null;
  sourceReference: string | null;
  title: string;
  description: string | null;
  publishedAt: Date;
  effectiveAt: Date | null;
  sourceUrl: string | null;
  documentId: string | null;
  affectedFields: unknown;
}) {
  return {
    id: c.id,
    sourceId: c.sourceId,
    sourceReference: c.sourceReference,
    title: c.title,
    description: c.description,
    publishedAt: c.publishedAt.toISOString(),
    effectiveAt: c.effectiveAt?.toISOString() ?? null,
    sourceUrl: c.sourceUrl,
    documentId: c.documentId,
    affectedFields: c.affectedFields,
  };
}
