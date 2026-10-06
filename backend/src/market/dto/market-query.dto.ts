import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

export class MarketWireQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 40 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiPropertyOptional({ example: 'MH', description: 'Two-letter state code.' })
  @IsOptional()
  @Matches(/^[A-Z]{2}$/)
  state?: string;
}

export class MarketClosingQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 20, default: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;
}
