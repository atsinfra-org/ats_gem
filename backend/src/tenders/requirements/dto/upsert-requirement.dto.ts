import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString, Length, Matches } from 'class-validator';
import { RequirementType } from '../../../generated/prisma/enums';

export class CreateRequirementDto {
  @ApiProperty({ enum: RequirementType })
  @IsEnum(RequirementType)
  type!: RequirementType;

  @ApiProperty()
  @IsString()
  @Length(1, 500)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 5000)
  description?: string;

  @ApiPropertyOptional({ description: 'Exact decimal string, e.g. "500000.00".' })
  @IsOptional()
  @Matches(/^\d{1,16}\.\d{2}$/)
  value?: string;

  @ApiPropertyOptional({ example: 'years' })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  unit?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 500)
  sourceReference?: string;
}

export class UpdateRequirementDto {
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

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^\d{1,16}\.\d{2}$/)
  value?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 50)
  unit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 500)
  sourceReference?: string;
}
