import { getAccessToken } from "@/lib/api/client";
import { getAnonymousId } from "./anonymous-id";
import { getAttribution } from "./attribution";

export type AnalyticsEventName =
  | "PAGE_VIEW"
  | "REGISTRATION_STARTED"
  | "REGISTRATION_COMPLETED"
  | "EMAIL_VERIFICATION_COMPLETED"
  | "LOGIN_SUCCESS"
  | "LOGIN_FAILURE"
  | "LOGOUT"
  | "TENDER_VIEWED"
  | "TENDER_SAVED"
  | "TENDER_UNSAVED"
  | "TENDER_SOURCE_OPENED"
  | "TENDER_CORRIGENDUM_VIEWED"
  | "TENDER_VERSION_VIEWED"
  | "DOCUMENT_VIEWED"
  | "DOCUMENT_DOWNLOADED"
  | "DOCUMENT_DOWNLOAD_FAILED"
  | "NOTIFICATION_VIEWED"
  | "NOTIFICATION_CLICKED"
  | "NOTIFICATION_PREFERENCES_UPDATED"
  | "PROFILE_VIEWED"
  | "PROFILE_UPDATED"
  | "ORGANIZATION_VIEWED"
  | "CLIENT_ERROR"
  | "API_ERROR";

export interface TrackOptions {
  path?: string;
  metadata?: Record<string, unknown>;
  entityType?: string;
  entityId?: string;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
const FLUSH_DELAY_MS = 300;
const MAX_BATCH = 20;

interface QueuedEvent extends TrackOptions {
  name: AnalyticsEventName;
  anonymousId: string;
  occurredAt: string;
}

const queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let firstEventThisLoad = true;

function scheduleFlush() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, FLUSH_DELAY_MS);
}

function flush(onUnload = false): void {
  if (queue.length === 0) return;
  const events = queue.splice(0, MAX_BATCH);
  const body = JSON.stringify({ events });

  if (onUnload) {
    // The page is closing: no custom headers are possible either way (sendBeacon can't set them, and a
    // `keepalive` fetch racing the unload is unreliable), so this is always attributed anonymously.
    if (navigator.sendBeacon?.(`${API_BASE_URL}/analytics/events`, new Blob([body], { type: "application/json" }))) return;
    void fetch(`${API_BASE_URL}/analytics/events`, { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body }).catch(() => undefined);
    return;
  }

  // A plain (non-keepalive) fetch for the normal debounced path: `keepalive: true` on every request would
  // keep those connections alive past a client-side navigation, which can stall Playwright's/a real
  // browser's "network idle" detection during rapid page-to-page navigation - `keepalive` belongs only to
  // the unload path above, where the request outliving the page is exactly the point.
  const token = getAccessToken();
  void fetch(`${API_BASE_URL}/analytics/events`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body,
  }).catch(() => undefined); // analytics must never surface an error to the user
}

/**
 * Fire-and-forget analytics beacon (docs/ARCHITECTURE.md Sec 22.10). Batches up to 20 events per request with a
 * 300ms debounce, flushes what's queued on tab hide/unload via `navigator.sendBeacon`, and never throws - the
 * same pattern as the existing `recordSearchEvent` (lib/api/search.ts).
 */
export function track(name: AnalyticsEventName, options: TrackOptions = {}): void {
  if (typeof window === "undefined") return;
  const event: QueuedEvent = {
    name,
    anonymousId: getAnonymousId(),
    occurredAt: new Date().toISOString(),
    path: options.path,
    metadata: options.metadata,
    entityType: options.entityType,
    entityId: options.entityId,
  };
  if (firstEventThisLoad) {
    firstEventThisLoad = false;
    Object.assign(event, getAttribution());
  }
  queue.push(event);
  if (queue.length >= MAX_BATCH) void flush();
  else scheduleFlush();
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush(true);
  });
  window.addEventListener("pagehide", () => flush(true));
}
