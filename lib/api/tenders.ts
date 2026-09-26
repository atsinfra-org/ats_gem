import { apiRequest, apiRequestWithMeta } from "./client";
import type { Pagination, TenderDetail, TenderSummary } from "./types";

export interface TenderSearchResult {
  items: TenderSummary[];
  pagination: Pagination;
  /** The sort the server actually applied (relevance falls back to newest when there is no keyword). */
  sort?: string;
  ranked?: boolean;
}

/**
 * `params` is built by `toApiParams` (lib/search/search-state.ts) from the URL-backed search state; only
 * filters the backend really supports exist there (docs/API-CONTRACT.md §5).
 */
export async function searchTenders(params: Record<string, string | number | undefined>, signal?: AbortSignal): Promise<TenderSearchResult> {
  // Not `anonymous: true`: a signed-in caller's token is attached when present so `isSaved` reflects
  // their real watchlist and the search lands in their history; the endpoint works without a token too.
  const { data, meta } = await apiRequestWithMeta<TenderSummary[]>("/search/tenders", { query: params, signal });
  return { items: data, pagination: meta.pagination as Pagination, sort: meta.sort as string | undefined, ranked: meta.ranked as boolean | undefined };
}

export async function getTender(id: string): Promise<TenderDetail> {
  return apiRequest<TenderDetail>(`/tenders/${id}`);
}
