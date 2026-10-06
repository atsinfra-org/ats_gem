import type { ReactNode } from "react";
import type { ClosingItem, MarketSnapshot } from "@/lib/types";
import { SectionHeading } from "@/components/landing/section-heading";
import { ClosingBoard } from "@/components/landing/closing-board";
import { cn } from "@/lib/utils";

function compact(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function DeskCell({ title, meta, children }: { title: string; meta: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col bg-panel p-6">
      <div className="flex items-baseline justify-between gap-3 border-b border-white/10 pb-3 font-mono text-[11px] uppercase tracking-[0.12em]">
        <h3 className="text-white/85">{title}</h3>
        <span className="text-white/55">{meta}</span>
      </div>
      <div className="mt-5 flex flex-1 flex-col">{children}</div>
    </div>
  );
}

const statusStyle = {
  ok: { dot: "bg-[var(--color-success)]", label: "Synced" },
  delayed: { dot: "bg-[var(--color-warning)]", label: "Delayed" },
  down: { dot: "bg-destructive", label: "Down" },
};

export function TheDesk({ snapshot, closing }: { snapshot: MarketSnapshot; closing: ClosingItem[] }) {
  const maxBuyer = Math.max(...snapshot.topBuyers.map((b) => b.live));
  const maxBand = Math.max(...snapshot.valueBands.map((b) => b.count));
  const totalBands = snapshot.valueBands.reduce((sum, b) => sum + b.count, 0);
  const smallTicketShare = Math.round(
    (snapshot.valueBands.filter((b) => b.underOneCrore).reduce((sum, b) => sum + b.count, 0) / totalBands) * 100
  );

  return (
    <section className="bg-panel text-white">
      <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
        <SectionHeading
          tone="dark"
          section="B"
          kicker="The desk"
          title={
            <>
              Where the market is <em className="text-primary">moving.</em>
            </>
          }
          aside="Four live views of India's tender market, refreshed with every crawl. Open any row to see the tenders behind it."
        />

        <div className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
          <DeskCell title="Closing soonest" meta="Countdown">
            <ClosingBoard items={closing} />
          </DeskCell>

          <DeskCell title="Top buyers" meta="Live tenders">
            <ol className="space-y-4">
              {snapshot.topBuyers.map((b, i) => (
                <li key={b.short}>
                  <div className="flex items-baseline gap-3 text-sm">
                    <span className="font-mono text-[11px] text-white/55">{String(i + 1).padStart(2, "0")}</span>
                    <span className="flex-1 truncate text-white/85" title={b.name}>
                      {b.short}
                    </span>
                    <span className="font-mono text-xs tabular-nums text-white/65">{b.live.toLocaleString("en-IN")}</span>
                  </div>
                  <div className="ml-7 mt-1.5 h-0.5 rounded-full bg-white/10">
                    <div className="h-0.5 rounded-full bg-primary" style={{ width: `${(b.live / maxBuyer) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ol>
          </DeskCell>

          <DeskCell title="Value bands" meta="All live">
            <div className="flex h-44 items-end gap-2" role="img" aria-label={snapshot.valueBands.map((b) => `${b.label}: ${b.count.toLocaleString("en-IN")}`).join(", ")}>
              {snapshot.valueBands.map((b) => (
                <div key={b.short} className="flex flex-1 flex-col items-center justify-end">
                  <span className="mb-1.5 font-mono text-[10px] text-white/60">{compact(b.count)}</span>
                  <div
                    className={cn("w-full rounded-t-[3px]", b.underOneCrore ? "bg-white/75" : "bg-white/30")}
                    style={{ height: Math.max(4, Math.round((b.count / maxBand) * 132)) }}
                  />
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-2 border-t border-white/10 pt-2">
              {snapshot.valueBands.map((b) => (
                <span key={b.short} className="flex-1 text-center font-mono text-[10px] leading-tight text-white/55">
                  {b.short}
                </span>
              ))}
            </div>
            <p className="mt-auto pt-5 text-xs leading-relaxed text-white/55">
              <span className="font-mono text-white">{smallTicketShare}%</span> of live tenders are under ₹1 Crore — the
              market is bigger for MSMEs than it looks.
            </p>
          </DeskCell>

          <DeskCell title="Portals" meta="Sync status">
            <ul className="mb-5 space-y-3.5">
              {snapshot.portals.map((p) => (
                <li key={p.name} className="flex items-center gap-3 text-sm">
                  <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", statusStyle[p.status].dot)} />
                  <span className="sr-only">{statusStyle[p.status].label}:</span>
                  <span className="flex-1 truncate text-white/85">{p.name}</span>
                  <span className="font-mono text-[11px] text-white/55">{p.syncedMinutesAgo}m</span>
                  <span className="w-12 text-right font-mono text-xs tabular-nums text-white/70">
                    {p.today.toLocaleString("en-IN")}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-auto border-t border-white/10 pt-3 font-mono text-[11px] text-white/55">
              + {(snapshot.sources - snapshot.portals.length).toLocaleString("en-IN")} more sources
            </p>
          </DeskCell>
        </div>
      </div>
    </section>
  );
}
