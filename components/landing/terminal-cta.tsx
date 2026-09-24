"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TerminalSearch } from "@/components/landing/hero/terminal-search";
import { useAuthDialog } from "@/lib/store/auth-dialog-store";

export function TerminalCta() {
  const { open: openAuth } = useAuthDialog();

  return (
    <section className="relative overflow-hidden bg-ink text-white">
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-48 left-1/3 h-[440px] w-[780px] rounded-full bg-primary/15 blur-[130px]"
      />
      <div className="relative mx-auto max-w-7xl px-4 py-28 sm:px-6 lg:px-8 lg:py-36">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/55">End of edition</p>
        <h2 className="mt-5 font-display text-[clamp(3.5rem,11vw,8.5rem)] leading-[0.95]">
          Find. Track. <em className="text-primary">Win.</em>
        </h2>

        <div className="mt-12 grid gap-10 lg:grid-cols-2 lg:gap-16">
          <p className="max-w-md text-lg leading-relaxed text-white/65">
            Your next contract is probably already on the wire. Tell us what you bid on and we&apos;ll show you where
            it is — or set up an account and let the alerts come to you.
          </p>
          <div>
            <TerminalSearch id="cta-search" placeholder="what do you bid on?" showSuggestions={false} />
            <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
              <Button size="lg" onClick={openAuth}>
                Create free account <ArrowRight className="h-4 w-4" />
              </Button>
              <Link
                href="/contact"
                className="text-sm font-medium text-white/70 underline decoration-white/30 underline-offset-4 transition-colors hover:text-white hover:decoration-white"
              >
                or talk to sales
              </Link>
            </div>
          </div>
        </div>

        <p className="mt-12 font-mono text-[11px] uppercase tracking-[0.14em] text-white/55">
          Free plan · No card required · <span className="whitespace-nowrap">Cancel anytime</span>
        </p>
      </div>
    </section>
  );
}
