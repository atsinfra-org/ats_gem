import type { MatchReason } from "@/lib/api/types";

const REASONS: Record<MatchReason, { label: string; title: string }> = {
  REFERENCE_EXACT: { label: "Exact reference", title: "The tender reference number matches your search exactly." },
  REFERENCE_PREFIX: { label: "Reference starts with", title: "The tender reference number starts with your search." },
  REFERENCE_PARTIAL: { label: "Reference contains", title: "Your search appears inside the tender reference number." },
  TITLE_PHRASE: { label: "Title match", title: "Your search appears in the tender title as typed." },
  TITLE_TERMS: { label: "Title words", title: "All your search words appear in the tender title." },
  ENTITY: { label: "Organization match", title: "Your search matches the procuring organization or department." },
  OTHER_FIELDS: { label: "Category / location match", title: "Your search matches the tender category, location or type." },
  FUZZY: { label: "Similar spelling", title: "No exact matches were found, so this is a close spelling match." },
};

/** Explains why a result was returned. Rendered only for ranked (keyword/reference) searches; the reason comes from the API, never guessed here. */
export function MatchReasonBadge({ reason }: { reason: MatchReason | null | undefined }) {
  if (!reason || !REASONS[reason]) return null;
  const r = REASONS[reason];
  return (
    <span title={r.title} className="inline-flex items-center rounded-full border border-border bg-secondary/60 px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">
      <span className="sr-only">Matched because: </span>
      {r.label}
    </span>
  );
}
