"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { NotificationItem } from "@/components/notifications/notification-item";
import { useAppStore } from "@/lib/store/app-store";

export function NotificationBell() {
  const { notifications, unreadCount, markNotificationRead, markAllNotificationsRead } = useAppStore();
  const recent = notifications.slice(0, 5);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications (${unreadCount} unread)`}>
          <Bell className="h-4.5 w-4.5" />
          {unreadCount > 0 && (
            <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
              {unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2.5">
          <p className="text-sm font-semibold text-foreground">Notifications</p>
          {unreadCount > 0 && (
            <button onClick={markAllNotificationsRead} className="text-xs font-medium text-primary hover:underline">
              Mark all read
            </button>
          )}
        </div>
        <DropdownMenuSeparator />
        <div className="max-h-80 overflow-y-auto">
          {recent.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">No notifications yet</p>
          ) : (
            recent.map((n) => (
              <NotificationItem key={n.id} notification={n} onRead={() => markNotificationRead(n.id)} compact />
            ))
          )}
        </div>
        <DropdownMenuSeparator />
        <Link href="/notifications" className="block px-3 py-2.5 text-center text-xs font-semibold text-primary hover:bg-secondary">
          View all notifications
        </Link>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
