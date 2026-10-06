"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useSession } from "@/lib/auth/session-context";
import { useAuthDialog } from "@/lib/store/auth-dialog-store";

/** Client-side route guard: backend authorization remains authoritative (every API call is still
 * checked server-side) - this only prevents rendering the authenticated shell before a session is
 * known, and bounces a signed-out visitor to the login dialog instead of showing an empty shell. */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated } = useSession();
  const router = useRouter();
  const { open } = useAuthDialog();

  React.useEffect(() => {
    if (user === null) {
      open();
      router.replace("/");
    }
  }, [user, open, router]);

  if (user === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAuthenticated) return null;

  return <>{children}</>;
}
