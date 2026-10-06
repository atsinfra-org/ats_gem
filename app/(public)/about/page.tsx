import type { Metadata } from "next";
import { Target, Eye, Users2 } from "lucide-react";

export const metadata: Metadata = {
  title: "About Us",
  alternates: { canonical: "/about" },
  description: "Learn about ATS GeM's mission to make tender discovery simple and transparent for Indian businesses.",
};

const values = [
  { icon: Target, title: "Our Mission", description: "To democratize access to procurement opportunities for every Indian business, regardless of size." },
  { icon: Eye, title: "Our Vision", description: "A transparent procurement ecosystem where the best bid wins, not the best connections." },
  { icon: Users2, title: "Our Team", description: "A team of engineers, procurement experts and data specialists building the future of tender intelligence." },
];

export default function AboutPage() {
  return (
    <div>
      <section className="bg-[var(--color-navy-deep)] py-20 text-center">
        <div className="mx-auto max-w-3xl px-4">
          <h1 className="text-3xl font-bold text-white sm:text-4xl">Building India&apos;s Tender Intelligence Platform</h1>
          <p className="mt-4 text-white/70">
            ATS GeM aggregates, verifies and simplifies tender data from thousands of sources so businesses can focus on what matters — winning.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          {values.map((v) => (
            <div key={v.title} className="rounded-xl border border-border bg-card p-6 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--color-primary)_10%,transparent)]">
                <v.icon className="h-6 w-6 text-primary" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-foreground">{v.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{v.description}</p>
            </div>
          ))}
        </div>

      </section>
    </div>
  );
}
