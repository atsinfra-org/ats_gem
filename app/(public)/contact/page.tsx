"use client";

import * as React from "react";
import { toast } from "sonner";
import { Mail, Phone, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ContactPage() {
  const [sending, setSending] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    await new Promise((r) => setTimeout(r, 900));
    setSending(false);
    toast.success("Message sent! We'll get back to you within 24 hours.");
    (e.target as HTMLFormElement).reset();
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Get in Touch</h1>
        <p className="mt-3 text-muted-foreground">Have a question about tenders, pricing or partnerships? We&apos;d love to hear from you.</p>
      </div>

      <div className="mt-12 grid grid-cols-1 gap-10 lg:grid-cols-[1fr_1.2fr]">
        <div className="space-y-5">
          {[
            { icon: Mail, label: "Email", value: "hello@atsgem.example.com" },
            { icon: Phone, label: "Phone", value: "+91 1800 200 3000" },
            { icon: MapPin, label: "Office", value: "Bandra Kurla Complex, Mumbai, Maharashtra" },
          ].map((item) => (
            <div key={item.label} className="flex items-start gap-3 rounded-xl border border-border bg-card p-5">
              <item.icon className="mt-0.5 h-5 w-5 text-primary" />
              <div>
                <p className="text-sm font-semibold text-foreground">{item.label}</p>
                <p className="text-sm text-muted-foreground">{item.value}</p>
              </div>
            </div>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-border bg-card p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="name">Full Name</Label>
              <Input id="name" required placeholder="Your name" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email Address</Label>
              <Input id="email" type="email" required placeholder="you@company.com" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="subject">Subject</Label>
            <Input id="subject" required placeholder="How can we help?" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="message">Message</Label>
            <textarea
              id="message"
              required
              rows={6}
              className="flex w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              placeholder="Tell us more..."
            />
          </div>
          <Button type="submit" size="lg" className="w-full" loading={sending}>
            Send Message
          </Button>
        </form>
      </div>
    </div>
  );
}
