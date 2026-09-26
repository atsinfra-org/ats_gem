import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { AppError } from '../common/errors/app-error';
import { AppConfig } from '../config/app-config.service';
import { RATE_LIMIT_KEY, type RateLimitPolicy } from './rate-limit.decorator';
import { RateLimitService } from './rate-limit.service';

/**
 * Enforces `@RateLimit(policy)` per client IP and sets the standard `RateLimit-*` headers
 * (docs/API-CONTRACT.md §1.5; CORS already exposes them). Registered first in the global guard chain
 * so a throttled request is rejected before any authentication or database work happens.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimitService,
    private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy = this.reflector.getAllAndOverride<RateLimitPolicy | undefined>(RATE_LIMIT_KEY, [context.getHandler(), context.getClass()]);
    if (!policy) return true;

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const { limit, windowSeconds } = this.policyLimits(policy);

    // Scoped by policy *and* route, so one endpoint's traffic does not consume another's allowance.
    const routeKey = `${req.method}:${req.route ? String((req.route as { path?: unknown }).path) : req.path}`;
    const result = await this.limiter.hit(`rate-limit:${policy}:${routeKey}:${req.ip ?? 'unknown'}`, limit, windowSeconds);

    res.setHeader('RateLimit-Limit', String(result.limit));
    res.setHeader('RateLimit-Remaining', String(result.remaining));
    res.setHeader('RateLimit-Reset', String(result.resetSeconds));
    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.resetSeconds));
      throw new AppError('RATE_LIMITED', 'Too many requests. Please try again later.');
    }
    return true;
  }

  private policyLimits(policy: RateLimitPolicy): { limit: number; windowSeconds: number } {
    switch (policy) {
      case 'search':
        return { limit: this.config.get('RATE_LIMIT_SEARCH_MAX'), windowSeconds: this.config.get('RATE_LIMIT_SEARCH_WINDOW_SECONDS') };
      case 'auth':
        return { limit: this.config.get('RATE_LIMIT_AUTH_MAX'), windowSeconds: this.config.get('RATE_LIMIT_AUTH_WINDOW_MINUTES') * 60 };
    }
  }
}
