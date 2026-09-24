"use client";

import { Check } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn, formatINR } from "@/lib/utils";
import type { PricingPlan } from "@/lib/mock/subscriptions";

export function PricingCard({
  plan,
  billingCycle,
  currentPlan,
  onSelect,
  loading,
}: {
  plan: PricingPlan;
  billingCycle: "monthly" | "yearly";
  currentPlan?: boolean;
  onSelect?: () => void;
  loading?: boolean;
}) {
  const price = billingCycle === "monthly" ? plan.monthlyPrice : plan.yearlyPrice;
  const isCustom = price < 0;

  return (
    <Card
      className={cn(
        "relative flex flex-col p-6",
        plan.highlighted && "border-primary shadow-lg ring-1 ring-primary"
      )}
    >
      {plan.highlighted && (
        <span className="absolute -top-3 left-6 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
          Most Popular
        </span>
      )}
      <h3 className="text-base font-semibold text-foreground">{plan.name}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{plan.description}</p>

      <div className="mt-5">
        {isCustom ? (
          <p className="text-3xl font-bold text-foreground">Custom</p>
        ) : (
          <p className="flex items-baseline gap-1">
            <span className="text-3xl font-bold text-foreground">{price === 0 ? "₹0" : formatINR(price)}</span>
            {price > 0 && <span className="text-sm text-muted-foreground">/{billingCycle === "monthly" ? "mo" : "yr"}</span>}
          </p>
        )}
      </div>

      <ul className="mt-6 flex-1 space-y-3">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm text-foreground">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-success)]" />
            {f}
          </li>
        ))}
      </ul>

      <Button
        className="mt-6 w-full"
        variant={currentPlan ? "outline" : plan.highlighted ? "default" : "outline"}
        disabled={currentPlan}
        loading={loading}
        onClick={onSelect}
      >
        {currentPlan ? "Current Plan" : plan.cta}
      </Button>
    </Card>
  );
}
