import type { Metadata } from "next";
import { PricingGrid } from "@/components/subscription/pricing-grid";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Simple, transparent pricing plans for businesses of every size.",
};

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Simple, Transparent Pricing</h1>
        <p className="mt-3 text-muted-foreground">
          Choose the plan that fits your business. Upgrade or downgrade anytime.
        </p>
      </div>
      <div className="mt-12">
        <PricingGrid mode="public" />
      </div>
    </div>
  );
}
