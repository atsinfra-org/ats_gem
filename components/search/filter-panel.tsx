"use client";

import * as React from "react";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { tenderCategories, tenderStates, tenderIndustries, tenderSources } from "@/lib/mock/tenders";

export interface FilterState {
  states: string[];
  categories: string[];
  industries: string[];
  tenderTypes: string[];
  sources: string[];
  statuses: string[];
  minValue: string;
  maxValue: string;
}

export const emptyFilters: FilterState = {
  states: [],
  categories: [],
  industries: [],
  tenderTypes: [],
  sources: [],
  statuses: [],
  minValue: "",
  maxValue: "",
};

const tenderTypeOptions = ["Open Tender", "Limited Tender", "EOI", "RFP", "Single Tender", "Global Tender"];
const statusOptions = [
  { value: "open", label: "Open" },
  { value: "closing_soon", label: "Closing Soon" },
  { value: "limited", label: "Limited Tender" },
  { value: "eoi", label: "EOI" },
  { value: "rfp", label: "RFP" },
  { value: "closed", label: "Closed" },
];

function CheckboxGroup({
  options,
  selected,
  onChange,
}: {
  options: string[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <div className="space-y-2.5">
      {options.map((opt) => (
        <div key={opt} className="flex items-center gap-2">
          <Checkbox
            id={opt}
            checked={selected.includes(opt)}
            onCheckedChange={(checked) => {
              if (checked) onChange([...selected, opt]);
              else onChange(selected.filter((v) => v !== opt));
            }}
          />
          <Label htmlFor={opt} className="text-sm font-normal text-foreground cursor-pointer">
            {opt}
          </Label>
        </div>
      ))}
    </div>
  );
}

export function FilterPanel({
  filters,
  onChange,
  onClear,
}: {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  onClear: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
        <h3 className="text-sm font-semibold text-foreground">Filters</h3>
        <button onClick={onClear} className="text-xs font-medium text-primary hover:underline">
          Clear All
        </button>
      </div>

      <Accordion type="multiple" defaultValue={["value", "location", "status"]} className="px-4">
        <AccordionItem value="status">
          <AccordionTrigger>Tender Status</AccordionTrigger>
          <AccordionContent>
            <CheckboxGroup
              options={statusOptions.map((s) => s.label)}
              selected={filters.statuses.map((s) => statusOptions.find((o) => o.value === s)?.label ?? s)}
              onChange={(labels) =>
                onChange({
                  ...filters,
                  statuses: labels.map((l) => statusOptions.find((o) => o.label === l)?.value ?? l),
                })
              }
            />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="location">
          <AccordionTrigger>Location / State</AccordionTrigger>
          <AccordionContent>
            <CheckboxGroup
              options={[...new Set([...tenderStates, ...filters.states])]}
              selected={filters.states}
              onChange={(states) => onChange({ ...filters, states })}
            />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="category">
          <AccordionTrigger>Category</AccordionTrigger>
          <AccordionContent>
            <CheckboxGroup
              options={tenderCategories}
              selected={filters.categories}
              onChange={(categories) => onChange({ ...filters, categories })}
            />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="industry">
          <AccordionTrigger>Industry</AccordionTrigger>
          <AccordionContent>
            <CheckboxGroup
              options={tenderIndustries}
              selected={filters.industries}
              onChange={(industries) => onChange({ ...filters, industries })}
            />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="type">
          <AccordionTrigger>Tender Type</AccordionTrigger>
          <AccordionContent>
            <CheckboxGroup
              options={tenderTypeOptions}
              selected={filters.tenderTypes}
              onChange={(tenderTypes) => onChange({ ...filters, tenderTypes })}
            />
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="value">
          <AccordionTrigger>Estimated Value (₹)</AccordionTrigger>
          <AccordionContent>
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="Min"
                type="number"
                value={filters.minValue}
                onChange={(e) => onChange({ ...filters, minValue: e.target.value })}
              />
              <Input
                placeholder="Max"
                type="number"
                value={filters.maxValue}
                onChange={(e) => onChange({ ...filters, maxValue: e.target.value })}
              />
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="source" className="border-b-0">
          <AccordionTrigger>Source</AccordionTrigger>
          <AccordionContent>
            <CheckboxGroup
              options={tenderSources}
              selected={filters.sources}
              onChange={(sources) => onChange({ ...filters, sources })}
            />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
