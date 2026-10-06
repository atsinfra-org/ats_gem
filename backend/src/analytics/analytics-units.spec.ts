import { ANALYTICS_METADATA_SCHEMAS } from './analytics-event-schemas';
import { parseRange } from './analytics-query.service';
import { ROLLUP_METRICS } from './analytics-rollup.service';
import { AppError } from '../common/errors/app-error';

const T = '0198c1a2-3b4c-7d5e-8f60-123456789abc';

describe('analytics event metadata schemas', () => {
  it('every event name has a schema and it rejects unknown keys (closed shape)', () => {
    for (const schema of Object.values(ANALYTICS_METADATA_SCHEMAS)) {
      expect(schema.safeParse({ notAllowed: 'x' }).success).toBe(false);
    }
  });

  it('TENDER_VIEWED requires a tender id and accepts a bounded source enum only', () => {
    const s = ANALYTICS_METADATA_SCHEMAS.TENDER_VIEWED;
    expect(s.safeParse({ tenderId: T, source: 'search' }).success).toBe(true);
    expect(s.safeParse({ tenderId: T, source: 'malicious-source' }).success).toBe(false);
    expect(s.safeParse({ tenderId: 'not-a-uuid' }).success).toBe(false);
    expect(s.safeParse({}).success).toBe(false);
  });

  it('DOCUMENT_DOWNLOADED cannot carry document contents or arbitrary fields', () => {
    const s = ANALYTICS_METADATA_SCHEMAS.DOCUMENT_DOWNLOADED;
    expect(s.safeParse({ tenderId: T, documentId: T, documentType: 'NIT' }).success).toBe(true);
    expect(s.safeParse({ tenderId: T, documentId: T, fileContents: 'base64...' }).success).toBe(false);
  });

  it('CLIENT_ERROR and API_ERROR bound their string fields', () => {
    expect(ANALYTICS_METADATA_SCHEMAS.CLIENT_ERROR.safeParse({ message: 'x'.repeat(121) }).success).toBe(false);
    expect(ANALYTICS_METADATA_SCHEMAS.CLIENT_ERROR.safeParse({ message: 'x'.repeat(120) }).success).toBe(true);
    expect(ANALYTICS_METADATA_SCHEMAS.API_ERROR.safeParse({ code: 'NOT_FOUND', status: 404 }).success).toBe(true);
    expect(ANALYTICS_METADATA_SCHEMAS.API_ERROR.safeParse({ code: 'X', status: 999 }).success).toBe(false);
  });

  it('events with no meaningful metadata accept only an empty object', () => {
    expect(ANALYTICS_METADATA_SCHEMAS.LOGOUT.safeParse({}).success).toBe(true);
    expect(ANALYTICS_METADATA_SCHEMAS.LOGOUT.safeParse({ anything: 1 }).success).toBe(false);
  });
});

describe('parseRange', () => {
  it('defaults to the trailing 30 days ending today', () => {
    const r = parseRange(undefined, undefined);
    expect((r.to.getTime() - r.from.getTime()) / 86_400_000).toBe(29);
  });

  it('accepts an explicit range', () => {
    const r = parseRange('2026-09-01', '2026-09-10');
    expect(r.from.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-09-10T00:00:00.000Z');
  });

  it('rejects an inverted range, a malformed date and a range wider than 366 days', () => {
    expect(() => parseRange('2026-09-10', '2026-09-01')).toThrow(AppError);
    expect(() => parseRange('not-a-date', '2026-09-10')).toThrow(AppError);
    expect(() => parseRange('2024-01-01', '2026-06-01')).toThrow(AppError);
  });
});

describe('rollup metrics', () => {
  it('is a closed, non-empty list with no duplicates', () => {
    expect(ROLLUP_METRICS.length).toBeGreaterThan(0);
    expect(new Set(ROLLUP_METRICS).size).toBe(ROLLUP_METRICS.length);
  });
});
