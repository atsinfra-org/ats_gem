import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, HelpCircle, FileQuestion, Mail } from "lucide-react";

export const metadata: Metadata = {
  title: "Resources",
  description: "Guides, help articles and resources to help you win more tenders.",
};

const resources = [
  { icon: BookOpen, title: "Tender Guides", description: "Step-by-step guides on preparing and submitting winning bids.", href: "/resources" },
  { icon: HelpCircle, title: "Help Center", description: "Find answers to common questions about using the platform.", href: "/faq" },
  { icon: FileQuestion, title: "FAQ", description: "Quick answers to frequently asked questions.", href: "/faq" },
  { icon: Mail, title: "Contact Support", description: "Get in touch with our support team for personalized help.", href: "/contact" },
];

const guides = [
  "How to Register on Government e-Procurement Portals",
  "Understanding EMD and Performance Bank Guarantees",
  "A Complete Checklist for Tender Document Submission",
  "How to Read and Interpret a BOQ (Bill of Quantities)",
  "Common Reasons Bids Get Rejected — and How to Avoid Them",
];

export default function ResourcesPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Resources</h1>
        <p className="mt-3 text-muted-foreground">Everything you need to navigate the tender process confidently.</p>
      </div>

      <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {resources.map((r) => (
          <Link key={r.title} href={r.href} className="rounded-xl border border-border bg-card p-6 transition-shadow hover:shadow-md">
            <r.icon className="h-6 w-6 text-primary" />
            <h3 className="mt-3 text-sm font-semibold text-foreground">{r.title}</h3>
            <p className="mt-1.5 text-xs text-muted-foreground">{r.description}</p>
          </Link>
        ))}
      </div>

      <div className="mt-16">
        <h2 className="text-xl font-semibold text-foreground">Popular Tender Guides</h2>
        <div className="mt-4 divide-y divide-border rounded-xl border border-border bg-card">
          {guides.map((g) => (
            <Link key={g} href="#" className="block px-5 py-4 text-sm text-foreground hover:bg-secondary transition-colors">
              {g}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
