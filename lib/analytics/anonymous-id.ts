const STORAGE_KEY = "ats_anon_id";

/** Random, not derived from any PII (email, name, IP) - see docs/ARCHITECTURE.md Sec 22.4. */
function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, "");
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

/** One id per browser, persisted in localStorage. Falls back to an in-memory id (private windows, blocked storage). */
let memoryId: string | null = null;

export function getAnonymousId(): string {
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const created = generateId();
    window.localStorage.setItem(STORAGE_KEY, created);
    return created;
  } catch {
    memoryId ??= generateId();
    return memoryId;
  }
}
