import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { adminSources } from "@/lib/mock/sources";
import { format } from "date-fns";

const statusVariant = { active: "success", paused: "secondary", error: "danger", pending: "warning" } as const;

export default function AdminSourcesPage() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Crawler Sources</h2>
        <p className="text-sm text-muted-foreground">{adminSources.length} configured data sources</p>
      </div>

      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-5 py-3 font-medium">Source Name</th>
              <th className="px-5 py-3 font-medium">Type</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Last Crawl</th>
              <th className="px-5 py-3 font-medium">Tenders Found</th>
              <th className="px-5 py-3 font-medium">Success Rate</th>
            </tr>
          </thead>
          <tbody>
            {adminSources.map((s) => (
              <tr key={s.id} className="border-b border-border last:border-0 hover:bg-secondary/40">
                <td className="px-5 py-3 font-medium text-foreground">{s.name}</td>
                <td className="px-5 py-3 text-muted-foreground">{s.type}</td>
                <td className="px-5 py-3"><Badge variant={statusVariant[s.status]} className="capitalize">{s.status}</Badge></td>
                <td className="px-5 py-3 text-muted-foreground">{s.lastCrawl === "—" ? "—" : format(new Date(s.lastCrawl), "dd MMM, hh:mm a")}</td>
                <td className="px-5 py-3 text-muted-foreground">{s.tendersFound.toLocaleString("en-IN")}</td>
                <td className="px-5 py-3 w-40">
                  <div className="flex items-center gap-2">
                    <Progress value={s.successRate} className="h-1.5" />
                    <span className="w-10 shrink-0 text-xs text-muted-foreground">{s.successRate}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
