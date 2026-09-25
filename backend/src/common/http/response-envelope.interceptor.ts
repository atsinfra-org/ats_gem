import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { map, type Observable } from 'rxjs';
import { ApiPayload, getRequestId, type SuccessEnvelope } from './api-response';

/** Wraps every successful handler result in `{ success, data, meta }` (docs/API-CONTRACT.md §1.1). */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<SuccessEnvelope<unknown>> {
    const requestId = getRequestId(context.switchToHttp().getRequest<Request>());
    return next.handle().pipe(
      map((result: unknown) => {
        if (result instanceof ApiPayload) {
          const payload: ApiPayload<unknown> = result;
          return { success: true, data: payload.data, meta: { ...payload.meta, requestId } };
        }
        return { success: true, data: result ?? null, meta: { requestId } };
      }),
    );
  }
}
