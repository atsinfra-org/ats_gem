import type { Metadata } from "next";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";

export const metadata: Metadata = {
  title: "FAQ",
  description: "Frequently asked questions about ATS Gem's tender discovery platform.",
};

const faqs = [
  { q: "What is ATS Gem?", a: "ATS Gem is a tender intelligence platform that aggregates government and private tenders from thousands of sources across India, helping businesses discover, track and win opportunities." },
  { q: "How often is tender data refreshed?", a: "Our crawlers refresh most e-procurement sources every 15-30 minutes, ensuring you see new tenders almost as soon as they're published." },
  { q: "Is there a free plan?", a: "Yes, our Free plan lets you explore up to 50 tender views per month with basic search filters." },
  { q: "Can I set up alerts for specific categories?", a: "Yes, Professional and Business plans support unlimited saved searches with instant, daily or weekly alert frequencies." },
  { q: "Do you provide tender documents?", a: "Yes, verified tender notices, BOQs, drawings and technical documents are available for download on Professional plans and above." },
  { q: "How do I cancel my subscription?", a: "You can cancel anytime from the Billing page inside your dashboard. Your access continues until the end of the current billing cycle." },
  { q: "Do you support global tenders?", a: "Yes, we track select international tenders relevant to Indian exporters and consultants under the Global Tenders category." },
];

export default function FaqPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Frequently Asked Questions</h1>
        <p className="mt-3 text-muted-foreground">Can&apos;t find what you&apos;re looking for? <a href="/contact" className="text-primary hover:underline">Contact our team</a>.</p>
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
