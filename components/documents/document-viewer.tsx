"use client";

import * as React from "react";
import {
  ZoomIn,
  ZoomOut,
  Search,
  Download,
  Printer,
  Maximize2,
  FileText,
  FileSpreadsheet,
  FileArchive,
  File,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Button } from "@/components/ui/button";
import type { TenderDocument } from "@/lib/types";
import { cn } from "@/lib/utils";

const iconByType = { pdf: FileText, xlsx: FileSpreadsheet, zip: FileArchive, docx: File };

export function DocumentViewer({
  open,
  onOpenChange,
  documents,
  activeDocument,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documents: TenderDocument[];
  activeDocument: TenderDocument | null;
  onSelect: (doc: TenderDocument) => void;
}) {
  const [zoom, setZoom] = React.useState(100);

  if (!activeDocument) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[95vw] h-[85vh] p-0 gap-0 grid grid-rows-[auto_1fr]">
        <VisuallyHidden>
          <DialogTitle>Document Viewer — {activeDocument.name}</DialogTitle>
        </VisuallyHidden>
        <div className="flex items-center gap-1.5 border-b border-border px-4 py-2.5">
          <Button variant="ghost" size="icon" onClick={() => setZoom((z) => Math.max(50, z - 10))} aria-label="Zoom out">
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="w-12 text-center text-xs text-muted-foreground">{zoom}%</span>
          <Button variant="ghost" size="icon" onClick={() => setZoom((z) => Math.min(200, z + 10))} aria-label="Zoom in">
            <ZoomIn className="h-4 w-4" />
          </Button>
          <div className="mx-1 h-5 w-px bg-border" />
          <Button variant="ghost" size="icon" aria-label="Search in document">
            <Search className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Print" onClick={() => toast.info("Print preview would open here")}>
            <Printer className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Fullscreen">
            <Maximize2 className="h-4 w-4" />
          </Button>
          <div className="ml-auto">
            <Button size="sm" onClick={() => toast.success("Document download started", { description: activeDocument.name })}>
              <Download className="h-3.5 w-3.5" /> Download
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[220px_1fr_240px] overflow-hidden">
          <div className="hidden md:block overflow-y-auto border-r border-border p-2">
            {documents.map((doc) => {
              const Icon = iconByType[doc.type];
              return (
                <button
                  key={doc.id}
                  onClick={() => onSelect(doc)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors",
                    activeDocument.id === doc.id ? "bg-primary/10 text-primary" : "text-foreground/80 hover:bg-secondary"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{doc.name}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-center overflow-auto bg-secondary/40 p-6">
            <div
              className="flex aspect-[1/1.414] w-full max-w-md flex-col items-center justify-center gap-3 rounded-md border border-border bg-white shadow-md"
              style={{ transform: `scale(${zoom / 100})`, transformOrigin: "center" }}
            >
              <FileText className="h-16 w-16 text-muted-foreground/40" />
              <p className="px-6 text-center text-xs text-muted-foreground">
                Preview for {activeDocument.name}
                <br />
                Document streaming will be connected to backend storage.
              </p>
            </div>
          </div>

          <div className="hidden md:block overflow-y-auto border-l border-border p-4">
            <h4 className="text-sm font-semibold text-foreground">Document Info</h4>
            <dl className="mt-3 space-y-3 text-xs">
              <div>
                <dt className="text-muted-foreground">File Name</dt>
                <dd className="mt-0.5 font-medium text-foreground break-all">{activeDocument.name}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">File Type</dt>
                <dd className="mt-0.5 font-medium uppercase text-foreground">{activeDocument.type}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">File Size</dt>
                <dd className="mt-0.5 font-medium text-foreground">
                  {activeDocument.sizeKb >= 1024 ? `${(activeDocument.sizeKb / 1024).toFixed(1)} MB` : `${activeDocument.sizeKb} KB`}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
