import Link from "next/link";
import { Building2, MapPin, Calendar, IndianRupee, Landmark } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TenderStatusBadge } from "@/components/tender/tender-status-badge";
import { DeadlineBadge } from "@/components/tender/deadline-badge";
import { SaveTenderButton } from "@/components/tender/save-tender-button";
import { MatchReasonBadge } from "@/components/search/match-reason";
import type { TenderSummary } from "@/lib/api/types";
import { formatMoney, cn } from "@/lib/utils";
import { format } from "date-fns";

export function TenderCard({ tender, view = "grid" }: { tender: TenderSummary; view?: "grid" | "list" }) {
  const location = [tender.city, tender.state].filter(Boolean).join(", ") || "Location not specified";

  return (
    <Card
      className={cn(
        "group relative flex gap-4 p-5 transition-all duration-200 ease-out",
        "hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg",
        view === "grid" ? "flex-col" : "flex-col md:flex-row md:items-start"
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {tender.referenceNumber && <span className="font-mono">{tender.referenceNumber}</span>}
            <MatchReasonBadge reason={tender.matchReason} />
          </div>
          <TenderStatusBadge status={tender.status} />
        </div>

        <Link href={`/tenders/${tender.id}`} className="mt-2 block">
          <h3 className="text-base font-semibold leading-snug text-foreground group-hover:text-primary transition-colors line-clamp-2">
            {tender.title}
          </h3>
        </Link>

        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
          <div className="flex items-center gap-1.5 min-w-0">
            <Building2 className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{tender.procuringEntity?.name ?? tender.department ?? "Not specified"}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{location}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <IndianRupee className="h-3.5 w-3.5 shrink-0" />
            <span>Value: {formatMoney(tender.estimatedValue)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Landmark className="h-3.5 w-3.5 shrink-0" />
            <span>EMD: {formatMoney(tender.emdAmount)}</span>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {tender.category && (
            <span className="rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">{tender.category.name}</span>
          )}
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Calendar className="h-3 w-3" /> Published {format(new Date(tender.publishedAt), "dd MMM yyyy")}
          </span>
        </div>
      </div>

      <div
        className={cn(
          "flex items-center gap-2 pt-3 border-t border-border md:border-t-0 md:pt-0",
          view === "list" && "md:flex-col md:items-end md:border-l md:border-t-0 md:pl-4 md:min-w-[180px]"
        )}
      >
        {tender.closingAt && <DeadlineBadge date={tender.closingAt} />}
        <div className="ml-auto flex items-center gap-2 md:ml-0 md:mt-2">
          <SaveTenderButton tenderId={tender.id} showLabel={false} size="icon" />
          <Button asChild size="sm">
            <Link href={`/tenders/${tender.id}`}>View Details</Link>
          </Button>
        </div>
      </div>
    </Card>
  );
}
