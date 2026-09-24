import { tenders, getTenderById as findTenderById, getSimilarTenders } from "@/lib/mock/tenders";
import type { Tender } from "@/lib/types";

const delay = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

export interface TenderSearchParams {
  keyword?: string;
  state?: string;
  category?: string;
  industry?: string;
  tenderType?: string;
  source?: string;
  status?: string;
  minValue?: number;
  maxValue?: number;
  sort?: string;
  page?: number;
  pageSize?: number;
}

export interface TenderSearchResult {
  items: Tender[];
  total: number;
  page: number;
  pageSize: number;
}

export async function searchTenders(params: TenderSearchParams): Promise<TenderSearchResult> {
  await delay(200);
  let results = [...tenders];

  if (params.keyword) {
    const kw = params.keyword.toLowerCase();
    results = results.filter(
      (t) =>
        t.title.toLowerCase().includes(kw) ||
        t.department.toLowerCase().includes(kw) ||
        t.category.toLowerCase().includes(kw)
    );
  }
  if (params.state) results = results.filter((t) => t.state === params.state);
  if (params.category) results = results.filter((t) => t.category === params.category);
  if (params.industry) results = results.filter((t) => t.industry === params.industry);
  if (params.tenderType) results = results.filter((t) => t.tenderType === params.tenderType);
  if (params.source) results = results.filter((t) => t.source === params.source);
  if (params.status) results = results.filter((t) => t.status === params.status);
  if (params.minValue) results = results.filter((t) => t.estimatedValue >= params.minValue!);
  if (params.maxValue) results = results.filter((t) => t.estimatedValue <= params.maxValue!);

  switch (params.sort) {
    case "closing_soon":
      results.sort((a, b) => new Date(a.submissionDeadline).getTime() - new Date(b.submissionDeadline).getTime());
      break;
    case "value_high":
      results.sort((a, b) => b.estimatedValue - a.estimatedValue);
      break;
    case "value_low":
      results.sort((a, b) => a.estimatedValue - b.estimatedValue);
      break;
    case "latest":
    default:
      results.sort((a, b) => new Date(b.publishedDate).getTime() - new Date(a.publishedDate).getTime());
  }

  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 10;
  const start = (page - 1) * pageSize;
  const items = results.slice(start, start + pageSize);

  return { items, total: results.length, page, pageSize };
}

export async function getTender(id: string): Promise<Tender | undefined> {
  await delay(150);
  return findTenderById(id);
}

export async function getSimilar(tender: Tender): Promise<Tender[]> {
  await delay(150);
  return getSimilarTenders(tender);
}

export async function getRecommendedTenders(limit = 4): Promise<Tender[]> {
  await delay(150);
  return tenders.filter((t) => t.status === "open").slice(0, limit);
}

export async function getClosingSoonTenders(limit = 4): Promise<Tender[]> {
  await delay(150);
  return [...tenders]
    .filter((t) => t.status !== "closed")
    .sort((a, b) => new Date(a.submissionDeadline).getTime() - new Date(b.submissionDeadline).getTime())
    .slice(0, limit);
}
