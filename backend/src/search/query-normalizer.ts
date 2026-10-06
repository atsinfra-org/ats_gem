import { createHash } from 'node:crypto';

export const MAX_QUERY_LENGTH = 200;
const MAX_TOKENS = 12;
const MAX_TOKEN_LENGTH = 40;

export interface NormalizedQuery {
  /** Trimmed, whitespace-collapsed original text (case preserved) - what the user typed, minus noise. */
  display: string;
  /** Lower-case form used for phrase matching, history and analytics. */
  text: string;
  /** Unicode letter/digit runs, lower-cased. Punctuation and separators (`-`, `/`, `,` ...) split tokens. */
  tokens: string[];
  /** Safe `to_tsquery('simple', ...)` string: prefix-matching tokens AND-ed together. Empty when no tokens. */
  tsquery: string;
  /** Upper-case alphanumerics only - comparable with `tenders.reference_number_normalized`. */
  referenceKey: string;
}

/**
 * Turns raw user input into the pieces the search SQL needs. Nothing here is interpolated into SQL:
 * the `tsquery` string only ever contains `[letters digits]:* & ...` built from sanitized tokens (and is
 * still passed as a bound parameter), so operators such as `!`, `|`, `&`, `<->` typed by a user are
 * treated as separators, never as query syntax. Stop-words are NOT dropped: that would silently alter
 * intent ("of", "and" can be part of a name), and the 'simple' text-search config has no stop-word list.
 * Returns null when the input is empty after normalization; throws `RangeError` when it exceeds the limit.
 */
export function normalizeQuery(raw: string | undefined | null): NormalizedQuery | null {
  if (raw === undefined || raw === null) return null;
  if (raw.length > MAX_QUERY_LENGTH * 2) throw new RangeError(`Search query is too long (max ${MAX_QUERY_LENGTH} characters).`);
  const display = raw.normalize('NFKC').replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!display) return null;
  if (display.length > MAX_QUERY_LENGTH) throw new RangeError(`Search query is too long (max ${MAX_QUERY_LENGTH} characters).`);
  const tokens = (display.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).map((t) => t.slice(0, MAX_TOKEN_LENGTH)).slice(0, MAX_TOKENS);
  return {
    display,
    text: display.toLowerCase(),
    tokens,
    tsquery: tokens.map((t) => `${t}:*`).join(' & '),
    referenceKey: display.toUpperCase().replace(/[^\p{L}\p{N}]/gu, ''),
  };
}

/** Stable key for history de-duplication: same query + same filters (order-independent) => same key. */
export function dedupKey(queryText: string, filters: Record<string, unknown>): string {
  const sorted = Object.keys(filters)
    .sort()
    .map((k) => [k, filters[k]]);
  return createHash('sha256').update(JSON.stringify([queryText, sorted])).digest('hex');
}
