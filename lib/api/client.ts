/**
 * Centralized, typed API client for the real backend (see backend/docs/API-CONTRACT.md).
 *
 * - Every backend response is `{ success, data, meta }` or `{ success: false, error }` - this file
 *   is the only place that unwraps that envelope; nothing else in the app should call `fetch`
 *   directly against the API.
 * - The access token lives in memory only (never localStorage - see security notes in Phase 6
 *   brief). The refresh token is an httpOnly cookie the browser sends automatically; this client
 *   never reads or writes it directly.
 * - A 401 from any authenticated request triggers exactly one silent refresh-and-retry. If the
 *   refresh itself fails, every listener registered via `onSessionExpired` fires once so the UI can
 *   redirect to login without every call site handling it separately.
 */

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

export type ErrorCode =
  | "VALIDATION_FAILED"
  | "BAD_REQUEST"
  | "UNAUTHENTICATED"
  | "TOKEN_EXPIRED"
  | "INVALID_CREDENTIALS"
  | "REFRESH_TOKEN_REUSED"
  | "FORBIDDEN"
  | "EMAIL_NOT_VERIFIED"
  | "ACCOUNT_SUSPENDED"
  | "NOT_FOUND"
  | "TENDER_NOT_FOUND"
  | "ORGANIZATION_NOT_FOUND"
  | "SAVED_SEARCH_NOT_FOUND"
  | "CONFLICT"
  | "EMAIL_ALREADY_REGISTERED"
  | "ALREADY_MEMBER"
  | "TOKEN_INVALID_OR_EXPIRED"
  | "ACCOUNT_LOCKED"
  | "RATE_LIMITED"
  | "DEPENDENCY_UNAVAILABLE"
  | "INTERNAL_ERROR"
  | "NETWORK_ERROR"
  | "TIMEOUT";

export interface ApiErrorDetail {
  field?: string;
  code?: string;
  message?: string;
}

export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number,
    public readonly details?: ApiErrorDetail[],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  meta?: Record<string, unknown>;
  error?: { code: ErrorCode; message: string; details?: ApiErrorDetail[] };
}

let accessToken: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;
const sessionExpiredListeners = new Set<() => void>();

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** Registers a callback fired once when a session can no longer be refreshed. Returns an unsubscribe function. */
export function onSessionExpired(listener: () => void): () => void {
  sessionExpiredListeners.add(listener);
  return () => sessionExpiredListeners.delete(listener);
}

async function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
          method: "POST",
          credentials: "include",
          headers: { "X-Requested-With": "XMLHttpRequest" },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return false;
        const body = (await res.json()) as Envelope<{ accessToken: string; expiresIn: number }>;
        if (!body.success || !body.data) return false;
        setAccessToken(body.data.accessToken);
        return true;
      } catch {
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: object;
  signal?: AbortSignal;
  /** Skips the automatic Authorization header (public endpoints that must not force a refresh attempt). */
  anonymous?: boolean;
  timeoutMs?: number;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = new URL(`${API_BASE_URL}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function rawRequest<T>(path: string, options: RequestOptions, attempt: number): Promise<{ data: T; meta: Record<string, unknown> }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (!options.anonymous && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (path.startsWith("/auth/refresh") || path.startsWith("/auth/logout")) headers["X-Requested-With"] = "XMLHttpRequest";

  let res: Response;
  try {
    res = await fetch(buildUrl(path, options.query), {
      method: options.method ?? "GET",
      credentials: "include",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal ?? AbortSignal.timeout(options.timeoutMs ?? 20_000),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new ApiError("TIMEOUT", "The request took too long to respond.", 0);
    }
    throw new ApiError("NETWORK_ERROR", "Could not reach the server. Check your connection.", 0);
  }

  let body: Envelope<T> | null = null;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    // No JSON body (e.g. a 204, or an upstream proxy error page) - fall through to status handling below.
  }

  if (res.ok && body?.success) {
    return { data: body.data as T, meta: body.meta ?? {} };
  }

  const code = body?.error?.code ?? "INTERNAL_ERROR";
  const isAuthRoute = path.startsWith("/auth/");
  if (res.status === 401 && !isAuthRoute && !options.anonymous && attempt === 0) {
    const refreshed = await refreshSession();
    if (refreshed) return rawRequest<T>(path, options, attempt + 1);
    sessionExpiredListeners.forEach((listener) => listener());
  }

  throw new ApiError(code, body?.error?.message ?? `Request failed with status ${res.status}.`, res.status, body?.error?.details);
}

/** Returns only `data` - use `apiRequestWithMeta` when you need `meta` (e.g. pagination). */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { data } = await rawRequest<T>(path, options, 0);
  return data;
}

export async function apiRequestWithMeta<T>(path: string, options: RequestOptions = {}): Promise<{ data: T; meta: Record<string, unknown> }> {
  return rawRequest<T>(path, options, 0);
}

/** Attempts a silent session restore on app boot (a valid refresh cookie may already exist). */
export async function bootstrapSession(): Promise<boolean> {
  return refreshSession();
}

export async function logoutRequest(): Promise<void> {
  try {
    await apiRequest("/auth/logout", { method: "POST" });
  } finally {
    setAccessToken(null);
  }
}
