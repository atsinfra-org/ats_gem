import { randomBytes } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TokenExpiredError } from 'jsonwebtoken';
import { AppError } from '../common/errors/app-error';
import { sha256Hex } from '../common/stable-json';
import type { AccessTokenPayload } from './types';

export interface IssuedAccessToken {
  token: string;
  /** Seconds until expiry, for the API response (`{ accessToken, expiresIn }`). */
  expiresIn: number;
}

export interface IssuedRefreshToken {
  /** The value set in the cookie; never persisted. */
  token: string;
  /** SHA-256 of `token`; this is what `sessions.refresh_token_hash` stores. */
  hash: string;
}

/** Signs/verifies access tokens and generates opaque refresh tokens (ADR-11). Stateless: never touches the database. */
@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  signAccessToken(payload: AccessTokenPayload): IssuedAccessToken {
    const token = this.jwt.sign(payload);
    const decoded = this.jwt.decode<{ exp?: number }>(token);
    const expiresIn = decoded?.exp ? Math.max(0, decoded.exp - Math.floor(Date.now() / 1000)) : 0;
    return { token, expiresIn };
  }

  /** Throws `AppError('TOKEN_EXPIRED')` / `UNAUTHENTICATED` — never a raw jsonwebtoken error. */
  verifyAccessToken(token: string): AccessTokenPayload {
    try {
      return this.jwt.verify<AccessTokenPayload>(token);
    } catch (err) {
      if (err instanceof TokenExpiredError) throw new AppError('TOKEN_EXPIRED', 'Access token expired.');
      throw new UnauthorizedException();
    }
  }

  /** A 256-bit random value; only its hash is ever stored. */
  issueRefreshToken(): IssuedRefreshToken {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: this.hashRefreshToken(token) };
  }

  hashRefreshToken(token: string): string {
    return sha256Hex(token);
  }
}
