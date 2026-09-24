import { Badge } from "@/components/ui/badge";
import type { TenderStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const statusConfig: Record<TenderStatus, { label: string; variant: "success" | "warning" | "danger" | "info" | "secondary" }> = {
  open: { label: "Open Tender", variant: "success" },
  closing_soon: { label: "Closing Soon", variant: "warning" },
  limited: { label: "Limited Tender", variant: "info" },
  eoi: { label: "EOI", variant: "secondary" },
  rfp: { label: "RFP", variant: "secondary" },
  closed: { label: "Closed", variant: "danger" },
};

export function TenderStatusBadge({ status, className }: { status: TenderStatus; className?: string }) {
  const config = statusConfig[status];
  return (
    <Badge variant={config.variant} className={cn("font-semibold", className)}>
      {config.label}
    </Badge>
  );
}
