"use client";

import { useNow } from "@/lib/hooks/use-now";
import { formatElapsed } from "@/lib/utils";

const istClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function lastCrawl(at: string | null, now: number | null) {
  if (!at) return "No crawl yet";
  if (now === null) return "Last crawl -- min ago";
  const minutes = Math.max(0, Math.floor((now - Date.parse(at)) / 60_000));
  return minutes < 60 ? `Last crawl ${minutes} min ago` : `Last crawl ${formatElapsed(minutes * 60_000)} ago`;
}

export function StatusLine({ sources, lastCrawlAt }: { sources: number; lastCrawlAt: string | null }) {
  const now = useNow();

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-white/10 pb-3 font-mono text-[11px] uppercase tracking-[0.12em] text-white/55">
      <span className="flex items-center gap-2 text-white/85">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-success)] opacity-70" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-success)]" />
        </span>
        Live
      </span>
      <span>{sources.toLocaleString("en-IN")} sources</span>
      <span className="hidden sm:inline">{lastCrawl(lastCrawlAt, now)}</span>
      <span className="ml-auto tabular-nums text-white/70">
        IST {now === null ? "--:--:--" : istClock.format(now)}
      </span>
    </div>
  );
}
