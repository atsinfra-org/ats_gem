import { parseDurationToSeconds } from './duration';

describe('parseDurationToSeconds', () => {
  it.each([
    ['30s', 30],
    ['15m', 900],
    ['1h', 3_600],
    ['2d', 172_800],
  ])('parses %s as %d seconds', (input, expected) => {
    expect(parseDurationToSeconds(input)).toBe(expected);
  });

  it.each(['15', '15min', '1w', '', 'abc', '-5m'])('rejects "%s"', (input) => {
    expect(() => parseDurationToSeconds(input)).toThrow(/Invalid duration/);
  });
});
