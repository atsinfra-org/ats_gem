import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { invoices } from "@/lib/mock/subscriptions";
import { adminUsers } from "@/lib/mock/users";
import { format } from "date-fns";

const statusVariant = { paid: "success", pending: "warning", failed: "danger" } as const;

export default function AdminPaymentsPage() {
  const payments = adminUsers.map((u, i) => ({
    ...invoices[i % invoices.length],
    id: `PAY-${1000 + i}`,
    user: u.name,
    company: u.company,
  }));

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Payments</h2>
        <p className="text-sm text-muted-foreground">Recent payment transactions across the platform</p>
      </div>

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-5 py-3 font-medium">Payment ID</th>
              <th className="px-5 py-3 font-medium">User</th>
              <th className="px-5 py-3 font-medium">Company</th>
              <th className="px-5 py-3 font-medium">Plan</th>
              <th className="px-5 py-3 font-medium">Date</th>
              <th className="px-5 py-3 font-medium">Amount</th>
              <th className="px-5 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id} className="border-b border-border last:border-0 hover:bg-secondary/40">
                <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{p.id}</td>
                <td className="px-5 py-3 font-medium text-foreground">{p.user}</td>
                <td className="px-5 py-3 text-muted-foreground">{p.company}</td>
                <td className="px-5 py-3 text-muted-foreground">{p.plan}</td>
                <td className="px-5 py-3 text-muted-foreground">{format(new Date(p.date), "dd MMM yyyy")}</td>
                <td className="px-5 py-3 text-foreground">₹{p.amount.toLocaleString("en-IN")}</td>
                <td className="px-5 py-3"><Badge variant={statusVariant[p.status]} className="capitalize">{p.status}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
