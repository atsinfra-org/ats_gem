"use client";

import * as React from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { DocumentCard } from "@/components/documents/document-card";
import { DocumentViewer } from "@/components/documents/document-viewer";
import { AlertTriangle, FileQuestion, Info } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { ApiErrorState } from "@/components/states/status-error";
import { useFullList } from "@/lib/hooks/use-full-list";
import { EMBEDDED_PREVIEW_CAP } from "@/lib/api/tender-parts";
import type { TenderDetail, TenderDocumentSummary } from "@/lib/api/types";

const requirementTypeLabels: Record<string, string> = {
  ELIGIBILITY: "Eligibility",
  FINANCIAL: "Financial",
  TECHNICAL: "Technical",
  EXPERIENCE: "Experience",
  LEGAL: "Legal",
  REGISTRATION: "Registration",
  DOCUMENTATION: "Documentation",
  LOCATION: "Location",
  PERSONNEL: "Personnel",
  EQUIPMENT: "Equipment",
  OTHER: "Other",
};

const severityStyle: Record<string, string> = {
  ERROR: "text-destructive",
  WARNING: "text-[var(--color-warning)]",
  INFO: "text-muted-foreground",
};

function RequirementsList({ requirements }: { requirements: TenderDetail["requirements"] }) {
  if (requirements.length === 0) return <p className="text-sm text-muted-foreground">No structured requirements are available for this tender.</p>;
  const byType = new Map<string, typeof requirements>();
  for (const r of requirements) {
    if (!byType.has(r.type)) byType.set(r.type, []);
    byType.get(r.type)!.push(r);
  }
  return (
    <div className="space-y-6">
      {[...byType.entries()].map(([type, items]) => (
        <div key={type}>
          <h3 className="text-sm font-semibold text-foreground">{requirementTypeLabels[type] ?? type}</h3>
          <ul className="mt-2.5 space-y-2">
            {items.map((r) => (
              <li key={r.id} className="rounded-md border border-border p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-foreground">{r.title}</span>
                  {!r.isMandatory && <Badge variant="secondary" className="text-[10px]">Optional</Badge>}
                </div>
                {r.description && <p className="mt-1 text-muted-foreground">{r.description}</p>}
                {r.value && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {r.value}
                    {r.unit ? ` ${r.unit}` : ""}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function TimelineList({ timeline }: { timeline: TenderDetail["timeline"] }) {
  if (timeline.length === 0) return <p className="text-sm text-muted-foreground">No timeline events recorded for this tender.</p>;
  return (
    <ol className="space-y-4">
      {timeline.map((event) => (
        <li key={event.id} className="flex gap-3">
          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
          <div>
            <p className="text-sm font-medium text-foreground">
              {event.eventType.replaceAll("_", " ")}
              {event.eventAt && <span className="ml-2 font-normal text-muted-foreground">{format(new Date(event.eventAt), "dd MMM yyyy, h:mm a")}</span>}
            </p>
            {event.title && <p className="text-sm text-muted-foreground">{event.title}</p>}
            {event.description && <p className="text-sm text-muted-foreground">{event.description}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function CorrigendaList({ corrigenda }: { corrigenda: TenderDetail["corrigenda"] }) {
  if (corrigenda.length === 0) return <p className="text-sm text-muted-foreground">No corrigenda have been recorded for this tender.</p>;
  return (
    <ul className="space-y-3">
      {corrigenda.map((c) => (
        <li key={c.id} className="rounded-md border border-border p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium text-foreground">{c.title}</p>
            <span className="shrink-0 text-xs text-muted-foreground">{format(new Date(c.publishedAt), "dd MMM yyyy")}</span>
          </div>
          {c.description && <p className="mt-1 text-sm text-muted-foreground">{c.description}</p>}
          {c.affectedFields.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {c.affectedFields.map((f) => (
                <Badge key={f} variant="secondary" className="text-[10px]">{f}</Badge>
              ))}
            </div>
          )}
          {c.documentId && <p className="mt-2 text-xs text-muted-foreground">Linked document: <span className="font-mono">{c.documentId}</span></p>}
          {c.sourceUrl && (
            <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-primary hover:underline">
              View source
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

function LoadAll({ mayHaveMore, loading, error, onLoad }: { mayHaveMore: boolean; loading: boolean; error: unknown; onLoad: () => void }) {
  if (error) return <ApiErrorState error={error} onRetry={onLoad} />;
  if (!mayHaveMore) return null;
  return (
    <div className="mt-4 flex items-center gap-3">
      <p className="text-xs text-muted-foreground">Showing the first {EMBEDDED_PREVIEW_CAP}; there may be more.</p>
      <Button size="sm" variant="outline" onClick={onLoad} loading={loading}>Load all</Button>
    </div>
  );
}

function RequirementsSection({ tender }: { tender: TenderDetail }) {
  const list = useFullList(tender.id, "requirements", tender.requirements);
  return (
    <>
      <RequirementsList requirements={list.items} />
      <LoadAll mayHaveMore={list.mayHaveMore} loading={list.loading} error={list.error} onLoad={list.loadAll} />
    </>
  );
}

function TimelineSection({ tender }: { tender: TenderDetail }) {
  const list = useFullList(tender.id, "timeline", tender.timeline);
  return (
    <>
      <TimelineList timeline={list.items} />
      <LoadAll mayHaveMore={list.mayHaveMore} loading={list.loading} error={list.error} onLoad={list.loadAll} />
    </>
  );
}

function CorrigendaSection({ tender }: { tender: TenderDetail }) {
  const list = useFullList(tender.id, "corrigenda", tender.corrigenda);
  return (
    <>
      <CorrigendaList corrigenda={list.items} />
      <LoadAll mayHaveMore={list.mayHaveMore} loading={list.loading} error={list.error} onLoad={list.loadAll} />
    </>
  );
}

function fmtValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "none";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

function VersionsList({ versions }: { versions: TenderDetail["versions"] }) {
  if (versions.length === 0) return <p className="text-sm text-muted-foreground">No version history has been recorded for this tender.</p>;
  return (
    <>
      <ol className="space-y-3">
        {versions.map((v) => (
          <li key={v.version} className="rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-foreground">Version {v.version}</span>
              <Badge variant="secondary" className="text-[10px]">{v.changeType}</Badge>
              <span className="ml-auto text-xs text-muted-foreground">{format(new Date(v.detectedAt), "dd MMM yyyy, h:mm a")}</span>
            </div>
            {Object.keys(v.diff).length > 0 && (
              <dl className="mt-2 space-y-1 text-xs">
                {Object.entries(v.diff).map(([field, change]) => (
                  <div key={field} className="flex flex-wrap gap-x-2">
                    <dt className="font-medium text-foreground">{field}</dt>
                    <dd className="break-all text-muted-foreground">{fmtValue(change.from)} → {fmtValue(change.to)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        ))}
      </ol>
      {versions.length >= EMBEDDED_PREVIEW_CAP && <p className="mt-3 text-xs text-muted-foreground">Showing the {EMBEDDED_PREVIEW_CAP} most recent versions.</p>}
    </>
  );
}

function ProvenanceList({ provenance }: { provenance: TenderDetail["provenance"] }) {
  if (provenance.length === 0) return <p className="text-sm text-muted-foreground">No source records are linked to this tender.</p>;
  return (
    <ul className="space-y-3">
      {provenance.map((p) => (
        <li key={p.sourceId} className="rounded-md border border-border p-3 text-sm">
          <p className="font-medium text-foreground">Source <span className="font-mono text-xs text-muted-foreground">{p.sourceId}</span></p>
          {p.sourceUrl && (
            <a href={p.sourceUrl} target="_blank" rel="noreferrer" className="break-all text-xs text-primary hover:underline">{p.sourceUrl}</a>
          )}
          <dl className="mt-2 grid grid-cols-1 gap-1 text-xs sm:grid-cols-3">
            <div><dt className="text-muted-foreground">First seen</dt><dd className="text-foreground">{format(new Date(p.firstSeenAt), "dd MMM yyyy, h:mm a")}</dd></div>
            <div><dt className="text-muted-foreground">Last seen</dt><dd className="text-foreground">{format(new Date(p.lastSeenAt), "dd MMM yyyy, h:mm a")}</dd></div>
            <div><dt className="text-muted-foreground">Last changed</dt><dd className="text-foreground">{format(new Date(p.lastChangedAt), "dd MMM yyyy, h:mm a")}</dd></div>
          </dl>
        </li>
      ))}
    </ul>
  );
}

function DocumentsSection({ tender, onPreview }: { tender: TenderDetail; onPreview: (d: TenderDocumentSummary) => void }) {
  const list = useFullList(tender.id, "documents", tender.documents);
  return (
    <>
      {list.items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <FileQuestion className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">No documents are available for this tender yet.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {list.items.map((doc) => (
            <DocumentCard key={doc.id} tenderId={tender.id} document={doc} onPreview={onPreview} />
          ))}
        </div>
      )}
      <LoadAll mayHaveMore={list.mayHaveMore} loading={list.loading} error={list.error} onLoad={list.loadAll} />
    </>
  );
}

export function TenderTabs(
{ tender }: { tender: TenderDetail }) {
  const [viewerOpen, setViewerOpen] = React.useState(false);
  const [activeDoc, setActiveDoc] = React.useState<TenderDocumentSummary | null>(null);

  function openViewer(doc: TenderDocumentSummary) {
    setActiveDoc(doc);
    setViewerOpen(true);
  }

  const hasQualityIssues = tender.qualityIssues.length > 0;

  return (
    <>
      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="requirements">Requirements</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="corrigenda">Corrigenda{tender.corrigenda.length > 0 && ` (${tender.corrigenda.length})`}</TabsTrigger>
          <TabsTrigger value="versions">Versions{tender.versions.length > 0 && ` (${tender.versions.length})`}</TabsTrigger>
          <TabsTrigger value="sources">Sources</TabsTrigger>
          <TabsTrigger value="documents">Documents{tender.documents.length > 0 && ` (${tender.documents.length}${tender.documents.length >= EMBEDDED_PREVIEW_CAP ? "+" : ""})`}</TabsTrigger>
          {hasQualityIssues && <TabsTrigger value="quality">Data Quality</TabsTrigger>}
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Scope of Work</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground whitespace-pre-line">{tender.description || "No description available."}</p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Classification</h3>
              <dl className="mt-2 space-y-1.5 text-sm">
                <div className="flex justify-between"><dt className="text-muted-foreground">Category</dt><dd className="text-foreground">{tender.category?.name ?? "Not available"}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Sub-category</dt><dd className="text-foreground">{tender.subCategory?.name ?? "Not available"}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Tender Type</dt><dd className="text-foreground">{tender.tenderType?.name ?? "Not available"}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Procurement Type</dt><dd className="text-foreground">{tender.procurementType ?? "Not available"}</dd></div>
              </dl>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Source</h3>
              <dl className="mt-2 space-y-1.5 text-sm">
                <div className="flex justify-between"><dt className="text-muted-foreground">Source status</dt><dd className="text-foreground">{tender.sourceStatusRaw ?? "Not available"}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Last synced</dt><dd className="text-foreground">{format(new Date(tender.lastSyncedAt), "dd MMM yyyy, h:mm a")}</dd></div>
              </dl>
              {tender.primarySourceUrl && (
                <a href={tender.primarySourceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-primary hover:underline">
                  View on source portal
                </a>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="requirements">
          <RequirementsSection tender={tender} />
        </TabsContent>

        <TabsContent value="timeline">
          <TimelineSection tender={tender} />
        </TabsContent>

        <TabsContent value="corrigenda">
          <CorrigendaSection tender={tender} />
        </TabsContent>

        <TabsContent value="versions">
          <VersionsList versions={tender.versions} />
        </TabsContent>

        <TabsContent value="sources">
          <ProvenanceList provenance={tender.provenance} />
        </TabsContent>

        <TabsContent value="documents">
          <DocumentsSection tender={tender} onPreview={openViewer} />
        </TabsContent>

        {hasQualityIssues && (
          <TabsContent value="quality">
            <ul className="space-y-2.5">
              {tender.qualityIssues.map((issue, i) => (
                <li key={i} className="flex items-start gap-2.5 rounded-md border border-border p-3 text-sm">
                  {issue.severity === "ERROR" ? <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${severityStyle.ERROR}`} /> : <Info className={`mt-0.5 h-4 w-4 shrink-0 ${severityStyle[issue.severity]}`} />}
                  <div>
                    <p className="font-medium text-foreground">{issue.message}</p>
                    <p className="text-xs text-muted-foreground">{issue.code}</p>
                  </div>
                </li>
              ))}
            </ul>
          </TabsContent>
        )}
      </Tabs>

      <DocumentViewer
        open={viewerOpen}
        onOpenChange={setViewerOpen}
        tenderId={tender.id}
        documents={tender.documents}
        activeDocument={activeDoc}
        onSelect={setActiveDoc}
      />
    </>
  );
}
