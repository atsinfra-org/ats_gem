"use client";
/* eslint-disable react-hooks/set-state-in-effect -- loading flags for fetch-on-param-change effects */

import * as React from "react";
import Link from "next/link";
import { Bell, Settings } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/states/empty-state";
import { ApiErrorState } from "@/components/states/status-error";
import { Skeleton } from "@/components/ui/skeleton";
import {
  NotificationItem,
  TYPE_LABELS,
} from "@/components/notifications/notification-item";
import {
  listNotifications,
  markAsRead,
  markAsUnread,
} from "@/lib/api/notifications";
import { ApiError } from "@/lib/api/client";
import type { AppNotification, Pagination } from "@/lib/api/types";
import { useNotifications } from "@/lib/store/notifications-store";
import { toast } from "sonner";

const PAGE_SIZE = 20;
const ALL = "__all__";

export default function NotificationsPage() {
  const { unreadCount, markAllRead, refreshUnread } = useNotifications();
  const [tab, setTab] = React.useState<"all" | "unread">("all");
  const [type, setType] = React.useState<string>(ALL);
  const [page, setPage] = React.useState(1);
  const [items, setItems] = React.useState<AppNotification[]>([]);
  const [pagination, setPagination] = React.useState<Pagination>({
    page: 1,
    pageSize: PAGE_SIZE,
    total: 0,
    totalPages: 1,
  });
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<unknown>(null);
  const [retryTick, setRetryTick] = React.useState(0);

  // Align the header badge with the server whenever the page is opened.
  React.useEffect(() => {
    void refreshUnread();
  }, [refreshUnread]);

  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    listNotifications(
      {
        page,
        pageSize: PAGE_SIZE,
        type: type === ALL ? undefined : type,
        unread: tab === "unread",
      },
      controller.signal,
    )
      .then((res) => {
        setItems(res.notifications);
        setPagination(res.pagination);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err);
        setLoading(false);
      });
    return () => controller.abort();
  }, [tab, type, page, retryTick]);

  const changeFilter = (apply: () => void) => {
    apply();
    setPage(1);
  };

  async function setRead(n: AppNotification, read: boolean) {
    if (n.isRead === read) return;
    setItems((prev) =>
      prev.map((x) => (x.id === n.id ? { ...x, isRead: read } : x)),
    );
    try {
      await (read ? markAsRead(n.id) : markAsUnread(n.id));
      void refreshUnread();
      if (tab === "unread" && read)
        setItems((prev) => prev.filter((x) => x.id !== n.id));
    } catch (err) {
      setItems((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, isRead: n.isRead } : x)),
      );
      toast.error(
        err instanceof ApiError
          ? err.message
          : "Could not update this notification.",
      );
    }
  }

  async function readAll() {
    await markAllRead();
    setItems((prev) =>
      tab === "unread" ? [] : prev.map((x) => ({ ...x, isRead: true })),
    );
    setRetryTick((t) => t + 1);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Notifications
          </h1>
          <p
            role="status"
            aria-live="polite"
            className="mt-1 text-sm text-muted-foreground"
          >
            {unreadCount} unread{" "}
            {unreadCount === 1 ? "notification" : "notifications"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void readAll()}
            disabled={unreadCount === 0}
          >
            Mark all read
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/profile?tab=notifications#notifications">
              <Settings className="h-3.5 w-3.5" /> Preferences
            </Link>
          </Button>
        </div>
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) => changeFilter(() => setTab(v as "all" | "unread"))}
        className="space-y-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="unread">Unread</TabsTrigger>
          </TabsList>
          <Select
            value={type}
            onValueChange={(v) => changeFilter(() => setType(v))}
          >
            <SelectTrigger
              className="h-9 w-[210px]"
              aria-label="Filter by notification type"
            >
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All types</SelectItem>
              {Object.entries(TYPE_LABELS).map(([key, label]) => (
                <SelectItem key={key} value={key}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <TabsContent value={tab} className="mt-0">
          {loading ? (
            <div
              className="space-y-2"
              aria-busy="true"
              aria-label="Loading notifications"
            >
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : error ? (
            <ApiErrorState
              error={error}
              onRetry={() => setRetryTick((t) => t + 1)}
            />
          ) : items.length === 0 ? (
            <EmptyState
              icon={Bell}
              title={
                tab === "unread"
                  ? "No unread notifications"
                  : type !== ALL
                    ? "No notifications of this type"
                    : "No notifications"
              }
              description={
                tab === "unread"
                  ? "You are all caught up."
                  : "New alerts for your saved searches and saved tenders will appear here."
              }
            />
          ) : (
            <>
              <Card className="overflow-hidden p-0">
                <ul aria-label="Notifications">
                  {items.map((n) => (
                    <NotificationItem
                      key={n.id}
                      notification={n}
                      onRead={() => void setRead(n, true)}
                      onToggleRead={() => void setRead(n, !n.isRead)}
                    />
                  ))}
                </ul>
              </Card>
              <nav
                aria-label="Pagination"
                className="flex items-center justify-between"
              >
                <p className="text-xs text-muted-foreground">
                  Page {pagination.page} of {pagination.totalPages} ·{" "}
                  {pagination.total.toLocaleString("en-IN")} total
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= pagination.totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </nav>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
