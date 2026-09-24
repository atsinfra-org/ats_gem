"use client";

import Link from "next/link";
import { useNow } from "@/lib/hooks/use-now";
import type { ClosingItem } from "@/lib/types";
import { cn } from "@/lib/utils";

const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;

function formatCountdown(ms: number | null) {
  if (ms === null) return "--:--:--";
  if (ms <= 0) return "Closed";
  const total = Math.floor(ms / 1000);
  const days = Math.floor(total / 86400);
  const hms = [Math.floor((total % 86400) / 3600), Math.floor((total % 3600) / 60), total % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
  return days > 0 ? `${days}d ${hms}` : hms;
}

export function ClosingBoard({ items }: { items: ClosingItem[] }) {
  const now = useNow();

  return (
    <ol className="space-y-4">
      {items.map((t) => {
        const remaining = now === null ? null : new Date(t.deadline).getTime() - now;
        return (
          <li key={t.id}>
            <Link href={`/tenders/${t.id}`} className="group block">
              <p className="truncate text-sm text-white/85 transition-colors group-hover:text-white">{t.title}</p>
              <div className="mt-1 flex items-baseline justify-between gap-3">
                <span className="truncate text-xs text-white/55">{t.department}</span>
                <span
                  className={cn(
                    "shrink-0 font-mono text-xs tabular-nums",
                    remaining !== null && remaining < TWO_DAYS ? "text-primary" : "text-white/70"
                  )}
                >
                  {formatCountdown(remaining)}
                </span>
              </div>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
