import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the window resets. */
  resetSeconds: number;
}

/**
 * Fixed-window counter in Redis: `INCR` the key, set its expiry on the first hit so the window does
 * not keep sliding, allow while the count is within the limit. Fails open (allows the request) when
 * Redis is unreachable — availability of sign-up/login matters more than throttling precision during
 * a Redis outage, and the other defences (Argon2id cost, login lockout) still apply.
 */
@Injectable()
export class RateLimitService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    try {
      const count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, windowSeconds);
      const ttl = await this.redis.ttl(key);
      const resetSeconds = ttl > 0 ? ttl : windowSeconds;
      return { allowed: count <= limit, limit, remaining: Math.max(0, limit - count), resetSeconds };
    } catch {
      return { allowed: true, limit, remaining: limit, resetSeconds: windowSeconds };
    }
  }
}
