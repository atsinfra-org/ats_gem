import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'ats:is-public';

/**
 * Marks a route as not requiring authentication. `JwtAuthGuard` is global (fail-closed by
 * default — "backend authorization is mandatory"), so every public route must opt out explicitly.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
