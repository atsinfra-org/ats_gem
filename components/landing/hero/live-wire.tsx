"use client";

import * as React from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Pause, Play, X } from "lucide-react";
import { getWire } from "@/lib/api/market";
import { useNow } from "@/lib/hooks/use-now";
import type { WireItem } from "@/lib/types";
import { formatCompactINR, formatElapsed } from "@/lib/utils";

const VISIBLE = 5;
/** Ticks of catch-up the ticker plays before settling on the latest tenders. */
const REPLAY = 8;

export function LiveWire({
  items,
  filter,
  onClearFilter,
}: {
  items: WireItem[];
  filter: { code: string; name: string; live: number } | null;
  onClearFilter: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const now = useNow();
  // `items` is newest first; the ticker plays it oldest to newest so each tick brings a newer tender to
  // the top, and it settles on the latest ones.
  const feed = React.useMemo(() => [...items].reverse(), [items]);
  const last = feed.length - 1;
  const [head, setHead] = React.useState(Math.max(Math.min(VISIBLE, feed.length) - 1, last - REPLAY));
  const [paused, setPaused] = React.useState(false);
  const [hovering, setHovering] = React.useState(false);
  const shownHead = reduceMotion ? last : head;
  const streaming = !filter && !paused && !hovering && !reduceMotion && head < last;

  React.useEffect(() => {
    if (!streaming) return;
    const id = setInterval(() => setHead((h) => Math.min(h + 1, last)), 3200);
    return () => clearInterval(id);
  }, [streaming, last]);

  // A state's latest tenders are fetched on demand (the national feed rarely covers every state), once per state.
  const [byState, setByState] = React.useState<Record<string, WireItem[]>>({});
  const filterCode = filter && filter.live > 0 ? filter.code : null;
  React.useEffect(() => {
    if (!filterCode || byState[filterCode]) return;
    const controller = new AbortController();
    // Short delay so sweeping the pointer across the map only fetches the state it stops on.
    const timer = setTimeout(() => {
      getWire({ state: filterCode, limit: VISIBLE, signal: controller.signal })
        .catch(() => items.filter((i) => i.stateCode === filterCode).slice(0, VISIBLE))
        .then((rows) => {
          if (!controller.signal.aborted) setByState((prev) => ({ ...prev, [filterCode]: rows }));
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [filterCode, byState, items]);

  const filtered = filter ? (filter.live > 0 ? byState[filter.code] : []) : undefined;
  const loading = filter !== null && filtered === undefined;
  const visible = filter
    ? (filtered ?? [])
    : Array.from({ length: Math.min(VISIBLE, feed.length) }, (_, i) => feed[shownHead - i]);

  return (
    <div
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onFocus={() => setHovering(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHovering(false);
      }}
    >
      <div className="flex items-center justify-between border-b border-white/10 pb-2.5 font-mono text-[11px] uppercase tracking-[0.12em]">
        <span className="text-white/85">The wire</span>
        {filter ? (
          <button
            type="button"
            onClick={onClearFilter}
            className="flex items-center gap-1.5 text-white/55 transition-colors hover:text-white"
          >
            {filter.name} <X className="h-3 w-3" />
            <span className="sr-only">Clear state filter</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            aria-pressed={paused}
            className="flex items-center gap-1.5 text-white/55 transition-colors hover:text-white"
          >
            {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            {paused ? "Resume" : "Pause"}
          </button>
        )}
      </div>

      <ul className="relative min-h-[17.5rem]">
        <AnimatePresence initial={false} mode="popLayout">
          {visible.map((item) => (
            <motion.li
              key={item.id}
              layout={!reduceMotion}
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
            >
              <Link
                href={`/tenders/${item.id}`}
                className="-mx-2 grid grid-cols-[2.25rem_1fr_auto] items-baseline gap-3 rounded border-b border-white/[0.06] px-2 py-2.5 transition-colors hover:bg-white/[0.04]"
              >
                <span className="font-mono text-[11px] text-white/55">
                  {now === null ? "--" : formatElapsed(now - Date.parse(item.publishedAt))}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm text-white/85">{item.title}</span>
                  <span className="block truncate text-xs text-white/55">{item.department}</span>
                </span>
                <span className="text-right font-mono text-xs">
                  <span className="block text-[var(--color-success)]">
                    {item.value === null ? "—" : formatCompactINR(item.value)}
                  </span>
                  <span className="block text-white/55">{item.stateCode ?? "—"}</span>
                </span>
              </Link>
            </motion.li>
          ))}
        </AnimatePresence>

        {filter && !loading && visible.length === 0 && (
          <li className="py-8 text-sm text-white/60">
            {filter.live === 0 ? (
              <>No live tenders from {filter.name} right now.</>
            ) : (
              <>
                Nothing new from {filter.name} in the last hour.{" "}
                <Link
                  href={`/tenders?state=${filter.code}`}
                  className="text-white underline decoration-primary underline-offset-4"
                >
                  {filter.live.toLocaleString("en-IN")} tenders are live there
                </Link>
                .
              </>
            )}
          </li>
        )}
      </ul>
    </div>
  );
}
