import { HttpStatus } from '@nestjs/common';

/**
 * Stable, client-facing error codes (see docs/API-CONTRACT.md §13).
 * Add new codes here with their default HTTP status; never reuse a code for a different meaning.
 */
export const ErrorCode = {
  VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
  INVALID_CURSOR: HttpStatus.BAD_REQUEST,
  BAD_REQUEST: HttpStatus.BAD_REQUEST,
  UNAUTHENTICATED: HttpStatus.UNAUTHORIZED,
  TOKEN_EXPIRED: HttpStatus.UNAUTHORIZED,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  METHOD_NOT_ALLOWED: HttpStatus.METHOD_NOT_ALLOWED,
  CONFLICT: HttpStatus.CONFLICT,
  FILE_TOO_LARGE: HttpStatus.PAYLOAD_TOO_LARGE,
  UNSUPPORTED_FILE_TYPE: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  DEPENDENCY_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  INTERNAL_ERROR: HttpStatus.INTERNAL_SERVER_ERROR,
} as const satisfies Record<string, HttpStatus>;

export type ErrorCode = keyof typeof ErrorCode;

/** Fallback mapping for framework HttpExceptions that were not raised as AppError. */
export function errorCodeForStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHENTICATED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 405:
      return 'METHOD_NOT_ALLOWED';
    case 409:
      return 'CONFLICT';
    case 413:
      return 'FILE_TOO_LARGE';
    case 415:
      return 'UNSUPPORTED_FILE_TYPE';
    case 429:
      return 'RATE_LIMITED';
    case 503:
      return 'DEPENDENCY_UNAVAILABLE';
    default:
      return status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST';
  }
}
