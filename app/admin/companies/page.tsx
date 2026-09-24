import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { adminCompanies } from "@/lib/mock/companies";

const statusVariant = { active: "success", suspended: "danger", trial: "warning" } as const;

export default function AdminCompaniesPage() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Companies</h2>
        <p className="text-sm text-muted-foreground">{adminCompanies.length} registered companies</p>
      </div>

      <Card className="hidden overflow-x-auto p-0 sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-5 py-3 font-medium">Company</th>
              <th className="px-5 py-3 font-medium">Plan</th>
              <th className="px-5 py-3 font-medium">Users</th>
              <th className="px-5 py-3 font-medium">Tenders Tracked</th>
              <th className="px-5 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {adminCompanies.map((c) => (
              <tr key={c.id} className="border-b border-border last:border-0 hover:bg-secondary/40">
                <td className="px-5 py-3 font-medium text-foreground">{c.name}</td>
                <td className="px-5 py-3 text-muted-foreground">{c.plan}</td>
                <td className="px-5 py-3 text-muted-foreground">{c.users}</td>
                <td className="px-5 py-3 text-muted-foreground">{c.tendersTracked}</td>
                <td className="px-5 py-3">
                  <Badge variant={statusVariant[c.status as keyof typeof statusVariant]} className="capitalize">{c.status}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="space-y-3 sm:hidden">
        {adminCompanies.map((c) => (
          <Card key={c.id} className="p-4">
            <div className="flex items-start justify-between">
              <p className="text-sm font-semibold text-foreground">{c.name}</p>
              <Badge variant={statusVariant[c.status as keyof typeof statusVariant]} className="capitalize">{c.status}</Badge>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>Plan: {c.plan}</span>
              <span>{c.users} users</span>
              <span>{c.tendersTracked} tenders</span>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
