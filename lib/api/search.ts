import { apiRequest } from "./client";

export interface Suggestions {
  recent: { id: string; query: string }[];
  references: { tenderId: string; reference: string; title: string }[];
  entities: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  states: { code: string; name: string }[];
  popular: { query: string }[];
}

export interface HistoryItem {
  id: string;
  queryNormalized: string;
  filters: Record<string, unknown>;
  searchCount: number;
  lastSearchedAt: string;
}

export interface EntityOption {
  id: string;
  name: string;
  stateCode: string | null;
}

export type SearchEventType = "SEARCH_SUBMITTED" | "FILTER_APPLIED" | "FILTER_REMOVED" | "SORT_CHANGED" | "RESULT_OPENED" | "RESULT_SAVED" | "SEARCH_SAVED" | "SUGGESTION_SELECTED";

export interface SearchEventInput {
  type: SearchEventType;
  query?: string;
  name?: string;
  value?: string;
  tenderId?: string;
  position?: number;
  resultCount?: number;
}

export function getSuggestions(q: string, signal?: AbortSignal): Promise<Suggestions> {
  return apiRequest<Suggestions>("/search/suggestions", { query: { q }, signal });
}

export function searchEntities(q: string, signal?: AbortSignal): Promise<EntityOption[]> {
  return apiRequest<EntityOption[]>("/search/entities", { query: { q }, signal, anonymous: true });
}

export function listHistory(limit = 10, signal?: AbortSignal): Promise<HistoryItem[]> {
  return apiRequest<HistoryItem[]>("/search/history", { query: { limit }, signal });
}

export async function deleteHistoryItem(id: string): Promise<void> {
  await apiRequest(`/search/history/${id}`, { method: "DELETE" });
}

export async function clearHistory(): Promise<void> {
  await apiRequest("/search/history", { method: "DELETE" });
}

/** Fire-and-forget analytics: never throws, never blocks the UI (a failed event is simply dropped). */
export function recordSearchEvent(event: SearchEventInput): void {
  void apiRequest("/search/events", { method: "POST", body: event, timeoutMs: 5_000 }).catch(() => undefined);
}

export interface CityOption {
  name: string;
  count: number;
}

export function searchCities(q: string, state: string[] | undefined, signal?: AbortSignal): Promise<CityOption[]> {
  return apiRequest<CityOption[]>("/search/cities", { query: { q, state: state?.length === 1 ? state[0] : undefined }, signal, anonymous: true });
}

export function getEntitiesByIds(ids: string[], signal?: AbortSignal): Promise<EntityOption[]> {
  return apiRequest<EntityOption[]>("/search/entities", { query: { ids: ids.join(",") }, signal, anonymous: true });
}
