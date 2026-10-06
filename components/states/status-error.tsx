"use client";

import Link from "next/link";
import { AlertTriangle, Clock, Lock, ServerCrash, ShieldAlert, Timer, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthDialog } from "@/lib/store/auth-dialog-store";
import { ApiError } from "@/lib/api/client";
import { cn } from "@/lib/utils";

export type ErrorKind = 401 | 403 | 408 | 429 | 500 | 503 | "network";

const CONFIG: Record<ErrorKind, { icon: typeof Lock; title: string; body: string; retry: boolean; login?: boolean }> = {
  401: { icon: Lock, title: "Please log in", body: "You need to be signed in to view this. Your session may have expired.", retry: false, login: true },
  403: { icon: ShieldAlert, title: "Access denied", body: "Your account doesn't have permission to view this. Contact an administrator if you think this is a mistake.", retry: false },
  408: { icon: Clock, title: "Request timed out", body: "The server took too long to respond. Please try again.", retry: true },
  429: { icon: Timer, title: "Too many requests", body: "You're doing that too quickly. Please wait a moment and try again.", retry: true },
  500: { icon: AlertTriangle, title: "Something went wrong", body: "An unexpected error occurred on our end. Please try again in a moment.", retry: true },
  503: { icon: ServerCrash, title: "Service unavailable", body: "The service is temporarily unavailable. Please try again shortly.", retry: true },
  network: { icon: WifiOff, title: "Can't reach the server", body: "Check your internet connection and try again.", retry: true },
};

/** Maps any thrown value (typically an ApiError) to the error UX it should receive. */
export function errorKind(error: unknown): ErrorKind {
  if (error instanceof ApiError) {
    if (error.code === "NETWORK_ERROR") return "network";
    if (error.code === "TIMEOUT") return 408;
    if ([401, 403, 408, 429, 503].includes(error.status)) return error.status as ErrorKind;
    if (error.code === "UNAUTHENTICATED" || error.code === "TOKEN_EXPIRED") return 401;
    if (error.code === "FORBIDDEN") return 403;
    if (error.code === "RATE_LIMITED") return 429;
    if (error.code === "DEPENDENCY_UNAVAILABLE") return 503;
  }
  return 500;
}

/** Professional, consistent error view. Never shows raw messages, stack traces or API details. */
export function StatusError({ kind, onRetry, fullPage = false, className }: { kind: ErrorKind; onRetry?: () => void; fullPage?: boolean; className?: string }) {
  const { open } = useAuthDialog();
  const c = CONFIG[kind];
  const Icon = c.icon;
  return (
    <div
      role="alert"
      data-error-kind={kind}
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 text-center",
        fullPage ? "min-h-screen bg-background" : "rounded-lg border border-border bg-card py-14",
        className,
      )}
    >
      <Icon className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
      {typeof kind === "number" && <p className="text-3xl font-bold text-foreground">{kind}</p>}
      <h2 className="text-lg font-semibold text-foreground">{c.title}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">{c.body}</p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        {c.login && <Button onClick={open}>Log in</Button>}
        {c.retry && onRetry && <Button onClick={onRetry}>Try again</Button>}
        <Button variant="outline" asChild>
          <Link href="/">Go home</Link>
        </Button>
      </div>
    </div>
  );
}

/** Convenience for pages that hold the caught error. */
export function ApiErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return <StatusError kind={errorKind(error)} onRetry={onRetry} />;
}
