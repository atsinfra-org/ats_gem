import { Mail } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";

const SUPPORT_EMAIL = "support@atsgem.example.com";

const faqs = [
  { q: "How is tender data collected?", a: "Tenders are ingested from connected sources and normalized into a canonical record, including deduplication across sources publishing the same tender." },
  { q: "Can I download tender documents?", a: "Documents attached to a tender can be downloaded from the tender's Documents tab where available." },
  { q: "How do I save a tender or search?", a: "Use the Save button on any tender, or Save Search from the search results page, to find them later under Saved Tenders / Saved Searches." },
];

export default function SupportPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Support</h1>
        <p className="mt-1 text-sm text-muted-foreground">Reach out by email or browse common questions.</p>
      </div>

      <Card className="p-6 text-center sm:mx-auto sm:max-w-sm">
        <Mail className="mx-auto h-6 w-6 text-primary" />
        <p className="mt-2 text-sm font-semibold text-foreground">Email Us</p>
        <a href={`mailto:${SUPPORT_EMAIL}`} className="text-sm text-primary hover:underline">
          {SUPPORT_EMAIL}
        </a>
        <Button asChild className="mt-4 w-full">
          <a href={`mailto:${SUPPORT_EMAIL}`}>Send an Email</a>
        </Button>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Frequently Asked Questions</CardTitle>
          <CardDescription>Quick answers to common questions.</CardDescription>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible>
            {faqs.map((faq, i) => (
              <AccordionItem key={i} value={`faq-${i}`}>
                <AccordionTrigger>{faq.q}</AccordionTrigger>
                <AccordionContent>{faq.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>
    </div>
  );
}
