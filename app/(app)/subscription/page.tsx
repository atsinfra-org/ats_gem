import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { PricingGrid } from "@/components/subscription/pricing-grid";
import { currentSubscription } from "@/lib/mock/subscriptions";
import { format } from "date-fns";

export const metadata: Metadata = { title: "Subscription" };

export default function SubscriptionPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Subscription</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your plan and billing preferences.</p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
          <div>
            <p className="text-xs text-muted-foreground">Current Plan</p>
            <p className="text-lg font-bold text-foreground">{currentSubscription.plan}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Next Billing Date</p>
            <p className="text-sm font-medium text-foreground">{format(new Date(currentSubscription.nextBillingDate), "dd MMM yyyy")}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Amount</p>
            <p className="text-sm font-medium text-foreground">₹{currentSubscription.amount.toLocaleString("en-IN")}/mo</p>
          </div>
        </CardContent>
      </Card>

      <PricingGrid mode="app" currentPlanId="professional" />
    </div>
  );
}
