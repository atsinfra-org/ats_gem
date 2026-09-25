import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types';
import { RequireOrgRole } from '../rbac/require-org-role.decorator';
import { CreateSavedSearchDto } from './dto/create-saved-search.dto';
import { UpdateSavedSearchDto } from './dto/update-saved-search.dto';
import { SavedSearchesService } from './saved-searches.service';

@ApiTags('saved-searches')
@ApiBearerAuth()
@Controller('saved-searches')
export class SavedSearchesController {
  constructor(private readonly savedSearches: SavedSearchesService) {}

  @Get()
  @RequireOrgRole('VIEWER')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.savedSearches.list(user.organizationId);
  }

  @Post()
  @RequireOrgRole('MEMBER')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSavedSearchDto) {
    return this.savedSearches.create(user.organizationId, user.id, dto);
  }

  @Patch(':id')
  @RequireOrgRole('MEMBER')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSavedSearchDto) {
    return this.savedSearches.update(user.organizationId, id, dto);
  }

  @Delete(':id')
  @RequireOrgRole('MEMBER')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.savedSearches.remove(user.organizationId, id);
  }
}
