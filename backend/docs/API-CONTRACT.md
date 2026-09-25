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
- Ranges: `valueMin`, `valueMax`, `emdMin`, `emdMax` (rupees, decimal strings accepted), `publishedFrom`, `publishedTo`, `closingFrom`, `closingTo` (ISO dates).
- Sort: `sort=relevance|newest|closing_soon|value_desc|value_asc` (search); list endpoints accept `sort=<field>` / `sort=-<field>`.

### 1.5 Rate limits
Responses include `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`. Exceeding returns `429 RATE_LIMITED` with `Retry-After`.

| Audience / class | Default |
|---|---|
| Anonymous (general) | 60 req/min/IP |
| Authenticated | 300 req/min/user |
| Paid plans | 600 req/min/user |
| Admin | 1 200 req/min/user |
| Auth endpoints (login, register, reset) | 10 req/15 min/IP + per-account lockout |
| Search | 60 req/min anonymous, 120 authenticated |
| Document URLs | 30 req/min/user + plan download quota |

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

| Method & path | Auth | Body / params | Response `data` |
|---|---|---|---|
| `POST /auth/register` | public | `{ name, email, password, acceptTerms: true }` (password ≥ 8, not in breach list; terms version recorded) | `{ user, requiresEmailVerification: true }` · sets refresh cookie, returns `accessToken` |
| `POST /auth/login` | public | `{ email, password }` | `{ accessToken, expiresIn, user }` · sets refresh cookie |
| `POST /auth/refresh` | refresh cookie + `X-Requested-With` | — | `{ accessToken, expiresIn }` · rotates cookie |
| `POST /auth/logout` | user | — | `null` · revokes current session, clears cookie |
| `POST /auth/verify-email` | public | `{ token }` | `{ verified: true }` |
| `POST /auth/resend-verification` | user | — | `null` |
| `POST /auth/forgot-password` | public | `{ email }` | `null` (always 200 — no enumeration) |
| `POST /auth/reset-password` | public | `{ token, password }` | `null` · revokes all sessions |
| `POST /auth/change-password` | user | `{ currentPassword, newPassword }` | `null` · revokes other sessions |
| `GET /auth/google` | public | `?redirect=/dashboard` | 302 to Google |
| `GET /auth/google/callback` | public | Google params | 302 to frontend with session established |
| `GET /auth/sessions` | user | — | `Session[]` (device, ip, lastUsedAt, current) |
| `DELETE /auth/sessions/:id` | user | — | `null` |

## 4. Current user & organization — `/me`, `/organizations`

| Method & path | Auth | Notes |
|---|---|---|
| `GET /me` | user | profile + roles + current organization + plan summary + entitlements |
| `PATCH /me` | user | `{ name?, phone?, designation? }` (email change is a separate verified flow) |
| `POST /me/avatar` | user | multipart image ≤ 2 MB (png/jpg/webp) → `{ avatarUrl }` |
| `GET /me/usage` | user | per-feature usage vs limits for the current period |
| `GET/PATCH /me/notification-preferences` | user | channel and category toggles |
| `GET /organizations/current` | org:VIEWER | company profile |
| `PATCH /organizations/current` | org:OWNER | `{ name, gstin, pan, industry, companySize, address, stateCode, city, website, contactPerson, categoryIds }` |
| `GET /organizations/current/members` | org:VIEWER | |
| `POST /organizations/current/invitations` | org:OWNER + ent:team_seats | `{ email, role }` |
| `PATCH/DELETE /organizations/current/members/:userId` | org:OWNER | owner cannot be removed |
| `POST /organizations/invitations/accept` | user | `{ token }` |
| `GET/POST /organizations/current/documents` | org:OWNER | KYC documents (multipart PDF/JPG ≤ 10 MB) |
| `DELETE /organizations/current/documents/:id` | org:OWNER | |

## 5. Tenders & search

| Method & path | Auth | Notes |
|---|---|---|
| `GET /search/tenders` | public (limited) / user | Params: `q`, `state`, `district`, `city`, `category`, `subCategory`, `tenderType`, `procurementType`, `status`, `source`, `procuringEntity`, `valueMin`, `valueMax`, `emdMin`, `emdMax`, `feeMax`, `publishedFrom/To`, `closingFrom/To`, `sort`, `page`/`pageSize` **or** `cursor`/`limit`, `facets=true`. Quoted phrases in `q` are exact; a `q` that looks like a reference number boosts reference matches. Response: `TenderSummary[]`; `meta.facets = { state: [{value, label, count}], category: [...], source: [...], tenderType: [...], status: [...], valueRanges: [...] }`. Anonymous users get the first page only. |
| `GET /search/suggest` | public | `?q=` → keyword/entity/category suggestions (≤ 8) |
| `GET /tenders/:idOrSlug` | public (limited) / user + ent:tender_views | `TenderDetail`. Anonymous: summary fields + document list without download. Counts a view once per user per tender per day. |
| `GET /tenders/:id/similar` | public | `?limit=4` → `TenderSummary[]` |
| `GET /tenders/:id/documents/:documentId/url` | user + ent:document_downloads | `{ url, expiresAt }` signed URL (5 min) |
| `POST /tenders/:id/documents/archive` | user + ent:document_downloads | starts "download all" → `{ archiveId, status }` |
| `GET /documents/archives/:archiveId` | user | `{ status, url?, expiresAt? }` |
| `GET /meta/states` · `/meta/categories` · `/meta/tender-types` · `/meta/sources` | public | reference data for filters (sources expose name/slug only) |

## 6. Market data (landing page) — `/market`

| Method & path | Auth | Response |
|---|---|---|
| `GET /market/snapshot` | public, cached 5 min | `{ liveTenders, closingThisWeek: Money, sources, lastCrawlAt, states: [{ code, name, type, live, closingThisWeek: Money, topBuyer }], topBuyers: [...], valueBands: [...], portals: [{ name, status, lastSyncedAt, today }] }` |
| `GET /market/wire` | public | `?limit=40&state=MH` → latest published open tenders `{ id, title, department, value: Money, state: {code,name}, publishedAt }[]` |
| `GET /market/closing` | public | `?limit=5` → `{ id, title, department, closingAt }[]` |

## 7. Watchlists, saved searches, alerts, bids

| Method & path | Auth | Notes |
|---|---|---|
| `GET /watchlist/tenders` | user | page-based, `sort=closing_soon|newest|value_desc` |
| `PUT /watchlist/tenders/:tenderId` | user | idempotent save → `{ saved: true }` |
| `DELETE /watchlist/tenders/:tenderId` | user | idempotent unsave |
| `GET /watchlist/follows` · `POST` · `DELETE /:id` | user | `{ targetType: PROCURING_ENTITY|CATEGORY|STATE|DISTRICT|KEYWORD, targetId?, targetValue? }` |
| `GET /saved-searches` | user | own + shared in org |
| `POST /saved-searches` | user + ent:saved_searches | `{ name, criteria: SearchCriteria, shared?: boolean }` — `SearchCriteria` uses the same keys as `/search/tenders` |
| `PATCH/DELETE /saved-searches/:id` | creator or org:OWNER | |
| `GET /saved-searches/:id/results` | user | runs the stored criteria through search |
| `GET /alerts` · `POST` | user + ent:alerts | `{ savedSearchId \| criteria, name, frequency: INSTANT \| DAILY \| WEEKLY, channels: ("EMAIL" \| "IN_APP")[] }` — `SMS`, `WHATSAPP`, `PUSH` are reserved and return `422 CHANNEL_NOT_AVAILABLE` |
| `PATCH /alerts/:id` · `DELETE` | owner | |
| `POST /alerts/:id/pause` · `/resume` | owner | |
| `GET /bids` · `POST` · `PATCH /:id` · `DELETE /:id` | org:MEMBER | `{ tenderId, stage, bidAmount?: Money, submittedAt?, notes? }` |

## 8. Notifications — `/notifications`

| Method & path | Auth | Notes |
|---|---|---|
| `GET /notifications` | user | cursor-based; `?category=TENDER_ALERT&unread=true` |
| `GET /notifications/unread-count` | user | `{ count }` |
| `POST /notifications/:id/read` | user | idempotent |
| `POST /notifications/read-all` | user | |
| `DELETE /notifications` | user | clears (soft) all |
| `GET /notifications/stream` | user (token via cookie or `?access_token`) | **Server-Sent Events**: `event: notification` with a `Notification` payload; `event: unread-count`. Heartbeat every 25 s. |

Realtime strategy: SSE only (one-way server → client is all the product needs; works through proxies and scales with Redis pub/sub fan-out). WebSockets are not planned.

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
| 404 | `NOT_FOUND`, `TENDER_NOT_FOUND`, `DOCUMENT_NOT_FOUND`, `SAVED_SEARCH_NOT_FOUND`, `ALERT_NOT_FOUND`, `SOURCE_NOT_FOUND` | |
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
