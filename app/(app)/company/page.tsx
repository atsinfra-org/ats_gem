"use client";
/* eslint-disable react-hooks/set-state-in-effect -- loading flags for fetch-on-mount/param-change effects */

import * as React from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiErrorState } from "@/components/states/status-error";
import { useSession } from "@/lib/auth/session-context";
import { ApiError } from "@/lib/api/client";
import {
  getCurrentOrganization,
  inviteMember,
  listMembers,
  removeMember,
  updateCurrentOrganization,
  updateMemberRole,
  type OrganizationUpdate,
} from "@/lib/api/organizations";
import type { OrganizationDetail, OrganizationMember } from "@/lib/api/types";

const FIELDS: { key: keyof OrganizationUpdate; label: string; span?: boolean }[] = [
  { key: "name", label: "Company Name" },
  { key: "industry", label: "Industry" },
  { key: "gstin", label: "GSTIN" },
  { key: "pan", label: "PAN" },
  { key: "companySize", label: "Company Size" },
  { key: "website", label: "Website" },
  { key: "address", label: "Address", span: true },
  { key: "city", label: "City" },
  { key: "stateCode", label: "State code (e.g. MH)" },
  { key: "contactPerson", label: "Contact Person", span: true },
];

export default function CompanyProfilePage() {
  const { user } = useSession();
  const [org, setOrg] = React.useState<OrganizationDetail | null>(null);
  const [members, setMembers] = React.useState<OrganizationMember[]>([]);
  const [error, setError] = React.useState<unknown>(null);
  const [form, setForm] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const [inviteEmail, setInviteEmail] = React.useState("");
  const [inviteRole, setInviteRole] = React.useState<"MEMBER" | "VIEWER">("MEMBER");
  const [inviting, setInviting] = React.useState(false);

  const myRole = members.find((m) => m.userId === user?.id)?.role;
  const isOwner = myRole === "OWNER";

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const [o, m] = await Promise.all([getCurrentOrganization(), listMembers()]);
      setOrg(o);
      setMembers(m);
      setForm(Object.fromEntries(FIELDS.map((f) => [f.key, (o[f.key as keyof OrganizationDetail] as string | null) ?? ""])));
    } catch (err) {
      setError(err);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const data: OrganizationUpdate = {};
    for (const f of FIELDS) {
      const v = form[f.key]?.trim();
      if (v) data[f.key] = v;
    }
    try {
      setOrg(await updateCurrentOrganization(data));
      toast.success("Company profile updated");
    } catch (err) {
      toast.error(err instanceof ApiError ? (err.details?.[0]?.message ?? err.message) : "Could not update company.");
    } finally {
      setSaving(false);
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    try {
      await inviteMember(inviteEmail, inviteRole);
      toast.success("Invitation created. Note: email delivery depends on the backend mail driver.");
      setInviteEmail("");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not send invitation.");
    } finally {
      setInviting(false);
    }
  }

  async function handleRole(userId: string, role: "MEMBER" | "VIEWER") {
    try {
      await updateMemberRole(userId, role);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not change role.");
    }
  }

  async function handleRemove(userId: string) {
    try {
      await removeMember(userId);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not remove member.");
    }
  }

  if (error) return <ApiErrorState error={error} onRetry={load} />;
  if (!org) return <Skeleton className="h-96 w-full max-w-3xl" />;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Company Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {org.isPersonal ? "Your personal workspace." : "Your organization."} {!isOwner && "Only owners can edit these details."}
        </p>
      </div>

      <form onSubmit={handleSave}>
        <Card>
          <CardHeader>
            <CardTitle>Company Information</CardTitle>
            <CardDescription>GSTIN and PAN are validated by the server.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {FIELDS.map((f) => (
                <div key={f.key} className={f.span ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}>
                  <Label htmlFor={`org-${f.key}`}>{f.label}</Label>
                  <Input
                    id={`org-${f.key}`}
                    value={form[f.key] ?? ""}
                    disabled={!isOwner}
                    onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          </CardContent>
          {isOwner && (
            <CardFooter className="justify-end border-t border-border pt-5">
              <Button type="submit" loading={saving}>Save Changes</Button>
            </CardFooter>
          )}
        </Card>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>{members.length} member(s)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2.5">
          {members.map((m) => (
            <div key={m.userId} className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{m.user.name}</p>
                <p className="truncate text-xs text-muted-foreground">{m.user.email}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{m.role}</Badge>
                {isOwner && m.role !== "OWNER" && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => handleRole(m.userId, m.role === "MEMBER" ? "VIEWER" : "MEMBER")}>
                      Make {m.role === "MEMBER" ? "Viewer" : "Member"}
                    </Button>
                    <Button size="icon" variant="ghost" aria-label={`Remove ${m.user.name}`} onClick={() => handleRemove(m.userId)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </CardContent>
        {isOwner && (
          <CardFooter className="border-t border-border pt-5">
            <form onSubmit={handleInvite} className="flex w-full flex-col gap-2 sm:flex-row">
              <Input type="email" required placeholder="colleague@company.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} aria-label="Invite email" />
              <select
                aria-label="Invite role"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as "MEMBER" | "VIEWER")}
                className="h-10 rounded-md border border-input bg-card px-3 text-sm"
              >
                <option value="MEMBER">Member</option>
                <option value="VIEWER">Viewer</option>
              </select>
              <Button type="submit" loading={inviting}>Invite</Button>
            </form>
          </CardFooter>
        )}
      </Card>
    </div>
  );
}
