"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft } from "lucide-react";

const suggestions = ["road works", "solar", "medical equipment", "it services"];

export function TerminalSearch({
  id,
  placeholder,
  showSuggestions = true,
}: {
  id: string;
  placeholder: string;
  showSuggestions?: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");

  function go(term: string) {
    const keyword = term.trim();
    router.push(keyword ? `/tenders?q=${encodeURIComponent(keyword)}` : "/tenders");
  }

  return (
    <div>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          go(query);
        }}
        className="flex items-center gap-3 rounded-lg border border-white/15 bg-white/[0.04] py-1.5 pl-4 pr-1.5 transition-colors focus-within:border-white/40 focus-within:bg-white/[0.06]"
      >
        <span aria-hidden className="font-mono text-lg leading-none text-primary">
          ›
        </span>
        <label htmlFor={id} className="sr-only">
          Search tenders
        </label>
        <input
          id={id}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          className="h-11 min-w-0 flex-1 bg-transparent font-mono text-sm text-white caret-primary outline-none placeholder:text-white/55"
        />
        <button
          type="submit"
          aria-label="Search"
          className="inline-flex h-11 shrink-0 items-center gap-2 rounded-md bg-primary px-3.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:px-4"
        >
          <span className="hidden sm:inline">Search</span>
          <CornerDownLeft className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
        </button>
      </form>

      {showSuggestions && (
        <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-[11px] text-white/55">
          <span>try</span>
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => go(s)}
              className="rounded border border-white/10 px-2 py-1 text-white/65 transition-colors hover:border-white/35 hover:text-white"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
