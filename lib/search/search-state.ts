/**
 * The single model of "what is being searched" for the tender search UI. The URL is the source of truth:
 * `parseSearchParams` validates whatever is in the address bar (anything invalid is dropped and reported,
 * never sent to the API), `toSearchParams` produces the canonical URL, and `toApiParams` / `toCriteria`
 * derive the API query and the saved-search criteria from the same state.
 */

export const SORTS = ["relevance", "newest", "closingSoonest", "closingLatest", "valueHigh", "valueLow"] as const;
export type SortKey = (typeof SORTS)[number];

export const SORT_LABELS: Record<SortKey, string> = {
  relevance: "Best match",
  newest: "Newest first",
  closingSoonest: "Closing soonest",
  closingLatest: "Closing latest",
  valueHigh: "Value: high to low",
  valueLow: "Value: low to high",
};

export const STATUS_OPTIONS = [
  { value: "UPCOMING", label: "Upcoming" },
  { value: "OPEN", label: "Open" },
  { value: "CLOSING_SOON", label: "Closing soon" },
  { value: "CLOSED", label: "Closed" },
  { value: "AWARDED", label: "Awarded" },
  { value: "CANCELLED", label: "Cancelled" },
] as const;

export interface SearchFilters {
  state: string[];
  district: string[];
  city: string[];
  category: string[];
  procuringEntity: string[];
  tenderType: string[];
  status: string[];
  source: string[];
  minValue: string;
  maxValue: string;
  minEmd: string;
  maxEmd: string;
  minFee: string;
  maxFee: string;
  publishedFrom: string;
  publishedTo: string;
  closingFrom: string;
  closingTo: string;
  openingFrom: string;
  openingTo: string;
}

export interface SearchState {
  q: string;
  filters: SearchFilters;
  sort: SortKey;
  page: number;
}

export const emptyFilters: SearchFilters = {
  state: [],
  district: [],
  city: [],
  category: [],
  procuringEntity: [],
  tenderType: [],
  status: [],
  source: [],
  minValue: "",
  maxValue: "",
  minEmd: "",
  maxEmd: "",
  minFee: "",
  maxFee: "",
  publishedFrom: "",
  publishedTo: "",
  closingFrom: "",
  closingTo: "",
  openingFrom: "",
  openingTo: "",
};

export const emptySearch: SearchState = { q: "", filters: emptyFilters, sort: "relevance", page: 1 };

export const LIST_KEYS = ["state", "district", "city", "category", "procuringEntity", "tenderType", "status", "source"] as const;
export const MONEY_KEYS = ["minValue", "maxValue", "minEmd", "maxEmd", "minFee", "maxFee"] as const;
export const DATE_KEYS = ["publishedFrom", "publishedTo", "closingFrom", "closingTo", "openingFrom", "openingTo"] as const;

const MAX_Q = 200;
const MAX_LIST = 40;
const MAX_CITIES = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECIMAL = /^\d{1,16}(\.\d{1,2})?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const STATUS_SET = new Set<string>(STATUS_OPTIONS.map((s) => s.value));

const LIST_RULES: Record<(typeof LIST_KEYS)[number], (v: string) => boolean> = {
  state: (v) => /^[A-Z]{2}$/.test(v),
  district: (v) => UUID.test(v),
  city: (v) => v.length <= 100 && !/\p{Cc}/u.test(v),
  category: (v) => UUID.test(v),
  procuringEntity: (v) => UUID.test(v),
  tenderType: (v) => /^[A-Za-z0-9_-]{1,50}$/.test(v),
  status: (v) => STATUS_SET.has(v),
  source: (v) => UUID.test(v),
};

export function isValidDate(v: string): boolean {
  if (!DATE_ONLY.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function readList(params: URLSearchParams, key: string): string[] {
  const out: string[] = [];
  for (const raw of params.getAll(key)) for (const part of raw.split(",")) if (part.trim()) out.push(part.trim());
  return out;
}

export interface ParsedSearch {
  state: SearchState;
  /** Parameter names that were present but invalid and therefore ignored. */
  invalid: string[];
}

/** Accepts `URLSearchParams` or anything with `get`/`getAll` (Next's ReadonlyURLSearchParams). */
export function parseSearchParams(params: Pick<URLSearchParams, "get" | "getAll">): ParsedSearch {
  const invalid: string[] = [];
  const filters: SearchFilters = { ...emptyFilters };

  // `keyword` is the pre-Phase-7 name (topbar, old links); `q` wins when both exist.
  let q = (params.get("q") ?? params.get("keyword") ?? "").replace(/\s+/g, " ").trim();
  if (q.length > MAX_Q) {
    q = q.slice(0, MAX_Q);
    invalid.push("q");
  }

  for (const key of LIST_KEYS) {
    const values = readList(params as URLSearchParams, key);
    const valid = [...new Set(values.filter(LIST_RULES[key]))].slice(0, key === "city" ? MAX_CITIES : MAX_LIST);
    if (valid.length !== values.length) invalid.push(key);
    filters[key] = valid;
  }
  for (const key of MONEY_KEYS) {
    const v = params.get(key);
    if (v === null || v === "") continue;
    if (DECIMAL.test(v)) filters[key] = v;
    else invalid.push(key);
  }
  for (const key of DATE_KEYS) {
    const v = params.get(key);
    if (v === null || v === "") continue;
    if (isValidDate(v)) filters[key] = v;
    else invalid.push(key);
  }

  const range = (min: keyof SearchFilters, max: keyof SearchFilters, numeric: boolean) => {
    const a = filters[min] as string;
    const b = filters[max] as string;
    if (a && b && (numeric ? Number(a) > Number(b) : a > b)) {
      (filters[max] as string) = "";
      invalid.push(String(max));
    }
  };
  range("minValue", "maxValue", true);
  range("minEmd", "maxEmd", true);
  range("minFee", "maxFee", true);
  range("publishedFrom", "publishedTo", false);
  range("closingFrom", "closingTo", false);
  range("openingFrom", "openingTo", false);

  const sortRaw = params.get("sort");
  let sort: SortKey = "relevance";
  if (sortRaw) {
    if ((SORTS as readonly string[]).includes(sortRaw)) sort = sortRaw as SortKey;
    else invalid.push("sort");
  }

  let page = 1;
  const pageRaw = params.get("page");
  if (pageRaw) {
    const n = Number(pageRaw);
    if (Number.isInteger(n) && n >= 1 && n <= 10_000) page = n;
    else invalid.push("page");
  }

  return { state: { q, filters, sort, page }, invalid };
}

/** Canonical URL query: defaults and empty values are omitted so equal searches have equal URLs. */
export function toSearchParams(state: SearchState): URLSearchParams {
  const p = new URLSearchParams();
  if (state.q) p.set("q", state.q);
  for (const key of LIST_KEYS) if (state.filters[key].length) p.set(key, state.filters[key].join(","));
  for (const key of MONEY_KEYS) if (state.filters[key]) p.set(key, state.filters[key]);
  for (const key of DATE_KEYS) if (state.filters[key]) p.set(key, state.filters[key]);
  if (state.sort !== "relevance") p.set("sort", state.sort);
  if (state.page > 1) p.set("page", String(state.page));
  return p;
}

export function toSearchUrl(state: SearchState): string {
  const qs = toSearchParams(state).toString();
  return qs ? `/tenders?${qs}` : "/tenders";
}

/** API query for GET /search/tenders. Lists go out comma-separated; empty values are omitted by the client. */
export function toApiParams(state: SearchState, pageSize: number): Record<string, string | number | undefined> {
  const out: Record<string, string | number | undefined> = { q: state.q || undefined };
  for (const key of LIST_KEYS) out[key] = state.filters[key].length ? state.filters[key].join(",") : undefined;
  for (const key of MONEY_KEYS) out[key] = state.filters[key] || undefined;
  for (const key of DATE_KEYS) out[key] = state.filters[key] || undefined;
  out.sort = state.sort;
  out.page = state.page;
  out.pageSize = pageSize;
  return out;
}

export function isSameSearch(a: SearchState, b: SearchState): boolean {
  return toSearchParams(a).toString() === toSearchParams(b).toString();
}

export function activeFilterCount(filters: SearchFilters): number {
  let n = 0;
  for (const key of LIST_KEYS) n += filters[key].length ? 1 : 0;
  const pair = (a: keyof SearchFilters, b: keyof SearchFilters) => (filters[a] || filters[b] ? 1 : 0);
  n += pair("minValue", "maxValue") + pair("minEmd", "maxEmd") + pair("minFee", "maxFee");
  n += pair("publishedFrom", "publishedTo") + pair("closingFrom", "closingTo") + pair("openingFrom", "openingTo");
  return n;
}

export type SavedCriteria = Record<string, unknown>;

/** Saved-search criteria: everything that defines the result set, none of the view state (sort is included, page is not). */
export function toCriteria(state: SearchState): SavedCriteria {
  const c: SavedCriteria = {};
  if (state.q) c.q = state.q;
  for (const key of LIST_KEYS) if (state.filters[key].length) c[key] = state.filters[key];
  for (const key of [...MONEY_KEYS, ...DATE_KEYS]) if (state.filters[key]) c[key] = state.filters[key];
  if (state.sort !== "relevance") c.sort = state.sort;
  return c;
}

const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" && v ? [v] : []);

/** Accepts both current (list-valued) and legacy (single-string) criteria and validates through the same parser as the URL. */
export function fromCriteria(criteria: SavedCriteria): SearchState {
  const p = new URLSearchParams();
  if (typeof criteria.q === "string") p.set("q", criteria.q);
  for (const key of LIST_KEYS) {
    const list = asList(criteria[key]);
    if (list.length) p.set(key, list.join(","));
  }
  for (const key of [...MONEY_KEYS, ...DATE_KEYS, "sort"]) {
    const v = criteria[key];
    if (typeof v === "string" && v) p.set(key, key.endsWith("From") || key.endsWith("To") ? v.slice(0, 10) : v);
  }
  return parseSearchParams(p).state;
}
