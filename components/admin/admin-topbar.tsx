"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { AdminSidebar } from "@/components/admin/admin-sidebar";

const titleMap: Record<string, string> = {
  "/admin": "Overview",
  "/admin/users": "Users",
  "/admin/companies": "Companies",
  "/admin/tenders": "Tenders",
  "/admin/sources": "Sources",
  "/admin/documents": "Documents",
  "/admin/subscriptions": "Subscriptions",
  "/admin/payments": "Payments",
  "/admin/notifications": "Notifications",
  "/admin/audit-logs": "Audit Logs",
  "/admin/settings": "Settings",
};

export function AdminTopbar() {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const pathname = usePathname();
  const title = titleMap[pathname] ?? "Admin";

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-card px-4 sm:px-6">
      <button className="lg:hidden text-foreground" onClick={() => setMobileOpen(true)} aria-label="Open navigation menu">
        <Menu className="h-6 w-6" />
      </button>
      <h1 className="text-base font-semibold text-foreground">{title}</h1>
      <div className="ml-auto flex items-center gap-2">
        <NotificationBell />
        <Link href="/dashboard" className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-secondary">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">AD</AvatarFallback>
          </Avatar>
        </Link>
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 bg-[var(--color-navy-deep)] p-0 border-0">
          <VisuallyHidden>
            <SheetTitle>Admin Navigation</SheetTitle>
          </VisuallyHidden>
          <AdminSidebar onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>
    </header>
  );
}
