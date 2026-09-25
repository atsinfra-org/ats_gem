const LEGAL_SUFFIXES = /\b(pvt\.?|private|ltd\.?|limited|llp|inc\.?|ltd|corp\.?|corporation)\b/g;

/**
 * Deterministic normalization key for procuring-entity names (docs/ARCHITECTURE.md Sec 19.2):
 * lower-case, Unicode NFKD + strip diacritics, collapse punctuation/whitespace to single spaces,
 * drop common legal suffixes. Two names normalize equal only when they are almost certainly the
 * same organization written differently - this key drives EXACT_NORMALIZED_NAME resolution, so it
 * must never be so aggressive that unrelated entities collide.
 */
export function normalizeEntityName(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.,()/\\-]+/g, ' ')
    .replace(LEGAL_SUFFIXES, ' ')
    .replace(/[^a-z0-9&\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
