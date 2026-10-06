import type { Metadata } from "next";
import { TerminalHero } from "@/components/landing/hero/terminal-hero";
import { TheDesk } from "@/components/landing/the-desk";
import { WireToWin } from "@/components/landing/wire-to-win";
import { Voices } from "@/components/landing/voices";
import { PricingLedger } from "@/components/landing/pricing-ledger";
import { TerminalCta } from "@/components/landing/terminal-cta";
import { getClosingBoard, getMarketSnapshot, getWire } from "@/lib/api/market";

export const revalidate = 900;

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default async function HomePage() {
  const [snapshot, wire, closing] = await Promise.all([getMarketSnapshot(), getWire(), getClosingBoard()]);

  return (
    <>
      <TerminalHero snapshot={snapshot} wire={wire} />
      <TheDesk snapshot={snapshot} closing={closing} />
      <WireToWin />
      <Voices />
      <PricingLedger />
      <TerminalCta />
    </>
  );
}
