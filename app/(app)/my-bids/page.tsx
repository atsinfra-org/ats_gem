import Link from "next/link";
import type { Metadata } from "next";
import { Briefcase } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/states/empty-state";
import { bids, type BidStage } from "@/lib/mock/bids";
import { getTenderById } from "@/lib/mock/tenders";
import { formatINR } from "@/lib/utils";
import { format } from "date-fns";

export const metadata: Metadata = { title: "My Bids" };

const stageVariant: Record<BidStage, "secondary" | "info" | "warning" | "success" | "danger"> = {
  Preparing: "secondary",
  Submitted: "info",
  "Under Evaluation": "warning",
  Won: "success",
  Lost: "danger",
};

export default function MyBidsPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">My Bids</h1>
        <p className="mt-1 text-sm text-muted-foreground">Track the tenders you&apos;re actively bidding on.</p>
      </div>

      {bids.length === 0 ? (
        <EmptyState icon={Briefcase} title="No bids tracked yet" description="Start tracking a tender to see its bid status here." actionLabel="Browse Tenders" actionHref="/tenders" />
      ) : (
        <div className="space-y-3">
          {bids.map((bid) => {
            const tender = getTenderById(bid.tenderId);
            if (!tender) return null;
            return (
              <Card key={bid.id} className="p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant={stageVariant[bid.stage]}>{bid.stage}</Badge>
                      <span className="font-mono text-xs text-muted-foreground">{tender.tenderId}</span>
                    </div>
                    <Link href={`/tenders/${tender.id}`} className="mt-1.5 block text-sm font-semibold text-foreground hover:text-primary">
                      {tender.title}
                    </Link>
                    <p className="mt-1 text-xs text-muted-foreground">{bid.notes}</p>
                  </div>
                  <div className="shrink-0 text-left sm:text-right">
                    <p className="text-sm font-semibold text-foreground">
                      {bid.bidAmount ? formatINR(bid.bidAmount) : "Not submitted"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {bid.submittedOn ? `Submitted ${format(new Date(bid.submittedOn), "dd MMM yyyy")}` : "Preparing bid"}
                    </p>
                    <Button size="sm" variant="outline" className="mt-2" asChild>
                      <Link href={`/tenders/${tender.id}`}>View Tender</Link>
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
