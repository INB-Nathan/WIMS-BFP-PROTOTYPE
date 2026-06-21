# Offline Caching for Every Role — Design Spec

**Date:** 2026-06-21
**Status:** Draft — pending user review
**Scope:** Frontend read-cache (offline-first) completion across all roles

## Problem

The frontend already has an offline-first stack (encrypted IndexedDB cache via
`offlineStore`, connectivity snapshot, sync engine, service worker). Read-cache
wrappers exist for:

- **Encoder** — `offlineRegional.ts` (incident list + detail)
- **Analyst** — `offlineAnalytics.ts` (9 wrappers: heatmap, trends, comparative,
  type-distribution, response-time, top-N, filter-options, incident detail,
  incident sensitive)
- **Validator** — `offlineValidator.ts` (queue fetch, verify, archive/unarchive)
- **Admin (partial)** — `offlineAdmin.ts` (system-health, system-metrics,
  worker-status, active-sessions, audit-logs)

Several read surfaces across **all** roles still call online-only `legacy` /
`apiFetch` with no cache fallback. Offline navigation to several `'use client'`
dynamic pages falls through to the generic service-worker "Offline content
unavailable" page, so even where data wrappers exist the page never mounts and
the wrappers never run.

**Verified gaps (read-only, online-only today):**

| # | Surface | File | Read call(s) |
|---|---------|------|--------------|
| 1 | Admin security monitoring | `app/admin/monitoring/page.tsx` | `fetchAdminSecurityLogs(params)`, `fetchSecurityLogsSummary()` |
| 2 | Admin anomalies | `app/admin/anomalies/page.tsx` | `fetchAnomalies(params)` |
| 3 | Admin breach | `app/admin/breach/page.tsx` | `fetchBreaches()`, `fetchAdminConfig()` (NPC cfg) |
| 4 | Admin system config | `app/admin/system/config/page.tsx` | `fetchAdminConfig()` |
| 5 | Admin rate-limits | `app/admin/system/rate-limits/page.tsx` | `fetchRateLimits()` |
| 6 | Validator operational map | `app/dashboard/validator/map/page.tsx` | `apiFetch('/api/validator/operational-map…')` |
| 7 | Validator audit logs | `app/dashboard/validator/audit/page.tsx` | `apiFetch('/api/regional/validator/audit-logs…')` |
| 8 | Analyst wildland detail | `app/dashboard/analyst/incidents/[id]/wildland/page.tsx` | `fetchAnalystIncidentWildlandDetail(id)` |
| 9 | Reference data (regions/provinces/cities) | `app/dashboard/page.tsx`, `app/admin/system/page.tsx`, `app/dashboard/analyst/page.tsx`, `app/dashboard/analyst/[workflow]/page.tsx` | `fetchRegions()`, `fetchProvinces(regionId)`, `fetchCities(provinceId)` |

**Service-worker gaps (offline navigation):**

`sw.js` `canonicalPath()` collapses only `/dashboard/regional/incidents/<id>`
to a single detail shell. These `'use client'` dynamic pages have no collapse,
so offline navigation hits the generic fallback instead of mounting the page:
- `/dashboard/analyst/<workflow>` (valid slugs: `comparative`, `heatmap`,
  `trends`, `response-time`, `top-n`, `incident-explorer`)
- `/dashboard/analyst/incidents/<id>` (analyst incident detail)
- `/dashboard/analyst/incidents/<id>/wildland`

None of the new static admin/validator routes are in `urlsToCache`.

## Goal

Apply encrypted read-cache to every remaining online-only read surface so all
four roles can view their data offline, and make offline navigation reliable for
the affected pages. **Write/mutation operations stay online** (Scope A — admin
security actions, anomaly status updates, breach updates, config updates,
rate-limit updates, validator analyze/export are NOT queued).

## Non-Goals

- Offline write-queueing for admin mutations (Scope B — rejected: replaying
  config/security mutations later is risky and out of scope).
- Encoder sub-pages (`/dashboard/regional/conflicts`, `/dashboard/regional/audit`)
  — not in the gap set.
- Re-auditing already-cached surfaces (encoder regional, analyst 9 wrappers,
  validator verify/archive/queue, admin health/metrics/workers/sessions/audit).
- Retrofitting the inline stale-cache banners in `analyst/page.tsx` and
  `validator/page.tsx` to the new shared component (optional, scope creep).

## Architecture

### Pattern (existing, reused)

All new wrappers route through the shared orchestrator in `offlineBase.ts`:

```ts
offlineAware<T>(cacheKey, args, prefix, ttlMs, fetcher, errorMessage)
  -> OfflineResult<T> = { response, fromCache, cachedAt? }
```

Behaviour (already implemented, verified `offlineBase.ts:156`):
1. `shouldServeOffline()` (connectivity snapshot offline OR `navigator.onLine === false`)
   → return fresh cache or throw friendly `errorMessage` on miss/stale.
2. Online → call `fetcher()`, write encrypted cache, return `{fromCache:false}`.
3. Network-style error (`TypeError`, `ERR_*`, `Failed to fetch`, `NetworkError`,
   `net::ERR`) → `markConnectivityOffline()` + fall back to fresh cache or throw.

Cache keys: `buildCacheKey(prefix, cacheKey, args)` → deterministic, sorted,
`encodeURIComponent(stableStringify(args))`. Storage: `offlineStore`
`cacheAnalyticsResponse` / `getCachedAnalyticsResponse` (encrypted, per-user
key isolation).

### New wrappers (12 total)

**Extend `lib/api/offlineAdmin.ts` (+6, prefix `admin`):**

| Wrapper | Wraps | TTL |
|---------|-------|-----|
| `fetchAdminSecurityLogsOfflineAware(params)` | `legacy.fetchAdminSecurityLogs` | 60s |
| `fetchSecurityLogsSummaryOfflineAware()` | `legacy.fetchSecurityLogsSummary` | 60s |
| `fetchAnomaliesOfflineAware(params)` | `legacy.fetchAnomalies` | 60s |
| `fetchBreachesOfflineAware()` | `breach.fetchBreaches` (new import `./breach`) | 60s |
| `fetchAdminConfigOfflineAware()` | `legacy.fetchAdminConfig` | 30min |
| `fetchRateLimitsOfflineAware()` | `legacy.fetchRateLimits` | 30min |

Re-export from `lib/api/admin.ts` (current admin re-export hub) and/or `index.ts`
where pages import.

**Extend `lib/api/offlineValidator.ts` (+2, prefix `validator`):**

| Wrapper | Wraps | TTL |
|---------|-------|-----|
| `fetchOperationalMapOfflineAware(params)` | inline `apiFetch('/api/validator/operational-map…')` | 60s |
| `fetchValidatorAuditLogsOfflineAware(params)` | inline `apiFetch('/api/regional/validator/audit-logs…')` | 60s |

(Both pages currently call `apiFetch` directly with `URLSearchParams`; the
wrapper accepts a params object, builds the query, and calls `apiFetch`.)

**Extend `lib/api/offlineAnalytics.ts` (+1, prefix `analytics`):**

| Wrapper | Wraps | TTL |
|---------|-------|-----|
| `fetchAnalystIncidentWildlandDetailOfflineAware(id)` | `legacy.fetchAnalystIncidentWildlandDetail` | 30min (matches analyst incident detail) |

**New `lib/api/offlineReference.ts` (+3, prefix `reference`):**

| Wrapper | Wraps | TTL |
|---------|-------|-----|
| `fetchRegionsOfflineAware()` | `legacy.fetchRegions` | 30min (stable ref) |
| `fetchProvincesOfflineAware(regionId)` | `legacy.fetchProvinces` | 30min |
| `fetchCitiesOfflineAware(provinceId)` | `legacy.fetchCities` | 30min |

Rationale: `reference.ts` already re-exports the plain legacy ref fns; the new
offline-aware variants live in a sibling `offlineReference.ts` to mirror the
`offlineAdmin`/`offlineAnalytics`/`offlineValidator` naming convention and keep
`reference.ts` unchanged. Re-export from `lib/api/index.ts`.

**TTL rationale:** 60s for operational/security/anomaly/breach/map/audit
(near-realtime surfaces — stale data is acceptable for a short offline window
but should refresh promptly on reconnect, matching existing
`ADMIN_CACHE_TTL_MS = 60_000`). 30min for config, rate-limits, reference data,
wildland detail (stable / low-frequency — matches existing
`ANALYTICS_CACHE_TTL_MS = 30 * 60 * 1000`).

### Shared UI component (1 new)

`components/ui/StaleCacheBanner.tsx` — thin wrapper over existing
`components/ui/StickyBanner.tsx` (tone `amber`). Props:

```ts
{ freshness?: { cachedAt?: number; isOnline: boolean }; message?: string }
```

Renders only when `freshness?.cachedAt != null` (served from cache). Default
message: `Showing cached data — reconnect to refresh.` + ` from HH:MM:SS` when
`cachedAt` present (mirrors validator `page.tsx:655` inline impl).

Used by the 7 new full-rewire pages. (Existing inline banners in
`analyst/page.tsx` and `validator/page.tsx` are left as-is — non-goal.)

### Page rewires

**Full rewire (7 pages) — swap read import → offline-aware, mount
`useNetworkStatus()` + `useAutoSync()`, render `<StaleCacheBanner>`, add offline
badge in header, render friendly "unavailable offline" state on cache-miss
error. Writes unchanged (online):**

1. `app/admin/monitoring/page.tsx` — security logs + summary
2. `app/admin/anomalies/page.tsx` — anomalies list
3. `app/admin/breach/page.tsx` — breach list + NPC config (both via wrappers)
4. `app/admin/system/config/page.tsx` — config list
5. `app/admin/system/rate-limits/page.tsx` — rate-limit config
6. `app/dashboard/validator/map/page.tsx` — operational map
7. `app/dashboard/validator/audit/page.tsx` — audit logs

**Read-only swap (5 pages) — replace `fetchRegions` (and provinces/cities where
present) with offline-aware equivalents; add `<StaleCacheBanner>` only if the
page already tracks `fromCache`/`cachedAt` (minimal churn):**

8. `app/dashboard/analyst/page.tsx` — `fetchRegions` → offline-aware
9. `app/dashboard/analyst/[workflow]/page.tsx` — `fetchRegions` → offline-aware
   (already uses offline wrappers for heatmap/trends/etc. + inline banner)
10. `app/dashboard/analyst/incidents/[id]/wildland/page.tsx` — full rewire
    (wildland detail wrapper + `useNetworkStatus` + banner; **new page test
    file** — none exists today)
11. `app/dashboard/page.tsx` (root) — `fetchRegions` + `fetchProvinces` +
    `fetchCities` → offline-aware
12. `app/admin/system/page.tsx` — `fetchRegions` → offline-aware (page already
    mounts `useNetworkStatus`/`useAutoSync` and uses `offlineAdmin` wrappers for
    health/metrics)

### Service worker (`public/sw.js`)

1. Bump `CACHE_NAME` `wims-bfp-cache-v11` → `wims-bfp-cache-v12` (forces
   clients to drop the old precache list and adopt the new one).
2. Add static routes to `urlsToCache`:
   - `/admin/monitoring`
   - `/admin/anomalies`
   - `/admin/breach`
   - `/admin/system/config`
   - `/admin/system/rate-limits`
   - `/dashboard/validator/map`
   - `/dashboard/validator/audit`
3. Add canonical-path collapse for the 3 analyst `'use client'` dynamic routes,
   mirroring the existing regional incident-detail pattern
   (`INCIDENT_DETAIL_SHELL = '/dashboard/regional/incidents/1'`):

```js
const ANALYST_DETAIL_SHELL = '/dashboard/analyst/incidents/1';
const WILDLAND_SHELL = '/dashboard/analyst/incidents/1/wildland';
const WORKFLOW_SHELL = '/dashboard/analyst/comparative'; // any valid slug; same 'use client' page
```

Extend `canonicalPath()` so:
- `/dashboard/analyst/incidents/<id>` → `/dashboard/analyst/incidents/__detail__`
  (cache key + navigation fallback to `ANALYST_DETAIL_SHELL`)
- `/dashboard/analyst/incidents/<id>/wildland` →
  `/dashboard/analyst/incidents/__detail__/wildland` (fallback `WILDLAND_SHELL`)
- `/dashboard/analyst/<workflow>` (where `<workflow>` ∈ the valid slug set) →
  `/dashboard/analyst/__workflow__` (fallback `WORKFLOW_SHELL`)

Add `ANALYST_DETAIL_SHELL`, `WILDLAND_SHELL`, `WORKFLOW_SHELL` to `urlsToCache`.

Navigation-fallback logic (the block around `sw.js:159`/`192`) and RSC cache-key
logic (`sw.js:144`) must apply the same `canonicalPath()` mapping consistently
for both document and `/_rsc` requests, exactly as the regional incident path
does today.

### Tests (TDD — red first)

**Unit — wrappers (table-driven `describe.each` matrix):**

For each wrapper matrix row `[wrapper, args, ttl, legacyMock]`, assert 5 cases:
1. Online success → caches response, returns `{fromCache:false}`.
2. Offline + fresh cache → returns cached `{fromCache:true, cachedAt}`.
3. Offline + cache miss → throws friendly `errorMessage`.
4. Online network error → `markConnectivityOffline` called + returns fresh cache
   (or throws if no cache).
5. Stale cache (age > TTL) while offline → treated as miss → throws.

Files:
- Extend `lib/api/__tests__/offlineAdmin.test.ts` (+6 wrappers). (File exists.)
- **New** `lib/api/__tests__/offlineValidator.test.ts` (+2 wrappers; file does
  NOT exist today — also backfills coverage for the existing #269 verify/archive
  wrappers using the same matrix.)
- Extend `lib/api/__tests__/offlineAnalytics.test.ts` (+1 wildland wrapper). If
  no such file exists, create it.
- **New** `lib/api/__tests__/offlineReference.test.ts` (+3 ref wrappers).

**Unit — SW canonical path + precache:**
- `__tests__/sw-cache-key.test.ts` — extend with:
  - `offlineNavigationFallbackKeys` for analyst detail / wildland / workflow
    URLs return the respective shell before the generic dashboard.
  - `canonicalPath` (replicated helper, as the test already does for regional)
    collapses the 3 new route families.
  - Assert `urlsToCache` (replicated list) includes the 7 new static routes +
    3 shells.
  - Assert `CACHE_NAME` constant is `wims-bfp-cache-v12`.
  (Test does NOT currently assert `CACHE_NAME` or `urlsToCache` — verified; these
  are new assertions, not edits to existing ones.)

**Page tests:**
- For the 7 full-rewire pages: mock the new offline wrappers and
  `useNetworkStatus` as online (mirror the operations-board mock pattern, PWA
  wiki test pattern #7). Add one offline-render test per page asserting the
  stale-cache banner renders and cached data is shown.
- **New** `app/dashboard/analyst/incidents/[id]/wildland/wildland.test.tsx`
  (page has no test today): online happy-path + offline cached-render +
  offline cache-miss friendly state.
- Existing page tests that mock `@/lib/api/legacy` (`admin/monitoring`,
  `admin/anomalies`, `admin/breach`, `admin/system/config`,
  `admin/system/rate-limits`) must update mocks to the offline-aware wrappers
  (or keep legacy mock + add offline-wrapper mock) so they still pass.
- `dashboard/page.test.tsx`, `admin/system/page.tsx` tests that mock
  `fetchRegions` add `fetchRegionsOfflineAware` mock.

### Wiki + CI

- Update `system-wiki/architecture/pwa-tests-cicd.md` with the new wrapper
  inventory, new `offlineReference.ts`, `StaleCacheBanner`, and SW route/collapse
  additions.
- Append `system-wiki/log.md` entry.
- Review `system-wiki/gaps/frs-codebase-gap-register.md` — update only if this
  closes/creates an FRS/codebase gap (FRS M2 offline-first coverage).
- CI pre-flight before done: `cd src/frontend && npm run lint && npx vitest run
  && npm run build` with `NEXT_PUBLIC_AUTH_API_URL` and
  `NEXT_PUBLIC_BASE_URL` env vars set (per `AGENTS.md`).

## Implementation Order (TDD)

1. `StaleCacheBanner.tsx` + unit test (small, reusable, unblocks pages).
2. Reference wrappers + `offlineReference.test.ts` (cross-role foundation).
3. Analyst wildland wrapper + extend `offlineAnalytics.test.ts` + new wildland
   page test.
4. Validator map/audit wrappers + new `offlineValidator.test.ts`.
5. Admin 6 wrappers + extend `offlineAdmin.test.ts`.
6. SW: bump cache, add routes + shells, extend `sw-cache-key.test.ts`.
7. Page rewires (full 7, then swap 5) + update existing page-test mocks.
8. Wiki updates + CI pre-flight.

## Risks

- **`sw.js` surgery is delicate** (RSC cache keys + navigation fallback are
  interdependent). Mitigation: mirror the existing regional incident collapse
  exactly; extend the dedicated `sw-cache-key.test.ts` first (red), then edit
  `sw.js`.
- **`fetchAdminSecurityLogs` returns `{items, total}`** (not a bare array) —
  wrapper generic `T` must be `{items:any[]; total:number}`, not `any[]`.
- **Breach page calls `fetchAdminConfig` for NPC config** — reuse the same
  `fetchAdminConfigOfflineAware` wrapper (30min) as the config page; do not
  duplicate.
- **Existing page tests mock `@/lib/api/legacy`** — rewiring imports will break
  those mocks unless updated. Addressed in test plan.
- **`describe.each` matrix** must stub `connectivity` snapshot + IndexedDB
  helpers (`getCachedAnalyticsResponse`, `cacheAnalyticsResponse`) per case,
  matching how `offlineAdmin.test.ts` already does it.

## Acceptance

- All 12 offline-aware wrappers exist with TTLs per table and are re-exported
  from `@/lib/api`.
- The 7 full-rewire pages render cached data offline with a stale-cache banner
  and a friendly cache-miss state.
- The 5 swap pages use offline-aware ref/admin-config reads.
- `sw.js` precaches the 7 new static routes + 3 analyst shells and collapses
  the 3 analyst dynamic route families; `CACHE_NAME` is `v12`.
- `npx vitest run` green (new + updated tests).
- `npm run lint` green; `npm run build` green (env vars set).
- `system-wiki/architecture/pwa-tests-cicd.md` + `log.md` updated.
