import { computeTenderStatus } from './tender-status';

const now = new Date('2026-09-24T06:00:00Z');
const day = 86_400_000;
const at = (offsetMs: number) => new Date(now.getTime() + offsetMs);

describe('computeTenderStatus', () => {
  it('uses the lifecycle for terminal states regardless of dates', () => {
    const dates = { publishedAt: at(-day), closingAt: at(10 * day) };
    expect(computeTenderStatus({ lifecycle: 'CANCELLED', ...dates }, now)).toBe('CANCELLED');
    expect(computeTenderStatus({ lifecycle: 'AWARDED', ...dates }, now)).toBe('AWARDED');
    expect(computeTenderStatus({ lifecycle: 'ARCHIVED', ...dates }, now)).toBe('ARCHIVED');
  });

  it.each([
    ['UPCOMING', at(day), at(10 * day)],
    ['OPEN', at(-day), at(10 * day)],
    ['OPEN', at(-day), null],
    ['CLOSING_SOON', at(-day), at(3 * day)],
    ['CLOSING_SOON', at(-day), at(60_000)],
    ['CLOSED', at(-10 * day), now],
    ['CLOSED', at(-10 * day), at(-day)],
  ])('%s when published %s and closing %s', (expected, publishedAt, closingAt) => {
    expect(computeTenderStatus({ lifecycle: 'ACTIVE', publishedAt, closingAt }, now)).toBe(expected);
  });
});
