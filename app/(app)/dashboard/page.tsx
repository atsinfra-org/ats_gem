"use client";

import * as React from "react";
import Link from "next/link";
import { Bookmark, Clock, Search as SearchIcon } from "lucide-react";
import { TenderCard } from "@/components/tender/tender-card";
import { SkeletonTender } from "@/components/states/skeletons";
import { ApiErrorState } from "@/components/states/status-error";
import { EmptyState } from "@/components/states/empty-state";
import { useSession } from "@/lib/auth/session-context";
import { useWatchlist } from "@/lib/store/watchlist-store";
import { searchTenders } from "@/lib/api/tenders";
import type { TenderSummary } from "@/lib/api/types";

export default function DashboardPage() {
  const { user } = useSession();
  const { savedTenderIds } = useWatchlist();
  const [closingSoon, setClosingSoon] = React.useState<TenderSummary[] | null>(null);
  const [recent, setRecent] = React.useState<TenderSummary[] | null>(null);
  const [error, setError] = React.useState<unknown>(null);

  React.useEffect(() => {
    let cancelled = false;
    Promise.all([
      searchTenders({ status: "CLOSING_SOON", sortBy: "closingAt", sortOrder: "asc", pageSize: 4 }),
      searchTenders({ sortBy: "publishedAt", sortOrder: "desc", pageSize: 4 }),
    ])
      .then(([closing, latest]) => {
        if (cancelled) return;
        setClosingSoon(closing.items);
        setRecent(latest.items);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {user ? `Good to see you, ${user.name.split(" ")[0]}` : "Dashboard"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">Here&apos;s what&apos;s happening with your tender opportunities.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link href="/saved-tenders" className="flex items-center gap-4 rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary/40">
          <Bookmark className="h-5 w-5 text-primary" />
          <div>
            <p className="text-2xl font-bold text-foreground">{savedTenderIds.size}</p>
            <p className="text-sm text-muted-foreground">Saved Tenders</p>
          </div>
        </Link>
        <Link href="/tenders?sort=closing_soon" className="flex items-center gap-4 rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary/40">
          <Clock className="h-5 w-5 text-primary" />
          <div>
            <p className="text-2xl font-bold text-foreground">{closingSoon?.length ?? "—"}</p>
            <p className="text-sm text-muted-foreground">Closing Soon (top results)</p>
          </div>
        </Link>
      </div>

      {error != null && <ApiErrorState error={error} />}

      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Closing Soon</h2>
          <Link href="/tenders" className="text-sm font-medium text-primary hover:underline">
            View all
          </Link>
        </div>
        {closingSoon === null ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonTender key={i} />
            ))}
          </div>
        ) : closingSoon.length === 0 ? (
          <EmptyState icon={SearchIcon} title="Nothing closing soon" description="No tenders are currently closing soon." />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {closingSoon.map((t) => (
              <TenderCard key={t.id} tender={t} />
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Recently Published</h2>
          <Link href="/tenders" className="text-sm font-medium text-primary hover:underline">
            View all
          </Link>
        </div>
        {recent === null ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonTender key={i} />
            ))}
          </div>
        ) : recent.length === 0 ? (
          <EmptyState icon={SearchIcon} title="No tenders yet" description="No tenders have been published yet." />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {recent.map((t) => (
              <TenderCard key={t.id} tender={t} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
