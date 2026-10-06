import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, Length, ValidateNested } from 'class-validator';
import { SavedSearchCriteriaDto } from './saved-search-criteria.dto';

export class CreateSavedSearchDto {
  @ApiProperty() @IsString() @Length(1, 200) name!: string;

  @ApiProperty({ type: SavedSearchCriteriaDto })
  @ValidateNested()
  @Type(() => SavedSearchCriteriaDto)
  criteria!: SavedSearchCriteriaDto;

  @ApiPropertyOptional({ enum: ['OFF', 'IMMEDIATE', 'DAILY'], default: 'OFF', description: 'Alerts are opt-in per saved search.' })
  @IsOptional()
  @IsIn(['OFF', 'IMMEDIATE', 'DAILY'])
  alertFrequency?: 'OFF' | 'IMMEDIATE' | 'DAILY';
}
