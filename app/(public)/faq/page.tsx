import type { Metadata } from "next";
import { JsonLd } from "@/components/seo/json-ld";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";

export const metadata: Metadata = {
  title: "FAQ",
  description: "Frequently asked questions about ATS Gem's tender discovery platform.",
  alternates: { canonical: "/faq" },
};

const faqs = [
  { q: "What is ATS Gem?", a: "ATS Gem is a tender discovery platform. It ingests tenders from connected sources into a single searchable, de-duplicated record with structured details and documents." },
  { q: "Which sources are connected?", a: "Live portal integrations are not yet available; the platform currently runs on a development data source while production integrations are prepared." },
  { q: "Are alerts and email notifications available?", a: "Not yet. You can save tenders and searches and view in-app notifications, but automated alert delivery by email, SMS or WhatsApp is planned, not live." },
  { q: "Can I download tender documents?", a: "Yes, where a tender has documents attached, they can be opened or downloaded from the tender's Documents tab." },
  { q: "Can I buy a subscription?", a: "Not yet. Billing is not implemented, and the pricing page is indicative only." },
  { q: "Can my team share an account?", a: "You can invite colleagues to your organization as members or viewers from the Company Profile page." },
];

export default function FaqPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
      <JsonLd data={{ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) }} />
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Frequently Asked Questions</h1>
        <p className="mt-3 text-muted-foreground">Can&apos;t find what you&apos;re looking for? <a href="/contact" className="text-primary underline underline-offset-2">Contact our team</a>.</p>
      </div>

      <div className="mt-12 rounded-xl border border-border bg-card px-6">
        <Accordion type="single" collapsible>
          {faqs.map((faq, i) => (
            <AccordionItem key={i} value={`faq-${i}`}>
              <AccordionTrigger>{faq.q}</AccordionTrigger>
              <AccordionContent>{faq.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </div>
  );
}
