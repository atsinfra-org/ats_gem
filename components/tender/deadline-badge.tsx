import { CalendarClock } from "lucide-react";
import { daysUntil } from "@/lib/utils";
import { cn } from "@/lib/utils";

export function DeadlineBadge({ date, className }: { date: string; className?: string }) {
  const days = daysUntil(date);
  const isClosed = days < 0;
  const isUrgent = days >= 0 && days <= 5;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold",
        isClosed && "bg-secondary text-muted-foreground",
        isUrgent && "bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] text-[color-mix(in_srgb,var(--color-danger)_70%,black)] dark:text-[var(--color-danger)]",
        !isClosed && !isUrgent && "bg-[color-mix(in_srgb,var(--color-info)_10%,transparent)] text-[color-mix(in_srgb,var(--color-info)_70%,black)] dark:text-[var(--color-info)]",
        className
      )}
    >
      <CalendarClock className="h-3.5 w-3.5" />
      {isClosed
        ? "Closed"
        : days === 0
          ? "Closes today"
          : `${days} day${days === 1 ? "" : "s"} left`}
    </div>
  );
}
