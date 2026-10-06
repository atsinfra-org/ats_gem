"use client";
/* eslint-disable react-hooks/set-state-in-effect -- re-seed the form whenever a different search is opened */

import * as React from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FilterPanel, emptyFilters, type FilterState } from "@/components/search/filter-panel";
import { fromCriteria } from "@/lib/search/search-state";
import { updateSavedSearch } from "@/lib/api/saved-searches";
import { ApiError } from "@/lib/api/client";
import type { SavedSearch, SavedSearchCriteria } from "@/lib/api/types";

export function EditSavedSearchDialog({ search, onOpenChange, onSaved }: { search: SavedSearch | null; onOpenChange: (open: boolean) => void; onSaved: (updated: SavedSearch) => void }) {
  const [name, setName] = React.useState("");
  const [keyword, setKeyword] = React.useState("");
  const [filters, setFilters] = React.useState<FilterState>(emptyFilters);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!search) return;
    setName(search.name);
    setKeyword(typeof search.criteria.q === "string" ? search.criteria.q : "");
    const seeded = fromCriteria(search.criteria).filters;
    setFilters({ ...emptyFilters, state: seeded.state, category: seeded.category, status: seeded.status });
    setError(null);
  }, [search]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!search) return;
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    // Only keyword/state/category/status are editable here; every other criterion (dates, ranges, entity, ...) is preserved untouched.
    const criteria: SavedSearchCriteria = {
      ...search.criteria,
      q: keyword.trim() || undefined,
      state: filters.state.length ? filters.state : undefined,
      category: filters.category.length ? filters.category : undefined,
      status: filters.status.length ? filters.status : undefined,
    };
    try {
      const updated = await updateSavedSearch(search.id, name.trim(), criteria);
      onSaved(updated);
      onOpenChange(false);
      toast.success("Saved search updated");
    } catch (err) {
      setError(err instanceof ApiError ? (err.details?.[0]?.message ?? err.message) : "Could not update this saved search.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!search} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit saved search</DialogTitle>
          <DialogDescription>Change the name or criteria used when this search is re-run.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSave} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="edit-search-name">Name</Label>
            <Input id="edit-search-name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!error && !name.trim()} aria-describedby={error ? "edit-search-error" : undefined} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-search-keyword">Keyword</Label>
            <Input id="edit-search-keyword" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          </div>
          <FilterPanel filters={filters} onChange={setFilters} onClear={() => setFilters(emptyFilters)} compact />
          {error && (
            <p id="edit-search-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
