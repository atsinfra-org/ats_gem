import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OptionalUser } from '../auth/optional-user.decorator';
import { Public } from '../auth/public.decorator';
import type { AuthenticatedUser } from '../auth/types';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { ListTendersQueryDto } from './dto/list-tenders.query.dto';
import { TendersService } from './tenders.service';

@ApiTags('tenders')
@Controller()
export class TendersController {
  constructor(private readonly tenders: TendersService) {}

  @Public()
  @RateLimit('search')
  @Get('search/tenders')
  list(@Query() query: ListTendersQueryDto, @OptionalUser() user?: AuthenticatedUser) {
    return this.tenders.list(query, user ? { id: user.id, organizationId: user.organizationId } : undefined);
  }

  @Public()
  @Get('tenders/:id')
  detail(@Param('id', ParseUUIDPipe) id: string, @OptionalUser() user?: AuthenticatedUser) {
    return this.tenders.detail(id, user?.id);
  }
}
