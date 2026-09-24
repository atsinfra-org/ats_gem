"use client";

import { Bookmark } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/lib/store/app-store";
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
  const { isSaved, toggleSaveTender } = useAppStore();
  const saved = isSaved(tenderId);

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      aria-pressed={saved}
      className={cn(saved && "border-primary text-primary", className)}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const nowSaved = toggleSaveTender(tenderId);
        toast.success(nowSaved ? "Tender saved" : "Tender removed from saved");
      }}
    >
      <Bookmark className={cn("h-4 w-4", saved && "fill-current")} />
      {showLabel && (saved ? "Saved" : "Save")}
    </Button>
  );
}
