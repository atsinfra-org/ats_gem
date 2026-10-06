import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types';
import { ApiPayload } from '../common/http/api-response';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationsService } from './notifications.service';

export class ListNotificationsQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10_000) page?: number = 1;
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number = 20;
  @ApiPropertyOptional({ description: 'Notification type key, e.g. TENDER_CORRIGENDUM.' }) @IsOptional() @IsString() type?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }: { value: unknown }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : value)) @IsBoolean() unread?: boolean;
}

/** Every route derives the user from the access token; there is no `userId` parameter anywhere. */
@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly preferences: NotificationPreferencesService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListNotificationsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const { items, total, unreadCount } = await this.notifications.list(user.id, { page, pageSize, type: query.type, unread: query.unread });
    return new ApiPayload(items, { unreadCount, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } });
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: AuthenticatedUser) {
    return { unreadCount: await this.notifications.unreadCount(user.id) };
  }

  @Get('preferences')
  getPreferences(@CurrentUser() user: AuthenticatedUser) {
    return this.preferences.get(user.id);
  }

  @Patch('preferences')
  updatePreferences(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.preferences.update(user.id, body);
  }

  @Patch('read-all')
  markAllRead(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.markAllRead(user.id);
  }

  @Patch(':id/read')
  async markRead(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.notifications.setRead(user.id, id, true);
    return null;
  }

  @Patch(':id/unread')
  async markUnread(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.notifications.setRead(user.id, id, false);
    return null;
  }
}
