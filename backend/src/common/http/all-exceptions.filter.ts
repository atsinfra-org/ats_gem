import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Prisma } from '../../generated/prisma/client';
import { AppError, type ErrorDetail } from '../errors/app-error';
import { errorCodeForStatus, type ErrorCode } from '../errors/error-codes';
import { getRequestId, type ErrorEnvelope } from './api-response';

interface NormalizedError {
  status: number;
  code: ErrorCode;
  message: string;
  details?: ErrorDetail[];
}

/**
 * Converts every thrown value into the error envelope. Internal details (stack traces, SQL,
 * Prisma messages) are logged server-side only and never returned to clients.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();
    const normalized = this.normalize(exception);

    if (normalized.status >= 500) {
      if (exception instanceof AppError) {
        // Deliberate, handled failures (e.g. DEPENDENCY_UNAVAILABLE): no stack trace, not an error alert.
        this.logger.warn(
          { route: req.originalUrl, method: req.method, code: normalized.code, details: normalized.details },
          `Request failed → ${normalized.code}`,
        );
      } else {
        this.logger.error(
          { err: exception, route: req.originalUrl, method: req.method },
          `Unhandled error → ${normalized.code}`,
        );
      }
    }

    const body: ErrorEnvelope = {
      success: false,
      error: {
        code: normalized.code,
        message: normalized.message,
        ...(normalized.details?.length ? { details: normalized.details } : {}),
      },
      meta: { requestId: getRequestId(req) },
    };
    res.status(normalized.status).json(body);
  }

  private normalize(exception: unknown): NormalizedError {
    if (exception instanceof AppError) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    if (this.isBodyParseError(exception)) {
      return { status: HttpStatus.BAD_REQUEST, code: 'BAD_REQUEST', message: 'Malformed JSON request body.' };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = errorCodeForStatus(status);
      const message =
        status >= 500 ? 'An unexpected error occurred.' : this.httpExceptionMessage(exception);
      return { status, code, message };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          return { status: HttpStatus.CONFLICT, code: 'CONFLICT', message: 'A record with these values already exists.' };
        case 'P2025':
          return { status: HttpStatus.NOT_FOUND, code: 'NOT_FOUND', message: 'The requested record was not found.' };
        default:
          break;
      }
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
    };
  }

  /**
   * body-parser raises a SyntaxError, which Nest's Express adapter re-throws as
   * `new BadRequestException(error.message)` without the original error, so match on the message.
   */
  private isBodyParseError(exception: unknown): boolean {
    if (exception instanceof SyntaxError) return true;
    return (
      exception instanceof HttpException &&
      exception.getStatus() === 400 &&
      !(exception instanceof AppError) &&
      /\bJSON\b|Unexpected (token|end)/.test(exception.message)
    );
  }

  private httpExceptionMessage(exception: HttpException): string {
    const response = exception.getResponse();
    if (typeof response === 'string') return response;
    if (response && typeof response === 'object' && 'message' in response) {
      const { message } = response;
      if (typeof message === 'string') return message;
      if (Array.isArray(message)) return message.join('; ');
    }
    return exception.message;
  }
}
