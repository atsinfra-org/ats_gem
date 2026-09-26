import { FileText, Download, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { TenderDocumentSummary } from "@/lib/api/types";
import { documentDownloadUrl } from "@/lib/api/documents";

const documentTypeLabels: Record<string, string> = {
  NIT: "NIT",
  TENDER_DOCUMENT: "Tender Document",
  BOQ: "BOQ",
  CORRIGENDUM: "Corrigendum",
  TECHNICAL_SPEC: "Technical Spec",
  ELIGIBILITY: "Eligibility",
  ADDENDUM: "Addendum",
  TERMS: "Terms",
  DRAWING: "Drawing",
  OTHER: "Document",
};

export function DocumentCard({ tenderId, document: doc, onPreview }: { tenderId: string; document: TenderDocumentSummary; onPreview: (doc: TenderDocumentSummary) => void }) {
  const downloadUrl = documentDownloadUrl(tenderId, doc.id);

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-secondary/40">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-secondary">
        <FileText className="h-5 w-5 text-foreground/70" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{doc.fileName}</p>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary" className="text-[10px]">{documentTypeLabels[doc.documentType] ?? doc.documentType}</Badge>
          <span>v{doc.version}</span>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <Button variant="ghost" size="icon" aria-label={`Preview ${doc.fileName}`} onClick={() => onPreview(doc)}>
          <Eye className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="sm" asChild>
          <a href={downloadUrl} download={doc.fileName}>
            <Download className="h-3.5 w-3.5" /> Download
          </a>
        </Button>
      </div>
    </div>
  );
}
