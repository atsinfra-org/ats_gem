"use client";

import { Bookmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWatchlist } from "@/lib/store/watchlist-store";
import { cn } from "@/lib/utils";

export function SaveTenderButton({
  tenderId,
  variant = "outline",
  size = "sm",
  showLabel = true,
  className,
}: {
  tenderId: string;
  variant?: "outline" | "ghost" | "default" | "secondary";
  size?: "sm" | "default" | "icon";
  showLabel?: boolean;
  className?: string;
}) {
  const { isSaved, toggle } = useWatchlist();
  const saved = isSaved(tenderId);

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      aria-pressed={saved}
      aria-label={saved ? "Remove from saved tenders" : "Save tender"}
      className={cn(saved && "border-primary text-primary", className)}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void toggle(tenderId);
      }}
    >
      <Bookmark className={cn("h-4 w-4", saved && "fill-current")} />
      {showLabel && (saved ? "Saved" : "Save")}
    </Button>
  );
}
