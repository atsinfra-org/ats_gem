"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { SlidersHorizontal, Play, Trash2, BellRing } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/states/empty-state";
import { ConfirmModal } from "@/components/modals/confirm-modal";
import { useAppStore } from "@/lib/store/app-store";

export default function SavedSearchesPage() {
  const router = useRouter();
  const { savedSearches, removeSavedSearch } = useAppStore();
  const [deleteId, setDeleteId] = React.useState<string | null>(null);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Saved Searches</h1>
        <p className="mt-1 text-sm text-muted-foreground">Re-run your searches or convert them into alerts.</p>
      </div>

      {savedSearches.length === 0 ? (
        <EmptyState
          icon={SlidersHorizontal}
          title="No saved searches"
          description="Save a search from the tender search page to quickly re-run it later."
          actionLabel="Search Tenders"
          actionHref="/tenders"
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {savedSearches.map((search) => (
            <Card key={search.id} className="p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-foreground">{search.name}</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">Keywords: {search.keywords || "—"}</p>
                </div>
                <span className="shrink-0 rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-foreground">
                  {search.matchCount} matches
                </span>
              </div>

              {search.filters.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {search.filters.map((f) => (
                    <span key={f} className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                      {f}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <BellRing className="h-3.5 w-3.5" />
                  Alerts
                  <Switch checked={search.alertsEnabled} onCheckedChange={() => toast.success("Alert preference updated")} />
                </div>
                <p className="text-xs text-muted-foreground">
                  Updated {formatDistanceToNow(new Date(search.lastUpdated), { addSuffix: true })}
                </p>
              </div>

              <div className="mt-4 flex gap-2">
                <Button size="sm" className="flex-1" onClick={() => router.push(`/tenders?keyword=${encodeURIComponent(search.keywords)}`)}>
                  <Play className="h-3.5 w-3.5" /> Run Search
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDeleteId(search.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <ConfirmModal
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Delete Saved Search?"
        description="This will permanently remove this saved search and its alert configuration."
        confirmLabel="Delete"
        onConfirm={() => {
          if (deleteId) {
            removeSavedSearch(deleteId);
            toast.success("Saved search deleted");
          }
        }}
      />
    </div>
  );
}
