import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl, Length, Matches } from 'class-validator';

export class UpdateOrganizationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 200) name?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, { message: 'must be a valid 15-character GSTIN' }) gstin?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[A-Z]{5}[0-9]{4}[A-Z]$/, { message: 'must be a valid 10-character PAN' }) pan?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 200) industry?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 50) companySize?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 500) address?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[A-Z]{2}$/, { message: 'must be a 2-letter state code' }) stateCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) city?: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl() website?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 200) contactPerson?: string;
}
