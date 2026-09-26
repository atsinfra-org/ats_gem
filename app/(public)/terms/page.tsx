import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms & Privacy", alternates: { canonical: "/terms" } };

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-3xl font-bold text-foreground">Terms &amp; Privacy</h1>
      <p className="mt-4 text-sm text-muted-foreground">
        The full Terms of Service and Privacy Policy are still being finalised and have not been published yet. This page
        will be replaced by the reviewed legal documents. Until then, accepting the terms at sign-up is recorded against
        your account together with the terms version in force.
      </p>
      <h2 id="terms" className="mt-8 text-xl font-semibold text-foreground">Terms of Service</h2>
      <p className="mt-2 text-sm text-muted-foreground">Pending publication.</p>
      <h2 id="privacy" className="mt-8 text-xl font-semibold text-foreground">Privacy Policy</h2>
      <p className="mt-2 text-sm text-muted-foreground">Pending publication. For privacy questions, contact support@atsgem.example.com.</p>
    </div>
  );
}
