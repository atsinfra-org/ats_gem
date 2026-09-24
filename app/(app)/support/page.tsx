"use client";

import * as React from "react";
import { toast } from "sonner";
import { LifeBuoy, Mail, Phone, MessageSquare } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";

const faqs = [
  { q: "How often is tender data updated?", a: "Our sources are crawled continuously, with most portals refreshed every 15-30 minutes." },
  { q: "Can I download tender documents?", a: "Yes, Professional plan and above allow unlimited document downloads." },
  { q: "How do I cancel my subscription?", a: "You can cancel anytime from the Billing page. Access continues until the end of the billing cycle." },
];

export default function SupportPage() {
  const [sending, setSending] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    await new Promise((r) => setTimeout(r, 900));
    setSending(false);
    toast.success("Support request submitted. We'll get back to you within 24 hours.");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Support</h1>
        <p className="mt-1 text-sm text-muted-foreground">We&apos;re here to help. Reach out or browse common questions.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-5 text-center">
          <Mail className="mx-auto h-6 w-6 text-primary" />
          <p className="mt-2 text-sm font-semibold text-foreground">Email Us</p>
          <p className="text-xs text-muted-foreground">support@atsgem.example.com</p>
        </Card>
        <Card className="p-5 text-center">
          <Phone className="mx-auto h-6 w-6 text-primary" />
          <p className="mt-2 text-sm font-semibold text-foreground">Call Us</p>
          <p className="text-xs text-muted-foreground">+91 1800 200 3000</p>
        </Card>
        <Card className="p-5 text-center">
          <MessageSquare className="mx-auto h-6 w-6 text-primary" />
          <p className="mt-2 text-sm font-semibold text-foreground">Live Chat</p>
          <p className="text-xs text-muted-foreground">Mon-Sat, 9am-7pm IST</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><LifeBuoy className="h-4.5 w-4.5" /> Raise a Ticket</CardTitle>
            <CardDescription>Describe your issue and our team will respond shortly.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="subject">Subject</Label>
                <Input id="subject" placeholder="e.g. Unable to download tender document" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="message">Message</Label>
                <textarea
                  id="message"
                  required
                  rows={5}
                  className="flex w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  placeholder="Describe the issue in detail..."
                />
              </div>
              <Button type="submit" loading={sending}>Submit Ticket</Button>
            </form>
          </CardContent>
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
    </div>
  );
}
