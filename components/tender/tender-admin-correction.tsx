"use client";

import * as React from "react";
import { ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useSession } from "@/lib/auth/session-context";
import { correctTender } from "@/lib/api/admin";
import { ApiError } from "@/lib/api/client";

/** Staff-only inline correction action (backend `tender.correct` permission). Visible for any
 * account with a staff role - the specific permission is still enforced server-side; a staff
 * member without `tender.correct` sees a 403 surfaced as an error toast, not a hidden button
 * (this is coarse UX gating, not the authorization boundary). */
export function TenderAdminCorrection({ tenderId, currentTitle }: { tenderId: string; currentTitle: string }) {
  const { user } = useSession();
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState(currentTitle);
  const [reason, setReason] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  if (!user || user.staffRoles.length === 0) return null;

  async function handleSave() {
    if (!reason.trim()) return;
    setSaving(true);
    try {
      await correctTender(tenderId, { title: title !== currentTitle ? title : undefined }, reason.trim());
      toast.success("Correction saved.");
      setOpen(false);
      setReason("");
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not save this correction.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <ShieldAlert className="h-3.5 w-3.5" /> Admin: Correct
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Correct tender data</DialogTitle>
            <DialogDescription>Every change here is audited with a reason (backend `tender.correct`).</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="correct-title">Title</Label>
              <Input id="correct-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="correct-reason">Reason (required)</Label>
              <Input id="correct-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this correction being made?" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} loading={saving} disabled={!reason.trim()}>
              Save Correction
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
