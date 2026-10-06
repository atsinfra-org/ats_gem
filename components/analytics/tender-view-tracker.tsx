"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { track } from "@/lib/analytics/client";

const KNOWN_SOURCES = new Set(["search", "saved", "notification", "direct"]);

/** Headless. Fires one TENDER_VIEWED per tender detail page load; `source` comes from how the link was built (search results, saved tenders, a notification), defaulting to "direct". */
export function TenderViewTracker({ tenderId }: { tenderId: string }) {
  const searchParams = useSearchParams();
  React.useEffect(() => {
    const raw = searchParams.get("from");
    const source = raw && KNOWN_SOURCES.has(raw) ? raw : "direct";
    track("TENDER_VIEWED", { entityType: "tender", entityId: tenderId, metadata: { tenderId, source } });
    // Intentionally runs once per mount (a fresh navigation), not on every searchParams change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenderId]);
  return null;
}
