"use client";

import { BellRing, CalendarClock, Settings, CreditCard, UserCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { AppNotification, NotificationCategory } from "@/lib/types";
import { cn } from "@/lib/utils";

const categoryIcon: Record<NotificationCategory, typeof BellRing> = {
  "Tender Alert": BellRing,
  Deadline: CalendarClock,
  System: Settings,
  Subscription: CreditCard,
  Account: UserCircle,
};

export function NotificationItem({
  notification,
  onRead,
  compact = false,
}: {
  notification: AppNotification;
  onRead?: () => void;
  compact?: boolean;
}) {
  const Icon = categoryIcon[notification.category];

  return (
    <button
      onClick={onRead}
      className={cn(
        "flex w-full items-start gap-3 border-b border-border px-3 py-3 text-left transition-colors last:border-0 hover:bg-secondary",
        !notification.read && "bg-[color-mix(in_srgb,var(--color-primary)_4%,transparent)]"
      )}
    >
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary">
        <Icon className="h-4 w-4 text-foreground/70" />
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm leading-snug text-foreground", !notification.read && "font-semibold")}>
          {notification.title}
        </p>
        {!compact && <p className="mt-0.5 text-xs text-muted-foreground">{notification.message}</p>}
        <p className="mt-1 text-[11px] text-muted-foreground">
          {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
        </p>
      </div>
      {!notification.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />}
    </button>
  );
}
