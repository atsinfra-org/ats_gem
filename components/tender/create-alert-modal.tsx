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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useAppStore } from "@/lib/store/app-store";

const channelOptions = ["Email", "SMS", "WhatsApp"];

export function CreateAlertModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { addAlert } = useAppStore();
  const [name, setName] = React.useState("");
  const [criteria, setCriteria] = React.useState("");
  const [frequency, setFrequency] = React.useState<"Instant" | "Daily" | "Weekly">("Instant");
  const [channels, setChannels] = React.useState<string[]>(["Email"]);
  const [saving, setSaving] = React.useState(false);

  async function handleCreate() {
    if (!name.trim()) return;
    setSaving(true);
    await new Promise((r) => setTimeout(r, 500));
    addAlert({ name, criteria, frequency, channels });
    setSaving(false);
    setName("");
    setCriteria("");
    onOpenChange(false);
    toast.success("Alert created");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Tender Alert</DialogTitle>
          <DialogDescription>Get notified automatically when matching tenders are published.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="alert-name">Alert Name</Label>
            <Input id="alert-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Road Works - Maharashtra" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="alert-criteria">Search Criteria</Label>
            <Input id="alert-criteria" value={criteria} onChange={(e) => setCriteria(e.target.value)} placeholder="e.g. Category: Road Works · State: Maharashtra" />
          </div>
          <div className="space-y-1.5">
            <Label>Frequency</Label>
            <Select value={frequency} onValueChange={(v) => setFrequency(v as typeof frequency)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Instant">Instant</SelectItem>
                <SelectItem value="Daily">Daily</SelectItem>
                <SelectItem value="Weekly">Weekly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Notification Channels</Label>
            <div className="flex gap-4">
              {channelOptions.map((c) => (
                <div key={c} className="flex items-center gap-2">
                  <Checkbox
                    id={`ch-${c}`}
                    checked={channels.includes(c)}
                    onCheckedChange={(checked) =>
                      setChannels((prev) => (checked ? [...prev, c] : prev.filter((x) => x !== c)))
                    }
                  />
                  <Label htmlFor={`ch-${c}`} className="text-sm font-normal cursor-pointer">{c}</Label>
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleCreate} loading={saving} disabled={!name.trim()}>Create Alert</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
