import type { Metadata } from "next";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { AppTopbar } from "@/components/layout/app-topbar";
import { RequireAuth } from "@/components/auth/require-auth";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AppShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <div className="flex min-h-screen bg-background">
        <aside className="hidden w-64 shrink-0 border-r border-border bg-card lg:block">
          <div className="sticky top-0 h-screen">
            <SidebarNav />
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <AppTopbar />
          <main className="flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
        </div>
      </div>
    </RequireAuth>
  );
}
