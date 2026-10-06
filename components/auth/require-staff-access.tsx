"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { StatusError } from "@/components/states/status-error";
import { useSession } from "@/lib/auth/session-context";
import { useAuthDialog } from "@/lib/store/auth-dialog-store";

/**
 * Gates the admin shell on "has any staff role" - a coarse, UX-only check (the real, fine-grained
 * permission check for each admin action still happens server-side on every request; a staff role
 * without the specific permission for a given action still gets a 403 from the API, shown inline).
 */
export function RequireStaffAccess({ children }: { children: React.ReactNode }) {
  const { user } = useSession();
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

  if (!user) return null;

  if (user.staffRoles.length === 0) return <StatusError kind={403} />;

  return <>{children}</>;
}
