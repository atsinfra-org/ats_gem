import type { Metadata } from "next";
import { FileText, Bookmark, BellRing, Clock } from "lucide-react";
import { StatCard } from "@/components/charts/stat-card";
import { ChartCard } from "@/components/charts/chart-card";
import { TenderOpportunityChart } from "@/components/charts/tender-opportunity-chart";
import { TenderCategoryChart } from "@/components/charts/tender-category-chart";
import { TenderCard } from "@/components/tender/tender-card";
import { getClosingSoonTenders, getRecommendedTenders } from "@/lib/api/tenders";
import { currentUser } from "@/lib/mock/users";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const [closingSoon, recommended] = await Promise.all([
    getClosingSoonTenders(4),
    getRecommendedTenders(4),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Good morning, {currentUser.name.split(" ")[0]}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Here&apos;s what&apos;s happening with your tender opportunities.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="New Tenders" value="128" icon={FileText} trend={12} trendLabel="vs last week" />
        <StatCard label="Saved Tenders" value="5" icon={Bookmark} trend={8} trendLabel="vs last week" />
        <StatCard label="Active Alerts" value="4" icon={BellRing} trend={0} trendLabel="no change" />
        <StatCard label="Closing Soon" value="9" icon={Clock} trend={-4} trendLabel="vs last week" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ChartCard title="Tender Opportunities" description="Trend over the last 6 months" className="lg:col-span-2">
          <TenderOpportunityChart />
        </ChartCard>
        <ChartCard title="Tender Categories" description="Distribution by category">
          <TenderCategoryChart />
        </ChartCard>
      </div>

      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Closing Soon</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {closingSoon.map((t) => (
            <TenderCard key={t.id} tender={t} />
          ))}
        </div>
      </div>

      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Recommended For You</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {recommended.map((t) => (
            <TenderCard key={t.id} tender={t} />
          ))}
        </div>
      </div>
    </div>
  );
}
