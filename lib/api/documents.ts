import { API_BASE_URL } from "./client";

/** Documents are public (same visibility as the tender itself) - no auth header needed for these URLs. */
export function documentDownloadUrl(tenderId: string, documentId: string): string {
  return `${API_BASE_URL}/tenders/${tenderId}/documents/${documentId}/download`;
}
