import { apiRequestWithMeta } from "./client";
import type { Pagination, TenderCorrigendumSummary, TenderDocumentSummary, TenderRequirementSummary, TenderTimelineEntry } from "./types";

/** The `/tenders/:id` detail response embeds at most this many rows per section (backend preview cap). */
export const EMBEDDED_PREVIEW_CAP = 20;

export type TenderPart = "requirements" | "timeline" | "corrigenda" | "documents";
type PartItem = { requirements: TenderRequirementSummary; timeline: TenderTimelineEntry; corrigenda: TenderCorrigendumSummary; documents: TenderDocumentSummary };

/** Fetches every page of a dedicated, paginated sub-resource endpoint. */
export async function fetchAllPages<P extends TenderPart>(tenderId: string, part: P, pageSize = 100): Promise<PartItem[P][]> {
  const all: PartItem[P][] = [];
  for (let page = 1; ; page++) {
    const { data, meta } = await apiRequestWithMeta<PartItem[P][]>(`/tenders/${tenderId}/${part}`, { query: { page, pageSize } });
    all.push(...data);
    const p = meta.pagination as Pagination | undefined;
    if (!p || page >= p.totalPages) break;
  }
  return all;
}
