import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsIn } from 'class-validator';
import { OrganizationRole } from '../../generated/prisma/enums';

/** Never OWNER — ownership transfers through a dedicated flow, not an invitation. */
export class InviteMemberDto {
  @ApiProperty() @IsEmail() email!: string;

  @ApiProperty({ enum: ['MEMBER', 'VIEWER'] })
  @IsEnum(OrganizationRole)
  @IsIn(['MEMBER', 'VIEWER'])
  role!: 'MEMBER' | 'VIEWER';
}
