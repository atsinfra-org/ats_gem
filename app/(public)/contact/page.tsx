import type { Metadata } from "next";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Contact",
  description: "Get in touch with the ATS GeM team.",
  alternates: { canonical: "/contact" },
};

const EMAIL = "hello@atsgem.example.com";

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Get in Touch</h1>
      <p className="mt-3 text-muted-foreground">Have a question about the platform, pricing or partnerships? Email us and we will get back to you.</p>
      <div className="mt-10 rounded-xl border border-border bg-card p-8">
        <Mail className="mx-auto h-6 w-6 text-primary" />
        <a href={`mailto:${EMAIL}`} className="mt-3 block text-lg font-semibold text-primary hover:underline">{EMAIL}</a>
        <Button asChild className="mt-6">
          <a href={`mailto:${EMAIL}`}>Send an Email</a>
        </Button>
      </div>
    </div>
  );
}
