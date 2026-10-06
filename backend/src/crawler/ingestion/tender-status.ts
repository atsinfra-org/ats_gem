import type { TenderLifecycle, TenderStatus } from '../../generated/prisma/enums';

/** Tenders closing within this window are shown as CLOSING_SOON. */
export const CLOSING_SOON_MS = 3 * 86_400_000;

export interface StatusInput {
  lifecycle: TenderLifecycle;
  publishedAt: Date;
  closingAt: Date | null;
}

/**
 * Derives the display status from lifecycle and dates (docs/DATABASE.md §5). Stored on the row so
 * it can be indexed and filtered; recomputed on every ingestion and, from Phase 3, by a periodic job.
 */
export function computeTenderStatus(input: StatusInput, now: Date): TenderStatus {
  switch (input.lifecycle) {
    case 'CANCELLED':
      return 'CANCELLED';
    case 'AWARDED':
      return 'AWARDED';
    case 'ARCHIVED':
      return 'ARCHIVED';
    case 'ACTIVE':
      break;
  }
  const t = now.getTime();
  if (input.publishedAt.getTime() > t) return 'UPCOMING';
  if (!input.closingAt) return 'OPEN';
  const remaining = input.closingAt.getTime() - t;
  if (remaining <= 0) return 'CLOSED';
  return remaining <= CLOSING_SOON_MS ? 'CLOSING_SOON' : 'OPEN';
}
