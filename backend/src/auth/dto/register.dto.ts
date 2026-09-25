import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsEmail, IsString, Length } from 'class-validator';
import { MIN_PASSWORD_LENGTH } from '../password.service';

export class RegisterDto {
  @ApiProperty({ minLength: 1, maxLength: 200 })
  @IsString()
  @Length(1, 200)
  name!: string;

  @ApiProperty()
  @IsEmail()
  email!: string;

  @ApiProperty({ minLength: MIN_PASSWORD_LENGTH, maxLength: 128 })
  @IsString()
  @Length(MIN_PASSWORD_LENGTH, 128)
  password!: string;

  @ApiProperty({ description: 'Must be true; recorded with the current terms version.' })
  @Equals(true, { message: 'You must accept the terms to register.' })
  acceptTerms!: true;
}
