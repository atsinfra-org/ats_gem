import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SectionHeading({
  tone,
  section,
  kicker,
  title,
  aside,
}: {
  tone: "dark" | "paper";
  section: string;
  kicker: string;
  title: ReactNode;
  aside?: string;
}) {
  const dark = tone === "dark";
  return (
    <header
      className={cn(
        "grid gap-6 border-b pb-8 lg:grid-cols-[1fr_minmax(0,22rem)] lg:items-end",
        dark ? "border-white/15" : "border-ink/20"
      )}
    >
      <div>
        <p
          className={cn(
            "flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.14em]",
            dark ? "text-white/55" : "text-ink/65"
          )}
        >
          <span
            className={cn(
              "flex h-5 w-5 items-center justify-center rounded-[3px] text-[10px]",
              dark ? "bg-white/10 text-white" : "bg-ink text-paper"
            )}
          >
            {section}
          </span>
          {kicker}
        </p>
        <h2 className={cn("mt-5 font-display text-5xl leading-[1] sm:text-6xl", dark ? "text-white" : "text-ink")}>
          {title}
        </h2>
      </div>
      {aside && (
        <p className={cn("text-sm leading-relaxed", dark ? "text-white/55" : "text-ink/65")}>{aside}</p>
      )}
    </header>
  );
}
