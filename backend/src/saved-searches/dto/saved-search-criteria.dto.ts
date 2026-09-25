import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsISO8601, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { TenderStatus } from '../../generated/prisma/enums';

/**
 * The filterable fields a saved search can capture — the same shape `ListTendersQueryDto` accepts,
 * minus pagination. Kept as its own class (not the query DTO itself) so criteria and "the current
 * page of a search" can evolve independently as the search engine grows in later phases.
 */
export class SavedSearchCriteriaDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 200) q?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[A-Z]{2}$/) state?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() category?: string;
  @ApiPropertyOptional({ enum: TenderStatus }) @IsOptional() @IsEnum(TenderStatus) status?: TenderStatus;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() publishedFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() publishedTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() closingFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() closingTo?: string;
}
