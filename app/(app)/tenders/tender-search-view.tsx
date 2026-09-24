"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LayoutGrid, List, SlidersHorizontal, Search as SearchIcon, FileDown, Bookmark } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { TenderCard } from "@/components/tender/tender-card";
import { FilterPanel, emptyFilters, type FilterState } from "@/components/search/filter-panel";
import { SaveSearchModal } from "@/components/search/save-search-modal";
import { SkeletonTender } from "@/components/states/skeletons";
import { EmptyState } from "@/components/states/empty-state";
import { searchTenders } from "@/lib/api/tenders";
import type { Tender } from "@/lib/types";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 9;

export function TenderSearchView() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [keyword, setKeyword] = React.useState(searchParams.get("keyword") ?? "");
  const [sort, setSort] = React.useState("latest");
  const [view, setView] = React.useState<"grid" | "list">("grid");
  const [page, setPage] = React.useState(1);
  const [filters, setFilters] = React.useState<FilterState>(() => {
    const fromParam = (key: string) => {
      const value = searchParams.get(key);
      return value ? [value] : [];
    };
    return {
      ...emptyFilters,
      categories: fromParam("category"),
      states: fromParam("state"),
      sources: fromParam("source"),
    };
  });
  const [mobileFiltersOpen, setMobileFiltersOpen] = React.useState(false);
  const [saveSearchOpen, setSaveSearchOpen] = React.useState(false);

  const [loading, setLoading] = React.useState(true);
  const [results, setResults] = React.useState<Tender[]>([]);
  const [total, setTotal] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading flag for an in-flight data fetch
    setLoading(true);
    searchTenders({
      keyword,
      state: filters.states[0],
      category: filters.categories[0],
      industry: filters.industries[0],
      tenderType: filters.tenderTypes[0],
      source: filters.sources[0],
      sort,
      page,
      pageSize: PAGE_SIZE,
    }).then((res) => {
      if (cancelled) return;
      setResults(res.items);
      setTotal(res.total);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [keyword, filters, sort, page]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset pagination when query changes
    setPage(1);
  }, [keyword, filters, sort]);

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    router.replace(`/tenders?keyword=${encodeURIComponent(keyword)}`);
  }

  const filterSummary = [
    ...filters.states,
    ...filters.categories,
    ...filters.industries,
    ...filters.tenderTypes,
    ...filters.sources,
  ];

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Tender Search</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Verified government and private tenders from 5,000+ sources, updated every 15 minutes.
        </p>
      </div>

      <form onSubmit={handleSearchSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="Search by keyword, department, tender ID..."
            className="pl-9"
            aria-label="Search tenders"
          />
        </div>
        <Button type="submit">Search</Button>
        <Button type="button" variant="outline" className="lg:hidden" onClick={() => setMobileFiltersOpen(true)}>
          <SlidersHorizontal className="h-4 w-4" /> Filters
        </Button>
      </form>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
        <aside className="hidden lg:block">
          <FilterPanel filters={filters} onChange={setFilters} onClear={() => setFilters(emptyFilters)} />
        </aside>

        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Showing <span className="font-medium text-foreground">{results.length}</span> of{" "}
              <span className="font-medium text-foreground">{total.toLocaleString("en-IN")}</span> results
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setSaveSearchOpen(true)}>
                <Bookmark className="h-3.5 w-3.5" /> Save Search
              </Button>
              <Button variant="outline" size="sm">
                <FileDown className="h-3.5 w-3.5" /> Export
              </Button>
              <Select value={sort} onValueChange={setSort}>
                <SelectTrigger className="h-9 w-[160px]" aria-label="Sort results">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="latest">Latest First</SelectItem>
                  <SelectItem value="closing_soon">Closing Soon</SelectItem>
                  <SelectItem value="value_high">Value: High to Low</SelectItem>
                  <SelectItem value="value_low">Value: Low to High</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center rounded-md border border-border p-0.5">
                <button
                  onClick={() => setView("grid")}
                  aria-label="Grid view"
                  aria-pressed={view === "grid"}
                  className={cn("rounded p-1.5", view === "grid" ? "bg-secondary text-foreground" : "text-muted-foreground")}
                >
                  <LayoutGrid className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setView("list")}
                  aria-label="List view"
                  aria-pressed={view === "list"}
                  className={cn("rounded p-1.5", view === "list" ? "bg-secondary text-foreground" : "text-muted-foreground")}
                >
                  <List className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          {loading ? (
            <div className={cn("grid gap-4", view === "grid" ? "sm:grid-cols-2 xl:grid-cols-3" : "grid-cols-1")}>
              {Array.from({ length: 6 }).map((_, i) => (
                <SkeletonTender key={i} />
              ))}
            </div>
          ) : results.length === 0 ? (
            <EmptyState
              icon={SearchIcon}
              title="No tenders found"
              description="Try adjusting your search keywords or filters to find more results."
              actionLabel="Clear Filters"
              onAction={() => {
                setFilters(emptyFilters);
                setKeyword("");
              }}
            />
          ) : (
            <>
              <div className={cn("grid gap-4", view === "grid" ? "sm:grid-cols-2 xl:grid-cols-3" : "grid-cols-1")}>
                {results.map((t) => (
                  <TenderCard key={t.id} tender={t} view={view} />
                ))}
              </div>

              <div className="mt-6 flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Page {page} of {totalPages}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    Previous
                  </Button>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-xl">
          <SheetHeader>
            <SheetTitle>Filters</SheetTitle>
          </SheetHeader>
          <div className="mt-4">
            <FilterPanel filters={filters} onChange={setFilters} onClear={() => setFilters(emptyFilters)} />
          </div>
          <Button className="mt-4 w-full" onClick={() => setMobileFiltersOpen(false)}>
            Apply Filters
          </Button>
        </SheetContent>
      </Sheet>

      <SaveSearchModal
        open={saveSearchOpen}
        onOpenChange={setSaveSearchOpen}
        keywords={keyword}
        filterSummary={filterSummary}
      />
    </div>
  );
}
