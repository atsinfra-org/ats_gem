"use client";

import * as React from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export default function AdminNotificationsPage() {
  const [sending, setSending] = React.useState(false);

  async function handleBroadcast(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    await new Promise((r) => setTimeout(r, 900));
    setSending(false);
    toast.success("Broadcast notification sent to all users");
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Notifications</h2>
        <p className="text-sm text-muted-foreground">Send platform-wide announcements to users</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Broadcast Notification</CardTitle>
          <CardDescription>This will be sent to all active users immediately.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleBroadcast} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="title">Title</Label>
              <Input id="title" required placeholder="e.g. Scheduled maintenance on 28 Sep" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="body">Message</Label>
              <textarea
                id="body"
                required
                rows={4}
                className="flex w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </div>
            <Button type="submit" loading={sending}>Send Broadcast</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
