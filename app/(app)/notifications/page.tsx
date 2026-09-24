"use client";

import * as React from "react";
import { Bell, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EmptyState } from "@/components/states/empty-state";
import { NotificationItem } from "@/components/notifications/notification-item";
import { useAppStore } from "@/lib/store/app-store";
import type { NotificationCategory } from "@/lib/types";

const categories: (NotificationCategory | "All")[] = ["All", "Tender Alert", "Deadline", "System", "Subscription", "Account"];

export default function NotificationsPage() {
  const { notifications, markNotificationRead, markAllNotificationsRead, clearNotifications, unreadCount } = useAppStore();
  const [tab, setTab] = React.useState<string>("All");

  const filtered = tab === "All" ? notifications : notifications.filter((n) => n.category === tab);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Notifications</h1>
          <p className="mt-1 text-sm text-muted-foreground">{unreadCount} unread notifications</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={markAllNotificationsRead} disabled={unreadCount === 0}>
            Mark all read
          </Button>
          <Button variant="outline" size="sm" onClick={clearNotifications} disabled={notifications.length === 0}>
            <Trash2 className="h-3.5 w-3.5" /> Clear all
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          {categories.map((c) => (
            <TabsTrigger key={c} value={c}>{c}</TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={tab}>
          {filtered.length === 0 ? (
            <EmptyState icon={Bell} title="No notifications" description="You're all caught up. New notifications will appear here." />
          ) : (
            <Card className="overflow-hidden p-0">
              {filtered.map((n) => (
                <NotificationItem key={n.id} notification={n} onRead={() => markNotificationRead(n.id)} />
              ))}
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
