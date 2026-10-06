import type { Metadata } from "next";
import { Building2, HardHat, Landmark, Briefcase } from "lucide-react";
import { GetStartedLink } from "@/components/solutions/get-started-link";

export const metadata: Metadata = {
  title: "Solutions",
  alternates: { canonical: "/solutions" },
  description: "Tailored tender intelligence solutions for MSMEs, contractors, enterprises and consultants.",
};

const solutions = [
  {
    icon: HardHat,
    title: "MSMEs",
    description: "Affordable access to verified tenders with simplified filters designed for small business owners.",
    points: ["Keyword and filter search", "Requirements and timeline per tender", "Save what matters"],
  },
  {
    icon: Building2,
    title: "Contractors",
    description: "Track large-scale construction and infrastructure tenders across every state and department.",
    points: ["State and category filters", "EMD & value filtering", "Saved tenders and searches"],
  },
  {
    icon: Landmark,
    title: "Enterprises",
    description: "Enterprise-grade data feeds and team collaboration tools for procurement departments.",
    points: ["Multi-seat team access", "Organization members and viewers", "Role-based access"],
  },
  {
    icon: Briefcase,
    title: "Consultants",
    description: "Research and advise clients faster with comprehensive historical and market intelligence.",
    points: ["Structured tender details", "Document access", "Cross-source de-duplication"],
  },
];

export default function SolutionsPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Solutions for Every Business</h1>
        <p className="mt-3 text-muted-foreground">Whichever stage your business is at, ATS GeM adapts to your workflow.</p>
      </div>

      <div className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {solutions.map((s) => (
          <div key={s.title} className="rounded-xl border border-border bg-card p-7">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--color-primary)_10%,transparent)]">
              <s.icon className="h-6 w-6 text-primary" />
            </div>
            <h3 className="mt-4 text-lg font-semibold text-foreground">{s.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{s.description}</p>
            <ul className="mt-4 space-y-2">
              {s.points.map((p) => (
                <li key={p} className="flex items-center gap-2 text-sm text-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" /> {p}
                </li>
              ))}
            </ul>
            <GetStartedLink />
          </div>
        ))}
      </div>
    </div>
  );
}
