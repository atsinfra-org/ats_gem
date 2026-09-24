"use client";

import * as React from "react";
import { Plus, BellRing, Pause, Play, Trash2, Mail } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/states/empty-state";
import { ConfirmModal } from "@/components/modals/confirm-modal";
import { CreateAlertModal } from "@/components/tender/create-alert-modal";
import { useAppStore } from "@/lib/store/app-store";

export default function AlertsPage() {
  const { alerts, toggleAlertStatus, removeAlert } = useAppStore();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [pauseId, setPauseId] = React.useState<string | null>(null);
  const [deleteId, setDeleteId] = React.useState<string | null>(null);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Tender Alerts</h1>
          <p className="mt-1 text-sm text-muted-foreground">Automated notifications for tenders matching your criteria.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> Create Alert
        </Button>
      </div>

      {alerts.length === 0 ? (
        <EmptyState
          icon={BellRing}
          title="No alerts configured"
          description="Create your first alert to get notified the moment matching tenders are published."
          actionLabel="Create Alert"
          onAction={() => setCreateOpen(true)}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {alerts.map((alert) => (
            <Card key={alert.id} className="p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-foreground">{alert.name}</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">{alert.criteria}</p>
                </div>
                <Badge variant={alert.status === "active" ? "success" : "secondary"}>
                  {alert.status === "active" ? "Active" : "Paused"}
                </Badge>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Mail className="h-3.5 w-3.5" /> {alert.channels.join(", ")}
                </span>
                <span>·</span>
                <span>{alert.frequency}</span>
                <span>·</span>
                <span>
                  {alert.lastTriggered
                    ? `Last triggered ${formatDistanceToNow(new Date(alert.lastTriggered), { addSuffix: true })}`
                    : "Never triggered"}
                </span>
              </div>

              <div className="mt-4 flex gap-2 border-t border-border pt-3">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => setPauseId(alert.id)}
                >
                  {alert.status === "active" ? (
                    <><Pause className="h-3.5 w-3.5" /> Pause</>
                  ) : (
                    <><Play className="h-3.5 w-3.5" /> Resume</>
                  )}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDeleteId(alert.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <CreateAlertModal open={createOpen} onOpenChange={setCreateOpen} />

      <ConfirmModal
        open={!!pauseId}
        onOpenChange={(open) => !open && setPauseId(null)}
        destructive={false}
        title="Change alert status?"
        description="You can resume this alert at any time from this page."
        confirmLabel="Confirm"
        onConfirm={() => {
          if (pauseId) {
            toggleAlertStatus(pauseId);
            toast.success("Alert status updated");
          }
        }}
      />

      <ConfirmModal
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Delete Alert?"
        description="This will permanently delete this alert. You will stop receiving notifications for it."
        confirmLabel="Delete"
        onConfirm={() => {
          if (deleteId) {
            removeAlert(deleteId);
            toast.success("Alert deleted");
          }
        }}
      />
    </div>
  );
}
