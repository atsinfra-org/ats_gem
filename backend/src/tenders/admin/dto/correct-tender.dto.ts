import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, Length, Matches } from 'class-validator';

export class CorrectTenderDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(3, 1000) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 20_000) description?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{1,16}\.\d{2}$/) estimatedValue?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{1,16}\.\d{2}$/) emdAmount?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{1,16}\.\d{2}$/) tenderFee?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() closingAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() openingAt?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[A-Z]{2}$/) stateCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 200) city?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 500) locationText?: string;

  @ApiProperty({ description: 'Required: why this correction is being made (recorded in the audit log).' })
  @IsString()
  @Length(3, 1000)
  reason!: string;
}
