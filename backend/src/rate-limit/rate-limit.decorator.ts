import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'ats:rate-limit';

/** Named limit policies. Their numbers come from configuration (see `RateLimitGuard`), not the call site. */
export type RateLimitPolicy = 'auth';

/** Applies a per-IP request limit to a route. Opt-in; routes without it are unaffected. */
export const RateLimit = (policy: RateLimitPolicy): MethodDecorator => SetMetadata(RATE_LIMIT_KEY, policy);
