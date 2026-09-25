const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};
const IST_OFFSET_MINUTES = 5 * 60 + 30;
const EMPTY = new Set(['', '-', 'na', 'n/a', 'nil', 'not applicable']);

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

/**
 * Parses Indian-formatted amounts ("₹ 1,23,45,678.5", "Rs. 5,000/-") into an exact decimal string
 * with two places ("12345678.50"). Empty markers ("NA", "-") return undefined. No floats involved.
 */
export function parseIndianAmount(input: string | undefined | null): string | undefined {
  if (input === undefined || input === null) return undefined;
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/^(₹|rs\.?|inr)\s*/, '')
    .replace(/\/-$/, '')
    .replace(/,/g, '')
    .trim();
  if (EMPTY.has(cleaned)) return undefined;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) throw new ParseError(`Unrecognised amount "${input}"`);
  const whole = match[1].replace(/^0+(?=\d)/, '');
  const fraction = (match[2] ?? '').padEnd(2, '0');
  return `${whole}.${fraction}`;
}

/**
 * Parses portal date-times such as "24-Sep-2026 03:00 PM" (IST, as Indian portals publish them)
 * into an ISO-8601 UTC string.
 */
export function parseIstDateTime(input: string | undefined | null): string | undefined {
  if (input === undefined || input === null) return undefined;
  const value = input.trim();
  if (EMPTY.has(value.toLowerCase())) return undefined;
  const match = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{1,2}):(\d{2})(?:\s*([AaPp][Mm]))?)?$/.exec(value);
  if (!match) throw new ParseError(`Unrecognised date "${input}"`);
  const [, dd, mon, yyyy, hh = '0', mm = '0', meridiem] = match;
  const month = MONTHS[mon.toLowerCase()];
  if (month === undefined) throw new ParseError(`Unrecognised month in "${input}"`);
  let hour = Number(hh);
  if (meridiem) {
    if (hour < 1 || hour > 12) throw new ParseError(`Invalid hour in "${input}"`);
    hour = (hour % 12) + (meridiem.toLowerCase() === 'pm' ? 12 : 0);
  }
  const day = Number(dd);
  const utcMs = Date.UTC(Number(yyyy), month, day, hour, Number(mm)) - IST_OFFSET_MINUTES * 60_000;
  const check = new Date(utcMs + IST_OFFSET_MINUTES * 60_000);
  if (check.getUTCDate() !== day || check.getUTCMonth() !== month || Number(mm) > 59 || hour > 23) {
    throw new ParseError(`Invalid date "${input}"`);
  }
  return new Date(utcMs).toISOString();
}

/** Reference numbers compared across sources: upper-case, alphanumerics only. */
export function normalizeReference(reference: string): string {
  return reference.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Collapses whitespace and trims; returns undefined for empty or placeholder values. */
export function cleanText(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined;
  const value = input.replace(/\s+/g, ' ').trim();
  return EMPTY.has(value.toLowerCase()) ? undefined : value;
}
