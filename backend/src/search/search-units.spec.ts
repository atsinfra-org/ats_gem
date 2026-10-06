import { assertMoneyRange, assertRange, lowerBound, upperBoundExclusive } from './date-bounds';
import { dedupKey, MAX_QUERY_LENGTH, normalizeQuery } from './query-normalizer';

describe('normalizeQuery', () => {
  it('returns null for empty or whitespace-only input', () => {
    expect(normalizeQuery(undefined)).toBeNull();
    expect(normalizeQuery('   \n\t ')).toBeNull();
  });

  it('collapses whitespace, lower-cases for matching, keeps the display form', () => {
    const q = normalizeQuery('  Road   CONSTRUCTION \n Pune ')!;
    expect(q.display).toBe('Road CONSTRUCTION Pune');
    expect(q.text).toBe('road construction pune');
    expect(q.tokens).toEqual(['road', 'construction', 'pune']);
  });

  it('splits on punctuation and separators so hyphenated and slashed forms tokenize alike', () => {
    expect(normalizeQuery('road-construction')!.tokens).toEqual(['road', 'construction']);
    expect(normalizeQuery('PWD/2026/0012')!.tokens).toEqual(['pwd', '2026', '0012']);
  });

  it('does not drop stop-words (would silently change intent)', () => {
    expect(normalizeQuery('construction of road')!.tokens).toEqual(['construction', 'of', 'road']);
  });

  it('builds a prefix tsquery from sanitized tokens only', () => {
    expect(normalizeQuery('road constr')!.tsquery).toBe('road:* & constr:*');
  });

  it.each(["'; DROP TABLE tenders;--", 'a & b | !c <-> d', '(((', 'road:*) | (x', '\\'])('never lets query syntax through: %s', (input) => {
    const q = normalizeQuery(input);
    const tsquery = q?.tsquery ?? '';
    expect(tsquery).toMatch(/^([\p{L}\p{N}]+:\*( & )?)*$/u);
  });

  it('supports non-latin scripts', () => {
    expect(normalizeQuery('सड़क निर्माण')!.tokens.length).toBeGreaterThan(0);
  });

  it('derives the reference key (upper-case alphanumerics)', () => {
    expect(normalizeQuery('pwd/2026 - 0012a')!.referenceKey).toBe('PWD20260012A');
  });

  it('rejects over-long queries and caps token count', () => {
    expect(() => normalizeQuery('x'.repeat(MAX_QUERY_LENGTH + 1))).toThrow(RangeError);
    expect(normalizeQuery(Array.from({ length: 40 }, (_, i) => `w${i}`).join(' '))!.tokens).toHaveLength(12);
  });

  it('treats punctuation-only input as having no tokens', () => {
    expect(normalizeQuery('///---')!.tokens).toEqual([]);
  });
});

describe('dedupKey', () => {
  it('is order-independent for filters and distinguishes different searches', () => {
    expect(dedupKey('road', { a: 1, b: 2 })).toBe(dedupKey('road', { b: 2, a: 1 }));
    expect(dedupKey('road', { a: 1 })).not.toBe(dedupKey('road', { a: 2 }));
    expect(dedupKey('road', {})).not.toBe(dedupKey('bridge', {}));
  });
});

describe('date bounds (IST semantics)', () => {
  it('a date-only value is an IST calendar day: inclusive start, exclusive next-day end', () => {
    expect(lowerBound('2026-09-30')!.toISOString()).toBe('2026-09-29T18:30:00.000Z');
    expect(upperBoundExclusive('2026-09-30')!.toISOString()).toBe('2026-09-30T18:30:00.000Z');
  });

  it('from = to on a date-only value covers exactly one day', () => {
    const from = lowerBound('2026-10-05')!;
    const to = upperBoundExclusive('2026-10-05')!;
    expect(to.getTime() - from.getTime()).toBe(86_400_000);
  });

  it('an ISO instant is used as given, with an inclusive upper bound', () => {
    expect(lowerBound('2026-09-30T10:00:00.000Z')!.toISOString()).toBe('2026-09-30T10:00:00.000Z');
    expect(upperBoundExclusive('2026-09-30T10:00:00.000Z')!.toISOString()).toBe('2026-09-30T10:00:00.001Z');
  });

  it('undefined stays undefined', () => {
    expect(lowerBound(undefined)).toBeUndefined();
    expect(upperBoundExclusive(undefined)).toBeUndefined();
  });

  it('rejects inverted ranges but accepts equal same-day ranges and open ends', () => {
    expect(() => assertRange('closing', lowerBound('2026-10-06'), upperBoundExclusive('2026-10-05'))).toThrow();
    expect(() => assertRange('closing', lowerBound('2026-10-05'), upperBoundExclusive('2026-10-05'))).not.toThrow();
    expect(() => assertRange('closing', lowerBound('2026-10-05'), undefined)).not.toThrow();
  });

  it('rejects an inverted money range', () => {
    expect(() => assertMoneyRange('value', '200', '100')).toThrow();
    expect(() => assertMoneyRange('value', '100', '100')).not.toThrow();
  });
});
