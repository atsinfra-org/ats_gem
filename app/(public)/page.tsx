import type { Metadata } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { TerminalHero } from "@/components/landing/hero/terminal-hero";
import { TheDesk } from "@/components/landing/the-desk";
import { WireToWin } from "@/components/landing/wire-to-win";
import { Voices } from "@/components/landing/voices";
import { PricingLedger } from "@/components/landing/pricing-ledger";
import { TerminalCta } from "@/components/landing/terminal-cta";
import { JsonLd } from "@/components/seo/json-ld";
import { getClosingBoard, getMarketSnapshot, getWire } from "@/lib/api/market";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import type { ClosingItem, MarketSnapshot, WireItem } from "@/lib/types";

// Matches the backend's 5-minute snapshot cache.
export const revalidate = 300;

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

const emptySnapshot: MarketSnapshot = {
  liveTenders: 0,
  closingThisWeekCr: 0,
  sources: 0,
  lastCrawlAt: null,
  states: [],
  topBuyers: [],
  valueBands: [],
  portals: [],
};

async function loadMarket(): Promise<[MarketSnapshot, WireItem[], ClosingItem[]]> {
  try {
    return await Promise.all([getMarketSnapshot(), getWire(), getClosingBoard()]);
  } catch (err) {
    // In production a failed regeneration throws, so Next keeps serving the last good page. The build
    // (API may not be reachable yet) and local dev render empty market data instead of failing.
    if (process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== PHASE_PRODUCTION_BUILD) throw err;
    return [emptySnapshot, [], []];
  }
}

export default async function HomePage() {
  const [snapshot, wire, closing] = await loadMarket();

  return (
    <>
      <JsonLd data={{ "@context": "https://schema.org", "@graph": [{ "@type": "WebSite", name: SITE_NAME, url: SITE_URL }, { "@type": "Organization", name: SITE_NAME, url: SITE_URL }] }} />
      <TerminalHero snapshot={snapshot} wire={wire} />
      <TheDesk snapshot={snapshot} closing={closing} />
      <WireToWin />
      <Voices />
      <PricingLedger />
      <TerminalCta />
    </>
  );
}
