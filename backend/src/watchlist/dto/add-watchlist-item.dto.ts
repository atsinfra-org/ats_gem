import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class AddWatchlistItemDto {
  @ApiProperty() @IsUUID() tenderId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 1000) note?: string;
}
