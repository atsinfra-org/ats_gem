"use client";

import * as React from "react";
import { listCategories, listDistricts, listSources, listStates, listTenderTypes } from "@/lib/api/taxonomy";
import type { CategoryRef, DistrictRef, SourceRef, StateRef, TenderTypeRef } from "@/lib/api/types";
import type { LabelLookup } from "./chips";

export interface Taxonomy {
  states: StateRef[];
  categories: CategoryRef[];
  types: TenderTypeRef[];
  sources: SourceRef[];
  districts: DistrictRef[];
  /** True when the district list could not be loaded (as opposed to being genuinely empty). */
  districtsFailed: boolean;
  loaded: boolean;
}

export const emptyTaxonomy: Taxonomy = { states: [], categories: [], types: [], sources: [], districts: [], districtsFailed: false, loaded: false };

/** Loads the filter option lists once; a failed list is simply empty (filters then show "Loading..."/no options, search itself is unaffected). */
export function useTaxonomy(enabled = true, includeAdvanced = true): Taxonomy {
  const [t, setT] = React.useState<Taxonomy>(emptyTaxonomy);
  React.useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const safe = <T,>(p: Promise<T[]> | undefined): Promise<T[]> => (p ?? Promise.resolve([] as T[])).catch(() => [] as T[]);
    let districtsFailed = false;
    const districts = includeAdvanced
      ? Promise.resolve(listDistricts()).catch(() => {
          districtsFailed = true;
          return [] as DistrictRef[];
        })
      : Promise.resolve([] as DistrictRef[]);
    Promise.all([safe(listStates()), safe(listCategories()), includeAdvanced ? safe(listTenderTypes()) : Promise.resolve([]), includeAdvanced ? safe(listSources()) : Promise.resolve([]), districts]).then(([states, categories, types, sources, dist]) => {
      if (alive) setT({ states, categories, types, sources, districts: dist, districtsFailed, loaded: true });
    });
    return () => {
      alive = false;
    };
  }, [enabled, includeAdvanced]);
  return t;
}

export function toLookup(t: Taxonomy, entities: Record<string, string> = {}): LabelLookup {
  return {
    state: Object.fromEntries(t.states.map((s) => [s.code, s.name])),
    category: Object.fromEntries(t.categories.map((c) => [c.id, c.name])),
    tenderType: Object.fromEntries(t.types.map((x) => [x.key, x.name])),
    source: Object.fromEntries(t.sources.map((s) => [s.id, s.name])),
    district: Object.fromEntries(t.districts.map((d) => [d.id, d.name])),
    procuringEntity: entities,
  };
}
