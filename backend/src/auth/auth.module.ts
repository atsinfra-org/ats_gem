import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { parseDurationToSeconds } from '../common/duration';
import { AppConfig } from '../config/app-config.service';
import { OrganizationsModule } from '../organizations/organizations.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthTokenService } from './auth-token.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { LoginThrottleService } from './login-throttle.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';

@Module({
  imports: [
    OrganizationsModule,
    JwtModule.registerAsync({
      global: false,
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        secret: config.get('JWT_SECRET'),
        signOptions: { expiresIn: parseDurationToSeconds(config.get('JWT_ACCESS_TTL')) },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, TokenService, SessionService, AuthTokenService, LoginThrottleService, JwtAuthGuard],
  exports: [AuthService, TokenService, JwtAuthGuard],
})
export class AuthModule {}
