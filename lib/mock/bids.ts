import { tenders } from "@/lib/mock/tenders";

export type BidStage = "Preparing" | "Submitted" | "Under Evaluation" | "Won" | "Lost";

export interface Bid {
  id: string;
  tenderId: string;
  stage: BidStage;
  submittedOn: string | null;
  bidAmount: number | null;
  notes: string;
}

export const bids: Bid[] = [
  { id: "bid-1", tenderId: tenders[2].id, stage: "Submitted", submittedOn: "2026-09-18", bidAmount: tenders[2].estimatedValue * 0.96, notes: "Submitted via GeM portal with all required annexures." },
  { id: "bid-2", tenderId: tenders[5].id, stage: "Under Evaluation", submittedOn: "2026-09-10", bidAmount: tenders[5].estimatedValue * 0.98, notes: "Technical bid cleared, awaiting financial bid opening." },
  { id: "bid-3", tenderId: tenders[9].id, stage: "Preparing", submittedOn: null, bidAmount: null, notes: "Collecting compliance documents from finance team." },
  { id: "bid-4", tenderId: tenders[14].id, stage: "Won", submittedOn: "2026-08-02", bidAmount: tenders[14].estimatedValue * 0.94, notes: "Awarded L1. Work order issued on 20 Aug 2026." },
  { id: "bid-5", tenderId: tenders[18].id, stage: "Lost", submittedOn: "2026-07-15", bidAmount: tenders[18].estimatedValue * 0.99, notes: "Lost to L1 bidder by 2.1% margin." },
];
