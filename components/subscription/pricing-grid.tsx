"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { PricingCard } from "@/components/subscription/pricing-card";
import { pricingPlans } from "@/lib/mock/subscriptions";
import { cn } from "@/lib/utils";
import { useAuthDialog } from "@/lib/store/auth-dialog-store";

/** Informational only: billing is not implemented, so choosing a plan just leads to signup/contact. */
export function PricingGrid() {
  const router = useRouter();
  const { open: openAuth } = useAuthDialog();
  const [billingCycle, setBillingCycle] = React.useState<"monthly" | "yearly">("monthly");

  return (
    <div>
      <p className="mx-auto mb-6 max-w-xl rounded-md border border-border bg-secondary/40 px-4 py-2 text-center text-sm text-muted-foreground">
        Pricing shown is indicative. Online purchase and subscriptions are not available yet - create an account to get started.
      </p>
      <div className="mb-8 flex justify-center">
        <div className="inline-flex items-center rounded-lg border border-border bg-card p-1">
          {(["monthly", "yearly"] as const).map((cycle) => (
            <button
              key={cycle}
              onClick={() => setBillingCycle(cycle)}
              className={cn(
                "rounded-md px-4 py-1.5 text-sm font-medium transition-colors capitalize",
                billingCycle === cycle ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {cycle}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {pricingPlans.map((plan) => (
          <PricingCard
            key={plan.id}
            plan={plan}
            billingCycle={billingCycle}
            currentPlan={false}
            loading={false}
            onSelect={() => (plan.id === "enterprise" ? router.push("/contact") : openAuth())}
          />
        ))}
      </div>
    </div>
  );
}
