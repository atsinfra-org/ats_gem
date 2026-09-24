"use client";

import * as React from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { DocumentCard } from "@/components/documents/document-card";
import { DocumentViewer } from "@/components/documents/document-viewer";
import { TenderCard } from "@/components/tender/tender-card";
import { CheckCircle2, Download } from "lucide-react";
import { toast } from "sonner";
import type { Tender, TenderDocument } from "@/lib/types";
import { downloadAllDocuments } from "@/lib/api/documents";

function List({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2.5">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2.5 text-sm text-foreground">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-success)]" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function TenderTabs({ tender, similar }: { tender: Tender; similar: Tender[] }) {
  const [viewerOpen, setViewerOpen] = React.useState(false);
  const [activeDoc, setActiveDoc] = React.useState<TenderDocument | null>(null);
  const [downloadingAll, setDownloadingAll] = React.useState(false);

  function openViewer(doc: TenderDocument) {
    setActiveDoc(doc);
    setViewerOpen(true);
  }

  async function handleDownloadAll() {
    setDownloadingAll(true);
    await downloadAllDocuments(tender.id);
    setDownloadingAll(false);
    toast.success("All documents download started");
  }

  return (
    <>
      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="eligibility">Eligibility</TabsTrigger>
          <TabsTrigger value="terms">Terms &amp; Conditions</TabsTrigger>
          <TabsTrigger value="process">Bidding Process</TabsTrigger>
          <TabsTrigger value="similar">Similar Tenders</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Scope of Work</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{tender.description}</p>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Technical Requirements</h3>
            <div className="mt-3"><List items={tender.technicalRequirements} /></div>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">Financial Requirements</h3>
            <div className="mt-3"><List items={tender.financialRequirements} /></div>
          </div>
        </TabsContent>

        <TabsContent value="documents">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{tender.documents.length} documents available</p>
            <Button size="sm" onClick={handleDownloadAll} loading={downloadingAll}>
              <Download className="h-3.5 w-3.5" /> Download All
            </Button>
          </div>
          <div className="space-y-2.5">
            {tender.documents.map((doc) => (
              <DocumentCard key={doc.id} document={doc} onPreview={openViewer} />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="eligibility">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Eligibility Requirements</h3>
          <List items={tender.eligibility} />
        </TabsContent>

        <TabsContent value="terms">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Terms &amp; Conditions</h3>
          <List items={tender.termsAndConditions} />
        </TabsContent>

        <TabsContent value="process">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Bidding Process</h3>
          <ol className="space-y-4">
            {tender.biddingProcess.map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  {i + 1}
                </span>
                <p className="text-sm text-foreground pt-0.5">{step}</p>
              </li>
            ))}
          </ol>
        </TabsContent>

        <TabsContent value="similar">
          {similar.length === 0 ? (
            <p className="text-sm text-muted-foreground">No similar tenders found.</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {similar.map((t) => (
                <TenderCard key={t.id} tender={t} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <DocumentViewer
        open={viewerOpen}
        onOpenChange={setViewerOpen}
        documents={tender.documents}
        activeDocument={activeDoc}
        onSelect={setActiveDoc}
      />
    </>
  );
}
