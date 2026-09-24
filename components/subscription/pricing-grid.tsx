"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PricingCard } from "@/components/subscription/pricing-card";
import { ConfirmModal } from "@/components/modals/confirm-modal";
import { pricingPlans } from "@/lib/mock/subscriptions";
import { changePlan } from "@/lib/api/subscriptions";
import { cn } from "@/lib/utils";
import { useAuthDialog } from "@/lib/store/auth-dialog-store";

export function PricingGrid({ mode = "public", currentPlanId = "professional" }: { mode?: "public" | "app"; currentPlanId?: string }) {
  const router = useRouter();
  const { open: openAuth } = useAuthDialog();
  const [billingCycle, setBillingCycle] = React.useState<"monthly" | "yearly">("monthly");
  const [confirmPlan, setConfirmPlan] = React.useState<string | null>(null);
  const [loadingPlan, setLoadingPlan] = React.useState<string | null>(null);

  async function handleConfirm() {
    if (!confirmPlan) return;
    setLoadingPlan(confirmPlan);
    await changePlan(confirmPlan);
    setLoadingPlan(null);
    toast.success("Plan updated successfully");
  }

  return (
    <div>
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
              {cycle} {cycle === "yearly" && <span className="text-xs">(Save 15%)</span>}
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
            currentPlan={mode === "app" && plan.id === currentPlanId}
            loading={loadingPlan === plan.id}
            onSelect={() => {
              if (mode === "public") {
                if (plan.id === "enterprise") router.push("/contact");
                else openAuth();
              } else {
                if (plan.id === "enterprise") router.push("/contact");
                else setConfirmPlan(plan.id);
              }
            }}
          />
        ))}
      </div>

      <ConfirmModal
        open={!!confirmPlan}
        onOpenChange={(open) => !open && setConfirmPlan(null)}
        destructive={false}
        title="Confirm plan change"
        description="Your billing will be updated immediately and prorated for the current cycle."
        confirmLabel="Confirm Change"
        onConfirm={handleConfirm}
      />
    </div>
  );
}
