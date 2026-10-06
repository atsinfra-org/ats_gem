import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border text-foreground bg-transparent",
        success: "border-transparent bg-[color-mix(in_srgb,var(--color-success)_15%,transparent)] text-[color-mix(in_srgb,var(--color-success)_70%,black)] dark:text-[var(--color-success)]",
        warning: "border-transparent bg-[color-mix(in_srgb,var(--color-warning)_18%,transparent)] text-[color-mix(in_srgb,var(--color-warning)_45%,black)] dark:text-[var(--color-warning)]",
        danger: "border-transparent bg-[color-mix(in_srgb,var(--color-danger)_12%,transparent)] text-[color-mix(in_srgb,var(--color-danger)_70%,black)] dark:text-[var(--color-danger)]",
        info: "border-transparent bg-[color-mix(in_srgb,var(--color-info)_12%,transparent)] text-[color-mix(in_srgb,var(--color-info)_70%,black)] dark:text-[var(--color-info)]",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
