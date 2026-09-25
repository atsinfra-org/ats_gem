import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsISO8601, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { TenderStatus } from '../../generated/prisma/enums';

/**
 * Filter/pagination foundation for `GET /search/tenders` (docs/API-CONTRACT.md §5). This is a
 * plain indexed-column filter, not the relevance-ranked search engine — that is Phase 4/5, built
 * behind the same `SearchProvider` interface without changing this DTO's shape.
 */
export class ListTendersQueryDto {
  @ApiPropertyOptional({ description: 'Matched against the title (case-insensitive substring).' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  q?: string;

  @ApiPropertyOptional({ example: 'MH' })
  @IsOptional()
  @Matches(/^[A-Z]{2}$/)
  state?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  category?: string;

  @ApiPropertyOptional({ enum: TenderStatus })
  @IsOptional()
  @IsEnum(TenderStatus)
  status?: TenderStatus;

  @ApiPropertyOptional() @IsOptional() @IsISO8601() publishedFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() publishedTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() closingFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() closingTo?: string;

  @ApiPropertyOptional({ description: 'Canonical procuring entity (Phase 3), not the free-text department.' })
  @IsOptional()
  @IsUUID()
  procuringEntity?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  district?: string;

  @ApiPropertyOptional({ description: 'Minimum estimated value (exact decimal string, e.g. "100000.00").' })
  @IsOptional()
  @Matches(/^\d{1,16}\.\d{2}$/)
  minValue?: string;

  @ApiPropertyOptional({ description: 'Maximum estimated value (exact decimal string).' })
  @IsOptional()
  @Matches(/^\d{1,16}\.\d{2}$/)
  maxValue?: string;

  @ApiPropertyOptional({ enum: ['publishedAt', 'closingAt', 'estimatedValue'], default: 'publishedAt' })
  @IsOptional()
  @IsEnum(['publishedAt', 'closingAt', 'estimatedValue'])
  sortBy?: 'publishedAt' | 'closingAt' | 'estimatedValue';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}
