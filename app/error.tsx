"use client";

import * as React from "react";
import { StatusError, errorKind } from "@/components/states/status-error";
import { track } from "@/lib/analytics/client";

/** Route-level boundary: any error thrown while rendering a route (including failed server fetches). */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  React.useEffect(() => {
    track("CLIENT_ERROR", { path: window.location.pathname, metadata: { message: error.message.slice(0, 120) } });
  }, [error]);
  return <StatusError kind={errorKind(error)} onRetry={reset} fullPage />;
}
