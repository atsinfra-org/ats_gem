import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { adminUsers } from "@/lib/mock/users";
import { pricingPlans } from "@/lib/mock/subscriptions";

const fallbackSubscriberCounts: Record<string, number> = {
  free: 8420,
  professional: 12680,
  business: 3940,
  enterprise: 560,
};

export default function AdminSubscriptionsPage() {
  const planCounts = pricingPlans.map((p) => ({
    ...p,
    count:
      adminUsers.filter((u) => u.plan.toLowerCase() === p.name.toLowerCase()).length ||
      fallbackSubscriberCounts[p.id] ||
      0,
  }));

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Subscriptions</h2>
        <p className="text-sm text-muted-foreground">Overview of active subscriptions by plan</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {planCounts.map((p) => (
          <Card key={p.id} className="p-5">
            <p className="text-sm font-medium text-muted-foreground">{p.name}</p>
            <p className="mt-2 text-2xl font-bold text-foreground">{p.count.toLocaleString("en-IN")}</p>
            <p className="mt-1 text-xs text-muted-foreground">active subscribers</p>
          </Card>
        ))}
      </div>

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-5 py-3 font-medium">User</th>
              <th className="px-5 py-3 font-medium">Company</th>
              <th className="px-5 py-3 font-medium">Plan</th>
              <th className="px-5 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {adminUsers.map((u) => (
              <tr key={u.id} className="border-b border-border last:border-0 hover:bg-secondary/40">
                <td className="px-5 py-3 font-medium text-foreground">{u.name}</td>
                <td className="px-5 py-3 text-muted-foreground">{u.company}</td>
                <td className="px-5 py-3 text-muted-foreground">{u.plan}</td>
                <td className="px-5 py-3">
                  <Badge variant={u.status === "active" ? "success" : u.status === "suspended" ? "danger" : "warning"} className="capitalize">
                    {u.status}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
