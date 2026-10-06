"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import type { MarketSnapshot, StateSnapshot, WireItem } from "@/lib/types";
import { StatusLine } from "@/components/landing/hero/status-line";
import { TerminalSearch } from "@/components/landing/hero/terminal-search";
import { IndiaMap } from "@/components/landing/hero/india-map";
import { LiveWire } from "@/components/landing/hero/live-wire";

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/55">{label}</p>
      <p className="mt-1 truncate font-mono text-sm text-white" title={value}>
        {value}
      </p>
    </div>
  );
}

export function TerminalHero({ snapshot, wire }: { snapshot: MarketSnapshot; wire: WireItem[] }) {
  const router = useRouter();
  // Hover previews sit on top of the pinned choice (dropdown, keyboard or tap) and fall back to it when they end.
  const [pinned, setPinned] = React.useState<string | null>(null);
  const [hovered, setHovered] = React.useState<string | null>(null);
  const selected = hovered ?? pinned;
  const showingPinned = hovered === null && pinned !== null;

  function pin(code: string | null) {
    setPinned(code);
    setHovered(null);
  }
  const state = snapshot.states.find((s) => s.code === selected) ?? null;
  const closingCr = state ? state.closingWeekCr : snapshot.closingThisWeekCr;
  const statesByName = React.useMemo(
    () => [...snapshot.states].sort((a, b) => a.name.localeCompare(b.name)),
    [snapshot.states]
  );

  const tendersHref = (s: StateSnapshot) => `/tenders?state=${encodeURIComponent(s.name)}`;

  function openState(s: StateSnapshot) {
    router.push(tendersHref(s));
  }

  return (
    <MotionConfig reducedMotion="user">
      <section className="relative -mt-16 overflow-hidden bg-ink text-white">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-40 top-20 h-[520px] w-[520px] rounded-full bg-primary/10 blur-[130px]"
        />

        <div className="relative mx-auto max-w-7xl px-4 pb-16 pt-24 sm:px-6 lg:px-8 lg:pb-24">
          <StatusLine sources={snapshot.sources} lastCrawlMinutesAgo={snapshot.lastCrawlMinutesAgo} />

          <div className="mt-10 grid gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <div className="min-w-0 lg:col-start-1 lg:row-start-1">
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-primary">
                Closing this week · {state ? state.name : "All India"}
              </p>
              <h1 className="mt-4">
                <span className="relative block overflow-hidden font-display text-[clamp(3.5rem,11vw,8rem)] leading-[1] tracking-tight">
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.span
                      key={closingCr}
                      className="inline-block"
                      initial={{ y: "60%", opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      exit={{ y: "-60%", opacity: 0 }}
                      transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
                    >
                      ₹{closingCr.toLocaleString("en-IN")} Cr
                    </motion.span>
                  </AnimatePresence>
                </span>
                <span className="mt-5 block max-w-lg text-lg leading-relaxed text-white/65 sm:text-xl">
                  in government and private tenders closing this week
                  {state ? ` in ${state.name}` : " across India"}. Find yours before the deadline does.
                </span>
              </h1>
              <div className="mt-8">
                <TerminalSearch
                  id="hero-search"
                  placeholder={`Search ${snapshot.liveTenders.toLocaleString("en-IN")} live tenders`}
                />
              </div>
            </div>

            <div className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">
              <div className="mx-auto max-w-[460px] lg:mr-0">
                <div className="mb-5 flex items-center justify-between gap-4">
                  <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/55">India · by state</p>
                  <label htmlFor="state-jump" className="sr-only">
                    Jump to a state
                  </label>
                  <select
                    id="state-jump"
                    value={pinned ?? ""}
                    onChange={(e) => pin(e.target.value || null)}
                    className="h-10 max-w-[15rem] cursor-pointer truncate rounded-md border border-white/15 bg-ink px-2.5 font-mono text-xs text-white/85 outline-none transition-colors hover:border-white/30 focus-visible:border-white/60 sm:h-8"
                  >
                    <option value="">All 28 states and 8 UTs</option>
                    {statesByName.map((s) => (
                      <option key={s.code} value={s.code}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <IndiaMap
                  states={snapshot.states}
                  selected={selected}
                  onSelect={(code, isPinned) => (isPinned ? pin(code) : setHovered(code))}
                  onHoverEnd={() => setHovered(null)}
                  onOpen={openState}
                />

                <div aria-live="polite" className="mt-6 border-t border-white/10 pt-4">
                  <div className="flex items-baseline justify-between gap-4">
                    <p className="min-w-0 truncate text-base font-medium text-white">{state ? state.name : "All India"}</p>
                    {state && showingPinned ? (
                      <Link
                        href={tendersHref(state)}
                        className="flex shrink-0 items-center gap-1 font-mono text-[11px] uppercase tracking-[0.12em] text-white underline decoration-primary decoration-2 underline-offset-4 hover:text-primary"
                      >
                        View tenders <ArrowUpRight className="h-3 w-3" />
                      </Link>
                    ) : (
                      <p className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-white/55">
                        {state ? "Click to open" : "Hover or pick a state"}
                      </p>
                    )}
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-4">
                    <Metric label="Live" value={(state?.live ?? snapshot.liveTenders).toLocaleString("en-IN")} />
                    <Metric label="Closing 7d" value={`₹${closingCr.toLocaleString("en-IN")} Cr`} />
                    <Metric label="Top buyer" value={state?.topBuyer ?? snapshot.topBuyers[0].short} />
                  </div>
                </div>
                <a
                  href="https://simplemaps.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 inline-block font-mono text-[10px] text-white/55 transition-colors hover:text-white"
                >
                  Map: Simplemaps
                </a>
              </div>
            </div>

            <div className="min-w-0 lg:col-start-1 lg:row-start-2">
              <LiveWire
                items={wire}
                filter={state ? { code: state.code, name: state.name, live: state.live } : null}
                onClearFilter={() => pin(null)}
              />
            </div>
          </div>
        </div>
      </section>
    </MotionConfig>
  );
}
