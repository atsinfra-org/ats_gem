import type { Metadata } from "next";
import { Users, Building2, FileText, Server, FolderOpen, IndianRupee } from "lucide-react";
import { StatCard } from "@/components/charts/stat-card";
import { ChartCard } from "@/components/charts/chart-card";
import { UserGrowthChart, TenderIngestionChart, RevenueChart, SourceBreakdownChart } from "@/components/charts/admin-charts";

export const metadata: Metadata = { title: "Admin Overview" };

export default function AdminOverviewPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Platform Overview</h2>
        <p className="mt-1 text-sm text-muted-foreground">Monitor platform health, growth and revenue at a glance.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Total Users" value="25,600" icon={Users} trend={14} trendLabel="MoM" />
        <StatCard label="Active Companies" value="3,240" icon={Building2} trend={9} trendLabel="MoM" />
        <StatCard label="Live Tenders" value="1,04,820" icon={FileText} trend={6} trendLabel="MoM" />
        <StatCard label="Crawler Sources" value="5,120" icon={Server} trend={2} trendLabel="MoM" />
        <StatCard label="Documents" value="8,42,300" icon={FolderOpen} trend={11} trendLabel="MoM" />
        <StatCard label="Monthly Revenue" value="₹32.2L" icon={IndianRupee} trend={18} trendLabel="MoM" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="User Growth" description="New registered users over time">
          <UserGrowthChart />
        </ChartCard>
        <ChartCard title="Tender Ingestion" description="Tenders crawled per day (last 7 days)">
          <TenderIngestionChart />
        </ChartCard>
        <ChartCard title="Subscription Revenue" description="Monthly recurring revenue trend">
          <RevenueChart />
        </ChartCard>
        <ChartCard title="Tender Sources" description="Distribution by source type">
          <SourceBreakdownChart />
        </ChartCard>
      </div>
    </div>
  );
}
