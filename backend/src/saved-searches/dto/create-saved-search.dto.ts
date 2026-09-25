import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsString, Length, ValidateNested } from 'class-validator';
import { SavedSearchCriteriaDto } from './saved-search-criteria.dto';

export class CreateSavedSearchDto {
  @ApiProperty() @IsString() @Length(1, 200) name!: string;

  @ApiProperty({ type: SavedSearchCriteriaDto })
  @ValidateNested()
  @Type(() => SavedSearchCriteriaDto)
  criteria!: SavedSearchCriteriaDto;
}
