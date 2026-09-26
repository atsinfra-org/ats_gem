"use client";
/* eslint-disable react-hooks/set-state-in-effect -- preferences load on mount */

import * as React from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ApiErrorState } from "@/components/states/status-error";
import { ApiError } from "@/lib/api/client";
import { getPreferences, updatePreferences } from "@/lib/api/notifications";
import type { NotificationCategory, NotificationPreferences } from "@/lib/api/types";

export const CATEGORY_COPY: Record<NotificationCategory, { label: string; description: string }> = {
  SAVED_SEARCH_ALERTS: { label: "Saved-search alerts", description: "New tenders that match a saved search with alerts turned on (choose per search under Saved Searches)." },
  SAVED_TENDER_UPDATES: { label: "Saved-tender updates", description: "Changes to the closing date, value or details of tenders you saved." },
  DEADLINE_REMINDERS: { label: "Deadline reminders", description: "Reminders before a saved tender closes." },
  CORRIGENDA: { label: "Corrigenda", description: "Corrigendum notices on tenders you saved or that match a saved-search alert." },
  STATUS_CHANGES: { label: "Tender status changes", description: "Cancellations and closures of tenders you saved." },
  SYSTEM: { label: "Account and security", description: "Password changes and account messages. These are always on." },
};

const ORDER: NotificationCategory[] = ["SAVED_SEARCH_ALERTS", "SAVED_TENDER_UPDATES", "DEADLINE_REMINDERS", "CORRIGENDA", "STATUS_CHANGES", "SYSTEM"];
const OFFSET_LABELS: Record<number, string> = { 168: "7 days before", 72: "3 days before", 24: "1 day before", 3: "3 hours before" };
const ZONES = ["Asia/Kolkata", "UTC", "Asia/Dubai", "Asia/Singapore", "Europe/London", "America/New_York"];

/** Real, persisted notification preferences (GET/PATCH /notifications/preferences). Emails are asynchronous; turning a channel off never deletes history. */
export function NotificationPreferencesCard() {
  const [saved, setSaved] = React.useState<NotificationPreferences | null>(null);
  const [draft, setDraft] = React.useState<NotificationPreferences | null>(null);
  const [error, setError] = React.useState<unknown>(null);
  const [saving, setSaving] = React.useState(false);
  const [fieldError, setFieldError] = React.useState<string | null>(null);
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    const c = new AbortController();
    setError(null);
    getPreferences(c.signal)
      .then((p) => {
        setSaved(p);
        setDraft(p);
      })
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) setError(err);
      });
    return () => c.abort();
  }, [tick]);

  const dirty = !!saved && !!draft && JSON.stringify(saved) !== JSON.stringify(draft);

  function setChannel(cat: NotificationCategory, channel: "inApp" | "email", value: boolean) {
    setDraft((d) => (d ? { ...d, categories: { ...d.categories, [cat]: { ...d.categories[cat], [channel]: value } } } : d));
  }

  async function save() {
    if (!draft || !saved) return;
    setSaving(true);
    setFieldError(null);
    const categories: Record<string, { inApp?: boolean; email?: boolean }> = {};
    for (const cat of ORDER) {
      if (draft.categories[cat].locked) continue;
      const a = saved.categories[cat];
      const b = draft.categories[cat];
      if (a.inApp !== b.inApp || a.email !== b.email) categories[cat] = { inApp: b.inApp, email: b.email };
    }
    const q = draft.quietHours;
    try {
      const next = await updatePreferences({
        categories,
        deadlineOffsetsHours: draft.deadlineOffsetsHours,
        quietHours: q.enabled ? { enabled: true, start: q.start ?? "22:00", end: q.end ?? "07:00", timezone: q.timezone } : { enabled: false },
      });
      setSaved(next);
      setDraft(next);
      toast.success("Notification preferences saved");
    } catch (err) {
      setFieldError(err instanceof ApiError ? (err.details?.[0]?.message ?? err.message) : "Could not save your preferences.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card id="notifications" tabIndex={-1} aria-labelledby="notification-preferences-title" className="scroll-mt-20">
      <CardHeader>
        <CardTitle id="notification-preferences-title">Notification preferences</CardTitle>
        <CardDescription>Choose what reaches you in the app and by email. Emails are sent from a background queue, so they can arrive a little after the in-app notification.</CardDescription>
      </CardHeader>
      {error ? (
        <CardContent>
          <ApiErrorState error={error} onRetry={() => setTick((t) => t + 1)} />
        </CardContent>
      ) : !draft ? (
        <CardContent className="space-y-3" aria-busy="true" aria-label="Loading preferences">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </CardContent>
      ) : (
        <>
          <CardContent className="space-y-6">
            <div>
              <div className="hidden grid-cols-[1fr_auto_auto] gap-x-6 border-b border-border pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:grid" aria-hidden>
                <span>Alert type</span>
                <span className="w-14 text-center">In-app</span>
                <span className="w-14 text-center">Email</span>
              </div>
              <ul>
                {ORDER.map((cat) => {
                  const copy = CATEGORY_COPY[cat];
                  const p = draft.categories[cat];
                  return (
                    <li key={cat} className="grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-2 border-b border-border py-3 last:border-0 sm:grid-cols-[1fr_auto_auto]">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">{copy.label}</p>
                        <p className="text-xs text-muted-foreground">{copy.description}</p>
                      </div>
                      <div className="flex items-center justify-end gap-4 sm:contents">
                        <label className="flex w-14 flex-col items-center gap-1 text-[11px] text-muted-foreground">
                          <span className="sm:sr-only">In-app</span>
                          <Switch checked={p.inApp} disabled={p.locked} aria-label={`${copy.label}: in-app notifications`} onCheckedChange={(v) => setChannel(cat, "inApp", v)} />
                        </label>
                        <label className="flex w-14 flex-col items-center gap-1 text-[11px] text-muted-foreground">
                          <span className="sm:sr-only">Email</span>
                          <Switch checked={p.email} disabled={p.locked} aria-label={`${copy.label}: email notifications`} onCheckedChange={(v) => setChannel(cat, "email", v)} />
                        </label>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>

            <fieldset>
              <legend className="text-sm font-medium text-foreground">Deadline reminders</legend>
              <p className="mt-0.5 text-xs text-muted-foreground">Choose when to be reminded before a saved tender closes. Nothing is sent for tenders without a closing date.</p>
              <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
                {draft.allowedDeadlineOffsetsHours.map((h) => {
                  const id = `offset-${h}`;
                  return (
                    <div key={h} className="flex items-center gap-2">
                      <Checkbox
                        id={id}
                        checked={draft.deadlineOffsetsHours.includes(h)}
                        onCheckedChange={(v) =>
                          setDraft((d) => (d ? { ...d, deadlineOffsetsHours: v === true ? [...d.deadlineOffsetsHours, h].sort((a, b) => a - b) : d.deadlineOffsetsHours.filter((x) => x !== h) } : d))
                        }
                      />
                      <label htmlFor={id} className="text-sm text-foreground">
                        {OFFSET_LABELS[h] ?? `${h} hours before`}
                      </label>
                    </div>
                  );
                })}
              </div>
            </fieldset>

            <fieldset>
              <legend className="text-sm font-medium text-foreground">Quiet hours</legend>
              <p className="mt-0.5 text-xs text-muted-foreground">Emails are held until quiet hours end. Security messages are never held.</p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <Switch checked={draft.quietHours.enabled} aria-label="Hold emails during quiet hours" onCheckedChange={(v) => setDraft((d) => (d ? { ...d, quietHours: { ...d.quietHours, enabled: v, start: d.quietHours.start ?? "22:00", end: d.quietHours.end ?? "07:00" } } : d))} />
                  Hold emails during quiet hours
                </label>
                {draft.quietHours.enabled && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Input type="time" aria-label="Quiet hours start" className="w-28" value={draft.quietHours.start ?? "22:00"} onChange={(e) => setDraft((d) => (d ? { ...d, quietHours: { ...d.quietHours, start: e.target.value } } : d))} />
                    <span className="text-sm text-muted-foreground">to</span>
                    <Input type="time" aria-label="Quiet hours end" className="w-28" value={draft.quietHours.end ?? "07:00"} onChange={(e) => setDraft((d) => (d ? { ...d, quietHours: { ...d.quietHours, end: e.target.value } } : d))} />
                    <select
                      aria-label="Quiet hours time zone"
                      className="h-10 rounded-md border border-input bg-background px-2 text-sm"
                      value={draft.quietHours.timezone}
                      onChange={(e) => setDraft((d) => (d ? { ...d, quietHours: { ...d.quietHours, timezone: e.target.value } } : d))}
                    >
                      {[...new Set([draft.quietHours.timezone, ...ZONES])].map((z) => (
                        <option key={z} value={z}>
                          {z}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </fieldset>

            {fieldError && (
              <p role="alert" className="text-sm text-destructive">
                {fieldError}
              </p>
            )}
          </CardContent>
          <CardFooter className="justify-end gap-2">
            <Button variant="outline" disabled={!dirty || saving} onClick={() => setDraft(saved)}>
              Reset
            </Button>
            <Button onClick={() => void save()} loading={saving} disabled={!dirty}>
              Save preferences
            </Button>
          </CardFooter>
        </>
      )}
    </Card>
  );
}
