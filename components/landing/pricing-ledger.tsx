"use client";

import * as React from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/landing/section-heading";
import { pricingPlans, type PricingPlan } from "@/lib/mock/subscriptions";
import { useAuthDialog } from "@/lib/store/auth-dialog-store";
import { cn } from "@/lib/utils";

type Cycle = "monthly" | "yearly";

const FEATURED = "professional";

const rows: { label: string; values: (string | boolean)[] }[] = [
  { label: "Tender views", values: ["50 / month", "Unlimited", "Unlimited", "Unlimited"] },
  { label: "Saved searches", values: ["1", "10", "Unlimited", "Unlimited"] },
  { label: "Alerts", values: ["Daily email digest", "Instant email", "Instant · SMS · WhatsApp", "All + API webhooks"] },
  { label: "Document downloads", values: [false, true, true, true] },
  { label: "Bid tracking", values: ["3 active bids", "Unlimited", "Unlimited", "Unlimited"] },
  { label: "Team seats", values: ["1", "1", "Up to 10", "Unlimited"] },
  { label: "Market intelligence", values: [false, false, true, true] },
  { label: "API access", values: [false, false, "Beta", true] },
  { label: "Support", values: ["Email", "Priority", "Priority", "Dedicated manager"] },
];

function priceOf(plan: PricingPlan, cycle: Cycle) {
  const amount = cycle === "monthly" ? plan.monthlyPrice : plan.yearlyPrice;
  if (amount < 0) return { amount: "Custom", period: "Annual contract" };
  if (amount === 0) return { amount: "₹0", period: "Free forever" };
  return { amount: `₹${amount.toLocaleString("en-IN")}`, period: cycle === "monthly" ? "per month" : "per year" };
}

function Value({ value }: { value: string | boolean }) {
  if (value === true)
    return (
      <>
        <Check aria-hidden className="h-4 w-4" />
        <span className="sr-only">Included</span>
      </>
    );
  if (value === false)
    return (
      <>
        <span aria-hidden className="opacity-35">
          —
        </span>
        <span className="sr-only">Not included</span>
      </>
    );
  return <span>{value}</span>;
}

function PlanCta({ plan, featured, onStart }: { plan: PricingPlan; featured: boolean; onStart: () => void }) {
  const outline = featured
    ? "w-full border-paper/30 bg-transparent text-paper hover:bg-paper hover:text-ink"
    : "w-full border-ink/25 bg-transparent text-ink hover:bg-ink hover:text-paper";
  if (plan.id === "enterprise") {
    return (
      <Button asChild variant="outline" className={outline}>
        <Link href="/contact">Talk to sales</Link>
      </Button>
    );
  }
  if (featured) {
    return (
      <Button className="w-full" onClick={onStart}>
        Choose {plan.name}
      </Button>
    );
  }
  return (
    <Button variant="outline" className={outline} onClick={onStart}>
      {plan.id === "free" ? "Start free" : `Choose ${plan.name}`}
    </Button>
  );
}

export function PricingLedger() {
  const { open: openAuth } = useAuthDialog();
  const [cycle, setCycle] = React.useState<Cycle>("monthly");

  return (
    <section className="border-t-2 border-ink bg-paper text-ink">
      <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
        <SectionHeading
          tone="paper"
          section="E"
          kicker="Pricing"
          title={
            <>
              Plain pricing. <em className="text-primary">No sales call.</em>
            </>
          }
          aside="Start free and upgrade when your pipeline grows. Prices in INR, exclusive of GST."
        />

        <div
          role="radiogroup"
          aria-label="Billing period"
          className="mt-8 inline-flex rounded-md border border-ink/20 p-0.5 font-mono text-xs"
        >
          {(["monthly", "yearly"] as const).map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={cycle === c}
              onClick={() => setCycle(c)}
              className={cn(
                "rounded px-3 py-1.5 transition-colors",
                cycle === c ? "bg-ink text-paper" : "text-ink/60 hover:text-ink"
              )}
            >
              {c === "monthly" ? "Monthly" : "Yearly · 2 months free"}
            </button>
          ))}
        </div>

        <div className="mt-8 hidden md:block">
          <table className="w-full table-fixed border-separate border-spacing-0 text-sm">
            <caption className="sr-only">Plan comparison</caption>
            <colgroup>
              <col className="w-[22%]" />
              {pricingPlans.map((p) => (
                <col key={p.id} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th scope="col" className="pb-6 text-left align-bottom font-mono text-[11px] font-normal uppercase tracking-[0.12em] text-ink/60">
                  Plan
                </th>
                {pricingPlans.map((plan) => {
                  const featured = plan.id === FEATURED;
                  const price = priceOf(plan, cycle);
                  return (
                    <th
                      key={plan.id}
                      scope="col"
                      className={cn(
                        "px-5 pb-6 pt-6 text-left align-bottom font-normal",
                        featured && "rounded-t-lg bg-ink text-paper"
                      )}
                    >
                      {featured && (
                        <span className="mb-3 inline-block rounded-sm bg-primary px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-white">
                          Most chosen
                        </span>
                      )}
                      <span className="block text-sm font-semibold">{plan.name}</span>
                      <span className="mt-2 block font-display text-4xl leading-none">{price.amount}</span>
                      <span className="mt-1.5 block font-mono text-[11px] opacity-60">{price.period}</span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row" className="border-t border-ink/15 py-3.5 pr-4 text-left font-normal text-ink/70">
                    {row.label}
                  </th>
                  {row.values.map((v, i) => {
                    const featured = pricingPlans[i].id === FEATURED;
                    return (
                      <td
                        key={pricingPlans[i].id}
                        className={cn(
                          "border-t px-5 py-3.5",
                          featured ? "border-paper/10 bg-ink text-paper" : "border-ink/15"
                        )}
                      >
                        <Value value={v} />
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr>
                <td className="border-t border-ink/15" />
                {pricingPlans.map((plan) => {
                  const featured = plan.id === FEATURED;
                  return (
                    <td
                      key={plan.id}
                      className={cn(
                        "border-t px-5 pb-6 pt-5",
                        featured ? "rounded-b-lg border-paper/10 bg-ink" : "border-ink/15"
                      )}
                    >
                      <PlanCta plan={plan} featured={featured} onStart={openAuth} />
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-8 space-y-4 md:hidden">
          {pricingPlans.map((plan, i) => {
            const featured = plan.id === FEATURED;
            const price = priceOf(plan, cycle);
            return (
              <article
                key={plan.id}
                className={cn("rounded-lg border p-5", featured ? "border-ink bg-ink text-paper" : "border-ink/15")}
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">{plan.name}</h3>
                  {featured && (
                    <span className="rounded-sm bg-primary px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-white">
                      Most chosen
                    </span>
                  )}
                </div>
                <p className="mt-3 font-display text-4xl leading-none">{price.amount}</p>
                <p className="mt-1.5 font-mono text-[11px] opacity-60">{price.period}</p>
                <dl className="mt-5 text-sm">
                  {rows.map((row) => (
                    <div
                      key={row.label}
                      className={cn("flex justify-between gap-4 border-t py-2.5", featured ? "border-paper/10" : "border-ink/10")}
                    >
                      <dt className="opacity-65">{row.label}</dt>
                      <dd className="text-right">
                        <Value value={row.values[i]} />
                      </dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-4">
                  <PlanCta plan={plan} featured={featured} onStart={openAuth} />
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
