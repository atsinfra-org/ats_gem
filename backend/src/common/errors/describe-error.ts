/**
 * One-line, log-safe description of an error. Connection failures from `net` are AggregateErrors
 * with an empty message, so fall back to the error code (e.g. ECONNREFUSED) or name.
 */
export function describeError(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    const text = err.message || (typeof code === 'string' ? code : '') || err.name;
    return text.split('\n')[0].slice(0, 500);
  }
  return String(err).slice(0, 500);
}

/** Lets one call through per interval — for warnings that would otherwise repeat on every reconnect. */
export class LogThrottle {
  private last = Number.NEGATIVE_INFINITY;

  constructor(private readonly intervalMs = 30_000) {}

  ready(now = Date.now()): boolean {
    if (now - this.last < this.intervalMs) return false;
    this.last = now;
    return true;
  }

  reset(): void {
    this.last = Number.NEGATIVE_INFINITY;
  }
}
