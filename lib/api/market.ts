import { marketSnapshot } from "@/lib/mock/market";
import { tenders } from "@/lib/mock/tenders";
import { hasPassed } from "@/lib/utils";
import type { ClosingItem, MarketSnapshot, WireItem } from "@/lib/types";

const delay = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));

export async function getMarketSnapshot(): Promise<MarketSnapshot> {
  await delay();
  return marketSnapshot;
}

export async function getWire(limit = 40): Promise<WireItem[]> {
  await delay();
  const codeByName = new Map(marketSnapshot.states.map((s) => [s.name, s.code]));
  return tenders
    .filter((t) => t.status !== "closed")
    .sort((a, b) => new Date(b.publishedDate).getTime() - new Date(a.publishedDate).getTime())
    .slice(0, limit)
    .map((t) => ({
      id: t.id,
      title: t.title,
      department: t.department,
      value: t.estimatedValue,
      stateName: t.state,
      stateCode: codeByName.get(t.state) ?? t.state.slice(0, 2).toUpperCase(),
    }));
}

export async function getClosingBoard(limit = 5): Promise<ClosingItem[]> {
  await delay();
  return tenders
    .filter((t) => !hasPassed(t.submissionDeadline))
    .sort((a, b) => new Date(a.submissionDeadline).getTime() - new Date(b.submissionDeadline).getTime())
    .slice(0, limit)
    .map((t) => ({ id: t.id, title: t.title, department: t.department, deadline: t.submissionDeadline }));
}
