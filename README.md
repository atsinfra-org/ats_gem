# ATS Gem — Web Application (frontend)

Next.js 16 (App Router) + React 19 + Tailwind 4 + Radix UI. Talks to the NestJS backend in [`backend/`](backend/README.md) (see `backend/docs/API-CONTRACT.md`).

## Local development

```bash
# 1. Backend (Postgres, Redis, API, worker) - see backend/README.md
cd backend && docker compose up -d postgres redis migrate seed api worker

# 2. Frontend
cp .env.example .env.local      # NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1
npm install
npm run dev                     # http://localhost:3000
```

The backend's `CORS_ORIGINS` must include the frontend origin (default `http://localhost:3000`).

## Commands

| Command | Purpose |
|---|---|
| `npm run build` | Production build (includes typecheck) |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit tests (API client, formatting) |
| `npm run test:browser` | Playwright (system Chrome) smoke tests against a running frontend + backend. The auth suite needs a staff user `staff-smoke@example.com` / `correct-horse-battery` (register it, then grant `SUPER_ADMIN` in `user_roles`). |

## Architecture

- `app/(public)` marketing pages (home, about, solutions, pricing, faq, contact, resources, terms).
- `app/(auth)` token-link pages: `/verify-email`, `/reset-password`, `/invite`; `/login`, `/register`, `/forgot-password` open the shared auth dialog.
- `app/(app)` authenticated shell (guarded client-side by `RequireAuth`): dashboard, tenders, tender detail, saved tenders, saved searches, notifications, profile, company, support.
- `app/admin` minimal staff area (procuring entities, duplicate candidates) guarded by `RequireStaffAccess`; the backend remains the authorization authority.
- `lib/api/client.ts` is the only place that calls `fetch`: unwraps the `{success,data,meta}` envelope, throws typed `ApiError`, attaches the in-memory access token, and does one silent refresh + retry on 401. The refresh token is an httpOnly cookie handled by the browser.
- `lib/auth/session-context.tsx` (session), `lib/store/watchlist-store.tsx`, `lib/store/notifications-store.tsx` hold the only global state; everything else is fetched per page.

## Authentication

Access token in memory only; on load the app calls `POST /auth/refresh` (cookie + `X-Requested-With`) to restore a session. Expired sessions redirect to login.

## Known limitations (backend does not support these yet, so the UI does not pretend to)

- No alert/email/SMS delivery, billing/subscriptions, bids, analytics, market stats, similar tenders, bulk document download, Google sign-in, search suggestions, or full-text search.
- Search filters are limited to what the API accepts: keyword (title), one state, one category, one status, value range, sort, page.
- Tender pages require login in the UI (the API itself allows anonymous reads).
- Email delivery uses the backend log driver in development, so verification/reset/invite links are not actually mailed.
- Terms/Privacy pages are placeholders until legal text exists. Pricing is indicative only.
- Full admin panel is a later phase.
