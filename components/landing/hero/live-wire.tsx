"use client";

import * as React from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Pause, Play, X } from "lucide-react";
import type { WireItem } from "@/lib/types";
import { formatCompactINR } from "@/lib/utils";

const VISIBLE = 5;
const liveStamps = ["now", "1m", "3m", "6m", "9m"];
const filteredStamps = ["12m", "47m", "2h", "5h", "9h"];

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
  const [head, setHead] = React.useState(VISIBLE - 1);
  const [paused, setPaused] = React.useState(false);
  const [hovering, setHovering] = React.useState(false);
  const streaming = !filter && !paused && !hovering && !reduceMotion && items.length > VISIBLE;

  React.useEffect(() => {
    if (!streaming) return;
    const id = setInterval(() => setHead((h) => (h + 1) % items.length), 3200);
    return () => clearInterval(id);
  }, [streaming, items.length]);

  const visible = filter
    ? items.filter((i) => i.stateCode === filter.code).slice(0, VISIBLE)
    : Array.from({ length: Math.min(VISIBLE, items.length) }, (_, i) => items[(head - i + items.length) % items.length]);
  const stamps = filter ? filteredStamps : liveStamps;

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
          {visible.map((item, i) => (
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
                <span className="font-mono text-[11px] text-white/55">{stamps[i]}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm text-white/85">{item.title}</span>
                  <span className="block truncate text-xs text-white/55">{item.department}</span>
                </span>
                <span className="text-right font-mono text-xs">
                  <span className="block text-[var(--color-success)]">{formatCompactINR(item.value)}</span>
                  <span className="block text-white/55">{item.stateCode}</span>
                </span>
              </Link>
            </motion.li>
          ))}
        </AnimatePresence>

        {filter && visible.length === 0 && (
          <li className="py-8 text-sm text-white/60">
            Nothing new from {filter.name} in the last hour.{" "}
            <Link
              href={`/tenders?state=${encodeURIComponent(filter.name)}`}
              className="text-white underline decoration-primary underline-offset-4"
            >
              {filter.live.toLocaleString("en-IN")} tenders are live there
            </Link>
            .
          </li>
        )}
      </ul>
    </div>
  );
}
