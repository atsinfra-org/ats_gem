"use client";

import { Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SaveTenderButton } from "@/components/tender/save-tender-button";

export function TenderDetailActions({ tenderId }: { tenderId: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          if (typeof window !== "undefined") navigator.clipboard?.writeText(window.location.href);
          toast.success("Link copied to clipboard");
        }}
      >
        <Share2 className="h-3.5 w-3.5" /> Share
      </Button>
      <SaveTenderButton tenderId={tenderId} variant="outline" size="sm" />
    </div>
  );
}
