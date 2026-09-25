import type { Request } from 'express';
import type { ErrorCode } from '../errors/error-codes';
import type { ErrorDetail } from '../errors/app-error';

export interface ResponseMeta {
  requestId?: string;
  [key: string]: unknown;
}

export interface SuccessEnvelope<T> {
  success: true;
  data: T;
  meta: ResponseMeta;
}

export interface ErrorEnvelope {
  success: false;
  error: { code: ErrorCode; message: string; details?: ErrorDetail[] };
  meta: ResponseMeta;
}

/** Return this from a handler to attach extra `meta` (pagination, facets) alongside `data`. */
export class ApiPayload<T> {
  constructor(
    readonly data: T,
    readonly meta: ResponseMeta = {},
  ) {}
}

export const REQUEST_ID_HEADER = 'x-request-id';

export function getRequestId(req: Request): string | undefined {
  const id = (req as Request & { id?: unknown }).id;
  return typeof id === 'string' ? id : undefined;
}
