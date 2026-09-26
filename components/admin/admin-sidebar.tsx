"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Building2, GitMerge } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Phase 6 scope only exposes the admin surfaces that actually have a backend API
 * (backend/docs/API-CONTRACT.md §5.1): procuring entities and duplicate candidates.
 * Everything else (users, companies, sources, documents, subscriptions, payments,
 * notifications, settings) has no backend admin endpoint yet and is intentionally
 * not linked here - see docs/PHASE-6-FRONTEND.md "Known limitations".
 */
const navItems = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/procuring-entities", label: "Procuring Entities", icon: Building2 },
  { href: "/admin/duplicate-candidates", label: "Duplicate Candidates", icon: GitMerge },
];

export function AdminSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col">
      <Link href="/admin" className="flex items-center gap-2 px-4 py-5" onClick={onNavigate}>
        <span className="text-lg font-bold tracking-tight text-white">
          ATS <span className="text-[var(--color-primary-on-dark)]">Gem</span>
        </span>
        <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/70">
          Admin
        </span>
      </Link>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3" aria-label="Admin navigation">
        {navItems.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active ? "bg-primary text-primary-foreground" : "text-white/60 hover:bg-white/5 hover:text-white"
              )}
              aria-current={active ? "page" : undefined}
            >
              <item.icon className="h-4.5 w-4.5 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
