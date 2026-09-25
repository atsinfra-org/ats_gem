export interface IndexResult {
  indexed: boolean;
  /** Why nothing was written, when `indexed` is false. */
  reason?: string;
}

/**
 * Keeps the search backend in sync with tenders. Called from the `search.index-tender` job that
 * the outbox emits for tender.created / updated / closed, so indexing is asynchronous and retried.
 * Implementations must be idempotent: the same event may be delivered more than once.
 */
export abstract class SearchIndexer {
  abstract readonly provider: string;
  abstract indexTender(tenderId: string): Promise<IndexResult>;
}
