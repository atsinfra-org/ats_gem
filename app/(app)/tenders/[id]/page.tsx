import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ChevronLeft } from "lucide-react";
import { TenderStatusBadge } from "@/components/tender/tender-status-badge";
import { TenderDetailActions } from "@/components/tender/tender-detail-actions";
import { TenderInformation } from "@/components/tender/tender-information";
import { ImportantDates } from "@/components/tender/important-dates";
import { TenderTabs } from "@/components/tender/tender-tabs";
import { getTender, getSimilar } from "@/lib/api/tenders";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const tender = await getTender(id);
  return { title: tender ? tender.title : "Tender Not Found" };
}

export default async function TenderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tender = await getTender(id);
  if (!tender) notFound();

  const similar = await getSimilar(tender);

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link href="/tenders" className="inline-flex items-center gap-1 hover:text-foreground">
          <ChevronLeft className="h-3.5 w-3.5" /> Back to Search Results
        </Link>
      </nav>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <TenderStatusBadge status={tender.status} />
            <span className="font-mono text-xs text-muted-foreground">{tender.tenderId}</span>
          </div>
          <h1 className="mt-2 text-xl font-bold leading-snug text-foreground sm:text-2xl">{tender.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{tender.department} · {tender.location}, {tender.state}</p>
        </div>
        <TenderDetailActions tenderId={tender.id} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          <TenderTabs tender={tender} similar={similar} />
        </div>
        <div className="space-y-6">
          <ImportantDates tender={tender} />
          <div>
            <h3 className="mb-3 text-sm font-semibold text-foreground">Tender Information</h3>
            <TenderInformation tender={tender} />
          </div>
        </div>
      </div>
    </div>
  );
}
