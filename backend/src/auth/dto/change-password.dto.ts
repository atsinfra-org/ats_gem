import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { MIN_PASSWORD_LENGTH } from '../password.service';

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @Length(1, 128)
  currentPassword!: string;

  @ApiProperty({ minLength: MIN_PASSWORD_LENGTH, maxLength: 128 })
  @IsString()
  @Length(MIN_PASSWORD_LENGTH, 128)
  newPassword!: string;
}
