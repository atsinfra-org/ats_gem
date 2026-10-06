import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length } from 'class-validator';

/** Email change is a separate verified flow, not implemented here (docs/API-CONTRACT.md §4). */
export class UpdateProfileDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 200) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 30) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 200) designation?: string;
}
