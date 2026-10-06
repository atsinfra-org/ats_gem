"use client";

import * as React from "react";
import { Search, Merge } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { EmptyState } from "@/components/states/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { listProcuringEntities, mergeProcuringEntities } from "@/lib/api/admin";
import { ApiError } from "@/lib/api/client";
import type { ProcuringEntity } from "@/lib/api/types";

export default function ProcuringEntitiesAdminPage() {
  const [items, setItems] = React.useState<ProcuringEntity[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [mergeSource, setMergeSource] = React.useState<ProcuringEntity | null>(null);
  const [targetId, setTargetId] = React.useState("");
  const [merging, setMerging] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listProcuringEntities({ search: search || undefined, pageSize: 50 });
      setItems(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load procuring entities.");
    } finally {
      setLoading(false);
    }
  }, [search]);

  React.useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  async function handleMerge() {
    if (!mergeSource || !targetId) return;
    setMerging(true);
    try {
      await mergeProcuringEntities(mergeSource.id, targetId);
      toast.success(`Merged "${mergeSource.name}" into the target entity.`);
      setMergeSource(null);
      setTargetId("");
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Merge failed.");
    } finally {
      setMerging(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Procuring Entities</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Entities resolved by the deduplication engine (backend Phase 3). Merging never deletes a row - the losing entity is kept and marked merged.
        </p>
      </div>

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name..." className="pl-9" />
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : error ? (
        <EmptyState icon={Search} title="Could not load entities" description={error} actionLabel="Retry" onAction={load} />
      ) : items.length === 0 ? (
        <EmptyState icon={Search} title="No procuring entities found" description="Try a different search term." />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5">Name</th>
                <th className="px-4 py-2.5">State</th>
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((entity) => (
                <tr key={entity.id}>
                  <td className="px-4 py-3 font-medium text-foreground">{entity.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{entity.stateCode ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{entity.entityType}</td>
                  <td className="px-4 py-3">
                    <Badge variant={entity.status === "MERGED" ? "secondary" : "default"}>{entity.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {entity.status === "ACTIVE" && (
                      <Button size="sm" variant="outline" onClick={() => setMergeSource(entity)}>
                        <Merge className="h-3.5 w-3.5" /> Merge
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!mergeSource} onOpenChange={(open) => !open && setMergeSource(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Merge &quot;{mergeSource?.name}&quot;</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor="target-entity-id" className="text-sm font-medium text-foreground">
              Target entity ID (surviving entity)
            </label>
            <Input id="target-entity-id" value={targetId} onChange={(e) => setTargetId(e.target.value)} placeholder="UUID of the entity to keep" />
            <p className="text-xs text-muted-foreground">
              This is deliberately a manual ID entry, not a picker - merges are irreversible in effect (though the losing row is kept, not deleted) and should be a deliberate action.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMergeSource(null)}>
              Cancel
            </Button>
            <Button onClick={handleMerge} loading={merging} disabled={!targetId}>
              Merge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
