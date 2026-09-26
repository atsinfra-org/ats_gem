import { apiRequest } from "./client";
import type { Money } from "./types";
import type { ClosingItem, MarketSnapshot, PortalSnapshot, ValueBand, WireItem } from "@/lib/types";

/** Landing-page market data (backend/docs/API-CONTRACT.md §6), mapped to the shapes the landing components render. */

interface ApiSnapshot {
  liveTenders: number;
  closingThisWeek: Money;
  sources: number;
  lastCrawlAt: string | null;
  states: { code: string; name: string; type: string; live: number; closingThisWeek: Money; topBuyer: string | null }[];
  topBuyers: { id: string; name: string; shortName: string | null; live: number; value: Money }[];
  valueBands: { key: string; min: string | null; max: string | null; count: number }[];
  portals: { id: string; name: string; status: PortalSnapshot["status"]; lastSyncedAt: string | null; today: number }[];
}

interface ApiWireItem {
  id: string;
  title: string;
  department: string | null;
  value: Money | null;
  state: { code: string; name: string } | null;
  publishedAt: string;
}

interface ApiClosingItem {
  id: string;
  title: string;
  department: string | null;
  closingAt: string;
}

const BANDS: Record<string, Omit<ValueBand, "count">> = {
  UNDER_10L: { label: "Under ₹10 Lakh", short: "<10L", underOneCrore: true },
  "10L_TO_1CR": { label: "₹10 Lakh – ₹1 Crore", short: "10L–1Cr", underOneCrore: true },
  "1CR_TO_10CR": { label: "₹1 – ₹10 Crore", short: "1–10Cr", underOneCrore: false },
  "10CR_TO_100CR": { label: "₹10 – ₹100 Crore", short: "10–100Cr", underOneCrore: false },
  OVER_100CR: { label: "Over ₹100 Crore", short: ">100Cr", underOneCrore: false },
};

/** Whole crores from ₹100 Cr up, two decimals below that, so small totals don't round to "₹0 Cr". */
function toCrore(money: Money): number {
  const crore = Number(money.amount) / 1e7;
  if (!Number.isFinite(crore)) return 0;
  return crore >= 100 ? Math.round(crore) : Math.round(crore * 100) / 100;
}

function inrValue(money: Money | null): number | null {
  if (!money || money.currency !== "INR") return null;
  const value = Number(money.amount);
  return Number.isFinite(value) ? value : null;
}

export async function getMarketSnapshot(): Promise<MarketSnapshot> {
  const s = await apiRequest<ApiSnapshot>("/market/snapshot", { anonymous: true });
  return {
    liveTenders: s.liveTenders,
    closingThisWeekCr: toCrore(s.closingThisWeek),
    sources: s.sources,
    lastCrawlAt: s.lastCrawlAt,
    states: s.states.map((st) => ({ code: st.code, name: st.name, live: st.live, closingWeekCr: toCrore(st.closingThisWeek), topBuyer: st.topBuyer })),
    topBuyers: s.topBuyers.map((b) => ({ name: b.name, short: b.shortName ?? b.name, live: b.live, valueCr: toCrore(b.value) })),
    valueBands: s.valueBands.flatMap((b) => (BANDS[b.key] ? [{ ...BANDS[b.key], count: b.count }] : [])),
    portals: s.portals.map((p) => ({ name: p.name, status: p.status, lastSyncedAt: p.lastSyncedAt, today: p.today })),
  };
}

export async function getWire(options: { limit?: number; state?: string; signal?: AbortSignal } = {}): Promise<WireItem[]> {
  const rows = await apiRequest<ApiWireItem[]>("/market/wire", {
    query: { limit: options.limit ?? 40, state: options.state },
    signal: options.signal,
    anonymous: true,
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    department: r.department ?? "",
    value: inrValue(r.value),
    stateName: r.state?.name ?? null,
    stateCode: r.state?.code ?? null,
    publishedAt: r.publishedAt,
  }));
}

export async function getClosingBoard(limit = 5): Promise<ClosingItem[]> {
  const rows = await apiRequest<ApiClosingItem[]>("/market/closing", { query: { limit }, anonymous: true });
  return rows.map((r) => ({ id: r.id, title: r.title, department: r.department ?? "", deadline: r.closingAt }));
}
