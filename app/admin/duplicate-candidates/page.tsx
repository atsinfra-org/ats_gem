"use client";
/* eslint-disable react-hooks/set-state-in-effect -- loading flags for fetch-on-mount/param-change effects */

import * as React from "react";
import Link from "next/link";
import { Check, X, GitMerge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/states/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { listDuplicateCandidates, resolveDuplicateCandidate } from "@/lib/api/admin";
import { ApiError } from "@/lib/api/client";
import type { DuplicateCandidate } from "@/lib/api/types";

const statusOptions = ["PENDING", "AUTO_CONFIRMED", "CONFIRMED", "REJECTED"];

export default function DuplicateCandidatesAdminPage() {
  const [items, setItems] = React.useState<DuplicateCandidate[]>([]);
  const [status, setStatus] = React.useState<string>("PENDING");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [resolvingId, setResolvingId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listDuplicateCandidates({ status, pageSize: 50 });
      setItems(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load duplicate candidates.");
    } finally {
      setLoading(false);
    }
  }, [status]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function handleResolve(id: string, resolution: "CONFIRMED" | "REJECTED") {
    setResolvingId(id);
    try {
      await resolveDuplicateCandidate(id, resolution);
      toast.success(resolution === "CONFIRMED" ? "Duplicate confirmed and merged." : "Candidate rejected.");
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to resolve candidate.");
    } finally {
      setResolvingId(null);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Duplicate Candidates</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Cross-source tender matches the deduplication engine could not confidently auto-link (backend Phase 3). Confirming re-points the losing tender&apos;s source records and archives it - nothing is deleted.
        </p>
      </div>

      <Select value={status} onValueChange={setStatus}>
        <SelectTrigger className="w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {statusOptions.map((s) => (
            <SelectItem key={s} value={s}>
              {s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : error ? (
        <EmptyState icon={GitMerge} title="Could not load candidates" description={error} actionLabel="Retry" onAction={load} />
      ) : items.length === 0 ? (
        <EmptyState icon={GitMerge} title="No candidates" description={`No duplicate candidates with status ${status}.`} />
      ) : (
        <div className="space-y-3">
          {items.map((c) => (
            <div key={c.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <Badge variant="secondary">{c.status}</Badge>
                <span className="text-xs text-muted-foreground">score {c.score}</span>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Link href={`/tenders/${c.tender.id}`} className="text-sm font-medium text-foreground hover:underline" target="_blank">
                  {c.tender.title}
                </Link>
                <Link href={`/tenders/${c.candidateTender.id}`} className="text-sm font-medium text-foreground hover:underline" target="_blank">
                  {c.candidateTender.title}
                </Link>
              </div>
              {c.status === "PENDING" && (
                <div className="mt-3 flex gap-2">
                  <Button size="sm" onClick={() => handleResolve(c.id, "CONFIRMED")} loading={resolvingId === c.id}>
                    <Check className="h-3.5 w-3.5" /> Confirm duplicate
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleResolve(c.id, "REJECTED")} loading={resolvingId === c.id}>
                    <X className="h-3.5 w-3.5" /> Reject
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
