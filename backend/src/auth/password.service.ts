import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/**
 * docs/ARCHITECTURE.md §5.3: Argon2id, 19 MiB memory, 2 iterations, single-threaded. These are
 * spelled out explicitly (rather than relying on the library's own defaults, which happen to
 * match) so a future default change upstream can never silently change our hashing parameters.
 * `algorithm` is deliberately omitted: `Algorithm` is a `const enum`, which TypeScript cannot
 * import under `isolatedModules`, and Argon2id is already the library's default.
 */
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

/** Minimum password length enforced at the DTO layer too; kept here as the single source of truth. */
export const MIN_PASSWORD_LENGTH = 8;

@Injectable()
export class PasswordService {
  hash(plaintext: string): Promise<string> {
    return hash(plaintext, ARGON2_OPTIONS);
  }

  /** Never throws on a malformed hash (e.g. a corrupted row) — treats it as a failed match. */
  async verify(hashed: string, plaintext: string): Promise<boolean> {
    try {
      return await verify(hashed, plaintext);
    } catch {
      return false;
    }
  }
}
