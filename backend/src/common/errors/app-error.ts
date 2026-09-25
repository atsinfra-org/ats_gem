import { HttpException } from '@nestjs/common';
import { ErrorCode } from './error-codes';

export interface ErrorDetail {
  field?: string;
  code: string;
  message: string;
  [key: string]: unknown;
}

/** Domain error carrying a stable client-facing code. Throw this from services; never raw HttpExceptions. */
export class AppError extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: ErrorDetail[],
    status: number = ErrorCode[code],
  ) {
    super({ code, message, details }, status);
    this.name = 'AppError';
  }
}
