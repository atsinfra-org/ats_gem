"use client";
/* eslint-disable react-hooks/set-state-in-effect -- history loads when the dialog opens */

import * as React from "react";
import { History, Trash2, Play } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ApiErrorState } from "@/components/states/status-error";
import { clearHistory, deleteHistoryItem, listHistory, type HistoryItem } from "@/lib/api/search";
import { buildChips } from "@/lib/search/chips";
import { fromCriteria, type SearchState } from "@/lib/search/search-state";

function toState(item: HistoryItem): SearchState {
  return fromCriteria({ ...item.filters, q: item.queryNormalized } as Record<string, unknown>);
}

/** The signed-in user's own recent searches (stored server-side, never shared, never recorded for anonymous visitors). */
export function SearchHistoryDialog({ open, onOpenChange, onRun }: { open: boolean; onOpenChange: (open: boolean) => void; onRun: (state: SearchState) => void }) {
  const [items, setItems] = React.useState<HistoryItem[] | null>(null);
  const [error, setError] = React.useState<unknown>(null);
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    if (!open) return;
    const c = new AbortController();
    setItems(null);
    setError(null);
    listHistory(30, c.signal)
      .then(setItems)
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) setError(err);
      });
    return () => c.abort();
  }, [open, tick]);

  async function remove(id: string) {
    try {
      await deleteHistoryItem(id);
      setItems((prev) => prev?.filter((i) => i.id !== id) ?? prev);
    } catch {
      toast.error("Could not remove this search.");
    }
  }

  async function clearAll() {
    try {
      await clearHistory();
      setItems([]);
      toast.success("Search history cleared");
    } catch {
      toast.error("Could not clear your search history.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Search history</DialogTitle>
          <DialogDescription>Only you can see this. Searches you run while signed in are remembered so you can repeat them, and you can remove any of them.</DialogDescription>
        </DialogHeader>
        {error ? (
          <ApiErrorState error={error} onRetry={() => setTick((t) => t + 1)} />
        ) : items === null ? (
          <p className="text-sm text-muted-foreground" role="status">
            Loading...
          </p>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <History className="h-6 w-6 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">No search history yet.</p>
          </div>
        ) : (
          <>
            <ul className="space-y-2">
              {items.map((item) => {
                const state = toState(item);
                const label = item.queryNormalized || "search with filters";
                const detail = buildChips(state)
                  .filter((c) => c.name !== "q")
                  .map((c) => c.label)
                  .join(" · ");
                return (
                  <li key={item.id} className="flex items-start gap-2 rounded-md border border-border p-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{item.queryNormalized || "Filtered search"}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {detail ? `${detail} · ` : ""}
                        {item.searchCount > 1 ? `${item.searchCount} times · ` : ""}
                        {formatDistanceToNow(new Date(item.lastSearchedAt), { addSuffix: true })}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`Run search ${label}`}
                      onClick={() => {
                        onRun(state);
                        onOpenChange(false);
                      }}
                    >
                      <Play className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="outline" aria-label={`Remove search ${label} from history`} onClick={() => remove(item.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                );
              })}
            </ul>
            <Button variant="outline" size="sm" onClick={clearAll} className="self-end">
              Clear all history
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
