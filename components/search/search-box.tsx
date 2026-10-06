"use client";
/* eslint-disable react-hooks/set-state-in-effect -- suggestion loading state follows the typed text */

import * as React from "react";
import {
  Search as SearchIcon,
  History,
  Hash,
  Building2,
  Tag,
  MapPin,
  TrendingUp,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  getSuggestions,
  listHistory,
  type Suggestions,
} from "@/lib/api/search";
import { cn } from "@/lib/utils";

export type PickKind = "procuringEntity" | "category" | "state";

interface Option {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  action:
    | { type: "query"; q: string }
    | { type: "filter"; kind: PickKind; value: string; label: string };
}

const MIN_CHARS = 2;

function buildOptions(
  text: string,
  s: Suggestions | null,
  recent: { id: string; q: string }[],
): Option[] {
  const out: Option[] = [];
  if (text.trim().length < MIN_CHARS) {
    for (const r of recent)
      out.push({
        id: `h-${r.id}`,
        group: "Recent searches",
        label: r.q,
        icon: History,
        action: { type: "query", q: r.q },
      });
    return out;
  }
  if (!s) return out;
  for (const r of s.recent)
    out.push({
      id: `h-${r.id}`,
      group: "Recent searches",
      label: r.query,
      icon: History,
      action: { type: "query", q: r.query },
    });
  for (const r of s.references)
    out.push({
      id: `r-${r.tenderId}`,
      group: "Tender references",
      label: r.reference,
      hint: r.title,
      icon: Hash,
      action: { type: "query", q: r.reference },
    });
  for (const e of s.entities)
    out.push({
      id: `e-${e.id}`,
      group: "Organizations",
      label: e.name,
      hint: "Filter by organization",
      icon: Building2,
      action: {
        type: "filter",
        kind: "procuringEntity",
        value: e.id,
        label: e.name,
      },
    });
  for (const c of s.categories)
    out.push({
      id: `c-${c.id}`,
      group: "Categories",
      label: c.name,
      hint: "Filter by category",
      icon: Tag,
      action: { type: "filter", kind: "category", value: c.id, label: c.name },
    });
  for (const st of s.states)
    out.push({
      id: `s-${st.code}`,
      group: "States",
      label: st.name,
      hint: "Filter by state",
      icon: MapPin,
      action: { type: "filter", kind: "state", value: st.code, label: st.name },
    });
  for (const p of s.popular)
    out.push({
      id: `p-${p.query}`,
      group: "Popular searches",
      label: p.query,
      icon: TrendingUp,
      action: { type: "query", q: p.query },
    });
  return out;
}

/**
 * ARIA 1.2 combobox with a listbox popup: the input keeps focus, the active option is announced through
 * `aria-activedescendant`. Enter on an active option picks it; Enter otherwise submits the typed text.
 */
export function SearchBox({
  value,
  onSubmit,
  onPickFilter,
  onSuggestionSelected,
  placeholder = "Search by keyword, reference number or organization...",
  children,
}: {
  value: string;
  onSubmit: (q: string) => void;
  onPickFilter: (kind: PickKind, value: string, label: string) => void;
  onSuggestionSelected?: (kind: string, label: string) => void;
  placeholder?: string;
  /** Extra controls rendered after the Search button (e.g. the mobile Filters button). */
  children?: React.ReactNode;
}) {
  const uid = React.useId();
  const listId = `${uid}-list`;
  const [text, setText] = React.useState(value);
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(-1);
  const [suggestions, setSuggestions] = React.useState<Suggestions | null>(
    null,
  );
  const [recent, setRecent] = React.useState<{ id: string; q: string }[]>([]);
  const [unavailable, setUnavailable] = React.useState(false);

  // The URL changed (back/forward, saved search, chip removal): show the committed query.
  React.useEffect(() => {
    setText(value);
  }, [value]);

  React.useEffect(() => {
    if (!open || text.trim().length >= MIN_CHARS) return;
    const c = new AbortController();
    listHistory(6, c.signal)
      .then((items) => {
        setRecent(
          items
            .filter((i) => i.queryNormalized)
            .map((i) => ({ id: i.id, q: i.queryNormalized })),
        );
        setUnavailable(false);
      })
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === "AbortError"))
          setRecent([]);
      });
    return () => c.abort();
  }, [open, text]);

  React.useEffect(() => {
    if (!open || text.trim().length < MIN_CHARS) return;
    const c = new AbortController();
    const t = setTimeout(() => {
      getSuggestions(text.trim(), c.signal)
        .then((s) => {
          setSuggestions(s);
          setUnavailable(false);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setSuggestions(null);
          setUnavailable(true);
        });
    }, 200);
    return () => {
      clearTimeout(t);
      c.abort();
    };
  }, [open, text]);

  const options = React.useMemo(
    () => buildOptions(text, suggestions, recent),
    [text, suggestions, recent],
  );
  React.useEffect(() => setActive(-1), [options]);
  const expanded = open && options.length > 0;

  function choose(o: Option) {
    setOpen(false);
    setActive(-1);
    if (o.action.type === "query") {
      setText(o.action.q);
      onSuggestionSelected?.(o.group, o.label);
      onSubmit(o.action.q);
    } else {
      setText("");
      onSuggestionSelected?.(o.group, o.label);
      onPickFilter(o.action.kind, o.action.value, o.action.label);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else if (options.length) setActive((a) => (a + 1) % options.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (options.length)
        setActive((a) => (a <= 0 ? options.length - 1 : a - 1));
    } else if (e.key === "Enter") {
      if (expanded && active >= 0) {
        e.preventDefault();
        choose(options[active]);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        setActive(-1);
      }
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  const groups: { name: string; items: { o: Option; index: number }[] }[] = [];
  options.forEach((o, index) => {
    let g = groups.find((x) => x.name === o.group);
    if (!g) groups.push((g = { name: o.group, items: [] }));
    g.items.push({ o, index });
  });

  function submitText(e: React.FormEvent) {
    e.preventDefault();
    setOpen(false);
    setActive(-1);
    onSubmit(text.replace(/\s+/g, " ").trim());
  }

  return (
    <form role="search" onSubmit={submitText} className="flex gap-2">
      <div className="relative flex-1">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          role="combobox"
          aria-label="Search tenders"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={
            expanded && active >= 0 ? `${uid}-opt-${active}` : undefined
          }
          autoComplete="off"
          spellCheck={false}
          maxLength={200}
          value={text}
          placeholder={placeholder}
          className="pl-9"
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          name="q"
        />
        <ul
          id={listId}
          role="listbox"
          aria-label="Search suggestions"
          hidden={!expanded}
          className="absolute left-0 right-0 top-full z-40 mt-1 max-h-80 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
          // Keep focus in the input while the pointer interacts with the popup.
          onMouseDown={(e) => e.preventDefault()}
        >
          {groups.map((g, gi) => (
            <li key={g.name} role="presentation">
              <ul role="group" aria-labelledby={`${uid}-g${gi}`}>
                <li
                  role="presentation"
                  id={`${uid}-g${gi}`}
                  className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {g.name}
                </li>
                {g.items.map(({ o, index }) => (
                  <li
                    key={o.id}
                    id={`${uid}-opt-${index}`}
                    role="option"
                    aria-selected={index === active}
                    onClick={() => choose(o)}
                    onMouseMove={() => setActive(index)}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm",
                      index === active && "bg-accent text-accent-foreground",
                    )}
                  >
                    <o.icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.hint && (
                      <span className="hidden max-w-[45%] truncate text-xs text-muted-foreground sm:inline">
                        {o.hint}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        <p role="status" aria-live="polite" className="sr-only">
          {expanded
            ? `${options.length} suggestions available. Use up and down arrows to review.`
            : unavailable
              ? "Suggestions are unavailable right now."
              : ""}
        </p>
      </div>
      <Button type="submit">Search</Button>
      {children}
    </form>
  );
}
