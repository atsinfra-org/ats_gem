import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Matches the backend's `TenderStatus` enum exactly (backend/docs/DATABASE.md §4). */
const statusConfig: Record<string, { label: string; variant: "success" | "warning" | "danger" | "info" | "secondary" }> = {
  UPCOMING: { label: "Upcoming", variant: "info" },
  OPEN: { label: "Open", variant: "success" },
  CLOSING_SOON: { label: "Closing Soon", variant: "warning" },
  CLOSED: { label: "Closed", variant: "secondary" },
  CANCELLED: { label: "Cancelled", variant: "danger" },
  AWARDED: { label: "Awarded", variant: "info" },
  ARCHIVED: { label: "Archived", variant: "secondary" },
};

export function TenderStatusBadge({ status, className }: { status: string; className?: string }) {
  const config = statusConfig[status] ?? { label: status, variant: "secondary" as const };
  return (
    <Badge variant={config.variant} className={cn("font-semibold", className)}>
      {config.label}
    </Badge>
  );
}
