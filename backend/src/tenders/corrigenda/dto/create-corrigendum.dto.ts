import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsISO8601, IsOptional, IsString, IsUUID, IsUrl, Length } from 'class-validator';

export class CreateCorrigendumDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sourceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 500)
  sourceReference?: string;

  @ApiProperty()
  @IsString()
  @Length(1, 500)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 10_000)
  description?: string;

  @ApiProperty()
  @IsISO8601()
  publishedAt!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  effectiveAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  sourceUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  documentId?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  affectedFields?: string[];
}
