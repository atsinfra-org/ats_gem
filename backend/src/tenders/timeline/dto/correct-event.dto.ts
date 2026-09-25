import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, Length } from 'class-validator';

export class CorrectEventDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  eventAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 500)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 5000)
  description?: string;
}
