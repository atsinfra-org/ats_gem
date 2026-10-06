"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { acceptInvitation } from "@/lib/api/organizations";
import { ApiError } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session-context";
import { useAuthDialog } from "@/lib/store/auth-dialog-store";

function InvitePageInner() {
  const token = useSearchParams().get("token");
  const { user } = useSession();
  const { open } = useAuthDialog();
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<{ ok: boolean; message: string } | null>(null);

  async function accept() {
    if (!token) return;
    setBusy(true);
    try {
      await acceptInvitation(token);
      setResult({ ok: true, message: "Invitation accepted. You are now a member of the organization." });
    } catch (err) {
      setResult({ ok: false, message: err instanceof ApiError ? err.message : "Could not accept invitation." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <h1 className="text-xl font-bold text-foreground">Organization invitation</h1>
      {!token ? (
        <p className="mt-2 text-sm text-muted-foreground">This invitation link is missing its token.</p>
      ) : result ? (
        <>
          <p className={`mt-2 text-sm ${result.ok ? "text-foreground" : "text-destructive"}`}>{result.message}</p>
          <Button asChild className="mt-6"><Link href="/dashboard">Go to Dashboard</Link></Button>
        </>
      ) : user ? (
        <Button className="mt-6" onClick={accept} loading={busy}>Accept Invitation</Button>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted-foreground">Log in with the invited email address to accept.</p>
          <Button className="mt-6" onClick={open}>Log in / Sign up</Button>
        </>
      )}
    </div>
  );
}

export default function InvitePage() {
  return (
    <React.Suspense fallback={null}>
      <InvitePageInner />
    </React.Suspense>
  );
}
