import { stateCodeFor } from './india-states';
import { cleanText, normalizeReference, parseIndianAmount, parseIstDateTime, ParseError } from './parsers';

describe('parseIndianAmount', () => {
  it.each([
    ['1,23,45,678.50', '12345678.50'],
    ['₹ 1,23,45,678.5', '12345678.50'],
    ['Rs. 5,000/-', '5000.00'],
    ['INR 750', '750.00'],
    ['0', '0.00'],
    ['007.05', '7.05'],
    // Beyond Number.MAX_SAFE_INTEGER: stays exact because no float is involved.
    ['9,99,99,99,99,99,99,999.99', '9999999999999999.99'],
    // Word-based lakh/crore notation (Phase 3): exact scaling, never floating-point.
    ['10 lakh', '1000000.00'],
    ['10L', '1000000.00'],
    ['10l', '1000000.00'],
    ['1 Crore', '10000000.00'],
    ['1.5 Cr', '15000000.00'],
    ['₹1.5 Cr', '15000000.00'],
    ['2.5 lakhs', '250000.00'],
    ['1.256 lakh', '125600.00'],
    ['1.2567 lakh', '125670.00'],
  ])('%s → %s', (input, expected) => {
    expect(parseIndianAmount(input)).toBe(expected);
  });

  it.each(['', 'NA', 'n/a', '-', 'Nil'])('treats "%s" as no value', (input) => {
    expect(parseIndianAmount(input)).toBeUndefined();
  });

  it.each(['12.345', 'abc', '1,2,3.4.5', '-100'])('rejects "%s"', (input) => {
    expect(() => parseIndianAmount(input)).toThrow(ParseError);
  });
});

describe('parseIstDateTime', () => {
  it('converts IST to UTC', () => {
    expect(parseIstDateTime('24-Sep-2026 03:00 PM')).toBe('2026-09-24T09:30:00.000Z');
    expect(parseIstDateTime('01-Jan-2027 12:15 AM')).toBe('2026-12-31T18:45:00.000Z');
    expect(parseIstDateTime('01-Jan-2027 12:15 PM')).toBe('2027-01-01T06:45:00.000Z');
  });

  it('accepts 24-hour times and bare dates (midnight IST)', () => {
    expect(parseIstDateTime('05-Oct-2026 17:45')).toBe('2026-10-05T12:15:00.000Z');
    expect(parseIstDateTime('05-Oct-2026')).toBe('2026-10-04T18:30:00.000Z');
  });

  it('returns undefined for placeholders', () => {
    expect(parseIstDateTime('NA')).toBeUndefined();
    expect(parseIstDateTime(undefined)).toBeUndefined();
  });

  it.each(['31-Feb-2026 10:00 AM', '24-Foo-2026', '2026-09-24', '24-Sep-2026 13:00 PM', '24-Sep-2026 10:75'])(
    'rejects "%s"',
    (input) => {
      expect(() => parseIstDateTime(input)).toThrow(ParseError);
    },
  );
});

describe('text helpers', () => {
  it('normalizes reference numbers for cross-source matching', () => {
    expect(normalizeReference('PWD/2026/ 0012-a')).toBe('PWD20260012A');
  });

  it('cleans whitespace and placeholders', () => {
    expect(cleanText('  Road \n works  ')).toBe('Road works');
    expect(cleanText('N/A')).toBeUndefined();
    expect(cleanText(42)).toBeUndefined();
  });

  it('maps state names (including historical spellings) to codes', () => {
    expect(stateCodeFor('Tamil Nadu')).toBe('TN');
    expect(stateCodeFor('ORISSA')).toBe('OD');
    expect(stateCodeFor('Jammu & Kashmir')).toBe('JK');
    expect(stateCodeFor('Atlantis')).toBeUndefined();
    expect(stateCodeFor(undefined)).toBeUndefined();
  });
});
