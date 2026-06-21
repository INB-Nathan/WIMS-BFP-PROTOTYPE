# Offline Caching for Every Role — Design Spec

**Date:** 2026-06-21
**Status:** Draft v3 — pending user review (revised per 6 directives + 5 pushback fixes)
**Scope:** Frontend read-cache (offline-first) completion across all roles

## Problem

The frontend has an offline-first stack (IndexedDB via `offlineStore`, connectivity
snapshot, sync engine, service worker). Read-cache wrappers exist for:

- **Encoder** — `offlineRegional.ts` (incident list + detail)
- **Analyst** — `offlineAnalytics.ts` (9 wrappers)
- **Validator** — `offlineValidator.ts` (queue fetch, verify, archive/unarchive)
- **Admin (partial)** — `offlineAdmin.ts` (system-health, metrics, workers,
  sessions, audit-logs)

Six verified problems remain:

1. **Read surfaces still online-only** (verified gaps):

| # | Surface | File | Read call(s) |
|---|---------|------|--------------|
| 1 | Admin security monitoring | `app/admin/monitoring/page.tsx` | `fetchAdminSecurityLogs(params)`, `fetchSecurityLogsSummary()` |
| 2 | Admin anomalies | `app/admin/anomalies/page.tsx` | `fetchAnomalies(params)` |
| 3 | Admin breach | `app/admin/breach/page.tsx` | `fetchBreaches()`, `fetchAdminConfig()` (NPC cfg) |
| 4 | Admin system config | `app/admin/system/config/page.tsx` | `fetchAdminConfig()` |
| 5 | Admin rate-limits | `app/admin/system/rate-limits/page.tsx` | `fetchRateLimits()` |
| 6 | Validator operational map | `app/dashboard/validator/map/page.tsx` | raw `apiFetch('/api/validator/operational-map…')` |
| 7 | Validator audit logs | `app/dashboard/validator/audit/page.tsx` | raw `apiFetch('/api/regional/validator/audit-logs…')` |
| 8 | Analyst wildland detail | `app/dashboard/analyst/incidents/[id]/wildland/page.tsx` | `fetchAnalystIncidentWildlandDetail(id)` |
| 9 | Reference data | `app/dashboard/page.tsx`, `app/admin/system/page.tsx`, `app/dashboard/analyst/page.tsx`, `app/dashboard/analyst/[workflow]/page.tsx` | `fetchRegions()`, `fetchProvinces(regionId)`, `fetchCities(provinceId)` |

2. **Storage method naming** — every cached read (analytics, admin, validator)
funnels through two methods named `cacheAnalyticsResponse` /
`getCachedAnalyticsResponse` in `offlineStore.ts` (verified: callers are
`offlineBase.ts`, `offlineValidator.ts` directly, plus 4 test files). The name
lies about what it stores. `offlineValidator.ts` even duplicates cache logic
inline instead of going through `offlineBase`.

3. **Reference data is encrypted with a short TTL** — geographical reference
data (regions/provinces/cities) is stable for days, non-sensitive, and shared
across roles, yet it would reuse the encrypted 30-min analytics path.
Encryption here is wasteful (crypto per read/write) and 30-min TTL forces
needless refetches.

4. **Raw `apiFetch` in pages** — validator map + audit call `apiFetch` directly
with inline `URLSearchParams`. No standard API function exists to wrap, so an
offline wrapper would have to duplicate the URL-building logic.

5. **SW precache bloat** — the prior draft hardcoded the 7 admin/validator
routes into `urlsToCache`. The `sw.js` navigate handler (line 174) already does
runtime caching (`cache.put(request, response.clone())` on every successful GET
+ fallback chain on network fail). Hardcoding role pages into the install list
bloats the precache and caches routes the user may never visit.

6. **No cache eviction** — `offlineStore` has `evictStaleCachedIncidents` for
the `cachedIncidents` store but **nothing prunes the `analytics-cache` store**
(verified). Heavily parameterized list queries (security logs with filters,
anomalies with filters, audit logs with pagination+filters, operational map
with params) create a new cache key per unique param set. Expired entries linger
forever → unbounded growth.

7. **`useAutoSync` on read-only pages** — the prior draft mounted `useAutoSync`
on read-only pages. `useAutoSync` triggers sync of the pending write queue. Per
Scope A, admin writes stay online (not queued), and validator map/audit/wildland/
dashboard-root are read-only. None of the 12 in-scope pages queue offline
writes, so none should mount `useAutoSync`.

## Goal

Apply read-cache to every remaining online-only read surface so all four roles
view data offline; fix the storage layer naming; use unencrypted long-TTL storage
for reference data; extract raw `apiFetch` into API functions before wrapping;
use runtime (not precache) caching for role-specific routes; drop `useAutoSync`
from read-only pages; define eviction for expired parameterized cache entries.
**Write/mutation operations stay online** (Scope A).

## Non-Goals

- Offline write-queueing for admin mutations (Scope B — rejected).
- Encoder sub-pages (`/dashboard/regional/conflicts`, `/dashboard/regional/audit`).
- Re-auditing already-cached surfaces.
- Retrofitting inline stale-cache banners in existing `analyst/page.tsx` /
  `validator/page.tsx` to the new shared component.
- Removing `useAutoSync` from *existing* pages outside this scope (encoder
  regional, validator main, analyst main — they queue writes, so autosync is
  correct there). This spec only avoids adding it to the 12 in-scope pages.

## Architecture

### Storage layer refactor (directive 1, 3, 6)

`offlineStore.ts` currently has one encrypted read-cache store
(`ANALYTICS_STORE = 'analytics-cache'`) and two methods named for analytics.
Introduce generic, domain-agnostic methods + a second unencrypted store.

**New constants:**
```ts
const READ_CACHE_STORE = 'analytics-cache';   // rename of ANALYTICS_STORE (same DB store, encrypted)
const REFERENCE_STORE  = 'reference-cache';   // NEW — unencrypted, long-TTL, per-user namespaced
```
Bump `DB_VERSION` 5 → 6 to create `REFERENCE_STORE` via the `upgrade()` callback
(keep `READ_CACHE_STORE` as the existing store, no data migration needed).

**Record schema — add per-record `ttlMs`** (pushback P3, applies to BOTH stores):
```ts
interface CachedReadRecord   { key: string; encrypted: EncryptedPayload; cachedAt: number; ttlMs: number }
interface CachedReferenceRecord { key: string; data: unknown;            cachedAt: number; ttlMs: number }  // plaintext
```
Storing `ttlMs` per record lets eviction delete by the record's own expiry
instead of a single shared cutoff, so a 60s security-logs entry is pruned at
~60s, not held until the 30min cutoff. Existing records (pre-ttlMs) get a
back-compat default of the longest TTL on read so they aren't wrongly evicted
before the next online refresh overwrites them with a `ttlMs`-bearing record.

**New generic methods (replace `cacheAnalyticsResponse` / `getCachedAnalyticsResponse`):**
```ts
export async function cacheReadResponse<T>(key, data, ttlMs, cachedAt = Date.now()): Promise<void>
  // encrypted, READ_CACHE_STORE; stores ttlMs on the record

export async function getReadCachedResponse<T>(key): Promise<CachedResponse<T> | undefined>
  // decrypts from READ_CACHE_STORE

export async function cacheReferenceData<T>(key, data, ttlMs, cachedAt = Date.now()): Promise<void>
  // UNENCRYPTED, REFERENCE_STORE; stores ttlMs on the record. key MUST include userId.

export async function getCachedReferenceData<T>(key): Promise<CachedResponse<T> | undefined>
  // reads from REFERENCE_STORE (no decrypt)

export async function evictExpiredReadCache(): Promise<number>
  // deletes READ_CACHE_STORE records where cachedAt + ttlMs < now; returns count (no ttlMs arg — per-record)

export async function evictExpiredReferenceData(): Promise<number>
  // same for REFERENCE_STORE, per-record ttlMs
```
`CachedResponse<T>` = `{ key, data, cachedAt, ttlMs }` (rename of
`CachedAnalyticsResponse`, kept as a type alias for back-compat).

**Per-user namespacing (pushback P1 — security):** the encrypted `READ_CACHE_STORE`
is already per-user isolated by the existing per-user crypto key (item F12,
`offlineStore.ts:168`). The **unencrypted** `REFERENCE_STORE` has no such
isolation, and `/api/ref/regions` is RLS-scoped per user (verified
`backend/api/routes/ref.py:20` — `Depends(get_current_wims_user)` +
`get_db_with_rls`; `public_dmz.py:199` confirms `ref_regions` carries an RLS
policy bypassed only via SECURITY DEFINER). An unencrypted shared store would
let user B read user A's cached region set off disk. Therefore every reference
cache key MUST embed the active userId: `reference:{userId}:regions`, etc.
`cacheReferenceData`/`getCachedReferenceData` take the userId-namespaced key as
given (callers build it); on user switch, `clearAllOfflineData()`/`setActiveOfflineUser`
already wipe crypto-key-bound stores — extend the user-switch path to also clear
that prior user's `REFERENCE_STORE` entries (key-prefix sweep
`reference:{prevUserId}:*`) so plaintext ref data does not survive a logout.

**Migration:** `offlineBase.ts` switches its imports from
`cacheAnalyticsResponse`/`getCachedAnalyticsResponse` to
`cacheReadResponse`/`getReadCachedResponse`. `offlineValidator.ts` (which calls
the cache methods directly for its queue-fetch wrapper) is migrated to
`cacheReadResponse`/`getReadCachedResponse` too, removing its inline duplication.
Old method names removed (all callers are in-repo: `offlineBase.ts`,
`offlineValidator.ts`, 4 test files — all updated in this spec). Test files
`lib/__tests__/offlineStore.encryption.test.ts`, `lib/__tests__/offlineValidator.test.ts`,
`lib/__tests__/offlineAnalytics.test.ts`, `lib/api/__tests__/offlineAdmin.test.ts`
updated to the new names.

**Eviction triggers (directive 6, pushbacks P3/P4):**
- **Boot guard** — once per session on app boot, guarded by a `localStorage`
  timestamp (`wims:cachePruneAt`) so it runs at most every 1h (lowered from 6h
  — pushback P4: heavy parameterized sessions grow fast).
- **After each sync-batch completion** (existing sync-completion handler).
- **Every-N-writes (pushback P4)** — a `localStorage` write counter
  (`wims:cacheWriteCount`) increments on every `cacheReadResponse`/
  `cacheReferenceData` write; when it crosses 25, run a prune pass and reset.
  Bounds unbounded growth in long active sessions that never sync.
- **User-switch** — `setActiveOfflineUser` clears the prior user's
  `REFERENCE_STORE` prefix (pushback P1) on top of the existing crypto-key wipe.
All prune passes are per-record-TTL (pushback P3): a record is expired iff
`cachedAt + ttlMs < now`, using the record's own `ttlMs`. Best-effort
(`try/catch`, `console.warn`, never blocks reads/writes).

### Pattern (existing `offlineAware`, reused + extended)

`offlineBase.ts:offlineAware<T>(cacheKey, args, prefix, ttlMs, fetcher, errorMessage)`
stays the orchestrator for **encrypted** read caches. It currently hardcodes
`cacheReadResponse`/`getReadCachedResponse`. To support the unencrypted
reference path, add a sibling orchestrator or a flag:

```ts
export async function offlineAware<T>(cacheKey, args, prefix, ttlMs, fetcher, errorMessage): Promise<OfflineResult<T>>
  // encrypted (existing) — passes ttlMs into cacheReadResponse for per-record eviction

export async function offlineAwareReference<T>(cacheKey, args, prefix, ttlMs, userId, fetcher, errorMessage): Promise<OfflineResult<T>>
  // UNENCRYPTED — same control flow but uses cacheReferenceData/getCachedReferenceData.
  // userId REQUIRED (pushback P1): baked into the cache key so RLS-scoped ref data
  // is isolated per user in the unencrypted store.
```
Both share `shouldServeOffline`, `isNetworkError`, `markConnectivityOffline`,
`buildCacheKey`, `isFresh` (already in `offlineBase`). Only the store accessor +
userId namespacing differ. Behaviour identical to the existing `offlineAware`
(offline → fresh cache or throw; online → fetch + cache; network error → mark
offline + cache fallback). Pages obtain `userId` from `useAuth()` and pass it
into the reference wrappers.

### API abstraction first (directive 4)

Before wrapping, extract the two raw `apiFetch` calls into standard API
functions so the offline wrappers wrap a named function, not inline URL-building:

**Add to `lib/api/validator.ts` (or `legacy.ts` if that's where validator fns
live — verify during impl):**
```ts
export async function fetchOperationalMap(params: OperationalMapParams): Promise<MapClusterItem[]>
  // builds URLSearchParams, calls apiFetch('/api/validator/operational-map…')

export async function fetchValidatorAuditLogs(params: AuditLogParams): Promise<AuditResponse>
  // builds URLSearchParams, calls apiFetch('/api/regional/validator/audit-logs…')
```
Types (`OperationalMapParams`, `AuditLogParams`, `MapClusterItem`, `AuditResponse`)
extracted from the inline generics the pages currently use. The pages keep
working unchanged against the new fns; the offline wrappers wrap the new fns.

### New wrappers (12 total)

**Extend `lib/api/offlineAdmin.ts` (+6, prefix `admin`, encrypted, 60s/30min):**

| Wrapper | Wraps | TTL |
|---------|-------|-----|
| `fetchAdminSecurityLogsOfflineAware(params)` | `legacy.fetchAdminSecurityLogs` | 60s |
| `fetchSecurityLogsSummaryOfflineAware()` | `legacy.fetchSecurityLogsSummary` | 60s |
| `fetchAnomaliesOfflineAware(params)` | `legacy.fetchAnomalies` | 60s |
| `fetchBreachesOfflineAware()` | `breach.fetchBreaches` (new import `./breach`) | 60s |
| `fetchAdminConfigOfflineAware()` | `legacy.fetchAdminConfig` | 30min |
| `fetchRateLimitsOfflineAware()` | `legacy.fetchRateLimits` | 30min |

Re-export via `lib/api/admin.ts` / `index.ts`.

**Extend `lib/api/offlineValidator.ts` (+2, prefix `validator`, encrypted, 60s):**

| Wrapper | Wraps | TTL |
|---------|-------|-----|
| `fetchOperationalMapOfflineAware(params)` | new `validator.fetchOperationalMap` | 60s |
| `fetchValidatorAuditLogsOfflineAware(params)` | new `validator.fetchValidatorAuditLogs` | 60s |

**Extend `lib/api/offlineAnalytics.ts` (+1, prefix `analytics`, encrypted, 30min):**

| Wrapper | Wraps | TTL |
|---------|-------|-----|
| `fetchAnalystIncidentWildlandDetailOfflineAware(id)` | `legacy.fetchAnalystIncidentWildlandDetail` | 30min |

**New `lib/api/offlineReference.ts` (+3, prefix `reference`, UNENCRYPTED, 7 days, per-user):**

| Wrapper | Wraps | TTL | Store | Per-user |
|---------|-------|-----|-------|----------|
| `fetchRegionsOfflineAware(userId)` | `legacy.fetchRegions` | 7 days | REFERENCE_STORE | key `reference:{userId}:regions` |
| `fetchProvincesOfflineAware(userId, regionId)` | `legacy.fetchProvinces` | 7 days | REFERENCE_STORE | key `reference:{userId}:provinces:{regionId}` |
| `fetchCitiesOfflineAware(userId, provinceId)` | `legacy.fetchCities` | 7 days | REFERENCE_STORE | key `reference:{userId}:cities:{provinceId}` |

Uses `offlineAwareReference` (unencrypted, userId-namespaced — pushback P1).
Re-export from `lib/api/index.ts`. Call sites pass `userId` from `useAuth()`.

**TTL rationale:** 60s for operational/security/anomaly/breach/map/audit
(near-realtime, matches existing `ADMIN_CACHE_TTL_MS`). 30min for config,
rate-limits, wildland detail (stable/low-frequency, matches
`ANALYTICS_CACHE_TTL_MS`). **7 days for reference data** (geographical
reference changes rarely; non-sensitive so unencrypted; long TTL avoids
refetch on every dashboard load).

### Shared UI component (1 new)

`components/ui/StaleCacheBanner.tsx` — thin wrapper over existing
`components/ui/StickyBanner.tsx` (tone `amber`). Props:
`{ freshness?: { cachedAt?: number; isOnline: boolean }; message?: string }`.
Renders only when `freshness?.cachedAt != null`. Default message:
`Showing cached data — reconnect to refresh.` + ` from HH:MM:SS` (mirrors
validator `page.tsx:655` inline impl). Used by the 7 full-rewire pages.

### Page rewires (directive 5 — no `useAutoSync` anywhere here)

**Full rewire (7 pages):** swap read import → offline-aware, mount
`useNetworkStatus()` only (NOT `useAutoSync` — Scope A queues no writes on these
pages), render `<StaleCacheBanner>`, offline badge in header, friendly
"unavailable offline" state on cache-miss. Writes unchanged (online, not queued):
1. `app/admin/monitoring/page.tsx`
2. `app/admin/anomalies/page.tsx`
3. `app/admin/breach/page.tsx`
4. `app/admin/system/config/page.tsx`
5. `app/admin/system/rate-limits/page.tsx`
6. `app/dashboard/validator/map/page.tsx`
7. `app/dashboard/validator/audit/page.tsx`

**Read-only swap (5 pages):** replace `fetchRegions` (and provinces/cities where
present) with offline-aware equivalents; add `<StaleCacheBanner>` only where the
page already tracks `fromCache`/`cachedAt`. No `useAutoSync` added:
8. `app/dashboard/analyst/page.tsx` — `fetchRegions` → offline-aware (already
   mounts autosync for its own reasons — leave existing autosync as-is, do not
   add more)
9. `app/dashboard/analyst/[workflow]/page.tsx` — `fetchRegions` → offline-aware
10. `app/dashboard/analyst/incidents/[id]/wildland/page.tsx` — full rewire
    (wildland wrapper + `useNetworkStatus` + banner; **new page test file**)
11. `app/dashboard/page.tsx` (root) — `fetchRegions` + `fetchProvinces` +
    `fetchCities` → offline-aware
12. `app/admin/system/page.tsx` — `fetchRegions` → offline-aware (already
    mounts `useNetworkStatus`; no autosync change)

### Service worker (`public/sw.js`) — directive 5 (runtime, not precache)

**Drop:** the 7 admin/validator route additions from `urlsToCache` (prior draft).
The navigate handler (line 174) already runtime-caches every successful GET
(`cache.put(request, response.clone())`) and falls back to cached/shell/app-shell
on network failure. Role-specific routes self-populate on first online visit —
no install-time hardcoding.

**Keep — bump `CACHE_NAME`** `wims-bfp-cache-v11` → `v12` (the canonical-path
changes below alter navigation fallback behaviour; a cache bump ensures clients
adopt the new `canonicalPath` logic cleanly).

**Keep — canonical-path collapse for the 3 analyst `'use client'` dynamic route
families** (mirror existing regional incident pattern, `sw.js:49` +
`INCIDENT_DETAIL_SHELL = '/dashboard/regional/incidents/1'`):

```js
const ANALYST_DETAIL_SHELL = '/dashboard/analyst/incidents/1';
const WILDLAND_SHELL = '/dashboard/analyst/incidents/1/wildland';
const WORKFLOW_SHELL = '/dashboard/analyst/comparative'; // any valid slug; same 'use client' page
```
Valid workflow slugs (verified): `comparative`, `heatmap`, `trends`,
`response-time`, `top-n`, `incident-explorer`. Extend `canonicalPath()`:
- `/dashboard/analyst/incidents/<id>` → `/dashboard/analyst/incidents/__detail__`
- `/dashboard/analyst/incidents/<id>/wildland` →
  `/dashboard/analyst/incidents/__detail__/wildland`
- `/dashboard/analyst/<workflow>` (slug in valid set) →
  `/dashboard/analyst/__workflow__`

The 3 shells are added to `urlsToCache` — they are **fallback anchors** (like
the existing `INCIDENT_DETAIL_SHELL`), not hardcoding of role pages. Without
them, offline navigation to an unvisited analyst incident/workflow URL falls
back to `APP_SHELL`/`/` and the analyst `'use client'` page never mounts, so
the offline wrapper never runs. The actual role pages (admin/validator) are NOT
precached — they rely on the existing runtime navigate caching **plus** the
post-login role prefetch below.

**Role-scoped post-login prefetch (pushback P2):** pure runtime caching leaves a
user who goes offline before first-visiting `admin/monitoring` with a blank
page. Mitigation without precaching every role's pages for every user: after a
successful login, the app `postMessage`s the active role to the SW
(`{type:'PREFETCH_ROLE', role}`); the SW `fetch()`es only that role's route set
and `cache.put()`s them into `CACHE_NAME`:
- `SYSTEM_ADMIN` → the 5 admin routes + `/admin/system`.
- `NATIONAL_ANALYST` → `/dashboard/analyst`, the 6 workflow slugs, analyst
  detail/wildland shells.
- `NATIONAL_VALIDATOR` → `/dashboard/validator`, `/dashboard/validator/map`,
  `/dashboard/validator/audit`.
- `REGIONAL_ENCODER` → `/dashboard/regional` (+ already-precached shells).
Bounded cost (one role's ~5–8 pages), guaranteed offline availability for that
user after their first login. The prefetch is best-effort (`Promise.allSettled`);
a failed prefetch does not block login. Routes already in the cache are skipped
(`cache.match` before `fetch`).

Navigation-fallback block (`sw.js:174`) + RSC cache-key block (`sw.js:144`)
apply the same `canonicalPath()` mapping for both document and `/_rsc` requests,
as the regional path does today.

### Eviction (directive 6)

Defined behaviour for expired parameterized list-query entries (pushback P3 —
per-record TTL, not a shared cutoff):
- `evictExpiredReadCache()` scans `READ_CACHE_STORE`, deletes any record where
  `cachedAt + record.ttlMs < Date.now()` using the **record's own `ttlMs`**.
  A 60s security-logs entry is pruned at ~60s; a 30min config entry at ~30min.
  Records lacking `ttlMs` (back-compat from pre-v3 writes) get the longest TTL
  as a safe default so they are not wrongly evicted before the next online
  refresh overwrites them.
- `evictExpiredReferenceData()` scans `REFERENCE_STORE` with per-record `ttlMs`
  (7 days for ref entries).
- Prune pass is bounded: single IDB transaction, `cursor.delete()` per expired
  record, capped at a max-records-per-pass constant (e.g. 500) to avoid long
  transactions; remaining expired entries pruned on the next pass.
- Triggers: app-boot guard (≤1/h via `localStorage` timestamp) + after each
  sync-batch + every-25-writes counter (pushback P4) + user-switch prefix clear
  (pushback P1).
- Best-effort: `try/catch`, `console.warn` on failure, never throws to caller.

Read-time `isFresh` per-wrapper TTL remains the correctness gate — eviction is
storage reclamation, never the thing that decides whether a read is stale.

## Tests (TDD — red first)

**Storage layer (`lib/__tests__/offlineStore.*.test.ts`):**
- Update `offlineStore.encryption.test.ts` to new method names
  (`cacheReadResponse`/`getReadCachedResponse`).
- New/extend tests: `cacheReferenceData`/`getCachedReferenceData` round-trip
  stores data **unencrypted** (assert no `EncryptedPayload` shape, plaintext
  retrievable without a crypto key).
- **Per-user isolation test (pushback P1)** — write ref data under
  `reference:userA:*`, assert `getCachedReferenceData('reference:userB:*')`
  returns undefined; assert user-switch clears `reference:userA:*` prefix.
- `evictExpiredReadCache()` deletes records by **per-record `ttlMs`** (pushback
  P3): a 60s-TTL record is deleted at age 61s while a 30min-TTL record at age
  61s survives; returns deleted count; leaves fresh entries.
- `evictExpiredReferenceData()` same for reference store (7-day `ttlMs`).
- Eviction is best-effort (store open failure → warn, no throw).
- Every-N-writes trigger (pushback P4): after 25 writes the counter fires a
  prune (assert prune invoked once per 25 writes, not per write).
- DB upgrade v5→v6 creates `REFERENCE_STORE` without dropping existing stores.

**Wrappers (table-driven `describe.each` matrix, 5 cases each):**
For each `[wrapper, args, ttl, legacyMock, store]` row: (1) online → caches,
`fromCache:false`; (2) offline + fresh → returns cached; (3) offline + miss →
throws friendly error; (4) online network error → marks offline + cache
fallback; (5) stale (age > TTL) offline → treated as miss → throws.
- Extend `lib/api/__tests__/offlineAdmin.test.ts` (+6 admin wrappers). (Exists.)
- Extend `lib/__tests__/offlineValidator.test.ts` (+2 map/audit wrappers; file
  EXISTS — also migrates existing #269 wrapper tests to new cache method names).
- Extend `lib/__tests__/offlineAnalytics.test.ts` (+1 wildland wrapper). (Exists.)
- **New** `lib/__tests__/offlineReference.test.ts` (+3 ref wrappers; asserts
  unencrypted store path + 7-day TTL freshness window + **userId namespacing**
  so userA's regions are not returned for userB's key).

**SW (`__tests__/sw-cache-key.test.ts`):**
- `offlineNavigationFallbackKeys` for analyst detail/wildland/workflow URLs
  return the respective shell before the generic dashboard.
- `canonicalPath` (replicated helper) collapses the 3 new route families.
- Assert `CACHE_NAME === 'wims-bfp-cache-v12'`.
- **Do NOT** assert the 7 admin/validator routes in `urlsToCache` (they are
  runtime-cached, not precached — asserting presence would be wrong).
- Assert the 3 analyst shells ARE in `urlsToCache` (fallback anchors).
- **Role-prefetch (pushback P2)** — new test: a `PREFETCH_ROLE` message for each
  role asserts the SW fetches that role's route set (mock `fetch`/`cache.put`)
  and skips already-cached routes; failed prefetch does not reject.

**API abstraction (`lib/__tests__/` or `lib/api/__tests__/`):**
- New tests for `fetchOperationalMap` + `fetchValidatorAuditLogs` building the
  correct URLSearchParams + calling `apiFetch` (pure, no cache).

**Page tests:**
- 7 full-rewire pages: mock new offline wrappers + `useNetworkStatus` online
  (operations-board mock pattern, PWA wiki test pattern #7). One offline-render
  test/page asserting banner + cached data + cache-miss friendly state. **Do
  not** mock `useAutoSync` (not mounted).
- **New** `app/dashboard/analyst/incidents/[id]/wildland/wildland.test.tsx`
  (no test today): online happy-path + offline cached-render + cache-miss state.
- Existing page tests mocking `@/lib/api/legacy` (`admin/monitoring`,
  `admin/anomalies`, `admin/breach`, `admin/system/config`,
  `admin/system/rate-limits`) updated to mock offline-aware wrappers.
- `dashboard/page.test.tsx`, `admin/system/page.tsx` tests add
  `fetchRegionsOfflineAware` (+ provinces/cities) mocks.

### Wiki + CI
- Update `system-wiki/architecture/pwa-tests-cicd.md`: new wrapper inventory,
  storage refactor (generic methods + `REFERENCE_STORE` unencrypted + eviction),
  `StaleCacheBanner`, SW runtime-vs-precache policy, `useAutoSync`-only-where-
  writes rule.
- Append `system-wiki/log.md`.
- Review `system-wiki/gaps/frs-codebase-gap-register.md` (FRS M2 offline-first).
- CI pre-flight: `cd src/frontend && npm run lint && npx vitest run &&
  npm run build` with `NEXT_PUBLIC_AUTH_API_URL` + `NEXT_PUBLIC_BASE_URL` set.

## Implementation Order (TDD)

1. **Storage refactor** — new generic methods + `REFERENCE_STORE` + DB v6
   upgrade + eviction fns + `offlineStore` tests (red first). Migrate
   `offlineBase` + `offlineValidator` direct cache calls. Update existing test
   files to new names. (Foundational — unblocks all wrappers.)
2. **`offlineAwareReference`** orchestrator in `offlineBase` + test.
3. **API abstraction** — `fetchOperationalMap` + `fetchValidatorAuditLogs` in
   `validator.ts` + tests.
4. **Reference wrappers** (`offlineReference.ts`) + `offlineReference.test.ts`.
5. **Analyst wildland wrapper** + extend `offlineAnalytics.test.ts` + new
   wildland page test.
6. **Validator map/audit wrappers** + extend `offlineValidator.test.ts`.
7. **Admin 6 wrappers** + extend `offlineAdmin.test.ts`.
8. **`StaleCacheBanner.tsx`** + unit test.
9. **SW** — bump cache, canonicalPath collapse + 3 shells, extend
   `sw-cache-key.test.ts` (red first).
10. **Page rewires** (7 full, then 5 swap) + update existing page-test mocks.
11. **Eviction wiring** — boot guard (≤1/h) + sync-completion + every-25-writes
    counter + user-switch prefix clear.
12. **SW role prefetch** — `postMessage` role on login + SW route-set prefetch.
13. **Wiki + CI pre-flight.**

## Risks

- **DB version bump 5→6** must create `REFERENCE_STORE` in `upgrade()` without
  dropping existing stores/data. Mitigation: only `db.createObjectStore` for the
  new store in the `oldVersion < 6` branch; test the upgrade path.
- **Renaming `cacheAnalyticsResponse`** touches `offlineValidator.ts` direct
  calls + 4 test files. All in-repo; migration is mechanical but must be
  complete or compile breaks. Mitigation: do step 1 as one atomic commit, run
  `vitest` + `tsc` immediately.
- **`sw.js` canonicalPath surgery** is delicate (RSC keys + nav fallback
  interdependent). Mitigation: mirror regional pattern exactly; extend
  `sw-cache-key.test.ts` red-first.
- **`fetchAdminSecurityLogs` returns `{items, total}`** (not bare array) —
  wrapper generic `T` must be `{items:any[]; total:number}`.
- **Breach page `fetchAdminConfig` for NPC config** reuses
  `fetchAdminConfigOfflineAware` (30min) — no duplicate wrapper.
- **Eviction per-record TTL (pushback P3)** — shared `READ_CACHE_STORE` holds
  mixed-TTL entries; each record carries its own `ttlMs` so a 60s entry prunes
  at ~60s and a 30min entry at ~30min. Pre-v3 records without `ttlMs` get the
  longest TTL as a safe back-compat default so they are not wrongly evicted
  before the next online refresh overwrites them. Read-time `isFresh` per-wrapper
  TTL remains the correctness gate.
- **`useAutoSync` non-goal trap** — do NOT add autosync to the 7 full-rewire
  pages even though some have online write buttons; Scope A queues nothing.
- **Reference data staleness (pushback P5, accepted)** — 7-day TTL means if an
  admin reassigns regions or edits geography, a given user may see stale ref
  data up to 7 days. PH administrative geography changes rarely, so this is
  acceptable. Mitigation: explicit refresh buttons (already on most ref-using
  pages) force an online refetch that overwrites the cache; on reconnect the
  next online read refreshes automatically. No spec change beyond this note.
- **Unencrypted ref store per-user isolation (pushback P1)** — correctness
  depends on every reference cache key embedding `userId` AND on the user-switch
  path clearing the prior user's `reference:{prevUserId}:*` prefix. If either is
  missed, user B can read user A's RLS-scoped region set off disk. Mitigation:
  a dedicated test asserts two synthetic users' ref caches are isolated and
  that user-switch wipes the prior user's prefix.

## Acceptance

- Generic storage methods `cacheReadResponse`/`getReadCachedResponse`/
  `cacheReferenceData`/`getCachedReferenceData`/`evictExpiredReadCache`/
  `evictExpiredReferenceData` exist (per-record `ttlMs`); old `cacheAnalyticsResponse`
  names removed; `offlineBase` + `offlineValidator` migrated; `REFERENCE_STORE`
  (unencrypted, per-user namespaced) created via DB v6 upgrade.
- 12 offline-aware wrappers exist (admin×6, validator×2, analyst×1, reference×3)
  with TTLs per table; reference wrappers use unencrypted 7-day store with
  `userId` in every cache key.
- `fetchOperationalMap` + `fetchValidatorAuditLogs` API functions exist; the 2
  validator wrappers wrap them (no inline `apiFetch`/`URLSearchParams` in the
  wrapper).
- 7 full-rewire pages render cached data offline with `StaleCacheBanner` + cache-
  miss state; mount `useNetworkStatus` but NOT `useAutoSync`.
- 5 swap pages use offline-aware ref/config reads (passing `userId` for ref).
- `sw.js`: `CACHE_NAME` v12; canonicalPath collapses the 3 analyst dynamic
  families; 3 shells in `urlsToCache`; **no** admin/validator page routes in
  `urlsToCache` (runtime-cached + post-login role prefetch).
- Role prefetch: SW handles `PREFETCH_ROLE` message, fetches the active role's
  route set on login, skips cached routes, best-effort.
- Eviction runs on boot (≤1/h) + after sync + every 25 writes + on user-switch;
  per-record `ttlMs` so 60s entries prune at ~60s; best-effort, non-blocking.
  User-switch clears prior user's `reference:{prevUserId}:*` prefix.
- `npx vitest run` green; `npm run lint` green; `npm run build` green (env set).
- `system-wiki/architecture/pwa-tests-cicd.md` + `log.md` updated.
