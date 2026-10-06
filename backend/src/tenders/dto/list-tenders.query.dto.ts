import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEnum, IsISO8601, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { TenderStatus } from '../../generated/prisma/enums';

const csv = () =>
  Transform(({ value }: { value: unknown }) => {
    if (value === undefined || value === null || value === '') return undefined;
    const parts = Array.isArray(value) ? value : (value as string).split(',');
    return parts.map((p) => String(p).trim()).filter(Boolean);
  });

const DECIMAL = /^\d{1,16}(\.\d{1,2})?$/;

export const SEARCH_SORTS = ['relevance', 'newest', 'closingSoonest', 'closingLatest', 'valueHigh', 'valueLow'] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];

/**
 * The single query model for `GET /search/tenders` (docs/API-CONTRACT.md Sec 5). List-valued filters
 * accept comma-separated values or repeated params (`state=MH,UP` or `state=MH&state=UP`); a single value
 * behaves exactly as before, so Phase 2-6 clients keep working. Only fields backed by real data exist here.
 */
export class ListTendersQueryDto {
  @ApiPropertyOptional({ description: 'Free text: matched (normalized, prefix-aware, typo-tolerant) across title, reference, procuring entity, category, location and tender type.' })
  @IsOptional()
  @IsString()
  @Length(1, 400)
  q?: string;

  @ApiPropertyOptional({ description: 'Tender reference number (exact or prefix, punctuation-insensitive).' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  reference?: string;

  @ApiPropertyOptional({ example: 'MH,UP', description: 'Two-letter state codes.' })
  @IsOptional()
  @csv()
  @IsArray()
  @ArrayMaxSize(40)
  @Matches(/^[A-Z]{2}$/, { each: true })
  state?: string[];

  @ApiPropertyOptional({ description: 'District ids (only populated where the source provides a district).' })
  @IsOptional()
  @csv()
  @IsArray()
  @ArrayMaxSize(40)
  @IsUUID('all', { each: true })
  district?: string[];

  @ApiPropertyOptional({ description: 'Exact city name, case-insensitive.' })
  @IsOptional()
  @csv()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Length(1, 100, { each: true })
  city?: string[];

  @ApiPropertyOptional({ description: 'Category ids; a parent category also matches its children.' })
  @IsOptional()
  @csv()
  @IsArray()
  @ArrayMaxSize(40)
  @IsUUID('all', { each: true })
  category?: string[];

  @ApiPropertyOptional({ description: 'Canonical procuring entity ids.' })
  @IsOptional()
  @csv()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  procuringEntity?: string[];

  @ApiPropertyOptional({ description: 'Tender type keys (see /meta/tender-types).' })
  @IsOptional()
  @csv()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Matches(/^[A-Za-z0-9_-]{1,50}$/, { each: true })
  tenderType?: string[];

  @ApiPropertyOptional({ enum: TenderStatus, isArray: true })
  @IsOptional()
  @csv()
  @IsArray()
  @ArrayMaxSize(10)
  @IsEnum(TenderStatus, { each: true })
  status?: TenderStatus[];

  @ApiPropertyOptional({ description: 'Tender source ids (see /meta/sources).' })
  @IsOptional()
  @csv()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  source?: string[];

  @ApiPropertyOptional({ description: 'Exact decimal, e.g. "100000" or "100000.50".' }) @IsOptional() @Matches(DECIMAL) minValue?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DECIMAL) maxValue?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DECIMAL) minEmd?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DECIMAL) maxEmd?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DECIMAL) minFee?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DECIMAL) maxFee?: string;

  @ApiPropertyOptional({ description: 'Date-only (IST calendar day, inclusive) or ISO-8601 instant.' }) @IsOptional() @IsISO8601() publishedFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() publishedTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() closingFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() closingTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() openingFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() openingTo?: string;

  @ApiPropertyOptional({ enum: SEARCH_SORTS, description: 'relevance = ranked when q/reference is given, otherwise newest first.' })
  @IsOptional()
  @IsIn(SEARCH_SORTS)
  sort?: SearchSort;

  /** Legacy (Phase 3) sort params; `sort` wins when both are present. */
  @ApiPropertyOptional({ enum: ['publishedAt', 'closingAt', 'estimatedValue'] })
  @IsOptional()
  @IsIn(['publishedAt', 'closingAt', 'estimatedValue'])
  sortBy?: 'publishedAt' | 'closingAt' | 'estimatedValue';

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}
