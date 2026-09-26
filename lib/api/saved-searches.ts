import { apiRequest } from "./client";
import type { SavedSearch, SavedSearchAlertFrequency, SavedSearchCriteria } from "./types";

export function listSavedSearches(): Promise<SavedSearch[]> {
  return apiRequest<SavedSearch[]>("/saved-searches");
}

export function createSavedSearch(name: string, criteria: SavedSearchCriteria, alertFrequency?: SavedSearchAlertFrequency): Promise<SavedSearch> {
  return apiRequest<SavedSearch>("/saved-searches", { method: "POST", body: { name, criteria, ...(alertFrequency ? { alertFrequency } : {}) } });
}

export function setSavedSearchAlerts(id: string, alertFrequency: SavedSearchAlertFrequency): Promise<SavedSearch> {
  return apiRequest<SavedSearch>(`/saved-searches/${id}`, { method: "PATCH", body: { alertFrequency } });
}

export function updateSavedSearch(id: string, name: string, criteria: SavedSearchCriteria): Promise<SavedSearch> {
  return apiRequest<SavedSearch>(`/saved-searches/${id}`, { method: "PATCH", body: { name, criteria } });
}

export async function deleteSavedSearch(id: string): Promise<void> {
  await apiRequest(`/saved-searches/${id}`, { method: "DELETE" });
}
