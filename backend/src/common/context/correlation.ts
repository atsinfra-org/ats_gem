import { AsyncLocalStorage } from 'node:async_hooks';

export interface CorrelationContext {
  /** Request ID for HTTP work, or the originating request/schedule for background work. */
  correlationId: string;
}

const storage = new AsyncLocalStorage<CorrelationContext>();

/** Runs `fn` with a correlation ID visible to everything it awaits (enqueues, outbox writes, logs). */
export function runWithCorrelation<T>(correlationId: string, fn: () => T): T {
  return storage.run({ correlationId }, fn);
}

export function currentCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}
