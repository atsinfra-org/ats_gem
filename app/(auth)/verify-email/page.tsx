"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAuthDialog } from "@/lib/store/auth-dialog-store";

export default function VerifyEmailPage() {
  const router = useRouter();
  const { open } = useAuthDialog();

  React.useEffect(() => {
    open();
    router.replace("/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
