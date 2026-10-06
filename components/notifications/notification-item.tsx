"use client";

import Link from "next/link";
import { AlarmClock, Bell, FileWarning, Search, ShieldAlert, RefreshCw, Ban, Mail } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { AppNotification } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { track } from "@/lib/analytics/client";

export const TYPE_LABELS: Record<string, string> = {
  SAVED_SEARCH_MATCH: "Saved search match",
  TENDER_UPDATED: "Tender updated",
  TENDER_DEADLINE: "Deadline reminder",
  TENDER_CORRIGENDUM: "Corrigendum",
  TENDER_CANCELLED: "Tender cancelled",
  TENDER_STATUS_CHANGED: "Status change",
  SECURITY: "Security",
  ACCOUNT: "Account",
};

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  SAVED_SEARCH_MATCH: Search,
  TENDER_UPDATED: RefreshCw,
  TENDER_DEADLINE: AlarmClock,
  TENDER_CORRIGENDUM: FileWarning,
  TENDER_CANCELLED: Ban,
  TENDER_STATUS_CHANGED: RefreshCw,
  SECURITY: ShieldAlert,
  ACCOUNT: Mail,
};

const PRIORITY_LABELS: Record<string, string> = { CRITICAL: "Critical", HIGH: "Important" };

/**
 * One notification. Tender notifications link to /tenders/:id only while that tender still exists (the API says so via
 * `entityAvailable`); otherwise the row is a plain button and says the tender is gone, so there are no dead links.
 * Unread is conveyed by text for assistive tech and by weight and a dot, never by colour alone.
 */
export function NotificationItem({
  notification,
  onRead,
  onToggleRead,
  compact = false,
}: {
  notification: AppNotification;
  onRead?: () => void;
  /** Full page only: explicit mark read/unread control. */
  onToggleRead?: () => void;
  compact?: boolean;
}) {
  const Icon = TYPE_ICONS[notification.type] ?? Bell;
  const typeLabel = TYPE_LABELS[notification.type] ?? "Notification";
  const priority = PRIORITY_LABELS[notification.priority];
  const linked = notification.entityType === "tender" && !!notification.entityId && notification.entityAvailable;
  const goneTender = notification.entityType === "tender" && !!notification.entityId && !notification.entityAvailable;

  const body = (
    <>
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary" aria-hidden>
        <Icon className="h-4 w-4 text-foreground/70" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {!notification.isRead && <span className="sr-only">Unread. </span>}
          <span className="rounded border border-border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{typeLabel}</span>
          {priority && <span className="text-[10px] font-semibold uppercase tracking-wide text-foreground">{priority}</span>}
        </div>
        <p className={cn("mt-1 text-sm leading-snug text-foreground", !notification.isRead && "font-semibold")}>{notification.title}</p>
        {!compact && <p className="mt-0.5 break-words text-xs text-muted-foreground">{notification.message}</p>}
        {goneTender && !compact && <p className="mt-0.5 text-xs italic text-muted-foreground">This tender is no longer available.</p>}
        <p className="mt-1 text-[11px] text-foreground/70">
          <time dateTime={notification.createdAt}>{formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}</time>
        </p>
      </div>
      {!notification.isRead && <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />}
    </>
  );

  const handleClick = () => {
    track("NOTIFICATION_CLICKED", { entityType: "notification", entityId: notification.id, metadata: { notificationId: notification.id, type: notification.type } });
    onRead?.();
  };

  const rowClass = cn("flex min-w-0 flex-1 items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary");

  return (
    <li className={cn("flex items-stretch border-b border-border last:border-0", !notification.isRead && "bg-[color-mix(in_srgb,var(--color-primary)_4%,transparent)]")}>
      {linked ? (
        <Link href={`/tenders/${notification.entityId}`} onClick={handleClick} className={rowClass}>
          {body}
        </Link>
      ) : (
        <button type="button" onClick={handleClick} className={rowClass}>
          {body}
        </button>
      )}
      {onToggleRead && (
        <button
          type="button"
          onClick={onToggleRead}
          className="shrink-0 self-center px-3 py-2 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={`${notification.isRead ? "Mark as unread" : "Mark as read"}: ${notification.title}`}
        >
          {notification.isRead ? "Mark unread" : "Mark read"}
        </button>
      )}
    </li>
  );
}
