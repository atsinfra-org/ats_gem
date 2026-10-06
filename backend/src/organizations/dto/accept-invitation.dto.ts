import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class AcceptInvitationDto {
  @ApiProperty()
  @IsString()
  @Length(1, 512)
  token!: string;
}
