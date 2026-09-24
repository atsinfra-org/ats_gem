import type { Invoice } from "@/lib/types";

export interface PricingPlan {
  id: string;
  name: string;
  monthlyPrice: number;
  yearlyPrice: number;
  description: string;
  features: string[];
  highlighted?: boolean;
  cta: string;
}

export const pricingPlans: PricingPlan[] = [
  {
    id: "free",
    name: "Free",
    monthlyPrice: 0,
    yearlyPrice: 0,
    description: "Get started with basic tender discovery.",
    features: ["50 tender views / month", "Basic search filters", "Email support", "1 saved search"],
    cta: "Get Started",
  },
  {
    id: "professional",
    name: "Professional",
    monthlyPrice: 2499,
    yearlyPrice: 24990,
    description: "For growing businesses actively bidding.",
    features: [
      "Unlimited tender views",
      "Advanced filters & search",
      "10 saved searches",
      "Real-time email alerts",
      "Document downloads",
      "Priority support",
    ],
    highlighted: true,
    cta: "Upgrade to Professional",
  },
  {
    id: "business",
    name: "Business",
    monthlyPrice: 5999,
    yearlyPrice: 59990,
    description: "For teams that need collaboration & insights.",
    features: [
      "Everything in Professional",
      "Unlimited saved searches",
      "Team collaboration (up to 10 seats)",
      "Market intelligence reports",
      "SMS + WhatsApp alerts",
      "API access (beta)",
    ],
    cta: "Upgrade to Business",
  },
  {
    id: "enterprise",
    name: "Enterprise",
    monthlyPrice: -1,
    yearlyPrice: -1,
    description: "Custom solutions for large organizations.",
    features: [
      "Everything in Business",
      "Unlimited seats",
      "Dedicated account manager",
      "Custom integrations",
      "SLA-backed support",
      "On-premise data options",
    ],
    cta: "Contact Sales",
  },
];

export const currentSubscription = {
  plan: "Professional",
  billingCycle: "Monthly" as const,
  nextBillingDate: "2026-09-29",
  amount: 2499,
  paymentMethod: "Visa •••• 4242",
};

export const invoices: Invoice[] = [
  { id: "INV-2026-0912", date: "2026-08-29", amount: 2499, status: "paid", plan: "Professional" },
  { id: "INV-2026-0811", date: "2026-07-29", amount: 2499, status: "paid", plan: "Professional" },
  { id: "INV-2026-0710", date: "2026-06-29", amount: 2499, status: "paid", plan: "Professional" },
  { id: "INV-2026-0609", date: "2026-05-29", amount: 1999, status: "paid", plan: "Starter" },
];
