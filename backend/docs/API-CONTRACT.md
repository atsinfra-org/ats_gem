# ATS Gem Backend — API Contract (v1)

Base URL: `/api/v1` · Format: JSON (UTF-8) · Auth: `Authorization: Bearer <accessToken>` · OpenAPI served at `/api/docs` when `SWAGGER_ENABLED=true`.

This contract is written for the frontend team. The frontend's current mock layer (`lib/api/*.ts`) maps to these endpoints as listed in §14.

---

## 1. Conventions

### 1.1 Envelope
```json
{ "success": true, "data": { }, "meta": { } }
```
```json
{ "success": false, "error": { "code": "TENDER_NOT_FOUND", "message": "Tender not found", "details": [ ] }, "meta": { "requestId": "01J…" } }
```
- `meta.requestId` is always present and equals the `X-Request-Id` response header; quote it in support tickets.
- `error.details` appears for validation errors: `[{ "field": "email", "code": "INVALID_EMAIL", "message": "Please enter a valid email address." }]`.

### 1.2 Data types
| Kind | Wire format |
|---|---|
| IDs | UUID strings |
| Dates | ISO 8601 UTC, e.g. `"2026-09-24T09:30:00.000Z"` |
| Money | object `{ "amount": "12500000.00", "currency": "INR" }` — `amount` is a **string** decimal |
| Enums | UPPER_SNAKE strings |
| Empty values | `null`, never omitted when part of the schema |

### 1.3 Pagination
Two styles, chosen per endpoint:

**Page-based** (UI lists with page numbers; capped at 10 000 results):
`?page=1&pageSize=20` (pageSize 1–100, default 20) → `meta.pagination = { page, pageSize, total, totalPages }`

**Cursor-based** (feeds, notifications, exports, deep search):
`?cursor=<opaque>&limit=20` → `meta.pagination = { nextCursor: string | null, limit }`

### 1.4 Filters & sorting
- Multi-value filters are repeated or comma-separated: `state=MH,UP` ≡ `state=MH&state=UP`.
- **Search (Phase 7, authoritative in Sec 5.3):** ranges are `minValue/maxValue`, `minEmd/maxEmd`, `minFee/maxFee` (exact decimal strings) and `publishedFrom/To`, `closingFrom/To`, `openingFrom/To` (date-only = IST calendar day, or an ISO instant); sort is `sort=relevance|newest|closingSoonest|closingLatest|valueHigh|valueLow`. The `valueMin` / `value_desc` style names originally sketched here were not adopted.
- Other list endpoints accept `sort=<field>` / `sort=-<field>`.

### 1.5 Rate limits
Responses include `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`. Exceeding returns `429 RATE_LIMITED` with `Retry-After`.

**Implemented in Phase 2**: `register`, `forgot-password` and `reset-password` (`RateLimitGuard` +
`@RateLimit('auth')`, per-IP, `RATE_LIMIT_AUTH_MAX`/`RATE_LIMIT_AUTH_WINDOW_MINUTES`, default
10/15 min, matching the row below) and `login`'s separate per-IP-and-per-account lockout
(`LoginThrottleService`, ARCHITECTURE §17.1). Every other row here — general per-audience limits,
search, document URLs — is Phase 10 ("tiered rate limits").

| Audience / class | Default |
|---|---|
| Anonymous (general) (Phase 10) | 60 req/min/IP |
| Authenticated (Phase 10) | 300 req/min/user |
| Paid plans (Phase 10) | 600 req/min/user |
| Admin (Phase 10) | 1 200 req/min/user |
| Auth endpoints (login, register, reset) | 10 req/15 min/IP + per-account lockout |
| Search (**Phase 7**: `search/tenders`, `search/suggestions`, `search/entities`, `search/events`) | 240 req/min per IP and route (`RATE_LIMIT_SEARCH_MAX` / `RATE_LIMIT_SEARCH_WINDOW_SECONDS`); per-audience tiers stay Phase 10 |
| Document URLs (Phase 10) | 30 req/min/user + plan download quota |

### 1.6 Auth levels used below
`public` · `user` (any signed-in user) · `org:<role>` (member of the current organization with at least that role) · `perm:<key>` (platform permission) · `ent:<feature>` (plan entitlement checked/consumed).

---

## 2. Shared schemas

```ts
type TenderStatus = "UPCOMING" | "OPEN" | "CLOSING_SOON" | "CLOSED" | "CANCELLED" | "AWARDED" | "ARCHIVED";
type Money = { amount: string; currency: string };

interface TenderSummary {
  id: string; slug: string;
  referenceNumber: string | null;
  title: string;
  procuringEntity: { id: string; name: string };
  department: string | null;
  category: { id: string; name: string } | null;
  tenderType: "OPEN" | "LIMITED" | "EOI" | "RFP" | "SINGLE" | "GLOBAL";
  status: TenderStatus;
  state: { code: string; name: string } | null;
  city: string | null;
  estimatedValue: Money | null;
  emdAmount: Money | null;
  publishedAt: string; closingAt: string | null;
  sources: { slug: string; name: string }[];
  isSaved: boolean;            // only when authenticated
}

interface TenderDetail extends TenderSummary {
  description: string | null;
  subCategory: { id: string; name: string } | null;
  procurementType: "GOODS" | "WORKS" | "SERVICES" | "CONSULTANCY" | null;
  district: string | null; locationText: string | null;
  tenderFee: Money | null; performanceSecurity: Money | null;
  documentDownloadStartAt: string | null; openingAt: string | null;
  bidValidityDays: number | null; workPeriodDays: number | null;
  eligibility: string[]; technicalRequirements: string[]; financialRequirements: string[];
  termsAndConditions: string[]; biddingProcess: string[];
  contact: { name: string | null; email: string | null; phone: string | null };
  sourceUrl: string | null;
  documents: TenderDocument[];
  versions: { version: number; changeType: string; detectedAt: string }[];
  lastSyncedAt: string;
}

interface TenderDocument {
  id: string; fileName: string;
  documentType: "NIT" | "TENDER_DOCUMENT" | "BOQ" | "CORRIGENDUM" | "TECHNICAL_SPEC" | "ELIGIBILITY" | "ADDENDUM" | "TERMS" | "DRAWING" | "OTHER";
  mimeType: string; fileSize: number; version: number;
  status: "PENDING" | "PROCESSED" | "FAILED"; downloadedAt: string | null;
}
```

Other schemas (`User`, `Organization`, `SavedSearch`, `Alert`, `Notification`, `Bid`, `Plan`, `Subscription`, `Invoice`, `MarketSnapshot`, admin DTOs) are defined in OpenAPI; their fields mirror [DATABASE.md](./DATABASE.md) minus internal columns, and the frontend `lib/types.ts` shapes where those already exist.

---

## 3. Auth — `/auth`

**Implemented in Phase 2** except `GET /auth/google` and `/auth/google/callback`: the schema is
ready (`user_identities`) but no route exists yet — it needs real Google credentials to verify
end-to-end (docs/ARCHITECTURE.md §17.1). `password ≥ 8` is enforced; breach-list checking is not
implemented (would need an external API call on every registration — deferred, see IMPLEMENTATION-PLAN.md).

| Method & path | Auth | Body / params | Response `data` |
|---|---|---|---|
| `POST /auth/register` | public | `{ name, email, password, acceptTerms: true }` (password ≥ 8; terms version recorded) | `{ user, requiresEmailVerification: true, accessToken, expiresIn }` · sets refresh cookie |
| `POST /auth/login` | public | `{ email, password }` | `{ accessToken, expiresIn, user }` · sets refresh cookie |
| `POST /auth/refresh` | refresh cookie + `X-Requested-With` | — | `{ accessToken, expiresIn }` · rotates cookie |
| `POST /auth/logout` | user | — | `null` · revokes current session, clears cookie |
| `POST /auth/verify-email` | public | `{ token }` | `{ verified: true }` |
| `POST /auth/resend-verification` | user | — | `null` |
| `POST /auth/forgot-password` | public | `{ email }` | `null` (always 200 — no enumeration) |
| `POST /auth/reset-password` | public | `{ token, password }` | `null` · revokes all sessions |
| `POST /auth/change-password` | user | `{ currentPassword, newPassword }` | `null` · revokes other sessions (not the current one) |
| `POST /auth/switch-organization/:organizationId` | user | — | `{ accessToken, expiresIn, organizationId }` · **new in Phase 2** (not in the original contract): mints a token scoped to another organization the caller belongs to; same session, no new cookie. See ARCHITECTURE §17.4 for why this exists. |
| `GET /auth/google` | public | *(not yet implemented — Phase 2 stub, see above)* | `?redirect=/dashboard` → 302 to Google |
| `GET /auth/google/callback` | public | *(not yet implemented)* | Google params → 302 to frontend with session established |
| `GET /auth/sessions` | user | — | `Session[]` (device, ip, lastUsedAt, current) |
| `DELETE /auth/sessions/:id` | user | — | `null` |

## 4. Current user & organization — `/me`, `/organizations`

Rows marked **(Phase N)** are not implemented yet; everything else shipped in Phase 2. Plan
summary/entitlements and `ent:team_seats` do not exist before Phase 8, so `GET /me` omits them and
`POST /organizations/current/invitations` currently has no seat limit.

| Method & path | Auth | Notes |
|---|---|---|
| `GET /me` | user | profile + `staffRoles` + current organization (no plan/entitlements yet — Phase 8) |
| `PATCH /me` | user | `{ name?, phone?, designation? }` (email change is a separate verified flow — not built) |
| `POST /me/avatar` (Phase 6) | user | multipart image ≤ 2 MB (png/jpg/webp) → `{ avatarUrl }` |
| `GET /me/usage` (Phase 8) | user | per-feature usage vs limits for the current period |
| `GET/PATCH /me/notification-preferences` (Phase 7) | user | channel and category toggles |
| `GET /organizations/current` | org:VIEWER | company profile |
| `PATCH /organizations/current` | org:OWNER | `{ name?, gstin?, pan?, industry?, companySize?, address?, stateCode?, city?, website?, contactPerson? }` (`categoryIds` not yet — Phase 3 links categories to organizations) |
| `GET /organizations/current/members` | org:VIEWER | |
| `POST /organizations/current/invitations` | org:OWNER | `{ email, role: "MEMBER" \| "VIEWER" }` — re-inviting a still-pending email replaces the old invitation |
| `PATCH/DELETE /organizations/current/members/:userId` | org:OWNER | `{ role: "MEMBER" \| "VIEWER" }`; the owner's own row cannot be changed or removed |
| `POST /organizations/invitations/accept` | user | `{ token }` — idempotent; rejects a token whose invited email does not match the signed-in account; call `POST /auth/switch-organization/:organizationId` afterwards to actually act in the joined organization |
| `GET/POST /organizations/current/documents` (Phase 6) | org:OWNER | KYC documents (multipart PDF/JPG ≤ 10 MB) |
| `DELETE /organizations/current/documents/:id` (Phase 6) | org:OWNER | |

## 5. Tenders & search

**Superseded for search by Sec 5.3 (Phase 7): `GET /search/tenders` is now the ranked search endpoint. The rest of this paragraph is the Phase 2/3 state, kept for history.** Phase 2/3 implement a plain indexed-column filter, not the relevance-ranked search engine below
(that is Phase 4/5, behind the same `GET /search/tenders` path and response shape). Live now on
`GET /tenders` (not yet renamed to `/search/tenders`): `q` (title substring, case-insensitive),
`state`, `category`, `status`, `procuringEntity` (canonical entity UUID, Phase 3), `district`,
`minValue`/`maxValue` (exact decimal strings, Phase 3), `publishedFrom/To`, `closingFrom/To`,
`sortBy` (`publishedAt`|`closingAt`|`estimatedValue`, Phase 3) / `sortOrder`, and page-based
`page`/`pageSize` (no cursor mode, no facets yet). `GET /tenders/:id` takes a UUID only (no slug
lookup yet) and, as of Phase 3, also returns `procuringEntity`, `versions` (diff history),
`qualityIssues` (open, non-blocking findings), `sourceStatusRaw` and `duplicateOfId`; `documents` is
still always `[]` (Phase 6 populates it). Everything else in this section — `/search/suggest`,
`/tenders/:id/similar`, document URLs/archives, `entitlement` checks,
`city/subCategory/tenderType/procurementType/source/emd/fee` filters and `/meta/sources` — is not
implemented yet.

### 5.1 Procuring entities and duplicate review (Phase 3, not yet under `/admin`)
Minimal admin-facing APIs, permission-gated, not part of the `/admin` surface sketched in §11 below
(that surface does not exist yet — these are their own top-level routes for now and can move under
`/admin` when that module is built):

| Method & path | Auth | Notes |
|---|---|---|
| `GET /procuring-entities` | `admin.access` | `?state&search&page&pageSize` |
| `POST /procuring-entities/:id/merge` | `entity.merge` | `{ targetEntityId }` → 200, no body. Never deletes; see docs/ARCHITECTURE.md §18.7 |
| `GET /duplicate-candidates` | `duplicate.review` | `?status&page&pageSize` |
| `POST /duplicate-candidates/:id/resolve` | `duplicate.review` | `{ resolution: "CONFIRMED"\|"REJECTED", notes? }` → 200, no body. See docs/ARCHITECTURE.md §18.8 |

### 5.2 Tender enrichment — requirements, timeline, corrigenda, documents, corrections (Phase 4)
Reads are public (same visibility as the tender itself); mutations require `tender.update`
(requirements/corrigenda/timeline correction) or the new `tender.correct` (canonical field
correction) — see docs/ARCHITECTURE.md §19.

| Method & path | Auth | Notes |
|---|---|---|
| `GET /tenders/:id/requirements` | public | `?type&page&pageSize` |
| `GET /tenders/:id/requirements/:reqId` | public | |
| `POST /tenders/:id/requirements` | `tender.update` | `{ type, title, description?, value?, unit?, isMandatory?, sourceReference? }` |
| `PATCH /tenders/:id/requirements/:reqId` | `tender.update` | partial update of the same fields |
| `DELETE /tenders/:id/requirements/:reqId` | `tender.update` | → 200, no body |
| `GET /tenders/:id/timeline` | public | `?page&pageSize` (max 200), chronological, unknown timestamps sorted last |
| `GET /tenders/:id/timeline/:eventId` | public | |
| `PATCH /tenders/:id/timeline/:eventId` | `tender.update` | `{ eventAt?, title?, description? }` — administrative correction, audited |
| `GET /tenders/:id/corrigenda` | public | `?page&pageSize` |
| `GET /tenders/:id/corrigenda/:corrigendumId` | public | |
| `POST /tenders/:id/corrigenda` | `tender.update` | `{ title, publishedAt, description?, effectiveAt?, sourceUrl?, sourceId?, sourceReference?, documentId?, affectedFields? }` — also records a matching `CORRIGENDUM` timeline event |
| `GET /tenders/:id/documents` | public | `?page&pageSize`. No public upload route — registration is internal (future crawler document-fetch step, Phase 6) |
| `GET /tenders/:id/documents/:documentId` | public | metadata only, never a storage key/credential |
| `GET /tenders/:id/documents/:documentId/download` | public | streams the file directly (`Content-Disposition: attachment`) |
| `PATCH /tenders/:id/correct` | `tender.correct` | `{ title?, description?, estimatedValue?, emdAmount?, tenderFee?, closingAt?, openingAt?, stateCode?, city?, locationText?, reason }` — `reason` required, every change audited with old/new value |

`GET /tenders/:id` (§5 above) now also returns `documents`, `requirements`, `timeline`, `corrigenda`
(each capped at 20 rows — use the dedicated endpoints above for anything beyond that) and
`provenance` (`[{ sourceId, sourceUrl, firstSeenAt, lastSeenAt, lastChangedAt }]`, one entry per
source currently tracking the tender).

| Method & path | Auth | Notes |
|---|---|---|
| `GET /search/tenders` | public (limited) / user | Params: `q`, `state`, `district`, `city`, `category`, `subCategory`, `tenderType`, `procurementType`, `status`, `source`, `procuringEntity`, `valueMin`, `valueMax`, `emdMin`, `emdMax`, `feeMax`, `publishedFrom/To`, `closingFrom/To`, `sort`, `page`/`pageSize` **or** `cursor`/`limit`, `facets=true`. Quoted phrases in `q` are exact; a `q` that looks like a reference number boosts reference matches. Response: `TenderSummary[]`; `meta.facets = { state: [{value, label, count}], category: [...], source: [...], tenderType: [...], status: [...], valueRanges: [...] }`. Anonymous users get the first page only. |
| `GET /search/suggest` (Phase 4/5) | public | `?q=` → keyword/entity/category suggestions (≤ 8) |
| `GET /tenders/:idOrSlug` | public (limited) / user + ent:tender_views | `TenderDetail`. Anonymous: summary fields + document list without download. Counts a view once per user per tender per day. |
| `GET /tenders/:id/similar` (Phase 4/5) | public | `?limit=4` → `TenderSummary[]` |
| `GET /tenders/:id/documents/:documentId/url` (Phase 6) | user + ent:document_downloads | `{ url, expiresAt }` signed URL (5 min) |
| `POST /tenders/:id/documents/archive` (Phase 6) | user + ent:document_downloads | starts "download all" → `{ archiveId, status }` |
| `GET /documents/archives/:archiveId` (Phase 6) | user | `{ status, url?, expiresAt? }` |
| `GET /meta/states` · `/meta/categories` · `/meta/tender-types` | public | reference data for filters — live now. `/meta/sources` (Phase 4/5) not yet. |

### 5.3 Search & discovery (Phase 7)

Authoritative behaviour and rationale: ARCHITECTURE Sec 20. Everything here is public unless marked (history requires auth).

**`GET /search/tenders`** (public; `search` rate-limit policy; a bearer token, when sent, adds `isSaved` and records history)

| Param | Type | Notes |
|---|---|---|
| `q` | string (<= 400 chars sent, <= 200 after normalization) | normalized, prefix-aware, typo-tolerant free text over title, reference, department/entity, category, location, tender type |
| `reference` | string | exact-or-prefix, punctuation-insensitive |
| `state` | `MH,UP` | two-letter codes |
| `district`, `category`, `procuringEntity`, `source` | UUID lists | a `category` parent also matches its children |
| `city` | list | case-insensitive exact |
| `tenderType` | key list | see `/meta/tender-types` |
| `status` | `TenderStatus` list | |
| `minValue` `maxValue` `minEmd` `maxEmd` `minFee` `maxFee` | decimal string, up to 16 digits and 2 decimals | exact, inclusive |
| `publishedFrom/To` `closingFrom/To` `openingFrom/To` | ISO-8601 | date-only = IST calendar day (from = 00:00 IST, to = next-day 00:00 IST, exclusive); instants as given; inverted range = 400 |
| `sort` | `relevance` (default), `newest`, `closingSoonest`, `closingLatest`, `valueHigh`, `valueLow` | legacy `sortBy` / `sortOrder` still honoured; `sort` wins |
| `page`, `pageSize` | int | pageSize 1-100 (default 20); anonymous callers get page 1, at most 20 rows |

Response: `data[]` tender summaries, each with `matchReason` (`REFERENCE_EXACT | REFERENCE_PREFIX | REFERENCE_PARTIAL | TITLE_PHRASE | TITLE_TERMS | ENTITY | OTHER_FIELDS | FUZZY`, or `null` when there was no keyword/reference); `meta.pagination = { page, pageSize, total, totalPages, totalCapped }` (`total` is capped at 10 000 and `totalCapped` says so); `meta.sort` is the sort actually applied; `meta.ranked` says whether a keyword/reference ranked the results.

Errors: `400 VALIDATION_FAILED` (bad values, inverted ranges, over-long query, and `details[].code = PAGE_TOO_DEEP` for offsets >= 10 000), `429 RATE_LIMITED`, `503 DEPENDENCY_UNAVAILABLE` (generic message, no internals).

**Support endpoints**

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /search/suggestions?q=` | public (a token adds the caller's own recents) | `{ recent[], references[], entities[], categories[], states[], popular[] }`; popular needs >= 3 distinct users |
| `GET /search/entities?q=` | public | server-side organization picker, min 2 chars, at most 10 |
| `GET /search/entities?ids=a,b` | public | display names for up to 20 valid entity ids (labels for shared URLs); junk ids ignored |
| `GET /search/cities?q=&state=` | public | distinct city names of live tenders with counts, min 2 chars, at most 20; `state` (two letters) optional; server-side lookup for the `city` filter |
| `GET /search/history?limit=` | required | the caller's own history, newest first |
| `DELETE /search/history/:id` | required | removes one of the caller's items (other users' ids return 404) |
| `DELETE /search/history` | required | clears the caller's history |
| `POST /search/events` | public, 202 | closed-shape analytics event (ARCHITECTURE Sec 20.9); unknown properties return 400 |
| `GET /search/health` | public | counts and last index run only |
| `GET /meta/sources` | public | `{ id, name, slug }[]` for the source filter (no crawl config) |
| `GET /meta/districts?state=` | public | districts; empty where sources provide none |

**Saved searches** reuse the search query model: `criteria` accepts every filter above (list-valued) plus `q` and `sort`, but not `page` / `pageSize`. Pre-Phase-7 criteria with single strings (`state: "MH"`) remain valid and are read as one-element lists.

## 6. Market data (landing page) — `/market`

| Method & path | Auth | Response |
|---|---|---|
| `GET /market/snapshot` | public, cached 5 min (Redis, keyed under `QUEUE_PREFIX`) | `{ liveTenders, closingThisWeek: Money, sources, lastCrawlAt, states: [{ code, name, type, live, closingThisWeek: Money, topBuyer }], topBuyers: [{ id, name, shortName, live, value: Money }] (top 6), valueBands: [{ key, min, max, count }], portals: [{ id, name, status: ok\|delayed\|down, lastSyncedAt, today }] (top 6), computedAt }` |
| `GET /market/wire` | public | `?limit=1..50 (40)&state=MH` → latest published live tenders `{ id, title, department, value: Money \| null, state: {code,name} \| null, publishedAt }[]` |
| `GET /market/closing` | public | `?limit=1..20 (5)` → live tenders with a deadline, soonest first `{ id, title, department, closingAt }[]` |

Implemented (`src/market`). **Live** = not deleted, not a confirmed duplicate, status `OPEN`/`CLOSING_SOON` and deadline not passed (or none). `closingThisWeek` sums INR `estimatedValue` of live tenders closing in the next 7 days. `topBuyer` is the procuring entity (short name when set) with the most live tenders in the state, falling back to the raw `department` for unresolved tenders; `department` in wire/closing is the entity name, else the raw department. Value bands count live INR tenders with a disclosed value, lower bound inclusive: `UNDER_10L`, `10L_TO_1CR`, `1CR_TO_10CR`, `10CR_TO_100CR`, `OVER_100CR` (`min`/`max` are INR decimal strings, `null` when open-ended). Portal `status` maps source health: `HEALTHY` → `ok`, `UNKNOWN`/`DEGRADED` → `delayed`, otherwise `down`; `today` counts source records first seen since IST midnight.

## 7. Watchlists, saved searches, alerts, bids

**Phase 2 implements the watchlist and saved searches rows below, under different paths than
originally drafted** (`/watchlist`, not `/watchlist/tenders`; no `shared`/entitlement checks, no
results-runner endpoint). Follows, alerts and bids are not implemented.

| Method & path | Auth | Notes |
|---|---|---|
| `GET /watchlist` | user | *(was drafted as `/watchlist/tenders`)* full list, newest first — no pagination/sort yet |
| `POST /watchlist` | user | *(was drafted as `PUT /watchlist/tenders/:tenderId`)* `{ tenderId, note? }` → the bookmark row; idempotent (bookmarking twice returns the existing row) |
| `DELETE /watchlist/:tenderId` | user | idempotent unsave |
| `GET /watchlist/follows` (Phase 7) · `POST` · `DELETE /:id` | user | `{ targetType: PROCURING_ENTITY|CATEGORY|STATE|DISTRICT|KEYWORD, targetId?, targetValue? }` |
| `GET /saved-searches` | org:VIEWER | scoped to the caller's current organization (not "own + shared" — there is only one shared, org-scoped list) |
| `POST /saved-searches` | org:MEMBER | `{ name, criteria: SearchCriteria }` — `SearchCriteria` accepts the same keys as `/search/tenders`'s live filters (§5) and rejects unknown ones; no `shared` flag or entitlement check yet |
| `PATCH/DELETE /saved-searches/:id` | org:MEMBER | 404 `SAVED_SEARCH_NOT_FOUND` for another organization's saved search |
| `GET /saved-searches/:id/results` (Phase 4/5) | user | runs the stored criteria through search |
| `GET /alerts` (Phase 7) · `POST` | user + ent:alerts | `{ savedSearchId \| criteria, name, frequency: INSTANT \| DAILY \| WEEKLY, channels: ("EMAIL" \| "IN_APP")[] }` — `SMS`, `WHATSAPP`, `PUSH` are reserved and return `422 CHANNEL_NOT_AVAILABLE` |
| `PATCH /alerts/:id` (Phase 7) · `DELETE` | owner | |
| `POST /alerts/:id/pause` (Phase 7) · `/resume` | owner | |
| `GET /bids` (Phase 7) · `POST` · `PATCH /:id` · `DELETE /:id` | org:MEMBER | `{ tenderId, stage, bidAmount?: Money, submittedAt?, notes? }` |

## 8. Notifications — `/notifications`

**Phase 8 as built.** Notifications are generated asynchronously by the worker from real domain events (ARCHITECTURE Sec 21); the API only reads and updates the caller's own rows. Identity always comes from the access token: there is no `userId`/`organizationId` parameter, and unknown query parameters are rejected with `400`. A notification that is not yours is `404` (indistinguishable from a missing one).

| Method & path | Auth | Notes |
|---|---|---|
| `GET /notifications` | user | Query: `page` (default 1), `pageSize` (<= 100, default 20), `type` (one of the types below), `unread=true`. Newest first; expired items hidden. `meta.unreadCount`, `meta.pagination {page,pageSize,total,totalPages}`. |
| `GET /notifications/unread-count` | user | `{ unreadCount }` (cheap; used for polling) |
| `PATCH /notifications/:id/read` | user | idempotent; `404` if not yours |
| `PATCH /notifications/:id/unread` | user | idempotent; `404` if not yours |
| `PATCH /notifications/read-all` | user | `{ updated }` |
| `GET /notifications/preferences` | user | per-category `{ inApp, email, locked }`, `deadlineOffsetsHours`, `allowedDeadlineOffsetsHours` (168, 72, 24, 3), `quietHours {enabled,start,end,timezone}`; documented defaults when nothing was saved |
| `PATCH /notifications/preferences` | user | partial update, strict schema (unknown keys `400`): `categories.<CATEGORY>.{inApp,email}`, `deadlineOffsetsHours` (subset of the allowed offsets, `[]` disables reminders), `quietHours` (`start`/`end` `HH:mm`, IANA `timezone`). The `SYSTEM` category cannot be disabled (`400`). Audited. |

Notification object: `id, type, title, message, entityType, entityId, entityAvailable, priority (LOW|NORMAL|HIGH|CRITICAL), metadata, isRead, readAt, expiresAt, createdAt`. `entityAvailable` is `false` when the linked tender no longer exists (the UI must not link it). `metadata` is a closed, validated snapshot (tender id/title/reference/closing date, changed fields, saved-search id/names, corrigendum id/title, offset hours, security kind) - never a free-form payload.

Types: `SAVED_SEARCH_MATCH`, `TENDER_UPDATED`, `TENDER_DEADLINE`, `TENDER_CORRIGENDUM`, `TENDER_CANCELLED`, `TENDER_STATUS_CHANGED`, `SECURITY`, `ACCOUNT`. Categories (for preferences): `SAVED_SEARCH_ALERTS`, `SAVED_TENDER_UPDATES`, `DEADLINE_REMINDERS`, `CORRIGENDA`, `STATUS_CHANGES`, `SYSTEM` (locked).

Saved-search alerts: `POST/PATCH /saved-searches` accept `alertFrequency` = `OFF` (default) | `IMMEDIATE` | `DAILY`; the saved search object returns it. Alerts are opt-in per search.

Realtime strategy: **polling** (count on load, on focus and at most every 60 s while visible). SSE/WebSocket streams and `DELETE /notifications` from the original sketch were not built (ARCHITECTURE Sec 21.9).

## 9. Billing — `/plans`, `/subscriptions`, `/payments`, `/invoices`

| Method & path | Auth | Notes |
|---|---|---|
| `GET /plans` | public | plans with prices and entitlements (drives the pricing page) |
| `GET /subscriptions/current` | org:VIEWER | `{ plan, status, billingCycle, currentPeriodEnd, cancelAtPeriodEnd, paymentMethod }` |
| `POST /subscriptions/checkout` | org:OWNER | `{ planCode, billingCycle }` + `Idempotency-Key` → `{ provider: "RAZORPAY", keyId, subscriptionId \| orderId, amount: Money, prefill }` |
| `POST /payments/verify` | org:OWNER | `{ razorpayPaymentId, razorpaySubscriptionId \| razorpayOrderId, razorpaySignature }` → server-side signature check; returns provisional state (webhook remains authoritative) |
| `POST /subscriptions/change-plan` | org:OWNER | `{ planCode, billingCycle }` → proration preview or checkout |
| `POST /subscriptions/cancel` | org:OWNER | cancels at period end |
| `GET /invoices` | org:OWNER | page-based |
| `GET /invoices/:id/pdf` | org:OWNER | `{ url, expiresAt }` |
| `POST /webhooks/razorpay` | public, HMAC signature | raw body; idempotent by event id; always 200 once persisted |

## 10. Support — `/support`, `/contact`
| `POST /support/tickets` | user | `{ subject, message }` |
|---|---|---|
| `GET /support/tickets` | user | own tickets |
| `POST /contact` | public, rate limited + honeypot | `{ name, email, subject, message }` |

## 11. Admin — `/admin` (all require the listed permission)

| Area | Endpoints | Permission |
|---|---|---|
| Users | `GET /admin/users?q&plan&status&role&joinedFrom&joinedTo` · `GET /admin/users/:id` · `PATCH /admin/users/:id/roles` · `POST /admin/users/:id/suspend` · `/activate` | `user.read`, `user.update`, `user.suspend` |
| Organizations | `GET /admin/organizations` · `GET /:id` · `POST /:id/documents/:docId/verify` | `user.read`, `user.update` |
| Tenders | `GET /admin/tenders` (includes flagged/archived/deleted) · `PATCH /admin/tenders/:id` · `POST /:id/archive` · `/flag` · `/unflag` · `DELETE /:id` (soft) · `GET /admin/duplicates` · `POST /admin/duplicates/:id/merge` · `/reject` | `tender.read`, `tender.update`, `tender.delete` |
| Sources | `GET/POST /admin/sources` · `PATCH /:id` · `PUT /:id/credentials` (write-only; response never echoes secrets) · `POST /:id/enable` · `/disable` · `POST /:id/test` · `PATCH /:id/schedule` | `crawler.read`, `crawler.configure` |
| Crawler | `POST /admin/sources/:id/crawl` · `POST /admin/crawler/runs/:id/cancel` · `/retry` · `POST /admin/sources/:id/pause` · `/resume` · `GET /admin/crawler/runs?source&status` · `GET /admin/crawler/runs/:id` · `GET /admin/crawler/runs/:id/events` · `GET /admin/crawler/stats` · `GET /admin/crawler/dead-letters` | `crawler.read`, `crawler.start`, `crawler.stop` |
| Documents | `GET /admin/documents?status&tender` · `POST /admin/documents/:id/reprocess` · `DELETE /admin/documents/:id` | `document.read`, `document.delete` |
| Notifications | `GET /admin/notifications/deliveries?status=FAILED` · `POST /admin/notifications/deliveries/:id/retry` · `POST /admin/notifications/broadcast` | `admin.notifications` |
| Billing | `GET /admin/subscriptions` · `GET /admin/payments` · `GET /admin/plans` · `PATCH /admin/plans/:code` (prices, entitlements) | `billing.read`, `billing.manage` |
| Analytics | `GET /admin/analytics/overview` · `/tenders` · `/crawlers` · `/users` · `/revenue` · `/search` (`?from&to&granularity=day|week|month`) | `analytics.read` |
| Audit | `GET /admin/audit-logs?actor&action&resourceType&resourceId&from&to` (cursor) | `audit.read` |
| Settings | `GET /admin/settings` · `PATCH /admin/settings` | `admin.settings` |
| Queues UI | `/admin/queues` (Bull Board) | `SUPER_ADMIN` role |

## 12. Health & ops
| `GET /health` | public | `{ status: "ok", version, uptime }` |
|---|---|---|
| `GET /health/live` | public | process alive |
| `GET /health/ready` | internal | checks PostgreSQL, Redis, search provider, object storage; 503 if any is down |
| `GET /health/queues` | internal (staff auth from Phase 5) | per queue: `waiting, active, delayed, prioritized, waiting-children, failed, completed` counts, `paused`, connected `workers`, `oldestWaitingMs`; 503 `DEPENDENCY_UNAVAILABLE` when Redis is down. Counts only — no job data |
| `GET /metrics` | internal network only | Prometheus format |

---

## 13. Error codes

| HTTP | Code | When |
|---|---|---|
| 400 | `VALIDATION_FAILED` | DTO validation; see `details` |
| 400 | `INVALID_CURSOR` | malformed/expired cursor |
| 401 | `UNAUTHENTICATED` | missing/invalid access token |
| 401 | `TOKEN_EXPIRED` | access token expired → call `/auth/refresh` |
| 401 | `INVALID_CREDENTIALS` | login failure (generic) |
| 401 | `REFRESH_TOKEN_REUSED` | refresh reuse detected; all sessions in family revoked |
| 403 | `FORBIDDEN` | missing permission / org role |
| 403 | `EMAIL_NOT_VERIFIED` | action requires verified email |
| 403 | `ACCOUNT_SUSPENDED` | |
| 402 | `PLAN_LIMIT_REACHED` | `details: [{ feature, limit, used, resetsAt }]` |
| 402 | `PLAN_FEATURE_UNAVAILABLE` | feature not in plan |
| 404 | `NOT_FOUND`, `TENDER_NOT_FOUND`, `ORGANIZATION_NOT_FOUND`, `DOCUMENT_NOT_FOUND`, `SAVED_SEARCH_NOT_FOUND`, `ALERT_NOT_FOUND`, `SOURCE_NOT_FOUND` | `ORGANIZATION_NOT_FOUND` added in Phase 2 |
| 409 | `CONFLICT`, `EMAIL_ALREADY_REGISTERED`, `ALREADY_MEMBER`, `SUBSCRIPTION_ACTIVE` | |
| 410 | `TOKEN_INVALID_OR_EXPIRED` | verify/reset/invite tokens |
| 413 | `FILE_TOO_LARGE` | |
| 415 | `UNSUPPORTED_FILE_TYPE` | |
| 422 | `PAYMENT_SIGNATURE_INVALID`, `SOURCE_AUTH_FAILED`, `CRAWL_ALREADY_RUNNING`, `CHANNEL_NOT_AVAILABLE` | |
| 423 | `ACCOUNT_LOCKED` | too many failed logins; `details.retryAt` |
| 429 | `RATE_LIMITED` | |
| 503 | `SEARCH_UNAVAILABLE`, `DEPENDENCY_UNAVAILABLE` | degraded dependency |
| 500 | `INTERNAL_ERROR` | message is generic; see `requestId` |

---

## 14. Frontend integration map

| Frontend call (`lib/api`) | Endpoint |
|---|---|
| `auth.login` / `auth.register` | `POST /auth/login` / `POST /auth/register` |
| `auth.requestPasswordReset` | `POST /auth/forgot-password` |
| `auth.loginWithGoogle` | browser navigation to `GET /auth/google?redirect=…` |
| `tenders.searchTenders` | `GET /search/tenders` — param renames: `keyword→q`, `industry→category` (industry is derived from category), `minValue/maxValue→valueMin/valueMax`, `sort: latest→newest, value_high→value_desc, value_low→value_asc` |
| `tenders.getTender` / `getSimilar` | `GET /tenders/:id` / `GET /tenders/:id/similar` |
| `tenders.getRecommendedTenders` | `GET /search/tenders?sort=relevance` seeded from the org's business categories and follows |
| `tenders.getClosingSoonTenders` | `GET /search/tenders?status=OPEN,CLOSING_SOON&sort=closing_soon&pageSize=4` |
| `market.getMarketSnapshot` / `getWire` / `getClosingBoard` | `GET /market/snapshot` / `GET /market/wire` / `GET /market/closing` |
| `documents.downloadDocument` / `downloadAllDocuments` | `GET /tenders/:id/documents/:docId/url` / `POST /tenders/:id/documents/archive` |
| `notifications.*` | `/notifications*` (+ SSE stream for the bell) |
| `subscriptions.getPlans` / `getCurrentSubscription` / `getInvoices` / `changePlan` / `cancelSubscription` | `GET /plans` / `GET /subscriptions/current` / `GET /invoices` / `POST /subscriptions/change-plan` / `POST /subscriptions/cancel` |
| `users.getCurrentUser` / `updateProfile` | `GET /me` / `PATCH /me` |
| `users.getCurrentCompany` / `updateCompany` | `GET/PATCH /organizations/current` |
| store: saved tenders, saved searches, alerts, notifications | `/watchlist/tenders`, `/saved-searches`, `/alerts`, `/notifications` |
| "My Bids" page (mock `lib/mock/bids.ts`) | `/bids` |
| Admin pages (`lib/mock/users|companies|sources|audit-logs`) | `/admin/*` |

Frontend type adjustments needed at integration time: money becomes `Money` objects (not numbers); `Tender.documentFee` → `tenderFee`; tender `status` values become UPPER_SNAKE; `state` becomes `{ code, name }`.
## 15. Analytics & tracking — `/analytics` (Phase 10)

Authoritative behaviour and rationale: ARCHITECTURE Sec 22. Ingestion is public; reporting is authorized per the existing RBAC/organization model (no parallel permission system).

| Method & path | Auth | Notes |
|---|---|---|
| `POST /analytics/events` | `@Public()`, `@RateLimit('analytics')`, 202 | Body: `{ events: TrackEvent[] }`, up to `ANALYTICS_MAX_BATCH_SIZE` (default 20, hard cap 20) per request. Each event: `name` (one of the 23 closed `AnalyticsEventName` values), `anonymousId` (client-generated, `^[A-Za-z0-9_-]{8,64}$`), optional `path` (pathname only, <= 300 chars), optional `metadata` (validated per `name`, see ARCHITECTURE Sec 22.3), optional `entityType`/`entityId`, optional `occurredAt` (clamped server-side to `[now-24h, now+5m]`), and first-event-only session attribution fields (`landingPath`, `referrerHost`, `utmSource/Medium/Campaign/Term/Content`). A bearer token, when present, attaches the caller's user/organization - these are never accepted as body fields. Response: `{ accepted, rejected }`; never a 5xx - a database or validation failure is reported as `rejected`, not an error. |
| `GET /analytics/me/summary` | user | `?from=&to=` (date-only, default trailing 30 days, max 366-day span). The caller's own event counts by type. |
| `GET /analytics/organizations/current/overview` | `@RequireOrgRole('VIEWER')` | `?from=&to=`. Daily-rollup totals for the caller's own organization. |
| `GET /analytics/admin/overview` | `@RequirePermissions('analytics.view')` | `?from=&to=`. Platform-wide (`dimension=global`) daily-rollup totals across the 10 metrics in ARCHITECTURE Sec 22.6. |
| `GET /analytics/admin/trends` | `@RequirePermissions('analytics.view')` | `?metric=&from=&to=` (metric is one of the 10 rollup metrics; unknown metric or range = `400`). One daily-count series. |

Raw `analytics_events` rows are never exposed by any endpoint - only aggregates (`analytics_daily_rollups`) and a caller's own summary. `from`/`to` outside a sane range, inverted, or malformed return `400 VALIDATION_FAILED`.

