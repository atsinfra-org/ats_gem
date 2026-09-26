import type { Metadata } from "next";
import Link from "next/link";
import { Building2, GitMerge, Info } from "lucide-react";

export const metadata: Metadata = { title: "Admin Overview" };

export default function AdminOverviewPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Admin</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          A minimal admin surface for the backend functionality available today. The full admin panel
          (users, companies, sources, billing, analytics, monitoring) is a later phase.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link
          href="/admin/procuring-entities"
          className="flex items-start gap-4 rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary/40"
        >
          <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div>
            <h3 className="text-sm font-semibold text-foreground">Procuring Entities</h3>
            <p className="mt-1 text-sm text-muted-foreground">Browse resolved procuring entities and merge duplicates.</p>
          </div>
        </Link>
        <Link
          href="/admin/duplicate-candidates"
          className="flex items-start gap-4 rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary/40"
        >
          <GitMerge className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div>
            <h3 className="text-sm font-semibold text-foreground">Duplicate Candidates</h3>
            <p className="mt-1 text-sm text-muted-foreground">Review tenders the deduplication engine flagged for confirmation.</p>
          </div>
        </Link>
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-border bg-secondary/40 p-4 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          User/company management, source/crawler control, document administration, billing,
          notifications and analytics dashboards are not implemented yet - there is no backend API
          for them in this phase.
        </p>
      </div>
    </div>
  );
}
