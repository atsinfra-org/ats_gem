import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types';
import { AddWatchlistItemDto } from './dto/add-watchlist-item.dto';
import { WatchlistService } from './watchlist.service';

@ApiTags('watchlist')
@ApiBearerAuth()
@Controller('watchlist')
export class WatchlistController {
  constructor(private readonly watchlist: WatchlistService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.watchlist.list(user.id);
  }

  @Post()
  add(@CurrentUser() user: AuthenticatedUser, @Body() dto: AddWatchlistItemDto) {
    return this.watchlist.add(user.id, dto);
  }

  @Delete(':tenderId')
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('tenderId', ParseUUIDPipe) tenderId: string) {
    await this.watchlist.remove(user.id, tenderId);
    return null;
  }
}
