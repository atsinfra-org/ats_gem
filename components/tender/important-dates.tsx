import { CheckCircle2, Circle } from "lucide-react";
import type { TenderDetail } from "@/lib/api/types";
import { format } from "date-fns";
import { cn, hasPassed } from "@/lib/utils";

export function ImportantDates({ tender }: { tender: TenderDetail }) {
  const events = [
    { label: "Published Date", date: tender.publishedAt },
    { label: "Last Date for Submission", date: tender.closingAt, highlight: true },
    { label: "Bid Opening Date", date: tender.openingAt },
  ].filter((e): e is { label: string; date: string; highlight?: boolean } => !!e.date);

  if (events.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-5">
        <h3 className="text-sm font-semibold text-foreground">Important Dates</h3>
        <p className="mt-3 text-sm text-muted-foreground">No dates are available for this tender.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <h3 className="text-sm font-semibold text-foreground">Important Dates</h3>
      <ol className="mt-4 space-y-5">
        {events.map((event, i) => {
          const passed = hasPassed(event.date);
          return (
            <li key={event.label} className="relative flex gap-3 pl-1">
              {i < events.length - 1 && (
                <span className="absolute left-[9px] top-5 h-full w-px bg-border" aria-hidden />
              )}
              {passed ? (
                <CheckCircle2 className="h-4.5 w-4.5 shrink-0 text-[var(--color-success)]" />
              ) : (
                <Circle className={cn("h-4.5 w-4.5 shrink-0", event.highlight ? "text-primary" : "text-muted-foreground")} />
              )}
              <div>
                <p className={cn("text-sm font-medium", event.highlight ? "text-primary" : "text-foreground")}>
                  {event.label}
                </p>
                <p className="text-xs text-muted-foreground">{format(new Date(event.date), "dd MMM yyyy, hh:mm a")}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
