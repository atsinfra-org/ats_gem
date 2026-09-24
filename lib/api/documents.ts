import type { TenderDocument } from "@/lib/types";

const delay = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms));

export async function downloadDocument(_doc: TenderDocument): Promise<{ success: true }> {
  await delay(1200);
  return { success: true };
}

export async function downloadAllDocuments(_tenderId: string): Promise<{ success: true }> {
  await delay(1800);
  return { success: true };
}
