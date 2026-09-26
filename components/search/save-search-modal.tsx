"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSavedSearch } from "@/lib/api/saved-searches";
import { ApiError } from "@/lib/api/client";
import type { FilterState } from "@/components/search/filter-panel";
import { buildChips, type LabelLookup } from "@/lib/search/chips";
import { toCriteria, type SortKey } from "@/lib/search/search-state";
import type { SavedSearchAlertFrequency, SavedSearchCriteria } from "@/lib/api/types";

export function SaveSearchModal({
  open,
  onOpenChange,
  keyword,
  filters,
  sort = "relevance",
  lookup,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  keyword: string;
  filters: FilterState;
  sort?: SortKey;
  lookup?: LabelLookup;
  onSaved?: () => void;
}) {
  const [name, setName] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [alerts, setAlerts] = React.useState<SavedSearchAlertFrequency>("OFF");
  const [error, setError] = React.useState<string | null>(null);

  const searchState = { q: keyword, filters, sort, page: 1 };
  const summary = buildChips(searchState, lookup).map((c) => c.label);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    const criteria = toCriteria(searchState) as SavedSearchCriteria;
    try {
      await createSavedSearch(name.trim(), criteria, alerts);
      setName("");
      setAlerts("OFF");
      onOpenChange(false);
      toast.success("Search saved");
      onSaved?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save this search.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save this search</DialogTitle>
          <DialogDescription>
            Save these criteria to quickly re-run this search later from Saved Searches.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="search-name">Search Name</Label>
            <Input
              id="search-name"
              placeholder="e.g. Road Works - Maharashtra"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="search-alerts">Alerts</Label>
            <select id="search-alerts" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={alerts} onChange={(e) => setAlerts(e.target.value as SavedSearchAlertFrequency)}>
              <option value="OFF">Off (no alerts)</option>
              <option value="IMMEDIATE">Alert me as new tenders arrive</option>
              <option value="DAILY">Daily digest</option>
            </select>
            <p className="text-xs text-muted-foreground">Alerts are in-app and by email according to your notification preferences. You can change this later under Saved Searches.</p>
          </div>
          {summary.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {summary.map((f) => (
                <span key={f} className="rounded-full bg-secondary px-2.5 py-1 text-xs text-secondary-foreground">
                  {f}
                </span>
              ))}
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} loading={saving} disabled={!name.trim()}>
            Save Search
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
