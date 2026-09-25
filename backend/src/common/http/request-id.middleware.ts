import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { runWithCorrelation } from '../context/correlation';
import { REQUEST_ID_HEADER } from './api-response';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

/**
 * Assigns the correlation ID before anything else runs (including body parsing), so even
 * requests rejected by the JSON parser carry an ID in logs and error responses. The ID is also
 * placed in async context so jobs and outbox events created by this request inherit it.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id = typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
  (req as Request & { id: string }).id = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  runWithCorrelation(id, next);
}
