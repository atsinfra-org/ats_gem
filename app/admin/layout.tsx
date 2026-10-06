import type { Metadata } from "next";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { AdminTopbar } from "@/components/admin/admin-topbar";
import { RequireStaffAccess } from "@/components/auth/require-staff-access";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireStaffAccess>
      <div className="flex min-h-screen bg-background">
        <aside className="hidden w-64 shrink-0 bg-[var(--color-navy-deep)] lg:block">
          <div className="sticky top-0 h-screen">
            <AdminSidebar />
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <AdminTopbar />
          <main className="flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
        </div>
      </div>
    </RequireStaffAccess>
  );
}
