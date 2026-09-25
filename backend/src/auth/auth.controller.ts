import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AppError } from '../common/errors/app-error';
import { AppConfig } from '../config/app-config.service';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { RateLimit } from '../rate-limit/rate-limit.decorator';
import { Public } from './public.decorator';
import type { RequestMeta } from './session.service';
import type { AuthenticatedUser } from './types';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfig,
  ) {}

  @Public()
  @RateLimit('auth')
  @Post('register')
  async register(@Body() dto: RegisterDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.register(dto, requestMeta(req));
    this.setRefreshCookie(res, result.refreshToken);
    return { user: result.user, requiresEmailVerification: true, accessToken: result.accessToken.token, expiresIn: result.accessToken.expiresIn };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto, requestMeta(req));
    this.setRefreshCookie(res, result.refreshToken);
    return { accessToken: result.accessToken.token, expiresIn: result.accessToken.expiresIn, user: result.user };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    // Cheap CSRF mitigation (ADR-11): a cross-site form/img/link cannot set a custom header, and
    // the CORS allow-list blocks a cross-origin script from doing it without the origin being trusted.
    if (req.header('X-Requested-With') !== 'XMLHttpRequest') throw new AppError('FORBIDDEN', 'Missing required header.');
    const token = req.cookies?.[this.config.get('REFRESH_COOKIE_NAME')] as string | undefined;
    if (!token) throw new AppError('UNAUTHENTICATED', 'No refresh session.');

    const result = await this.auth.refresh(token, requestMeta(req));
    this.setRefreshCookie(res, result.refreshToken);
    return { accessToken: result.accessToken.token, expiresIn: result.accessToken.expiresIn };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@CurrentUser() user: AuthenticatedUser, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[this.config.get('REFRESH_COOKIE_NAME')] as string | undefined;
    await this.auth.logout(user.sessionId, token);
    res.clearCookie(this.config.get('REFRESH_COOKIE_NAME'), { path: '/api/v1/auth' });
    return null;
  }

  @Public()
  @Post('verify-email')
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    await this.auth.verifyEmail(dto);
    return { verified: true };
  }

  @Post('resend-verification')
  async resendVerification(@CurrentUser() user: AuthenticatedUser) {
    await this.auth.resendVerification(user.id);
    return null;
  }

  @Public()
  @RateLimit('auth')
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.auth.forgotPassword(dto);
    return null;
  }

  @Public()
  @RateLimit('auth')
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto);
    return null;
  }

  @Post('change-password')
  async changePassword(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangePasswordDto) {
    await this.auth.changePassword(user.id, user.sessionId, dto);
    return null;
  }

  @ApiBearerAuth()
  @Get('sessions')
  async listSessions(@CurrentUser() user: AuthenticatedUser) {
    const sessions = await this.auth.listSessions(user.id);
    return sessions.map((s) => ({
      id: s.id,
      deviceLabel: s.deviceLabel,
      ip: s.ip,
      userAgent: s.userAgent,
      lastUsedAt: s.lastUsedAt.toISOString(),
      createdAt: s.createdAt.toISOString(),
      current: s.id === user.sessionId,
    }));
  }

  @ApiBearerAuth()
  @Delete('sessions/:id')
  async revokeSession(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.auth.revokeSession(user.id, id);
    return null;
  }

  /**
   * Every other token-issuing route always scopes the access token to the caller's personal
   * organization (docs/ARCHITECTURE.md §17.4). This is how a user who has accepted an invitation
   * into a team organization actually acts within it: swap the token, keep the same session.
   */
  @ApiBearerAuth()
  @Post('switch-organization/:organizationId')
  @HttpCode(200)
  async switchOrganization(@CurrentUser() user: AuthenticatedUser, @Param('organizationId', ParseUUIDPipe) organizationId: string) {
    const accessToken = await this.auth.switchOrganization(user.id, organizationId, user.sessionId);
    return { accessToken: accessToken.token, expiresIn: accessToken.expiresIn, organizationId };
  }

  private setRefreshCookie(res: Response, token: string): void {
    const secure = this.config.get('COOKIE_SECURE') ?? this.config.isProduction;
    res.cookie(this.config.get('REFRESH_COOKIE_NAME'), token, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: this.config.get('REFRESH_TOKEN_TTL_DAYS') * 86_400_000,
    });
  }
}

function requestMeta(req: Request): RequestMeta {
  return { ip: req.ip, userAgent: req.header('user-agent') };
}
