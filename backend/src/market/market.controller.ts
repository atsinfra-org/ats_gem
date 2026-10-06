import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { MarketClosingQueryDto, MarketWireQueryDto } from './dto/market-query.dto';
import { MarketService } from './market.service';

/** Landing-page market data (docs/API-CONTRACT.md §6): public, aggregate-only, no per-user data. */
@ApiTags('market')
@Controller('market')
export class MarketController {
  constructor(private readonly market: MarketService) {}

  @Public()
  @Get('snapshot')
  snapshot() {
    return this.market.snapshot();
  }

  @Public()
  @Get('wire')
  wire(@Query() query: MarketWireQueryDto) {
    return this.market.wire(query.limit ?? 40, query.state);
  }

  @Public()
  @Get('closing')
  closing(@Query() query: MarketClosingQueryDto) {
    return this.market.closing(query.limit ?? 5);
  }
}
