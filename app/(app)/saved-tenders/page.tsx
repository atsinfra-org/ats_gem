"use client";

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
import { SkeletonTender } from "@/components/states/skeletons";
import { useAppStore } from "@/lib/store/app-store";
import { tenders } from "@/lib/mock/tenders";

export default function SavedTendersPage() {
  const { savedTenderIds } = useAppStore();
  const [loading, setLoading] = React.useState(true);
  const [query, setQuery] = React.useState("");
  const [sort, setSort] = React.useState("latest");

  React.useEffect(() => {
    const t = setTimeout(() => setLoading(false), 400);
    return () => clearTimeout(t);
  }, []);

  let saved = tenders.filter((t) => savedTenderIds.includes(t.id));
  if (query) {
    const kw = query.toLowerCase();
    saved = saved.filter((t) => t.title.toLowerCase().includes(kw) || t.department.toLowerCase().includes(kw));
  }
  if (sort === "closing_soon") {
    saved = [...saved].sort((a, b) => new Date(a.submissionDeadline).getTime() - new Date(b.submissionDeadline).getTime());
  } else if (sort === "value_high") {
    saved = [...saved].sort((a, b) => b.estimatedValue - a.estimatedValue);
  } else {
    saved = [...saved].sort((a, b) => new Date(b.publishedDate).getTime() - new Date(a.publishedDate).getTime());
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
          <SelectTrigger className="sm:w-52">
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
