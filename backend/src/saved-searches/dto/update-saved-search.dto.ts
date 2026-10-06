import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, Length, ValidateNested } from 'class-validator';
import { SavedSearchCriteriaDto } from './saved-search-criteria.dto';

export class UpdateSavedSearchDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 200) name?: string;

  @ApiPropertyOptional({ type: SavedSearchCriteriaDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SavedSearchCriteriaDto)
  criteria?: SavedSearchCriteriaDto;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;

  @ApiPropertyOptional({ enum: ['OFF', 'IMMEDIATE', 'DAILY'] })
  @IsOptional()
  @IsIn(['OFF', 'IMMEDIATE', 'DAILY'])
  alertFrequency?: 'OFF' | 'IMMEDIATE' | 'DAILY';
}
