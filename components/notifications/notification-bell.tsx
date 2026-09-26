"use client";

import * as React from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { NotificationItem } from "@/components/notifications/notification-item";
import { useNotifications } from "@/lib/store/notifications-store";
import { useSession } from "@/lib/auth/session-context";

/**
 * Recent notifications in a non-modal popover (a plain list of links, not a menu: it contains links and text, so it
 * must not claim the ARIA "menu" role, and it must not hide the rest of the page from assistive technology).
 */
export function NotificationBell() {
  const { isAuthenticated } = useSession();
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = React.useState(false);
  const recent = notifications.slice(0, 5);

  if (!isAuthenticated) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications (${unreadCount} unread)`}>
          <Bell className="h-4.5 w-4.5" />
          {unreadCount > 0 && (
            <span aria-hidden className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
              {unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0" aria-label="Notifications">
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <p className="text-sm font-semibold text-foreground">Notifications</p>
          {unreadCount > 0 && (
            <button type="button" onClick={() => void markAllRead()} className="text-xs font-medium text-primary hover:underline">
              Mark all read
            </button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {recent.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">No notifications yet</p>
          ) : (
            <ul aria-label="Recent notifications">
              {recent.map((n) => (
                <NotificationItem
                  key={n.id}
                  notification={n}
                  onRead={() => {
                    void markRead(n.id);
                    setOpen(false);
                  }}
                  compact
                />
              ))}
            </ul>
          )}
        </div>
        <Link href="/notifications" onClick={() => setOpen(false)} className="block border-t border-border px-3 py-2.5 text-center text-xs font-semibold text-primary hover:bg-secondary">
          View all notifications
        </Link>
      </PopoverContent>
    </Popover>
  );
}
