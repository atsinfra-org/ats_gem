"use client";
/* eslint-disable react-hooks/set-state-in-effect -- loading flags for fetch-on-mount/param-change effects */

import * as React from "react";
import { toast } from "sonner";
import { Laptop, Smartphone, LogOut, CheckCircle2, AlertCircle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow } from "date-fns";
import { useSession } from "@/lib/auth/session-context";
import { apiRequest, ApiError } from "@/lib/api/client";
import { track } from "@/lib/analytics/client";
import { changePassword, listSessions, resendVerification, revokeSession } from "@/lib/api/auth";
import { NotificationPreferencesCard } from "@/components/notifications/notification-preferences-card";
import type { SessionInfo } from "@/lib/api/types";

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default function ProfilePage() {
  const { user, refreshUser } = useSession();
  const [name, setName] = React.useState(user?.name ?? "");
  const [phone, setPhone] = React.useState(user?.phone ?? "");
  const [designation, setDesignation] = React.useState(user?.designation ?? "");
  const [savingProfile, setSavingProfile] = React.useState(false);

  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [passwordError, setPasswordError] = React.useState<string | null>(null);
  const [savingPassword, setSavingPassword] = React.useState(false);

  const [sessions, setSessions] = React.useState<SessionInfo[] | null>(null);
  const [resendingVerification, setResendingVerification] = React.useState(false);

  React.useEffect(() => {
    if (user) {
      setName(user.name);
      setPhone(user.phone ?? "");
      setDesignation(user.designation ?? "");
    }
  }, [user]);

  React.useEffect(() => {
    listSessions()
      .then(setSessions)
      .catch(() => setSessions([]));
  }, []);

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    try {
      await apiRequest("/me", { method: "PATCH", body: { name, phone: phone || undefined, designation: designation || undefined } });
      track("PROFILE_UPDATED");
      await refreshUser();
      toast.success("Profile updated");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not update profile.");
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    setSavingPassword(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      toast.success("Password changed");
    } catch (err) {
      if (err instanceof ApiError && err.code === "INVALID_CREDENTIALS") setPasswordError("Current password is incorrect.");
      else if (err instanceof ApiError && err.code === "VALIDATION_FAILED") setPasswordError(err.details?.[0]?.message ?? "Please check the form for errors.");
      else setPasswordError("Could not change password.");
    } finally {
      setSavingPassword(false);
    }
  }

  async function handleResendVerification() {
    setResendingVerification(true);
    try {
      await resendVerification();
      toast.success("Verification email sent.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not resend verification email.");
    } finally {
      setResendingVerification(false);
    }
  }

  async function handleRevokeSession(id: string) {
    try {
      await revokeSession(id);
      setSessions((prev) => prev?.filter((s) => s.id !== id) ?? null);
      toast.success("Session revoked");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not revoke session.");
    }
  }

  // Alert emails link here (?tab=notifications): bring the preferences into view and move focus to them.
  React.useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") === "notifications" || window.location.hash === "#notifications") {
      const el = document.getElementById("notifications");
      el?.scrollIntoView({ block: "start" });
      el?.focus({ preventScroll: true });
    }
  }, [user]);

  React.useEffect(() => {
    if (user) track("PROFILE_VIEWED");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!user]);

  if (!user) return null;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">My Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your personal information, security and sessions.</p>
      </div>

      <form onSubmit={handleSaveProfile}>
        <Card>
          <CardHeader>
            <CardTitle>Personal Information</CardTitle>
            <CardDescription>Update your personal details.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-wrap items-center gap-4">
              <Avatar className="h-16 w-16">
                <AvatarFallback className="bg-primary text-lg font-semibold text-primary-foreground">{initials(user.name)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="break-all text-sm font-medium text-foreground">{user.email}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {user.isEmailVerified ? (
                    <Badge variant="success" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Verified</Badge>
                  ) : (
                    <>
                      <Badge variant="warning" className="gap-1"><AlertCircle className="h-3 w-3" /> Not verified</Badge>
                      <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={handleResendVerification} loading={resendingVerification}>
                        Resend verification email
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="fullName">Full Name</Label>
                <Input id="fullName" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="designation">Role / Designation</Label>
                <Input id="designation" value={designation} onChange={(e) => setDesignation(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">Phone Number</Label>
                <Input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
            </div>
          </CardContent>
          <CardFooter className="justify-end gap-2 border-t border-border pt-5">
            <Button type="submit" loading={savingProfile}>Save Changes</Button>
          </CardFooter>
        </Card>
      </form>

      <form onSubmit={handleChangePassword}>
        <Card>
          <CardHeader>
            <CardTitle>Change Password</CardTitle>
            <CardDescription>Choose a new password for your account.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {passwordError && (
              <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {passwordError}
              </div>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="currentPassword">Current Password</Label>
                <Input id="currentPassword" type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="newPassword">New Password</Label>
                <Input id="newPassword" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} />
              </div>
            </div>
          </CardContent>
          <CardFooter className="justify-end gap-2 border-t border-border pt-5">
            <Button type="submit" loading={savingPassword} disabled={!currentPassword || !newPassword}>Change Password</Button>
          </CardFooter>
        </Card>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>Active Sessions</CardTitle>
          <CardDescription>Devices currently signed in to your account.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {sessions === null ? (
            <Skeleton className="h-16 w-full" />
          ) : sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active sessions found.</p>
          ) : (
            sessions.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
                <div className="flex items-center gap-3 min-w-0">
                  {s.deviceLabel?.toLowerCase().includes("mobile") ? <Smartphone className="h-4 w-4 shrink-0 text-muted-foreground" /> : <Laptop className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">
                      {s.deviceLabel ?? "Unknown device"} {s.current && <Badge variant="secondary" className="ml-1 text-[10px]">This device</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {s.ip ?? "Unknown IP"} · Last active {formatDistanceToNow(new Date(s.lastUsedAt), { addSuffix: true })}
                    </p>
                  </div>
                </div>
                {!s.current && (
                  <Button variant="outline" size="sm" onClick={() => handleRevokeSession(s.id)}>
                    <LogOut className="h-3.5 w-3.5" /> Revoke
                  </Button>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <NotificationPreferencesCard />
    </div>
  );
}
