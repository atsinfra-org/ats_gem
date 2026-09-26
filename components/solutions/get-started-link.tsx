"use client";

import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthDialog } from "@/lib/store/auth-dialog-store";

export function GetStartedLink() {
  const { open: openAuth } = useAuthDialog();
  return (
    <Button size="lg" onClick={openAuth}>
      Get Started <ArrowRight className="h-3.5 w-3.5" />
    </Button>
  );
}
