"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { track } from "@/lib/analytics/client";

const ADMIN_PREFIX = "/admin";
const AUTH_PATHS = ["/login", "/register", "/forgot-password", "/reset-password", "/verify-email", "/invite"];
const APP_PATHS = ["/dashboard", "/tenders", "/saved-tenders", "/saved-searches", "/notifications", "/profile", "/company", "/support"];

function routeCategory(pathname: string): "public" | "auth" | "app" | "admin" {
  if (pathname.startsWith(ADMIN_PREFIX)) return "admin";
  if (AUTH_PATHS.some((p) => pathname.startsWith(p))) return "auth";
  if (APP_PATHS.some((p) => pathname.startsWith(p))) return "app";
  return "public";
}

/** Excluded so a page view never carries a reset/verification token even though it lives in the pathname's query string (paths are tracked without their query string anyway, but the route itself is also skipped as a precaution). */
const SENSITIVE_PATHS = ["/reset-password", "/verify-email"];

/**
 * Headless: renders nothing, changes no existing UI. Fires exactly one `PAGE_VIEW` per route change,
 * client-side navigation included (docs/ARCHITECTURE.md Sec 22.9). Query strings are never sent - only
 * the pathname - so a page carrying a password-reset or email-verification token is never logged with it.
 */
export function RouteTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const last = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!pathname || pathname === last.current) return;
    last.current = pathname;
    if (SENSITIVE_PATHS.some((p) => pathname.startsWith(p))) return;
    track("PAGE_VIEW", { path: pathname, metadata: { routeCategory: routeCategory(pathname) } });
    // searchParams is read to force this effect to depend on the full URL (App Router route changes with
    // only a query-string change still count as a navigation), but its value is deliberately never sent.
  }, [pathname, searchParams]);

  return null;
}
