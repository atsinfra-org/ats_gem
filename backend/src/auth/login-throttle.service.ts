import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { AppConfig } from '../config/app-config.service';
import { REDIS } from '../redis/redis.module';

export interface ThrottleCheck {
  locked: boolean;
  /** When the lock clears; present only when `locked`. */
  retryAt?: Date;
}

/**
 * Per-IP and per-account login throttling (docs/ARCHITECTURE.md §5.3): a fixed window of
 * `LOGIN_LOCKOUT_WINDOW_MINUTES` that locks out further attempts once `LOGIN_MAX_ATTEMPTS` failures
 * are recorded in it. State lives only in Redis — never persisted, never survives a Redis flush,
 * and fails open (does not block login) if Redis is unreachable, since availability of the login
 * path matters more than throttling precision during a Redis outage.
 */
@Injectable()
export class LoginThrottleService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly config: AppConfig,
  ) {}

  async check(ip: string, email: string): Promise<ThrottleCheck> {
    try {
      const [ipCount, emailCount] = await Promise.all([this.redis.get(this.key('ip', ip)), this.redis.get(this.key('email', email))]);
      const max = this.config.get('LOGIN_MAX_ATTEMPTS');
      if (Number(ipCount ?? 0) < max && Number(emailCount ?? 0) < max) return { locked: false };

      const [ipTtl, emailTtl] = await Promise.all([this.redis.pttl(this.key('ip', ip)), this.redis.pttl(this.key('email', email))]);
      const remainingMs = Math.max(ipTtl, emailTtl, 0);
      return { locked: true, retryAt: new Date(Date.now() + remainingMs) };
    } catch {
      return { locked: false };
    }
  }

  async recordFailure(ip: string, email: string): Promise<void> {
    const windowSeconds = this.config.get('LOGIN_LOCKOUT_WINDOW_MINUTES') * 60;
    try {
      await Promise.all([this.bump(this.key('ip', ip), windowSeconds), this.bump(this.key('email', email), windowSeconds)]);
    } catch {
      // Redis unavailable: throttling is best-effort, login itself must not fail because of it.
    }
  }

  async reset(ip: string, email: string): Promise<void> {
    try {
      await this.redis.del(this.key('ip', ip), this.key('email', email));
    } catch {
      // Best-effort cleanup; a stale counter just expires on its own.
    }
  }

  private key(scope: 'ip' | 'email', value: string): string {
    return `login-throttle:${scope}:${value}`;
  }

  /** INCR, setting the window's expiry only on the first hit so it does not keep resetting. */
  private async bump(key: string, windowSeconds: number): Promise<void> {
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, windowSeconds);
  }
}
