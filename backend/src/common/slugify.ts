import { randomBytes } from 'node:crypto';

/** Lower-case, hyphenated, ASCII-only. Never empty — falls back to a random token. */
export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || randomBytes(4).toString('hex');
}

/** Appends a short random suffix — used to resolve a slug collision without a retry loop reading the DB twice. */
export function withRandomSuffix(slug: string): string {
  return `${slug}-${randomBytes(3).toString('hex')}`;
}
