"use client";

import * as React from "react";
import { EMBEDDED_PREVIEW_CAP, fetchAllPages, type TenderPart } from "@/lib/api/tender-parts";

/** Starts from the rows embedded in the detail response; if that preview is at the backend cap, offers loading the full list. */
export function useFullList<T>(tenderId: string, part: TenderPart, embedded: T[]) {
  const [full, setFull] = React.useState<T[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<unknown>(null);
  const mayHaveMore = embedded.length >= EMBEDDED_PREVIEW_CAP && full === null;

  const loadAll = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setFull((await fetchAllPages(tenderId, part)) as T[]);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [tenderId, part]);

  return { items: full ?? embedded, mayHaveMore, loading, error, loadAll };
}
