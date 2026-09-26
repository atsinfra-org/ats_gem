import type { Metadata } from "next";
import Link from "next/link";
import { HelpCircle, Mail, LogIn } from "lucide-react";

export const metadata: Metadata = {
  title: "Help & Resources",
  description: "Answers to common questions and ways to get in touch with ATS Gem.",
  alternates: { canonical: "/resources" },
};

const resources = [
  { icon: HelpCircle, title: "FAQ", description: "Quick answers to frequently asked questions about the platform.", href: "/faq" },
  { icon: Mail, title: "Contact", description: "Get in touch with the team for help or questions.", href: "/contact" },
  { icon: LogIn, title: "Pricing", description: "See the indicative plans (purchase is not available yet).", href: "/pricing" },
];

export default function ResourcesPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Help &amp; Resources</h1>
        <p className="mt-3 text-muted-foreground">Guides and tutorials are not published yet. For now, these pages can help.</p>
      </div>
      <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {resources.map((r) => (
          <Link key={r.title} href={r.href} className="rounded-xl border border-border bg-card p-6 transition-shadow hover:shadow-md">
            <r.icon className="h-6 w-6 text-primary" />
            <h3 className="mt-3 text-sm font-semibold text-foreground">{r.title}</h3>
            <p className="mt-1.5 text-xs text-muted-foreground">{r.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
