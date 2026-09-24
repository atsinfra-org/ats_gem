"use client";

import * as React from "react";
import { FileText, FileSpreadsheet, FileArchive, File, Download, Eye, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { TenderDocument } from "@/lib/types";
import { downloadDocument } from "@/lib/api/documents";

const iconByType = {
  pdf: FileText,
  xlsx: FileSpreadsheet,
  zip: FileArchive,
  docx: File,
};

function formatSize(kb: number) {
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${kb} KB`;
}

export function DocumentCard({ document: doc, onPreview }: { document: TenderDocument; onPreview: (doc: TenderDocument) => void }) {
  const Icon = iconByType[doc.type];
  const [downloading, setDownloading] = React.useState(false);

  async function handleDownload() {
    setDownloading(true);
    await downloadDocument(doc);
    setDownloading(false);
    toast.success("Document download started", { description: doc.name });
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-secondary/40">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-secondary">
        <Icon className="h-5 w-5 text-foreground/70" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{doc.name}</p>
        <p className="text-xs text-muted-foreground">{formatSize(doc.sizeKb)}</p>
      </div>
      <div className="flex items-center gap-1.5">
        <Button variant="ghost" size="icon" aria-label={`Preview ${doc.name}`} onClick={() => onPreview(doc)}>
          <Eye className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={handleDownload} disabled={downloading}>
          {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          Download
        </Button>
      </div>
    </div>
  );
}
