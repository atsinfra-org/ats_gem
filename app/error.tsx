"use client";

import { StatusError, errorKind } from "@/components/states/status-error";

/** Route-level boundary: any error thrown while rendering a route (including failed server fetches). */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <StatusError kind={errorKind(error)} onRetry={reset} fullPage />;
}
