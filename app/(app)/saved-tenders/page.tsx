"use client";
/* eslint-disable react-hooks/set-state-in-effect -- loading flags for fetch-on-mount/param-change effects */

import * as React from "react";
import { Bookmark, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TenderCard } from "@/components/tender/tender-card";
import { EmptyState } from "@/components/states/empty-state";
import { ApiErrorState } from "@/components/states/status-error";
import { SkeletonTender } from "@/components/states/skeletons";
import { listWatchlist } from "@/lib/api/watchlist";
import { getTender } from "@/lib/api/tenders";
import type { TenderDetail } from "@/lib/api/types";

export default function SavedTendersPage() {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<unknown>(null);
  const [tenders, setTenders] = React.useState<TenderDetail[]>([]);
  const [query, setQuery] = React.useState("");
  const [sort, setSort] = React.useState("latest");

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await listWatchlist();
      const results = await Promise.allSettled(items.map((i) => getTender(i.tenderId)));
      setTenders(results.filter((r): r is PromiseFulfilledResult<TenderDetail> => r.status === "fulfilled").map((r) => r.value));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  let saved = tenders;
  if (query) {
    const kw = query.toLowerCase();
    saved = saved.filter((t) => t.title.toLowerCase().includes(kw) || (t.department ?? "").toLowerCase().includes(kw));
  }
  if (sort === "closing_soon") {
    saved = [...saved].sort((a, b) => new Date(a.closingAt ?? 8_640_000_000_000_000).getTime() - new Date(b.closingAt ?? 8_640_000_000_000_000).getTime());
  } else if (sort === "value_high") {
    saved = [...saved].sort((a, b) => Number(b.estimatedValue?.amount ?? 0) - Number(a.estimatedValue?.amount ?? 0));
  } else {
    saved = [...saved].sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Saved Tenders</h1>
        <p className="mt-1 text-sm text-muted-foreground">Tenders you&apos;ve bookmarked for quick access.</p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search saved tenders..." className="pl-9" />
        </div>
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="sm:w-52" aria-label="Sort saved tenders">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="latest">Latest First</SelectItem>
            <SelectItem value="closing_soon">Closing Soon</SelectItem>
            <SelectItem value="value_high">Value: High to Low</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonTender key={i} />
          ))}
        </div>
      ) : error ? (
        <ApiErrorState error={error} onRetry={load} />
      ) : saved.length === 0 ? (
        <EmptyState
          icon={Bookmark}
          title="No saved tenders yet"
          description="Save tenders while browsing to track and revisit them here."
          actionLabel="Browse Tenders"
          actionHref="/tenders"
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {saved.map((t) => (
            <TenderCard key={t.id} tender={t} />
          ))}
        </div>
      )}
    </div>
  );
}
