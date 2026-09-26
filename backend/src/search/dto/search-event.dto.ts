import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { SearchEventType } from '../../generated/prisma/enums';

/** Deliberately a closed shape (no free-form payload): analytics events cannot become a data-exfiltration or PII sink. */
export class CreateSearchEventDto {
  @ApiProperty({ enum: SearchEventType })
  @IsEnum(SearchEventType)
  type!: SearchEventType;

  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 400) query?: string;
  /** e.g. the filter name ("state") for FILTER_*, the sort key for SORT_CHANGED, or the suggestion kind. */
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 60) name?: string;
  /** e.g. the filter value or chosen suggestion text (short). */
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 120) value?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() tenderId?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(10_000) position?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1_000_000) resultCount?: number;
}
