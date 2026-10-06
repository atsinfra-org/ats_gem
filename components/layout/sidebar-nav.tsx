"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Search,
  Bookmark,
  SlidersHorizontal,
  Bell,
  UserCircle,
  Building2,
  LifeBuoy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const mainNav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/tenders", label: "Tender Search", icon: Search },
  { href: "/saved-tenders", label: "Saved Tenders", icon: Bookmark },
  { href: "/saved-searches", label: "Saved Searches", icon: SlidersHorizontal },
  { href: "/notifications", label: "Notifications", icon: Bell },
];

const secondaryNav = [
  { href: "/profile", label: "My Profile", icon: UserCircle },
  { href: "/company", label: "Company Profile", icon: Building2 },
  { href: "/support", label: "Support", icon: LifeBuoy },
];

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  const renderLink = (item: (typeof mainNav)[number]) => {
    const active = pathname === item.href || pathname.startsWith(item.href + "/");
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onNavigate}
        className={cn(
          "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          active
            ? "bg-primary text-primary-foreground"
            : "text-foreground/70 hover:bg-secondary hover:text-foreground"
        )}
        aria-current={active ? "page" : undefined}
      >
        <item.icon className="h-4.5 w-4.5 shrink-0" />
        {item.label}
      </Link>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 py-5">
        <Link href="/dashboard" className="text-lg font-bold tracking-tight text-foreground" onClick={onNavigate}>
          ATS <span className="text-primary">GeM</span>
        </Link>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3" aria-label="Main navigation">
        {mainNav.map(renderLink)}
        <div className="my-3 h-px bg-border" />
        {secondaryNav.map(renderLink)}
      </nav>
      <div className="border-t border-border p-3">
        <Button asChild variant="outline" className="w-full justify-start gap-2">
          <Link href="/tenders" onClick={onNavigate}>
            <Search className="h-4 w-4" /> Search Tenders
          </Link>
        </Button>
      </div>
    </div>
  );
}
