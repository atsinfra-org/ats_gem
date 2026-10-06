"use client";
/* eslint-disable react-hooks/set-state-in-effect -- loading flags for fetch-on-param-change effects */

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LayoutGrid, List, SlidersHorizontal, Search as SearchIcon, Bookmark, History, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { TenderCard } from "@/components/tender/tender-card";
import { FilterPanel } from "@/components/search/filter-panel";
import { SaveSearchModal } from "@/components/search/save-search-modal";
import { SearchBox, type PickKind } from "@/components/search/search-box";
import { SearchHistoryDialog } from "@/components/search/search-history-dialog";
import { SkeletonTender } from "@/components/states/skeletons";
import { EmptyState } from "@/components/states/empty-state";
import { ApiErrorState } from "@/components/states/status-error";
import { ApiError } from "@/lib/api/client";
import { getEntitiesByIds, recordSearchEvent } from "@/lib/api/search";
import { searchTenders, type TenderSearchResult } from "@/lib/api/tenders";
import { buildChips } from "@/lib/search/chips";
import {
  LIST_KEYS,
  MONEY_KEYS,
  DATE_KEYS,
  SORTS,
  SORT_LABELS,
  activeFilterCount,
  emptyFilters,
  parseSearchParams,
  toApiParams,
  toSearchParams,
  toSearchUrl,
  type SearchFilters,
  type SearchState,
  type SortKey,
} from "@/lib/search/search-state";
import { toLookup, useTaxonomy } from "@/lib/search/use-taxonomy";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 12;
const SCALAR_KEYS = [...MONEY_KEYS, ...DATE_KEYS] as const;
const INVALID_LABELS: Record<string, string> = { q: "keyword", page: "page number", sort: "sort order" };

const emptyResult: TenderSearchResult = { items: [], pagination: { page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 1 } };

function sanitizeFilters(base: SearchState, filters: SearchFilters): SearchFilters {
  return parseSearchParams(toSearchParams({ ...base, filters })).state.filters;
}

function emitFilterEvents(prev: SearchFilters, next: SearchFilters) {
  for (const key of LIST_KEYS) {
    for (const v of next[key]) if (!prev[key].includes(v)) recordSearchEvent({ type: "FILTER_APPLIED", name: key, value: v });
    for (const v of prev[key]) if (!next[key].includes(v)) recordSearchEvent({ type: "FILTER_REMOVED", name: key, value: v });
  }
  for (const key of SCALAR_KEYS) {
    if (prev[key] === next[key]) continue;
    recordSearchEvent({ type: next[key] ? "FILTER_APPLIED" : "FILTER_REMOVED", name: key });
  }
}

export function TenderSearchView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const paramString = searchParams.toString();

  // The URL is the single source of truth; everything below derives from it (back/forward, shared links, saved searches).
  const parsed = React.useMemo(() => parseSearchParams(new URLSearchParams(paramString)), [paramString]);
  const state = parsed.state;
  const canonical = toSearchParams(state).toString();
  const stateRef = React.useRef(state);
  React.useEffect(() => {
    stateRef.current = state;
  });

  const [ignored, setIgnored] = React.useState<string[]>([]);
  const [draft, setDraft] = React.useState<SearchFilters>(state.filters);
  const [entityLabels, setEntityLabels] = React.useState<Record<string, string>>({});
  const [view, setView] = React.useState<"grid" | "list">("grid");
  const [mobileFiltersOpen, setMobileFiltersOpen] = React.useState(false);
  const [saveSearchOpen, setSaveSearchOpen] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<unknown>(null);
  const [retryTick, setRetryTick] = React.useState(0);
  const [result, setResult] = React.useState<TenderSearchResult>(emptyResult);
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastReported = React.useRef("");

  const taxonomy = useTaxonomy();
  const lookup = React.useMemo(() => toLookup(taxonomy, entityLabels), [taxonomy, entityLabels]);

  const navigate = React.useCallback(
    (next: SearchState, mode: "push" | "replace" = "push", scroll = false) => {
      const url = toSearchUrl(next);
      if (mode === "push") router.push(url, { scroll });
      else router.replace(url, { scroll });
    },
    [router],
  );

  // Normalize whatever is in the address bar: drop invalid values, rename the legacy `keyword` param, fix ordering.
  React.useEffect(() => {
    if (parsed.invalid.length) setIgnored(parsed.invalid);
    if (paramString !== canonical) router.replace(toSearchUrl(state), { scroll: false });
  }, [paramString, canonical, parsed.invalid, state, router]);

  // Keep the filter draft (which may hold not-yet-valid typing) in step with the URL.
  React.useEffect(() => {
    setDraft(stateRef.current.filters);
  }, [canonical]);

  React.useEffect(() => () => clearTimeout(timer.current), []);

  // Organization ids arriving from a shared link/saved search have no label yet: resolve just those, once.
  const entityKey = state.filters.procuringEntity.filter((id) => !entityLabels[id]).join(",");
  React.useEffect(() => {
    if (!entityKey) return;
    const c = new AbortController();
    getEntitiesByIds(entityKey.split(","), c.signal)
      .then((list) => setEntityLabels((l) => ({ ...l, ...Object.fromEntries(list.map((e) => [e.id, e.name])) })))
      .catch(() => undefined);
    return () => c.abort();
  }, [entityKey]);

  const apiParams = React.useMemo(() => toApiParams(parseSearchParams(new URLSearchParams(canonical)).state, PAGE_SIZE), [canonical]);

  React.useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    searchTenders(apiParams, controller.signal)
      .then((res) => {
        setResult(res);
        setLoading(false);
        const key = `${canonical}#${retryTick}`;
        if (typeof apiParams.q === "string" && apiParams.page === 1 && lastReported.current !== key) {
          lastReported.current = key;
          recordSearchEvent({ type: "SEARCH_SUBMITTED", query: apiParams.q, resultCount: Math.min(res.pagination.total, 1_000_000) });
        }
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err);
        setLoading(false);
      });
    return () => controller.abort();
  }, [apiParams, canonical, retryTick]);

  function submitQuery(q: string) {
    if (q === state.q && state.page === 1) {
      setRetryTick((t) => t + 1);
      return;
    }
    navigate({ ...state, q, page: 1 });
  }

  function pickFilter(kind: PickKind, value: string, label: string) {
    if (kind === "procuringEntity") setEntityLabels((l) => ({ ...l, [value]: label }));
    const current = state.filters[kind];
    const filters = { ...state.filters, [kind]: current.includes(value) ? current : [...current, value] };
    recordSearchEvent({ type: "FILTER_APPLIED", name: kind, value });
    navigate({ ...state, q: "", filters, page: 1 });
  }

  function commitFilters(next: SearchFilters) {
    const base = stateRef.current;
    const sanitized = sanitizeFilters(base, next);
    const nextState = { ...base, filters: sanitized, page: 1 };
    if (toSearchParams(nextState).toString() === toSearchParams(base).toString()) return;
    emitFilterEvents(base.filters, sanitized);
    navigate(nextState);
  }

  function onFiltersChange(next: SearchFilters) {
    const scalarChanged = SCALAR_KEYS.some((k) => next[k] !== draft[k]);
    setDraft(next);
    clearTimeout(timer.current);
    if (scalarChanged) timer.current = setTimeout(() => commitFilters(next), 500);
    else commitFilters(next);
  }

  function clearFilters() {
    clearTimeout(timer.current);
    setDraft(emptyFilters);
    commitFilters(emptyFilters);
  }

  function changeSort(sort: SortKey) {
    recordSearchEvent({ type: "SORT_CHANGED", name: sort });
    navigate({ ...state, sort, page: 1 });
  }

  const chips = React.useMemo(() => buildChips(state, lookup), [state, lookup]);
  const filterCount = activeFilterCount(state.filters);
  const { items: results, pagination } = result;
  const capped = pagination.totalCapped === true;
  const totalLabel = `${pagination.total.toLocaleString("en-IN")}${capped ? "+" : ""}`;
  const shownSort: SortKey = state.sort === "relevance" && !state.q ? "newest" : state.sort;
  const sortOptions = SORTS.filter((s) => s !== "relevance" || state.q);
  const tooDeep = error instanceof ApiError && error.details?.some((d) => d.code === "PAGE_TOO_DEEP");
  const filterPanel = (
    <FilterPanel
      filters={draft}
      onChange={onFiltersChange}
      onClear={clearFilters}
      taxonomy={taxonomy}
      entityLabels={entityLabels}
      onEntityLabel={(id, name) => setEntityLabels((l) => ({ ...l, [id]: name }))}
    />
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Tender Search</h1>
        <p className="mt-1 text-sm text-muted-foreground">Search tenders ingested from connected sources.</p>
      </div>

      <SearchBox value={state.q} onSubmit={submitQuery} onPickFilter={pickFilter} onSuggestionSelected={(kind, label) => recordSearchEvent({ type: "SUGGESTION_SELECTED", name: kind.slice(0, 60), value: label.slice(0, 120) })}>
        <Button type="button" variant="outline" className="lg:hidden" onClick={() => setMobileFiltersOpen(true)}>
          <SlidersHorizontal className="h-4 w-4" /> Filters{filterCount > 0 && ` (${filterCount})`}
        </Button>
      </SearchBox>

      {ignored.length > 0 && (
        <div role="status" className="flex items-start justify-between gap-3 rounded-md border border-border bg-secondary/50 px-3 py-2 text-sm text-foreground">
          <p>Some options in this link were not valid and were ignored: {ignored.map((k) => INVALID_LABELS[k] ?? k).join(", ")}.</p>
          <button type="button" aria-label="Dismiss notice" onClick={() => setIgnored([])} className="shrink-0 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {chips.length > 0 && (
        <ul aria-label="Active filters" className="flex flex-wrap items-center gap-2">
          {chips.map((chip) => (
            <li key={chip.id}>
              <button
                type="button"
                aria-label={`Remove filter ${chip.label}`}
                onClick={() => {
                  recordSearchEvent({ type: "FILTER_REMOVED", name: chip.name.slice(0, 60), value: chip.value });
                  navigate(chip.remove(state));
                }}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2.5 py-1 text-xs text-secondary-foreground hover:bg-accent"
              >
                <span className="max-w-[16rem] truncate">{chip.label}</span>
                <X className="h-3 w-3" aria-hidden />
              </button>
            </li>
          ))}
          {chips.length > 1 && (
            <li>
              <button type="button" onClick={() => navigate({ ...state, q: "", filters: emptyFilters, page: 1 })} className="text-xs font-medium text-primary hover:underline">
                Clear all
              </button>
            </li>
          )}
        </ul>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[300px_1fr]">
        <aside className="hidden lg:block" aria-label="Search filters">
          {filterPanel}
        </aside>

        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
              {loading ? (
                "Searching..."
              ) : (
                <>
                  Showing <span className="font-medium text-foreground">{results.length}</span> of <span className="font-medium text-foreground">{totalLabel}</span> results
                </>
              )}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setHistoryOpen(true)}>
                <History className="h-3.5 w-3.5" /> History
              </Button>
              <Button variant="outline" size="sm" onClick={() => setSaveSearchOpen(true)}>
                <Bookmark className="h-3.5 w-3.5" /> Save Search
              </Button>
              <Select value={shownSort} onValueChange={(v) => changeSort(v as SortKey)}>
                <SelectTrigger className="h-9 w-[170px]" aria-label="Sort results">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  {sortOptions.map((s) => (
                    <SelectItem key={s} value={s}>
                      {SORT_LABELS[s]}
                    </SelectItem>
                  ))}
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

          {capped && !loading && (
            <p className="mb-3 text-xs text-muted-foreground">More than {pagination.total.toLocaleString("en-IN")} tenders match. Add a keyword or filters to narrow the results; only the first {pagination.total.toLocaleString("en-IN")} can be paged through.</p>
          )}

          {loading ? (
            <div className={cn("grid gap-4", view === "grid" ? "sm:grid-cols-2 2xl:grid-cols-3" : "grid-cols-1")}>
              {Array.from({ length: 6 }).map((_, i) => (
                <SkeletonTender key={i} />
              ))}
            </div>
          ) : tooDeep ? (
            <EmptyState icon={SearchIcon} title="That page is out of reach" description="Results beyond the first 10,000 cannot be paged. Narrow your search with a keyword or filters." actionLabel="Back to first page" onAction={() => navigate({ ...state, page: 1 })} />
          ) : error ? (
            <ApiErrorState error={error} onRetry={() => setRetryTick((t) => t + 1)} />
          ) : results.length === 0 && state.page > 1 && pagination.total > 0 ? (
            <EmptyState icon={SearchIcon} title="No results on this page" description="This page is past the end of the results." actionLabel="Back to first page" onAction={() => navigate({ ...state, page: 1 })} />
          ) : results.length === 0 ? (
            <EmptyState
              icon={SearchIcon}
              title="No tenders found"
              description={state.q ? `Nothing matched "${state.q}". Check the spelling, try fewer words, or remove some filters.` : "Try adjusting your filters to find more results."}
              actionLabel="Clear search and filters"
              onAction={() => navigate({ ...state, q: "", filters: emptyFilters, page: 1 })}
            />
          ) : (
            <>
              <div
                className={cn("grid gap-4", view === "grid" ? "sm:grid-cols-2 2xl:grid-cols-3" : "grid-cols-1")}
                onClickCapture={(e) => {
                  const target = e.target as HTMLElement;
                  if (!target.closest('a[href^="/tenders/"]')) return;
                  const link = target.closest<HTMLElement>("[data-result-id]");
                  if (!link) return;
                  recordSearchEvent({ type: "RESULT_OPENED", tenderId: link.dataset.resultId, position: Number(link.dataset.position), query: state.q || undefined });
                }}
              >
                {results.map((t, i) => (
                  <div key={t.id} data-result-id={t.id} data-position={(state.page - 1) * PAGE_SIZE + i + 1} className="contents">
                    <TenderCard tender={t} view={view} />
                  </div>
                ))}
              </div>

              <nav aria-label="Pagination" className="mt-6 flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Page {pagination.page} of {pagination.totalPages}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={state.page <= 1} onClick={() => navigate({ ...state, page: state.page - 1 }, "push", true)}>
                    Previous
                  </Button>
                  <Button variant="outline" size="sm" disabled={state.page >= pagination.totalPages} onClick={() => navigate({ ...state, page: state.page + 1 }, "push", true)}>
                    Next
                  </Button>
                </div>
              </nav>
            </>
          )}
        </div>
      </div>

      <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-xl">
          <SheetHeader>
            <SheetTitle>Filters</SheetTitle>
            <SheetDescription className="sr-only">Refine the tender search results.</SheetDescription>
          </SheetHeader>
          <div className="mt-4">{filterPanel}</div>
          <Button className="mt-4 w-full" onClick={() => setMobileFiltersOpen(false)}>
            {loading ? "Apply Filters" : `Show ${totalLabel} results`}
          </Button>
        </SheetContent>
      </Sheet>

      <SaveSearchModal
        open={saveSearchOpen}
        onOpenChange={setSaveSearchOpen}
        keyword={state.q}
        filters={state.filters}
        sort={state.sort}
        lookup={lookup}
        onSaved={() => recordSearchEvent({ type: "SEARCH_SAVED", query: state.q || undefined, resultCount: Math.min(pagination.total, 1_000_000) })}
      />
      <SearchHistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} onRun={(s) => navigate(s)} />
    </div>
  );
}
