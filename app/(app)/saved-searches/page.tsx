"use client";
/* eslint-disable react-hooks/set-state-in-effect -- loading flags for fetch-on-mount/param-change effects */

import * as React from "react";
import { useRouter } from "next/navigation";
import { SlidersHorizontal, Play, Trash2, Pencil, Bell } from "lucide-react";
import { EditSavedSearchDialog } from "@/components/saved-searches/edit-saved-search-dialog";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/states/empty-state";
import { ApiErrorState } from "@/components/states/status-error";
import { ConfirmModal } from "@/components/modals/confirm-modal";
import { listSavedSearches, deleteSavedSearch, setSavedSearchAlerts } from "@/lib/api/saved-searches";
import { ApiError } from "@/lib/api/client";
import { buildChips } from "@/lib/search/chips";
import { fromCriteria, toSearchUrl } from "@/lib/search/search-state";
import type { SavedSearch, SavedSearchAlertFrequency } from "@/lib/api/types";

/** Legacy (single-string) and current (list) criteria both go through the same validating parser as the URL. */
function criteriaChips(search: SavedSearch): string[] {
  return buildChips(fromCriteria(search.criteria))
    .filter((c) => c.name !== "q")
    .map((c) => c.label);
}

function runUrl(search: SavedSearch): string {
  return toSearchUrl(fromCriteria(search.criteria));
}

export default function SavedSearchesPage() {
  const router = useRouter();
  const [searches, setSearches] = React.useState<SavedSearch[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<unknown>(null);
  const [deleteId, setDeleteId] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<SavedSearch | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSearches(await listSavedSearches());
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  async function changeAlerts(search: SavedSearch, frequency: SavedSearchAlertFrequency) {
    const previous = search.alertFrequency;
    setSearches((prev) => prev.map((s) => (s.id === search.id ? { ...s, alertFrequency: frequency } : s)));
    try {
      await setSavedSearchAlerts(search.id, frequency);
      toast.success(frequency === "OFF" ? "Alerts turned off" : frequency === "DAILY" ? "You will get a daily digest" : "You will be alerted as new tenders arrive");
    } catch (err) {
      setSearches((prev) => prev.map((s) => (s.id === search.id ? { ...s, alertFrequency: previous } : s)));
      toast.error(err instanceof ApiError ? err.message : "Could not update alerts.");
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    const id = deleteId;
    setDeleteId(null);
    try {
      await deleteSavedSearch(id);
      setSearches((prev) => prev.filter((s) => s.id !== id));
      toast.success("Saved search deleted");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not delete this saved search.");
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Saved Searches</h1>
        <p className="mt-1 text-sm text-muted-foreground">Re-run a saved search whenever you need it.</p>
      </div>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : error ? (
        <ApiErrorState error={error} onRetry={load} />
      ) : searches.length === 0 ? (
        <EmptyState
          icon={SlidersHorizontal}
          title="No saved searches"
          description="Save a search from the tender search page to quickly re-run it later."
          actionLabel="Search Tenders"
          actionHref="/tenders"
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {searches.map((search) => (
            <Card key={search.id} className="p-5">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold text-foreground">{search.name}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">{search.criteria.q ? `Keyword: ${search.criteria.q}` : "No keyword"}</p>
              </div>

              {criteriaChips(search).length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {criteriaChips(search).map((f) => (
                    <span key={f} className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                      {f}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
                <label htmlFor={`alerts-${search.id}`} className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <Bell className="h-3.5 w-3.5" aria-hidden /> Alerts
                </label>
                <select
                  id={`alerts-${search.id}`}
                  aria-label={`Alerts for ${search.name}`}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  value={search.alertFrequency ?? "OFF"}
                  onChange={(e) => void changeAlerts(search, e.target.value as SavedSearchAlertFrequency)}
                >
                  <option value="OFF">Off</option>
                  <option value="IMMEDIATE">As new tenders arrive</option>
                  <option value="DAILY">Daily digest</option>
                </select>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Updated {formatDistanceToNow(new Date(search.updatedAt), { addSuffix: true })}
              </p>

              <div className="mt-4 flex gap-2">
                <Button size="sm" className="flex-1" onClick={() => router.push(runUrl(search))}>
                  <Play className="h-3.5 w-3.5" /> Run Search
                </Button>
                <Button size="sm" variant="outline" aria-label={`Edit ${search.name}`} onClick={() => setEditing(search)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="outline" aria-label={`Delete ${search.name}`} onClick={() => setDeleteId(search.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <EditSavedSearchDialog search={editing} onOpenChange={(o) => !o && setEditing(null)} onSaved={(u) => setSearches((prev) => prev.map((x) => (x.id === u.id ? u : x)))} />

      <ConfirmModal
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Delete Saved Search?"
        description="This will permanently remove this saved search."
        confirmLabel="Delete"
        onConfirm={handleDelete}
      />
    </div>
  );
}
