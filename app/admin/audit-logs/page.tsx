import { Card } from "@/components/ui/card";
import { auditLogs } from "@/lib/mock/audit-logs";
import { format } from "date-fns";

export default function AdminAuditLogsPage() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Audit Logs</h2>
        <p className="text-sm text-muted-foreground">Track administrative and system actions across the platform</p>
      </div>

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-5 py-3 font-medium">Actor</th>
              <th className="px-5 py-3 font-medium">Action</th>
              <th className="px-5 py-3 font-medium">Target</th>
              <th className="px-5 py-3 font-medium">IP Address</th>
              <th className="px-5 py-3 font-medium">Timestamp</th>
            </tr>
          </thead>
          <tbody>
            {auditLogs.map((log) => (
              <tr key={log.id} className="border-b border-border last:border-0 hover:bg-secondary/40">
                <td className="px-5 py-3 font-medium text-foreground">{log.actor}</td>
                <td className="px-5 py-3 text-muted-foreground">{log.action}</td>
                <td className="px-5 py-3 text-muted-foreground">{log.target}</td>
                <td className="px-5 py-3 font-mono text-xs text-muted-foreground">{log.ip}</td>
                <td className="px-5 py-3 text-muted-foreground">{format(new Date(log.timestamp), "dd MMM yyyy, hh:mm a")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
