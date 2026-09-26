"use client";

import { useNow } from "@/lib/hooks/use-now";
import { formatElapsed } from "@/lib/utils";

/** Time since `at`, ticking on the client ("--" during server render so markup stays hydration-safe). */
export function Elapsed({ at }: { at: string | null }) {
  const now = useNow();
  if (!at) return <>—</>;
  return <>{now === null ? "--" : formatElapsed(now - Date.parse(at))}</>;
}
