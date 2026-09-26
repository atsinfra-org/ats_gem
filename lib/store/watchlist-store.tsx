"use client";
/* eslint-disable react-hooks/set-state-in-effect -- loading flags for fetch-on-mount/param-change effects */

import * as React from "react";
import { toast } from "sonner";
import { useSession } from "@/lib/auth/session-context";
import { addToWatchlist, listWatchlist, removeFromWatchlist } from "@/lib/api/watchlist";
import { ApiError } from "@/lib/api/client";

interface WatchlistValue {
  savedTenderIds: Set<string>;
  isSaved: (tenderId: string) => boolean;
  /** Optimistic: flips immediately, rolls back and toasts on failure. Resolves once settled. */
  toggle: (tenderId: string) => Promise<void>;
  loading: boolean;
}

const WatchlistContext = React.createContext<WatchlistValue | null>(null);

export function WatchlistProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useSession();
  const [savedTenderIds, setSavedTenderIds] = React.useState<Set<string>>(new Set());
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!isAuthenticated) {
      setSavedTenderIds(new Set());
      return;
    }
    let cancelled = false;
    setLoading(true);
    listWatchlist()
      .then((items) => {
        if (!cancelled) setSavedTenderIds(new Set(items.map((i) => i.tenderId)));
      })
      .catch(() => {
        /* Silent - the watchlist page itself surfaces a real error state on load failure. */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  const isSaved = React.useCallback((tenderId: string) => savedTenderIds.has(tenderId), [savedTenderIds]);

  const toggle = React.useCallback(
    async (tenderId: string) => {
      if (!isAuthenticated) {
        toast.error("Log in to save tenders.");
        return;
      }
      const wasSaved = savedTenderIds.has(tenderId);
      setSavedTenderIds((prev) => {
        const next = new Set(prev);
        if (wasSaved) next.delete(tenderId);
        else next.add(tenderId);
        return next;
      });
      try {
        if (wasSaved) await removeFromWatchlist(tenderId);
        else await addToWatchlist(tenderId);
      } catch (err) {
        setSavedTenderIds((prev) => {
          const next = new Set(prev);
          if (wasSaved) next.add(tenderId);
          else next.delete(tenderId);
          return next;
        });
        toast.error(err instanceof ApiError ? err.message : "Could not update saved tenders.");
      }
    },
    [isAuthenticated, savedTenderIds],
  );

  return <WatchlistContext.Provider value={{ savedTenderIds, isSaved, toggle, loading }}>{children}</WatchlistContext.Provider>;
}

export function useWatchlist() {
  const ctx = React.useContext(WatchlistContext);
  if (!ctx) throw new Error("useWatchlist must be used within WatchlistProvider");
  return ctx;
}
