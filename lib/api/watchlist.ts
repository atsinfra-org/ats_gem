import { apiRequest } from "./client";
import type { WatchlistItem } from "./types";

export async function listWatchlist(): Promise<WatchlistItem[]> {
  return apiRequest<WatchlistItem[]>("/watchlist");
}

export async function addToWatchlist(tenderId: string, note?: string): Promise<WatchlistItem> {
  return apiRequest<WatchlistItem>("/watchlist", { method: "POST", body: { tenderId, note } });
}

export async function removeFromWatchlist(tenderId: string): Promise<void> {
  await apiRequest(`/watchlist/${tenderId}`, { method: "DELETE" });
}
