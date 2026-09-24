"use client";

import * as React from "react";
import { toast } from "sonner";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { currentUser } from "@/lib/mock/users";

export default function ProfilePage() {
  const [saving, setSaving] = React.useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await new Promise((r) => setTimeout(r, 800));
    setSaving(false);
    toast.success("Profile updated");
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">My Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your personal information and preferences.</p>
      </div>

      <form onSubmit={handleSave}>
        <Card>
          <CardHeader>
            <CardTitle>Personal Information</CardTitle>
            <CardDescription>Update your photo and personal details.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16">
                <AvatarFallback className="bg-primary text-lg font-semibold text-primary-foreground">
                  {currentUser.avatarInitials}
                </AvatarFallback>
              </Avatar>
              <Button type="button" variant="outline" size="sm">Edit Profile Photo</Button>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="fullName">Full Name</Label>
                <Input id="fullName" defaultValue={currentUser.name} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="role">Role / Designation</Label>
                <Input id="role" defaultValue={currentUser.role} />
              </div>
            </div>

            <Separator />

            <h3 className="text-sm font-semibold text-foreground">Contact Information</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email Address</Label>
                <Input id="email" type="email" defaultValue={currentUser.email} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">Phone Number</Label>
                <Input id="phone" type="tel" defaultValue={currentUser.phone} />
              </div>
            </div>

            <Separator />

            <h3 className="text-sm font-semibold text-foreground">Security</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="currentPassword">Current Password</Label>
                <Input id="currentPassword" type="password" placeholder="••••••••" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="newPassword">New Password</Label>
                <Input id="newPassword" type="password" placeholder="••••••••" />
              </div>
            </div>

            <Separator />

            <h3 className="text-sm font-semibold text-foreground">Notification Preferences</h3>
            <div className="space-y-3">
              {["Email notifications for new matching tenders", "SMS alerts for closing deadlines", "Weekly market intelligence digest"].map((label) => (
                <div key={label} className="flex items-center justify-between">
                  <Label className="text-sm font-normal text-foreground">{label}</Label>
                  <Switch defaultChecked />
                </div>
              ))}
            </div>
          </CardContent>
          <CardFooter className="justify-end gap-2 border-t border-border pt-5">
            <Button type="button" variant="outline">Cancel</Button>
            <Button type="submit" loading={saving}>Save Changes</Button>
          </CardFooter>
        </Card>
      </form>
    </div>
  );
}
