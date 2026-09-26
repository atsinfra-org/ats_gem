"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useSession } from "@/lib/auth/session-context";

/** Watches for a failed silent-refresh on a protected page and bounces the user to login. */
export function SessionExpiredWatcher() {
  const { sessionExpired, dismissSessionExpired } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  const PROTECTED_PREFIXES = ["/dashboard", "/admin", "/saved-", "/profile", "/company", "/notifications"];

  React.useEffect(() => {
    if (!sessionExpired) return;
    dismissSessionExpired();
    if (PROTECTED_PREFIXES.some((prefix) => pathname?.startsWith(prefix))) {
      toast.error("Your session has expired. Please log in again.");
      router.push("/login");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionExpired, dismissSessionExpired, pathname, router]);

  return null;
}
