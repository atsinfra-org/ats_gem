"use client";
/* eslint-disable react-hooks/set-state-in-effect -- loading flags for fetch-on-mount/param-change effects */

import * as React from "react";
import { toast } from "sonner";
import { useSession } from "@/lib/auth/session-context";
import { getUnreadCount, listNotifications, markAllAsRead, markAsRead, markAsUnread } from "@/lib/api/notifications";
import { ApiError } from "@/lib/api/client";
import type { AppNotification } from "@/lib/api/types";

/** Notifications are refreshed on load, on window focus and at most once a minute while the tab is visible - no push channel yet (docs/ARCHITECTURE.md Sec 21.9). */
export const NOTIFICATION_POLL_MS = 60_000;

interface NotificationsValue {
  /** The most recent notifications (the bell menu); the full history page loads its own pages. */
  notifications: AppNotification[];
  unreadCount: number;
  loading: boolean;
  error: unknown;
  refresh: () => Promise<void>;
  /** Re-reads only the unread count (cheap); pages call it after changing read state. */
  refreshUnread: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markUnread: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

const NotificationsContext = React.createContext<NotificationsValue | null>(null);

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useSession();
  const [notifications, setNotifications] = React.useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<unknown>(null);

  const refresh = React.useCallback(async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    setError(null);
    try {
      const res = await listNotifications({ pageSize: 10 });
      setNotifications(res.notifications);
      setUnreadCount(res.unreadCount);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  const refreshUnread = React.useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      setUnreadCount(await getUnreadCount());
    } catch {
      // A failed background count refresh keeps the last known value; the next tick tries again.
    }
  }, [isAuthenticated]);

  React.useEffect(() => {
    if (isAuthenticated) void refresh();
    else {
      setNotifications([]);
      setUnreadCount(0);
    }
  }, [isAuthenticated, refresh]);

  // Periodic + on-focus refresh: unread count every minute (visible tab only); the list only when the count grew.
  const lastCount = React.useRef(0);
  React.useEffect(() => {
    lastCount.current = unreadCount;
  }, [unreadCount]);
  React.useEffect(() => {
    if (!isAuthenticated) return;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const count = await getUnreadCount();
        if (count > lastCount.current) await refresh();
        else setUnreadCount(count);
      } catch {
        /* keep the last known state */
      }
    };
    const id = window.setInterval(() => void tick(), NOTIFICATION_POLL_MS);
    const onFocus = () => void tick();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [isAuthenticated, refresh]);

  // Read state is decided from the current list (a ref), never from inside a state updater, which runs later.
  const listRef = React.useRef<AppNotification[]>([]);
  React.useEffect(() => {
    listRef.current = notifications;
  }, [notifications]);

  const setReadState = React.useCallback(
    async (id: string, read: boolean) => {
      const known = listRef.current.find((n) => n.id === id);
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: read } : n)));
      if (known && known.isRead !== read) setUnreadCount((c) => Math.max(0, c + (read ? -1 : 1)));
      try {
        await (read ? markAsRead(id) : markAsUnread(id));
        if (!known) await refreshUnread(); // not in the recent list (e.g. changed on the full page): take the server's count
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : "Could not update notification.");
        void refresh();
      }
    },
    [refresh, refreshUnread],
  );
  const markRead = React.useCallback((id: string) => setReadState(id, true), [setReadState]);
  const markUnread = React.useCallback((id: string) => setReadState(id, false), [setReadState]);

  const markAllRead = React.useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);
    try {
      await markAllAsRead();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not update notifications.");
      void refresh();
    }
  }, [refresh]);

  return (
    <NotificationsContext.Provider value={{ notifications, unreadCount, loading, error, refresh, refreshUnread, markRead, markUnread, markAllRead }}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const ctx = React.useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications must be used within NotificationsProvider");
  return ctx;
}
