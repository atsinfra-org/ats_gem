"use client";

import { Share2, Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SaveTenderButton } from "@/components/tender/save-tender-button";
import { downloadAllDocuments } from "@/lib/api/documents";
import * as React from "react";

export function TenderDetailActions({ tenderId }: { tenderId: string }) {
  const [downloading, setDownloading] = React.useState(false);

  async function handleDownloadAll() {
    setDownloading(true);
    await downloadAllDocuments(tenderId);
    setDownloading(false);
    toast.success("All documents download started");
  }

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
      <Button size="sm" onClick={handleDownloadAll} loading={downloading}>
        <Download className="h-3.5 w-3.5" /> Download All
      </Button>
    </div>
  );
}
