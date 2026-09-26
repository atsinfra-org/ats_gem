"use client";
/* eslint-disable react-hooks/set-state-in-effect -- loading flags for fetch-on-mount/param-change effects */

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { verifyEmail } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session-context";

function VerifyEmailPageInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = React.useState<"pending" | "success" | "error">("pending");
  const [message, setMessage] = React.useState<string | null>(null);
  const { refreshUser } = useSession();

  React.useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("This verification link is missing its token.");
      return;
    }
    let cancelled = false;
    verifyEmail(token)
      .then(async () => {
        if (cancelled) return;
        await refreshUser();
        setStatus("success");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatus("error");
        setMessage(err instanceof ApiError ? err.message : "This link is invalid or has expired.");
      });
    return () => {
      cancelled = true;
    };
  }, [token, refreshUser]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
      {status === "pending" && (
        <>
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="mt-4 text-sm text-muted-foreground">Verifying your email address...</p>
        </>
      )}
      {status === "success" && (
        <>
          <CheckCircle2 className="h-12 w-12 text-[var(--color-success)]" />
          <h1 className="mt-4 text-xl font-bold text-foreground">Email verified</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Your email address has been confirmed.</p>
          <Button asChild className="mt-6">
            <Link href="/dashboard">Go to Dashboard</Link>
          </Button>
        </>
      )}
      {status === "error" && (
        <>
          <XCircle className="h-12 w-12 text-destructive" />
          <h1 className="mt-4 text-xl font-bold text-foreground">Verification failed</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{message}</p>
          <Button asChild variant="outline" className="mt-6">
            <Link href="/">Back to Home</Link>
          </Button>
        </>
      )}
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <React.Suspense fallback={null}>
      <VerifyEmailPageInner />
    </React.Suspense>
  );
}
