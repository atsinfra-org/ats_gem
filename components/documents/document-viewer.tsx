"use client";

/* eslint-disable react-hooks/set-state-in-effect -- reset probe state when the active document changes */
import * as React from "react";
import { Download, ExternalLink, FileText, FileWarning } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TenderDocumentSummary } from "@/lib/api/types";
import { documentDownloadUrl } from "@/lib/api/documents";

/** PDFs stream through the browser's native viewer via an iframe (Phase 6 brief §16); other types
 * offer download only - no OCR/text-extraction/preview conversion is implemented. */
export function DocumentViewer({
  open,
  onOpenChange,
  tenderId,
  documents,
  activeDocument,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenderId: string;
  documents: TenderDocumentSummary[];
  activeDocument: TenderDocumentSummary | null;
  onSelect: (doc: TenderDocumentSummary) => void;
}) {
  const activeId = activeDocument?.id;
  const [unavailable, setUnavailable] = React.useState(false);

  const [blobUrl, setBlobUrl] = React.useState<string | null>(null);

  // The API serves documents as attachments from another origin (CSP frame-ancestors + attachment
  // disposition), so an iframe cannot point at it directly. Fetch the bytes (CORS-enabled) and show
  // them from a same-origin blob URL; a failed fetch is a real, user-visible "unavailable" state.
  React.useEffect(() => {
    if (!open || !activeId) return;
    let cancelled = false;
    let created: string | null = null;
    setUnavailable(false);
    setBlobUrl(null);
    fetch(documentDownloadUrl(tenderId, activeId))
      .then(async (r) => {
        if (!r.ok) throw new Error("bad status");
        const blob = new Blob([await r.arrayBuffer()], { type: "application/pdf" });
        created = URL.createObjectURL(blob);
        if (!cancelled) setBlobUrl(created);
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [open, activeId, tenderId]);

  if (!activeDocument) return null;
  const url = documentDownloadUrl(tenderId, activeDocument.id);
  // We only know the document's declared type here, not its actual MIME type (that's returned by
  // the download response itself) - PDFs are named/typed consistently enough in practice that this
  // is a reasonable heuristic, and the fallback (download-only) is always safe.
  const looksLikePdf = activeDocument.fileName.toLowerCase().endsWith(".pdf");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[95vw] h-[85vh] p-0 gap-0 grid grid-rows-[auto_1fr]">
        <VisuallyHidden>
          <DialogTitle>Document Viewer — {activeDocument.fileName}</DialogTitle>
        </VisuallyHidden>
        <div className="flex items-center gap-1.5 border-b border-border px-4 py-2.5">
          <p className="truncate text-sm font-medium text-foreground">{activeDocument.fileName}</p>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href={url} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5" /> Open in New Tab
              </a>
            </Button>
            <Button size="sm" asChild>
              <a href={url} download={activeDocument.fileName}>
                <Download className="h-3.5 w-3.5" /> Download
              </a>
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] overflow-hidden">
          <div className="hidden md:block overflow-y-auto border-r border-border p-2">
            {documents.map((doc) => (
              <button
                key={doc.id}
                onClick={() => onSelect(doc)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors",
                  activeDocument.id === doc.id ? "bg-primary/10 text-primary" : "text-foreground/80 hover:bg-secondary"
                )}
              >
                <FileText className="h-4 w-4 shrink-0" />
                <span className="truncate">{doc.fileName}</span>
              </button>
            ))}
          </div>

          <div className="overflow-auto bg-secondary/40">
            {unavailable ? (
              <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                <FileWarning className="h-14 w-14 text-muted-foreground/50" aria-hidden="true" />
                <p className="max-w-xs text-sm text-muted-foreground">This document is currently unavailable. Please try again later.</p>
              </div>
            ) : looksLikePdf ? (
              blobUrl ? (
                <iframe title={activeDocument.fileName} src={blobUrl} className="h-full w-full border-0" />
              ) : (
                <p className="p-6 text-center text-sm text-muted-foreground" role="status">Loading document…</p>
              )
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                <FileText className="h-16 w-16 text-muted-foreground/40" />
                <p className="max-w-xs text-sm text-muted-foreground">
                  Inline preview isn&apos;t available for this file type. Use Download or Open in New Tab.
                </p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
