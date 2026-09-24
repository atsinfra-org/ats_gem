"use client";

import * as React from "react";
import { toast } from "sonner";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";

export default function AdminSettingsPage() {
  const [saving, setSaving] = React.useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await new Promise((r) => setTimeout(r, 800));
    setSaving(false);
    toast.success("Settings saved");
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Platform Settings</h2>
        <p className="text-sm text-muted-foreground">General configuration for the ATS Gem platform</p>
      </div>

      <form onSubmit={handleSave}>
        <Card>
          <CardHeader>
            <CardTitle>General</CardTitle>
            <CardDescription>Basic platform information.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="platformName">Platform Name</Label>
              <Input id="platformName" defaultValue="ATS Gem" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="supportEmail">Support Email</Label>
              <Input id="supportEmail" type="email" defaultValue="support@atsgem.example.com" />
            </div>

            <Separator />

            <h3 className="text-sm font-semibold text-foreground">Crawler Settings</h3>
            <div className="flex items-center justify-between">
              <Label className="text-sm font-normal text-foreground">Enable automatic crawling</Label>
              <Switch defaultChecked />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-sm font-normal text-foreground">Notify admins on crawl failure</Label>
              <Switch defaultChecked />
            </div>

            <Separator />

            <h3 className="text-sm font-semibold text-foreground">Maintenance</h3>
            <div className="flex items-center justify-between">
              <Label className="text-sm font-normal text-foreground">Maintenance mode</Label>
              <Switch />
            </div>
          </CardContent>
          <CardFooter className="justify-end border-t border-border pt-5">
            <Button type="submit" loading={saving}>Save Settings</Button>
          </CardFooter>
        </Card>
      </form>
    </div>
  );
}
