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
import { useAppStore } from "@/lib/store/app-store";

export function SaveSearchModal({
  open,
  onOpenChange,
  keywords,
  filterSummary,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  keywords: string;
  filterSummary: string[];
}) {
  const { addSavedSearch } = useAppStore();
  const [name, setName] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    await new Promise((r) => setTimeout(r, 500));
    addSavedSearch({ name, keywords, filters: filterSummary, alertsEnabled: true });
    setSaving(false);
    setName("");
    onOpenChange(false);
    toast.success("Search saved");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save this search</DialogTitle>
          <DialogDescription>
            We&apos;ll notify you whenever new tenders match this search criteria.
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
          {filterSummary.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {filterSummary.map((f) => (
                <span key={f} className="rounded-full bg-secondary px-2.5 py-1 text-xs text-secondary-foreground">
                  {f}
                </span>
              ))}
            </div>
          )}
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
