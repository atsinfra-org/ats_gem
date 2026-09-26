import { LIST_KEYS, STATUS_OPTIONS, type SearchFilters, type SearchState } from "./search-state";

export interface Chip {
  /** Stable key, also used in the accessible name of the remove button. */
  id: string;
  label: string;
  /** Analytics/filter name for the removed filter. */
  name: string;
  value?: string;
  remove: (s: SearchState) => SearchState;
}

/** Display names for ids (states, categories, organizations, sources, tender types). Missing ids fall back to a generic label. */
export interface LabelLookup {
  state?: Record<string, string>;
  district?: Record<string, string>;
  category?: Record<string, string>;
  procuringEntity?: Record<string, string>;
  tenderType?: Record<string, string>;
  source?: Record<string, string>;
}

const LIST_FALLBACK: Record<(typeof LIST_KEYS)[number], (v: string) => string> = {
  state: (v) => v,
  district: () => "District",
  city: (v) => v,
  category: () => "Category",
  procuringEntity: () => "Organization",
  tenderType: (v) => v,
  status: (v) => v,
  source: () => "Source",
};

const LIST_PREFIX: Record<(typeof LIST_KEYS)[number], string> = {
  state: "State",
  district: "District",
  city: "City",
  category: "Category",
  procuringEntity: "Organization",
  tenderType: "Type",
  status: "Status",
  source: "Source",
};

const RANGES: { min: keyof SearchFilters; max: keyof SearchFilters; label: string; kind: "money" | "date" }[] = [
  { min: "minValue", max: "maxValue", label: "Value", kind: "money" },
  { min: "minEmd", max: "maxEmd", label: "EMD", kind: "money" },
  { min: "minFee", max: "maxFee", label: "Fee", kind: "money" },
  { min: "publishedFrom", max: "publishedTo", label: "Published", kind: "date" },
  { min: "closingFrom", max: "closingTo", label: "Closing", kind: "date" },
  { min: "openingFrom", max: "openingTo", label: "Opening", kind: "date" },
];

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
const money = (v: string) => `₹${inr.format(Number(v))}`;
const day = (v: string) => new Date(`${v}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function rangeLabel(label: string, kind: "money" | "date", a: string, b: string): string {
  const f = kind === "money" ? money : day;
  if (a && b) return `${label}: ${f(a)} – ${f(b)}`;
  if (a) return `${label}: from ${f(a)}`;
  return `${label}: up to ${f(b)}`;
}

function statusLabel(v: string): string {
  return STATUS_OPTIONS.find((s) => s.value === v)?.label ?? v;
}

export function buildChips(state: SearchState, lookup: LabelLookup = {}): Chip[] {
  const chips: Chip[] = [];
  if (state.q) chips.push({ id: "q", label: `Keyword: ${state.q}`, name: "q", remove: (s) => ({ ...s, q: "", page: 1 }) });
  for (const key of LIST_KEYS) {
    for (const v of state.filters[key]) {
      const name = key === "status" ? statusLabel(v) : (lookup[key as keyof LabelLookup]?.[v] ?? LIST_FALLBACK[key](v));
      chips.push({
        id: `${key}:${v}`,
        label: `${LIST_PREFIX[key]}: ${name}`,
        name: key,
        value: v,
        remove: (s) => ({ ...s, page: 1, filters: { ...s.filters, [key]: s.filters[key].filter((x) => x !== v) } }),
      });
    }
  }
  for (const r of RANGES) {
    const a = state.filters[r.min] as string;
    const b = state.filters[r.max] as string;
    if (!a && !b) continue;
    chips.push({
      id: `${r.min}:${r.max}`,
      label: rangeLabel(r.label, r.kind, a, b),
      name: r.label.toLowerCase(),
      remove: (s) => ({ ...s, page: 1, filters: { ...s.filters, [r.min]: "", [r.max]: "" } }),
    });
  }
  return chips;
}
