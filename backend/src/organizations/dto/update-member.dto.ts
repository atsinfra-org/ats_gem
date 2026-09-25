import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsIn } from 'class-validator';
import { OrganizationRole } from '../../generated/prisma/enums';

/** Never OWNER: use the (future) ownership-transfer flow, not this endpoint. */
export class UpdateMemberDto {
  @ApiProperty({ enum: ['MEMBER', 'VIEWER'] })
  @IsEnum(OrganizationRole)
  @IsIn(['MEMBER', 'VIEWER'])
  role!: 'MEMBER' | 'VIEWER';
}
