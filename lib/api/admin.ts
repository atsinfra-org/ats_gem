import { apiRequestWithMeta, apiRequest } from "./client";
import type { DuplicateCandidate, Pagination, ProcuringEntity } from "./types";

export async function listProcuringEntities(params: { state?: string; search?: string; page?: number; pageSize?: number }) {
  const { data, meta } = await apiRequestWithMeta<ProcuringEntity[]>("/procuring-entities", { query: params });
  return { items: data, pagination: meta.pagination as Pagination };
}

export async function mergeProcuringEntities(sourceEntityId: string, targetEntityId: string): Promise<void> {
  await apiRequest(`/procuring-entities/${sourceEntityId}/merge`, { method: "POST", body: { targetEntityId } });
}

export async function listDuplicateCandidates(params: { status?: string; page?: number; pageSize?: number }) {
  const { data, meta } = await apiRequestWithMeta<DuplicateCandidate[]>("/duplicate-candidates", { query: params });
  return { items: data, pagination: meta.pagination as Pagination };
}

export async function resolveDuplicateCandidate(id: string, resolution: "CONFIRMED" | "REJECTED", notes?: string): Promise<void> {
  await apiRequest(`/duplicate-candidates/${id}/resolve`, { method: "POST", body: { resolution, notes } });
}

export async function correctTender(
  tenderId: string,
  changes: Partial<{
    title: string;
    description: string;
    estimatedValue: string;
    emdAmount: string;
    tenderFee: string;
    closingAt: string;
    openingAt: string;
    stateCode: string;
    city: string;
    locationText: string;
  }>,
  reason: string,
): Promise<void> {
  await apiRequest(`/tenders/${tenderId}/correct`, { method: "PATCH", body: { ...changes, reason } });
}
