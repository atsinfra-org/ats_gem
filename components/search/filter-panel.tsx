"use client";
/* eslint-disable react-hooks/set-state-in-effect -- option lists load on mount; entity search follows the typed text */

import * as React from "react";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { searchCities, searchEntities, type CityOption, type EntityOption } from "@/lib/api/search";
import { useTaxonomy, type Taxonomy } from "@/lib/search/use-taxonomy";
import { STATUS_OPTIONS, emptyFilters, type SearchFilters } from "@/lib/search/search-state";

/** Filter values are exactly what `GET /search/tenders` accepts (docs/API-CONTRACT.md §5); lists are real multi-selects. */
export type FilterState = SearchFilters;
export { emptyFilters };

const DECIMAL = /^\d{0,16}(\.\d{0,2})?$/;

type Option = { value: string; label: string; indent?: boolean };

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function CheckList({ label, options, selected, onChange, filterable = false }: { label: string; options: Option[]; selected: string[]; onChange: (next: string[]) => void; filterable?: boolean }) {
  const uid = React.useId();
  const [needle, setNeedle] = React.useState("");
  const shown = needle ? options.filter((o) => o.label.toLowerCase().includes(needle.toLowerCase())) : options;
  return (
    <div>
      {filterable && (
        <Input aria-label={`Find ${label.toLowerCase()}`} placeholder={`Find ${label.toLowerCase()}...`} value={needle} onChange={(e) => setNeedle(e.target.value)} className="mb-2 h-8 text-xs" />
      )}
      <div role="group" aria-label={label} className="max-h-52 space-y-1 overflow-y-auto pr-1">
        {options.length === 0 && <p className="text-xs text-muted-foreground">Loading...</p>}
        {shown.map((o, i) => {
          const id = `${uid}-${i}`;
          return (
            <div key={o.value} className="flex items-center gap-2" style={o.indent ? { paddingLeft: 16 } : undefined}>
              <Checkbox id={id} checked={selected.includes(o.value)} onCheckedChange={() => onChange(toggle(selected, o.value))} />
              <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer truncate text-sm text-foreground">
                {o.label}
              </label>
            </div>
          );
        })}
        {options.length > 0 && shown.length === 0 && <p className="text-xs text-muted-foreground">No matches.</p>}
      </div>
    </div>
  );
}

function EntityPicker({ selected, labels, onChange, onLabel }: { selected: string[]; labels: Record<string, string>; onChange: (next: string[]) => void; onLabel: (id: string, name: string) => void }) {
  const [text, setText] = React.useState("");
  const [results, setResults] = React.useState<EntityOption[]>([]);
  const [failed, setFailed] = React.useState(false);
  const uid = React.useId();

  React.useEffect(() => {
    if (text.trim().length < 2) {
      setResults([]);
      setFailed(false);
      return;
    }
    const c = new AbortController();
    const t = setTimeout(() => {
      searchEntities(text.trim(), c.signal)
        .then((r) => {
          setResults(r);
          setFailed(false);
        })
        .catch((err: unknown) => {
          if (!(err instanceof DOMException && err.name === "AbortError")) setFailed(true);
        });
    }, 250);
    return () => {
      clearTimeout(t);
      c.abort();
    };
  }, [text]);

  const chosen = selected.map((id) => ({ id, name: labels[id] ?? "Selected organization" }));
  const extra = results.filter((r) => !selected.includes(r.id));
  return (
    <div className="space-y-2">
      <Input aria-label="Search organizations" placeholder="Type 2+ letters to find an organization" value={text} onChange={(e) => setText(e.target.value)} className="h-8 text-xs" />
      <div role="group" aria-label="Organizations" className="max-h-44 space-y-1 overflow-y-auto pr-1">
        {[...chosen.map((c) => ({ id: c.id, name: c.name })), ...extra.map((r) => ({ id: r.id, name: r.name }))].map((o, i) => {
          const id = `${uid}-${i}`;
          return (
            <div key={o.id} className="flex items-center gap-2">
              <Checkbox
                id={id}
                checked={selected.includes(o.id)}
                onCheckedChange={() => {
                  onLabel(o.id, o.name);
                  onChange(toggle(selected, o.id));
                }}
              />
              <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer truncate text-sm">
                {o.name}
              </label>
            </div>
          );
        })}
        {failed && <p className="text-xs text-destructive">Organization search is unavailable right now.</p>}
        {!failed && text.trim().length >= 2 && results.length === 0 && <p className="text-xs text-muted-foreground">No organizations found.</p>}
      </div>
    </div>
  );
}

function CityPicker({ selected, states, onChange }: { selected: string[]; states: string[]; onChange: (next: string[]) => void }) {
  const [text, setText] = React.useState("");
  const [results, setResults] = React.useState<CityOption[]>([]);
  const [status, setStatus] = React.useState<"idle" | "loading" | "done" | "failed">("idle");
  const uid = React.useId();
  const stateKey = states.join(",");

  React.useEffect(() => {
    if (text.trim().length < 2) {
      setResults([]);
      setStatus("idle");
      return;
    }
    const c = new AbortController();
    setStatus("loading");
    const t = setTimeout(() => {
      searchCities(text.trim(), stateKey ? stateKey.split(",") : undefined, c.signal)
        .then((r) => {
          setResults(r);
          setStatus("done");
        })
        .catch((err: unknown) => {
          if (!(err instanceof DOMException && err.name === "AbortError")) setStatus("failed");
        });
    }, 250);
    return () => {
      clearTimeout(t);
      c.abort();
    };
  }, [text, stateKey]);

  const lower = new Set(selected.map((s) => s.toLowerCase()));
  const rows = [...selected.map((name) => ({ name, count: null as number | null })), ...results.filter((r) => !lower.has(r.name.toLowerCase())).map((r) => ({ name: r.name, count: r.count as number | null }))];
  return (
    <div className="space-y-2">
      <Input aria-label="Search cities" placeholder="Type 2+ letters to find a city" value={text} onChange={(e) => setText(e.target.value)} className="h-8 text-xs" />
      <div role="group" aria-label="Cities" className="max-h-44 space-y-1 overflow-y-auto pr-1">
        {rows.map((o, i) => {
          const id = `${uid}-${i}`;
          return (
            <div key={o.name.toLowerCase()} className="flex items-center gap-2">
              <Checkbox id={id} checked={lower.has(o.name.toLowerCase())} onCheckedChange={() => onChange(lower.has(o.name.toLowerCase()) ? selected.filter((s) => s.toLowerCase() !== o.name.toLowerCase()) : [...selected, o.name])} />
              <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer truncate text-sm">
                {o.name}
                {o.count !== null && <span className="ml-1 text-xs text-muted-foreground">({o.count})</span>}
              </label>
            </div>
          );
        })}
        {status === "loading" && (
          <p role="status" className="text-xs text-muted-foreground">
            Searching...
          </p>
        )}
        {status === "failed" && (
          <p role="alert" className="text-xs text-destructive">
            City search is unavailable right now.
          </p>
        )}
        {status === "done" && results.length === 0 && <p className="text-xs text-muted-foreground">No cities found.</p>}
      </div>
    </div>
  );
}

function RangeInputs({ label, prefix, minKey, maxKey, filters, onChange, placeholders }: { label: string; prefix: string; minKey: keyof SearchFilters; maxKey: keyof SearchFilters; filters: SearchFilters; onChange: (f: SearchFilters) => void; placeholders: [string, string] }) {
  const min = filters[minKey] as string;
  const max = filters[maxKey] as string;
  const bad = min !== "" && max !== "" && Number(min) > Number(max);
  const errId = React.useId();
  const set = (key: keyof SearchFilters, v: string) => {
    if (!DECIMAL.test(v)) return;
    onChange({ ...filters, [key]: v });
  };
  return (
    <div role="group" aria-label={label}>
      <div className="grid grid-cols-2 gap-2">
        <Input placeholder={placeholders[0]} aria-label={`${prefix} minimum`} inputMode="decimal" value={min} aria-invalid={bad} aria-describedby={bad ? errId : undefined} onChange={(e) => set(minKey, e.target.value)} />
        <Input placeholder={placeholders[1]} aria-label={`${prefix} maximum`} inputMode="decimal" value={max} aria-invalid={bad} aria-describedby={bad ? errId : undefined} onChange={(e) => set(maxKey, e.target.value)} />
      </div>
      {bad && (
        <p id={errId} role="alert" className="mt-1 text-xs text-destructive">
          Minimum is greater than maximum.
        </p>
      )}
    </div>
  );
}

function DateRange({ label, fromKey, toKey, filters, onChange }: { label: string; fromKey: keyof SearchFilters; toKey: keyof SearchFilters; filters: SearchFilters; onChange: (f: SearchFilters) => void }) {
  const from = filters[fromKey] as string;
  const to = filters[toKey] as string;
  const bad = from !== "" && to !== "" && from > to;
  const errId = React.useId();
  return (
    <div role="group" aria-label={label}>
      <div className="grid grid-cols-2 gap-2">
        <Input type="date" aria-label={`${label} from`} value={from} aria-invalid={bad} aria-describedby={bad ? errId : undefined} onChange={(e) => onChange({ ...filters, [fromKey]: e.target.value })} />
        <Input type="date" aria-label={`${label} to`} value={to} aria-invalid={bad} aria-describedby={bad ? errId : undefined} onChange={(e) => onChange({ ...filters, [toKey]: e.target.value })} />
      </div>
      {bad && (
        <p id={errId} role="alert" className="mt-1 text-xs text-destructive">
          The end date is before the start date.
        </p>
      )}
    </div>
  );
}

export function FilterPanel({
  filters,
  onChange,
  onClear,
  compact = false,
  entityLabels = {},
  onEntityLabel = () => undefined,
  taxonomy,
}: {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  onClear: () => void;
  /** Only state / category / status - used where only those criteria are editable (saved-search editing). */
  compact?: boolean;
  entityLabels?: Record<string, string>;
  onEntityLabel?: (id: string, name: string) => void;
  /** Option lists; loaded here when the caller does not already have them. */
  taxonomy?: Taxonomy;
}) {
  const own = useTaxonomy(!taxonomy, !compact);
  const active = taxonomy ?? own;
  const { states, categories, types, sources } = active;
  const taxonomyDistricts = active.districts;

  const districtOptions = React.useMemo<Option[]>(() => {
    const scoped = filters.state.length ? taxonomyDistricts.filter((d) => filters.state.includes(d.stateCode)) : taxonomyDistricts;
    return scoped.map((d) => ({ value: d.id, label: filters.state.length === 1 ? d.name : `${d.name} (${d.stateCode})` }));
  }, [taxonomyDistricts, filters.state]);

  const categoryOptions = React.useMemo<Option[]>(() => {
    const roots = categories.filter((c) => !c.parentId).sort((a, b) => a.name.localeCompare(b.name));
    const out: Option[] = [];
    for (const r of roots) {
      out.push({ value: r.id, label: r.name });
      for (const c of categories.filter((x) => x.parentId === r.id).sort((a, b) => a.name.localeCompare(b.name))) out.push({ value: c.id, label: c.name, indent: true });
    }
    for (const c of categories) if (c.parentId && !categories.some((x) => x.id === c.parentId)) out.push({ value: c.id, label: c.name });
    return out;
  }, [categories]);

  const set = (patch: Partial<FilterState>) => onChange({ ...filters, ...patch });

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
        <h3 className="text-sm font-semibold text-foreground">Filters</h3>
        <button type="button" onClick={onClear} className="text-xs font-medium text-primary hover:underline">
          Clear All
        </button>
      </div>

      <Accordion type="multiple" defaultValue={["status", "location", "value"]} className="px-4">
        <AccordionItem value="status">
          <AccordionTrigger>Tender Status</AccordionTrigger>
          <AccordionContent>
            <CheckList label="Status" options={STATUS_OPTIONS.map((s) => ({ value: s.value, label: s.label }))} selected={filters.status} onChange={(status) => set({ status })} />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="location">
          <AccordionTrigger>State</AccordionTrigger>
          <AccordionContent>
            <CheckList label="States" filterable options={states.map((s) => ({ value: s.code, label: s.name }))} selected={filters.state} onChange={(state) => set({ state })} />
          </AccordionContent>
        </AccordionItem>

        {!compact && (
          <>
            <AccordionItem value="district">
              <AccordionTrigger>District</AccordionTrigger>
              <AccordionContent>
                {!active.loaded ? (
                  <p role="status" className="text-xs text-muted-foreground">
                    Loading...
                  </p>
                ) : active.districtsFailed ? (
                  <p role="alert" className="text-xs text-destructive">
                    Districts could not be loaded.
                  </p>
                ) : districtOptions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{taxonomyDistricts.length === 0 ? "No district data is available from the current sources." : "No districts for the selected states."}</p>
                ) : (
                  <CheckList label="Districts" filterable options={districtOptions} selected={filters.district} onChange={(district) => set({ district })} />
                )}
                {filters.district.length > 0 && districtOptions.length === 0 && <p className="mt-1 text-xs text-muted-foreground">A district filter is active; use the chip above to remove it.</p>}
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="city">
              <AccordionTrigger>City</AccordionTrigger>
              <AccordionContent>
                <CityPicker selected={filters.city} states={filters.state} onChange={(city) => set({ city })} />
              </AccordionContent>
            </AccordionItem>
          </>
        )}

        <AccordionItem value="category" className={compact ? "border-b-0" : undefined}>
          <AccordionTrigger>Category</AccordionTrigger>
          <AccordionContent>
            <CheckList label="Categories" filterable options={categoryOptions} selected={filters.category} onChange={(category) => set({ category })} />
            <p className="mt-2 text-xs text-muted-foreground">Choosing a parent category includes its sub-categories.</p>
          </AccordionContent>
        </AccordionItem>

        {!compact && (
          <>
            <AccordionItem value="entity">
              <AccordionTrigger>Organization</AccordionTrigger>
              <AccordionContent>
                <EntityPicker selected={filters.procuringEntity} labels={entityLabels} onChange={(procuringEntity) => set({ procuringEntity })} onLabel={onEntityLabel} />
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="type">
              <AccordionTrigger>Tender Type</AccordionTrigger>
              <AccordionContent>
                {types.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No tender types available yet.</p>
                ) : (
                  <CheckList label="Tender types" options={types.map((t) => ({ value: t.key, label: t.name }))} selected={filters.tenderType} onChange={(tenderType) => set({ tenderType })} />
                )}
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="source">
              <AccordionTrigger>Source</AccordionTrigger>
              <AccordionContent>
                <CheckList label="Sources" options={sources.map((s) => ({ value: s.id, label: s.name }))} selected={filters.source} onChange={(source) => set({ source })} />
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="value">
              <AccordionTrigger>Estimated Value (₹)</AccordionTrigger>
              <AccordionContent>
                <RangeInputs label="Estimated value" prefix="Value" minKey="minValue" maxKey="maxValue" filters={filters} onChange={onChange} placeholders={["Min", "Max"]} />
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="emd">
              <AccordionTrigger>EMD (₹)</AccordionTrigger>
              <AccordionContent>
                <RangeInputs label="EMD amount" prefix="EMD" minKey="minEmd" maxKey="maxEmd" filters={filters} onChange={onChange} placeholders={["Min EMD", "Max EMD"]} />
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="fee">
              <AccordionTrigger>Tender Fee (₹)</AccordionTrigger>
              <AccordionContent>
                <RangeInputs label="Tender fee" prefix="Fee" minKey="minFee" maxKey="maxFee" filters={filters} onChange={onChange} placeholders={["Min fee", "Max fee"]} />
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="dates" className="border-b-0">
              <AccordionTrigger>Dates</AccordionTrigger>
              <AccordionContent>
                <div className="space-y-3">
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">Published</p>
                    <DateRange label="Published" fromKey="publishedFrom" toKey="publishedTo" filters={filters} onChange={onChange} />
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">Closing</p>
                    <DateRange label="Closing" fromKey="closingFrom" toKey="closingTo" filters={filters} onChange={onChange} />
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">Opening</p>
                    <DateRange label="Opening" fromKey="openingFrom" toKey="openingTo" filters={filters} onChange={onChange} />
                  </div>
                  <p className="text-xs text-muted-foreground">Dates are calendar days in Indian Standard Time (IST).</p>
                </div>
              </AccordionContent>
            </AccordionItem>
          </>
        )}
      </Accordion>
    </div>
  );
}
