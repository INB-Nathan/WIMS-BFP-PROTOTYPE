---
title: Frontend Infrastructure
created: 2026-05-16
updated: 2026-06-22
type: frontend
tags: [wims-bfp, frontend, components, api-client, auth, utilities, offline-first]
sources: [src/frontend/src/app/globals.css, src/frontend/src/context/AuthContext.tsx, src/frontend/src/lib/api.ts, src/frontend/src/lib/afor-utils.ts, src/frontend/src/lib/ph-regions.ts, src/frontend/src/lib/regional-incidents.ts, src/frontend/src/lib/analyst-workflow-transfer.ts, src/frontend/src/lib/edgeFunctions.ts, src/frontend/src/types/api.ts, src/frontend/src/lib/offlineStore.ts, src/frontend/src/lib/api/offlineBase.ts, src/frontend/src/lib/api/offlineAdmin.ts, src/frontend/src/lib/api/offlineAnalytics.ts, src/frontend/src/lib/api/offlineValidator.ts, src/frontend/src/lib/api/offlineReference.ts, src/frontend/public/sw.js, src/frontend/src/components/ui/StaleCacheBanner.tsx]
status: verified
---

# Frontend Infrastructure

## Global Presentation

**File:** `src/frontend/src/app/globals.css`

The application body applies a 90% `zoom` baseline so the authenticated dashboard surfaces fit more operational content on screen without requiring each user to manually adjust browser zoom.

## Auth Context

**File:** `src/frontend/src/context/AuthContext.tsx`

OIDC-based authentication wrapping Keycloak via `oidc-client-ts`. Provides session management with proactive token refresh (4-min interval via `navigator.locks`) and visibility-based cookie rotation.

**Exports:**

| Export | Kind | Description |
|---|---|---|
| `User` | Interface | `{ id, sub?, email?, preferred_username?, role?, assignedRegionId? }` |
| `AuthContextValue` | Interface | `{ user, isAuthenticated, loading, loggingOut, login, logout, refreshSession }` |
| `AuthProvider` | Component (default) | Wraps children with `AuthContext.Provider`. On mount calls `fetchSession()`. Sets up proactive refresh via `setInterval` (4 min) + `visibilitychange` listener |
| `useAuth()` | Hook | Returns `AuthContextValue`; throws if used outside `AuthProvider` |

**Key mechanics:**
- `createUserManager()` resolves localhost auth through the browser origin `/auth` proxy when the configured Keycloak URL points at `localhost:8080`; this avoids browser-side PKCE token exchange CORS failures when the app is served from `https://localhost`.
- `PROACTIVE_REFRESH_INTERVAL_MS = 240000` (4 min) — fires before 5-min access token expiry
- `REFRESH_LOCK_NAME = 'wims:auth:refresh_lock'` — cross-tab coordination via `navigator.locks`
- Logout clears OIDC state, calls `POST /api/auth/logout`, redirects to Keycloak `signoutRedirect` with `id_token_hint`
- `refreshAccessToken` — acquires a navigator lock then `POST /api/auth/refresh`. Ensures only one tab refreshes at a time (prevents `refreshTokenMaxReuse:0` race)
- `fetchSession` — calls `GET /api/auth/session`. On 401, attempts refresh then retries once
- `GET /api/auth/session` is a Next.js route handler that forwards browser cookies to backend `/api/user/me`; its `BACKEND_URL` value is treated as an origin and route paths append `/api/...` explicitly.
- `POST /api/auth/refresh` uses a server-only Keycloak origin (`AUTH_SERVER_URL`, `KEYCLOAK_INTERNAL_URL`, or `NEXT_PUBLIC_AUTH_INTERNAL_URL`) for token refresh. Browser-facing `NEXT_PUBLIC_AUTH_API_URL=/auth` remains relative for nginx/proxy access but is not valid for server-side `fetch()` inside the frontend container.
- Local Docker builds inline `NEXT_PUBLIC_API_URL=/api`; authenticated and public API clients therefore use same-origin requests under `https://localhost` instead of `http://localhost/api`.
- Keycloak startup imports `src/keycloak/import/bfp-realm.json` for the application realm. Because Keycloak creates the `master` realm before import and skips `master-realm.json`, the one-shot `keycloak-bootstrap` service runs `src/keycloak/bootstrap/bootstrap-master-realm.sh` after Keycloak is healthy to patch the master realm admin console redirects.

---

## Data Fetching Pattern (known gap)

**Status:** No caching layer — see [[gaps/ui-ux-gap-register]] P-01.

All dashboard pages fetch data via plain `useEffect` + `useCallback` chains. There is no client-side caching library (no React Query / SWR / TanStack Query). The consequence is:

- Next.js App Router unmounts/remounts page components on every route change. Each remount re-runs all `useEffect` data-fetch hooks, firing fresh API calls even if the user just visited the same page seconds ago.
- Pages block content render behind a local `loading: true` state until all API calls resolve (typically 300 ms–2 s on a local dev stack).
- The analyst dashboard is the worst case: `Promise.all` with 7 concurrent calls fires on every mount (`analyst/page.tsx:321-340`).

**Recommended fix:** Replace `useCallback` fetch patterns in each dashboard page with `useQuery` from TanStack Query. A `staleTime` of 60 s means revisiting a tab within a minute renders instantly from cache with a silent background refetch. No API slice changes required — `apiFetch` continues to be the transport.

---

## API Client

**Files:** `src/frontend/src/lib/api.ts`, `src/frontend/src/lib/api/`

The API client is split into domain slices with a compatibility barrel. `src/frontend/src/lib/api.ts` re-exports `src/frontend/src/lib/api/index.ts` so existing `@/lib/api` imports continue to work.

### API Slice Layout

| File | Purpose |
|---|---|
| `api/transport.ts` | Authenticated `apiFetch`, `API_BASE`, `ApiRequestError`, error extraction, cookie credentials, refresh retry, FormData handling |
| `api/public-transport.ts` | Zero-auth `publicApiFetch` with `credentials: 'omit'` |
| `api/errors.ts` | Error utility re-exports |
| `api/civilian.ts` | Public civilian reporting/tracking/notification exports |
| `api/triage.ts` | Validator triage queue and cluster workflow exports |
| `api/analytics.ts` | Analyst analytics, exports, incident-list exports, and offline-aware read wrapper exports |
| `api/regional.ts` | Regional encoder incidents, drafts, AFOR import/commit, duplicate checks |
| `api/admin.ts` | Admin/user/session/security/audit exports, including admin monitoring offline-aware wrappers |
| `api/offlineAdmin.ts` | Offline-aware admin monitoring read wrappers for health, metrics, worker status, active sessions, and audit logs |
| `api/reference.ts` | Reference data and nearby-station exports |
| `api/validator.ts` | Validator-oriented compatibility exports + offline-aware action wrappers |
| `api/offlineBase.ts` | Shared offline API helpers extracted from `offlineAdmin.ts`, `offlineAnalytics.ts`, and `offlineValidator.ts` — provides `OfflineResult<T>`, `offlineAware()` (encrypted), `offlineAwareReference()` (unencrypted, userId-namespaced), `isNetworkError`, `stableStringify`, `shouldServeOffline`, `readFreshCacheOrThrow`, `readFreshReferenceCacheOrThrow`, cache helpers |
| `api/offlineValidator.ts` | Offline-aware validator queue fetch, verification, and archive/unarchive wrappers returning `{ queued, localId }` or `{ response, fromCache, cachedAt? }` |
| `api/legacy.ts` | Temporary implementation holder during migration; new code should prefer domain slices |
| `api/offlineReference.ts` | Offline-aware unencrypted reference wrappers (`fetchRegionsOfflineAware`, `fetchProvincesOfflineAware`, `fetchCitiesOfflineAware`); 7-day TTL; `REFERENCE_STORE` with userId-namespaced keys |

Public civilian functions use `publicApiFetch` and do not call authenticated `apiFetch`.

**Core helper:**

| Function | Signature | Purpose |
|---|---|---|
| `apiFetch<T>(path, options?)` | `(path, options?) => Promise<T>` | Authenticated fetch wrapper. Normalizes path, sets JSON Content-Type (except FormData), handles 401 with auto-refresh retry |
| `publicApiFetch<T>(path, options?)` | `(path, options?) => Promise<T>` | Public/DMZ fetch wrapper. Always sends `credentials: 'omit'` |

### Incident CRUD Functions (18)

| Function | Method | Path | Purpose |
|---|---|---|---|
| `fetchIncidents(params?)` | GET | `/incidents` | Fetch incidents list with optional filters |
| `fetchIncident(id)` | GET | `/incidents/{id}` | Fetch single incident detail |
| `createIncident(payload)` | POST | `/incidents` | Create incident (geospatial intake) |
| `fetchRegionalIncidents(params?)` | GET | `/regional/incidents` | Fetch regional incidents (paginated) |
| `fetchRegionalIncident(id)` | GET | `/regional/incidents/{id}` | Fetch single regional incident |
| `createRegionalIncident(body, opts?)` | POST | `/regional/incidents` | Create regional incident |
| `updateRegionalIncident(id, body)` | PUT | `/regional/incidents/{id}` | Update regional incident |
| `submitIncidentForReview(id, opts?)` | PATCH | `/regional/incidents/{id}/submit` | Submit for validator review |
| `unpendIncident(id)` | PATCH | `/regional/incidents/{id}/unpend` | Withdraw to draft |
| `deleteIncident(id)` | DELETE | `/regional/incidents/{id}` | Soft-delete incident |
| `forceReplaceIncident(id, body)` | POST | `/regional/incidents/{id}/force-replace` | Replace PENDING data |
| `listEncoderDrafts(limit?, offset?)` | GET | `/regional/incidents/drafts` | List encoder drafts |
| `updateDraft(id, body)` | PATCH | `/regional/incidents/draft/{id}` | Update a draft |
| `deleteDraft(id)` | DELETE | `/regional/incidents/draft/{id}` | Delete a draft |
| `checkIncidentDuplicate(params)` | GET | `/regional/incidents/check-duplicate` | Check duplicates |
| `fetchPendingReports()` | GET | `/triage/pending` | Pending citizen reports |
| `promoteReport(id)` | POST | `/triage/{id}/promote` | Promote report to incident |
| `bulkPromoteReports(ids)` | POST | `/triage/bulk-promote` | Bulk promote reports |

### Analytics Functions (15 legacy reads/writes + 9 offline read wrappers)

`api/offlineAnalytics.ts` wraps the analyst read functions for heatmap, trends, comparative, type distribution, response time, top-N, filter options, analyst incident detail, and analyst sensitive detail. The wrapper names end in `OfflineAware` and return `{ response, fromCache, cachedAt? }` while caching successful reads into the encrypted IndexedDB analytics cache documented in [[architecture/pwa-tests-cicd]].

| Function | Method | Path | Purpose |
|---|---|---|---|
| `fetchHeatmapData(filters?)` | GET | `/analytics/heatmap` | Heatmap GeoJSON |
| `fetchTrendData(filters?)` | GET | `/analytics/trends` | Trends time-series |
| `fetchComparativeData(filters)` | GET | `/analytics/comparative` | Comparative counts |
| `fetchTypeDistribution(filters?)` | GET | `/analytics/type-distribution` | Type distribution |
| `fetchTopBarangays(filters?)` | GET | `/analytics/top-barangays` | Top barangays |
| `fetchResponseTimeByRegion(filters?)` | GET | `/analytics/response-time-by-region` | Response time |
| `fetchCompareRegions(filters)` | GET | `/analytics/compare-regions` | Region comparison |
| `fetchTopN(filters)` | GET | `/analytics/top-n` | Top-N hotspots |
| `fetchAnalyticsFilterOptions(field, filters?)` | GET | `/analytics/filter-options` | Filter dropdown options |
| `queueAnalyticsExport(request)` | POST | `/analytics/export/{format}` | Queue async export |
| `downloadAnalyticsExport(taskId)` | GET | `/analytics/export/{taskId}` | Download export Blob |
| `fetchAnalystIncidentList(params?)` | GET | `/incidents/analyst-list` | Analyst incident list |
| `fetchAnalystIncidentDetail(id)` | GET | `/incidents/analyst/{id}` | Analyst incident detail |
| `fetchAnalystIncidentWildlandDetail(id)` | GET | `/incidents/analyst/{id}/wildland` | Analyst wildland detail |

### Reference Data Functions (6)

| Function | Method | Path | Purpose |
|---|---|---|---|
| `fetchRegions()` | GET | `/ref/regions` | All regions |
| `fetchProvinces(regionId)` | GET | `/ref/provinces?region_id=` | Provinces by region |
| `fetchCities(provinceId)` | GET | `/ref/cities?province_id=` | Cities by province |
| `fetchCitiesByProvinces(ids)` | GET | `/ref/cities?province_ids=` | Cities by multiple provinces |
| `fetchBarangays(cityIds)` | GET | `/ref/barangays?city_ids=` | Barangays by city IDs |
| `fetchRegionsByRegionId(id)` | GET | `/ref/regions?region_id=` | Region filtered by ID |

### Admin Functions (11)

| Function | Method | Path | Purpose |
|---|---|---|---|
| `fetchAdminUsers()` | GET | `/admin/users` | All users |
| `fetchActiveSessions()` | GET | `/admin/active-sessions` | Active Keycloak sessions |
| `fetchSystemHealth()` | GET | `/admin/health` | System health |
| `revokeUserSessions(userId)` | POST | `/admin/users/{userId}/logout` | Force logout user |
| `updateAdminUser(userId, payload)` | PATCH | `/admin/users/{userId}` | Update user |
| `createAdminUser(payload)` | POST | `/admin/users` | Create user (onboard) |
| `fetchAdminSecurityLogs()` | GET | `/admin/security-logs` | Security logs |
| `analyzeSecurityLog(logId)` | POST | `/admin/security-logs/{logId}/analyze` | AI threat analysis |
| `updateAdminSecurityLog(logId, payload)` | PATCH | `/admin/security-logs/{logId}` | Update security log |
| `fetchAuditLogs(params?)` | GET | `/admin/audit-logs` | Audit trails (paginated) |
| `fetchUserSessions(userId)` | GET | `/sessions/{userId}` | User sessions |
| `terminateUserSessions(userId, sessionId)` | DELETE | `/sessions/{userId}/{sessionId}` | Terminate session |

### User & Civilian Functions (5)

| Function | Method | Path | Purpose |
|---|---|---|---|
| `fetchMyProfile()` | GET | `/user/me/profile` | Own profile |
| `updateMyProfile(payload)` | PATCH | `/user/me` | Update profile |
| `changeMyPassword(payload)` | PATCH | `/user/me/password` | Change password |
| `submitCivilianReport(payload)` | POST | `/civilian/reports` | Submit civilian report (no auth) |
| `fetchReportStatus(reportId)` | GET | `/civilian/reports/{id}` | Track civilian report (no auth) |

### AFOR Functions (2)

| Function | Method | Path | Purpose |
|---|---|---|---|
| `importAforFile(file)` | POST | `/regional/afor/import` | Import AFOR Excel/CSV |
| `commitAforImport(rows, formKind, opts?)` | POST | `/regional/afor/commit` | Commit AFOR import |

### Shared API Types

Defined in `src/frontend/src/types/api.ts`: `Region`, `Province`, `City`, `Barangay`, `IncidentListItem`, `SecurityLog`, `AuditLogEntry`, `PaginatedResponse<T>`, `AnalyticsSummary`, `AnalyticsFilters`, `ApiError`.

Additional types in `api.ts`: `DraftSummary`, `RefDuplicateIncident`, `AforFormKind`, `AforImportPreviewResponse`, `AforCommitResult`, `HeatmapGeoJSON`, `TrendsResponse`, `ComparativeResponse`, `AnalystIncidentListItem`, `AnalystIncidentDetailResponse`, `KeycloakSession`, and more.

---

## Utility Libraries

### `src/frontend/src/lib/afor-utils.ts`

AFOR incident classifications, field labels, problem options, and reference number utilities.

| Export | Description |
|---|---|
| `STRUCTURAL_TYPE_OPTIONS` | 17 type options for STRUCTURAL (APT, CON, DOR, HOT, LRH, SFD, INF, ASM, BUS, DET, EDU, HLC, RBC, IND, MER, MIX, STO) |
| `NON_STRUCTURAL_TYPE_OPTIONS` | 6 options (MSC, ELE, RUB, MOB, APP, GCR) |
| `WILDLAND_TYPE_OPTIONS` | 5 options (BRU, AGR, FOR, GRS, PEA) |
| `TRANSPORTATION_TYPE_OPTIONS` | 13 options (EBK, MOT, AUT, PUV, TRK, BUSV, HVY, LOC, NMT, CUS, VES, SHP, AIR, REC) |
| `CLASSIFICATION_LABELS` | Maps raw DB values to human-readable labels |
| `formatClassification(raw)` | Returns human-readable label from raw DB value |
| `getTypeOptionsForClassification(c)` | Returns dropdown options for a classification string |
| `getTypeCode(c, typeName)` | Returns 3-4 letter AFOR code from classification + type name |
| `getTypeNameFromCode(c, code)` | Returns full type name from code |
| `formatAforRegionCode(code)` | Converts 'NCR'/'4A' to 'RGN-NCR'/'RGN-4A' |
| `generateReferenceNumberPreview(params)` | Generates preview ref number with XXXX placeholder |
| `buildDuplicateKey(regionCode, typeCode, date)` | Extract duplicate-detection key |
| `FIELD_LABELS` | Canonical label map (~100 entries) for all incident fields |
| `fieldLabel(key)` | Returns human-readable label; falls back to title-cased key |
| `displayValue(value)` | "N/A" for null, "Yes"/"No" for boolean |
| `ALL_PROBLEM_OPTIONS` | Complete ordered list of 25 AFOR problem options |
| `normalizeProblemLabel(label)` | Normalizes legacy/alias problem labels to canonical |

### `src/frontend/src/lib/ph-regions.ts`

Static Philippine administrative data. All `region_id` values match `wims.ref_regions`.

| Export | Description |
|---|---|
| `PhRegion` interface | `{ regionId, regionName, regionCode }` |
| `PhProvince` interface | `{ regionId, provinceName }` |
| `PH_REGIONS` | Array of all 18 Philippine regions with name, code, and ID |
| `getShortRegionName(regionId)` | Returns short label ("Region I", "NCR") |
| `getAforRegionIdentifier(regionId)` | Maps region_id to AFOR ref-number identifier |
| `PH_PROVINCES` | Array of all provinces across 18 regions (~100 entries) |
| `getCitiesForProvince(regionId, province)` | City/municipality options for a region+province |
| `getProvincesForRegion(regionId)` | All provinces for a regionId |
| `getRegionCode(regionId)` | Returns region_code string for a regionId |

### `src/frontend/src/lib/regional-incidents.ts`

Regional incident list filters and pagination helpers.

| Export | Description |
|---|---|
| `REGIONAL_INCIDENT_GENERAL_CATEGORIES` | `['STRUCTURAL', 'NON_STRUCTURAL', 'VEHICULAR']` |
| `REGIONAL_VERIFICATION_STATUSES` | `['DRAFT', 'PENDING', 'VERIFIED', 'REJECTED']` |
| `REGIONAL_PAGE_SIZE_OPTIONS` | `[10, 25, 50]` |
| `clampRegionalPageSize(n)` | Clamps to valid page size (default 10) |
| `offsetFromPage(pageIndex0, pageSize)` | Converts 0-based page index to offset |
| `totalRegionalPages(total, pageSize)` | Total page count (minimum 1) |

### `src/frontend/src/lib/analyst-workflow-transfer.ts`

Cross-workflow state handoff using `sessionStorage`.

| Export | Description |
|---|---|
| `AnalystWorkflowSlug` | Union of 6 workflow identifiers |
| `AnalystWorkflowTransferPayload` | `{ filters, selectedIncidentIds?, createdAt }` |
| `createAnalystWorkflowTransferUrl(workflow, payload)` | Creates sessionStorage entry with transfer ID, returns URL with `?transfer=<uuid>` |
| `readAnalystWorkflowTransfer(transferId)` | Reads transfer payload from sessionStorage |

### `src/frontend/src/lib/edgeFunctions.ts`

Edge function wrappers for server-side operations.

| Export | Description |
|---|---|
| `Incident` interface | Full incident DTO with nonsensitive and sensitive detail fields |
| `edgeFunctions` | Object with methods: `uploadBundle`, `runConflictDetection`, `commitIncident`, `getAnalyticsSummary`, `securityEventAction`, `uploadAttachment` (FormData-based file upload) |

---

## Component Tree

All files in `src/frontend/src/components/`:

```
components/
  Sidebar.tsx
  IncidentDiffPanel.tsx
  UpdateRequestDiffPanel.tsx
  IncidentForm.tsx
  MapPickerInner.tsx
  MapPicker.tsx
  DuplicateIncidentModal.tsx
  DuplicateResolutionModal.tsx
  SyncStatusBar.tsx
  LayoutShell.tsx
  NetworkStatusIndicator.tsx
  Header.tsx
  analytics/
    ...
app/dashboard/regional/
  conflicts/
    page.tsx            ← Sync conflict resolution (issue #64)
```

### `Sidebar.tsx`

**Props:** `{ isOpen: boolean; onClose: () => void }`

Role-based navigation sidebar. Uses `useAuth()` to determine role and renders different nav sections:

- `SYSTEM_ADMIN`: `/admin`, dashboard, incidents, security, reports, backup
- `REGIONAL_ENCODER`: Regional dashboard, drafts, AFOR import, new incident
- `NATIONAL_VALIDATOR`: Validator dashboard, audit trail, triage
- `NATIONAL_ANALYST`: Analyst dashboard with workflow sub-links (comparative, heatmap, trends, response-time, top-n, incident-explorer) + profile
- Uses `usePathname()` for active state detection with left bar indicator

### `IncidentDiffPanel.tsx`

**Props:** `{ incidentId: number }`

M4-G side-by-side diff for validators. Fetches `GET /regional/validator/incidents/{id}/diff`. Shows changed fields table with Original vs Current values. Handles loading, error, no-snapshot, and no-changes states.

### `UpdateRequestDiffPanel.tsx`

**Props:** `{ updateIncidentId: number; originalIncidentId: number }`

Compares a PENDING update request (parent_incident_id) against the original VERIFIED incident. Fetches both incidents in parallel. Side-by-side columns with color coding (red-50 original, green-50 update). Toggle show/hide unchanged fields.

### `IncidentForm.tsx`

**Props:** `{ initialData?: Incident; existingIncidentId?: number; onSaved?: () => void }`

~1956-line form matching the physical BFP AFOR form with 12 sections (A-L):

| Section | Content |
|---|---|
| A — Response Details | Responder type, fire station, notification date/time, region/province/city/address, caller info, engine dispatch times, response time, gas consumption |
| B — Nature & Classification | Classification dropdown, type-of-involved, owner/establishment, fire origin, extent, structures/households/families/individuals/vehicles affected |
| C — Assets & Resources | Response vehicles, tools & equipment tables, hydrant location |
| D — Fire Alarm Level | 13-row alarm timeline table with datetime + commander per entry, ICP presence |
| E — Profile of Casualties | 6 categories x male/female table |
| F — Personnel on Duty | 8 roles with name + optional contact |
| G — Other Personnel | Dynamic rows with name/designation/remarks |
| H — MapPicker | Interactive pin selection |
| I — Narrative | Textarea |
| J — Problems Encountered | 25 checkboxes + free-text "Others" |
| K — Recommendations | Textarea |
| L — Disposition | Textarea + Prepared by / Noted by |

Key behaviors: `formState` with ~90 fields. Encoder region lock on mount. Duplicate detection modal via `DuplicateIncidentModal`. Reference number preview via `useMemo`. Autosaves drafts to IndexedDB (`saveDraftOp`, `syncStatus='draft'`) with a `localStorage` fallback for private mode. When `navigator.onLine` is false (or a request fails mid-flight), create/update/submit are queued as `offlineOps` (`queueOfflineOp`) with a "Saved locally — will sync when connection is restored" toast; the offline `create` op stores the **full nested incident** so no detail is lost on sync.

#### Offline-first encoder sync

- **Persistence (`lib/offlineStore.ts`, IndexedDB v3):** `offlineOps` (operation queue — create/update/submit/delete, each with a `localId` UUID idempotency key, `linkedLocalId` dependency chain, and per-op `syncStatus`: draft/pending/syncing/synced/conflict/error) and `cachedIncidents` (AES-256-GCM read cache so the dashboard/detail render offline). `clearAllCachedIncidents()` is called on logout for shared-device privacy; pending ops are preserved.
- **Reads (`lib/api/offlineRegional.ts`):** `fetchRegionalIncidents*OfflineAware` wrappers cache every successful response and fall back to the encrypted cache when offline (`fromCache: true` → amber "showing cached data" banner).
- **Sync (`lib/syncEngine.ts`):** `syncPendingIncidents(encoderId)` verifies app reachability, loads the local queue, checks `GET /api/auth/session`, and only calls `refreshToken()` if the access session is gone. It then replays ops **oldest-first** (sequential, so a create resolves its `serverId` before its linked submit). `create` ops replay through the same full-fidelity `POST /api/incidents/upload-bundle` the online form uses (not the flat `/api/regional/incidents`), tagged with `client_id` for retry-safe idempotency. Ops are marked synced only on server confirmation; a network error aborts the batch and leaves items queued; 409 → `conflict` state; a 401 during replay restores the current op to `pending` and returns `abortReason: 'auth'`.
- **Reconnect (`lib/useAutoSync.ts` + `useNetworkStatus`):** detects reconnection, toasts the user, and syncs after a short debounce. If both session check and refresh fail with auth (`abortReason: 'auth'`), it prompts re-login and **keeps** the queue intact; auth-service/network failures map to `abortReason: 'offline'` instead of repeated session-expired prompts.
- **Conflict Resolution (`lib/offlineStore.ts` + `app/dashboard/regional/conflicts/page.tsx`):** When the server returns HTTP 409 during sync, the offending operation is marked `conflict` with `errorCode` (`409_duplicate` or `409_conflict`) and the server's current version is stored in `serverVersion`. The `SyncStatusBar` shows an orange banner with conflict count and a "Review" link to `/dashboard/regional/conflicts`. The conflicts page lists all conflicted ops with their local payload, server version (if available), and three resolution options: **Keep Local** (re-queue for retry via `resolveConflictOp`), **Use Server Version** (delete the local op), or **Discard** (delete without accepting server version). This replaces silent last-write-wins with explicit user choice (issue #64).

### `MapPickerInner.tsx`

**Props:** `{ center?: [number,number]; zoom?: number; value?: {lat,lng}; onChange?: (lat,lng)=>void; mapHeight?: string }`

Interactive map picker using `react-leaflet` + OpenStreetMap Nominatim geocoding. Search with debounced (300ms) autocomplete (local Philippine suggestions + Nominatim). Click-to-place marker. Read-only mode hides search UI. Default center: Manila (14.5995, 120.9842), default zoom: 12.

### `SyncStatusBar.tsx`

Sync status UI (FR-3E). Displays: Offline (amber), Reconnecting (blue), Syncing (blue spin), All synced (green), Pending (gray with "Sync Now" button), Session Expired (red with "Log In to Sync"), Conflict (orange with count and "Review" link to `/dashboard/regional/conflicts`). Uses `useAutoSync()` and `useNetworkStatus()` hooks.

### `NetworkStatusIndicator.tsx`

Header network indicator backed by verified app reachability. It shows Checking, Reconnecting, Online, or Offline from `useNetworkStatus()` rather than raw `navigator.onLine`.

### Current Offline Stabilization (2026-06-07)

Regional Encoder offline decisions now use verified app reachability rather than raw browser online state. `lib/connectivity.ts` centralizes `checking/offline/reconnecting/online` status, treats browser `online/offline`, focus, and visibility events as hints, and only marks the app online after a same-origin `/health` probe succeeds. It no longer lets `navigator.onLine === false` block a real probe, and `useNetworkStatus()` rechecks every 5 seconds while offline/checking so the app can recover even if the browser misses the `online` event. Manual incident save/submit, AFOR import, offline reads, sync, `SyncStatusBar`, and `NetworkStatusIndicator` use this shared state; fetch network failures call `markConnectivityOffline()`.

`src/frontend/src/app/health/route.ts` serves the same-origin `/health` probe when the Next.js app is run directly without nginx. In Docker/nginx deployments, nginx still handles `/health` first.

`apiFetch()` now treats `refreshToken()` as successful only when `result.ok === true`, preventing failed refresh results from being retried as authenticated requests. `refreshToken()` classifies 5xx/429 refresh-route responses as offline/auth-service-unavailable rather than expired auth. `useAutoSync()` suppresses repeated auth-expired toasts, retries once after re-login/session restore when pending ops exist, and listens for service-worker `run-sync` messages. `public/sw.js` cache `v4` falls back to cached app shell or friendly offline HTML for navigations instead of returning `Response.error()`.

### Offline Incident Sync/View Stabilization (2026-06-11)

Offline-created incidents now use the same regional dashboard/detail surfaces as server-created incidents. `src/frontend/src/app/dashboard/regional/page.tsx` converts pending `offlineOps` create records into normal rich `IncidentCard` tiles with `verification_status = PENDING_SYNC` and routes them to `/dashboard/regional/incidents/{localId}` instead of the legacy `/local/{localId}` edit-only page. `src/frontend/src/app/dashboard/regional/incidents/[id]/page.tsx` accepts non-numeric local IDs, reads the encrypted op with `getOfflineOp(localId)`, reconstructs a `RegionalIncidentDetailResponse`, and renders the standard read-only incident detail view without fetching the server. Editing that view passes `offlineLocalId` to `IncidentForm`, so saves update the queued create op in place. Deleting a pending-sync incident calls `deleteOfflineOpCascade(localId)`, removing the queued create and any linked queued submit/update ops before reconnect. The legacy `/dashboard/regional/incidents/local/[localId]` route remains only as a redirect shim into the normal detail route.

Offline create sync no longer uses `INSERT ... ON CONFLICT` on `wims.fire_incidents`. Because immutable-record rules exist on that table, PostgreSQL rejects `ON CONFLICT`; `src/backend/api/routes/incidents.py` and `src/backend/api/routes/regional/encoder_crud.py` now serialize idempotent `client_id` retries with `pg_advisory_xact_lock(...)`, select any existing row by `client_id`, and then perform a normal insert when absent.

### `analytics/AnalystIncidentList.tsx`

Paginated incident table for analyst dashboard with column visibility, row selection across pagination, and "Analyze selected" workflow transfer.

### `analytics/ExportPreviewModal.tsx`

Export preview with format selection (CSV/PDF/XLSX), column selection, and estimated count. Downloads completed exports via `downloadAnalyticsExport()`.

### `analytics/TypeDistributionChart.tsx`, `TopBarangaysChart.tsx`, `TrendCharts.tsx`, `ResponseTimeChart.tsx`, `HeatmapViewer.tsx`

Recharts-based analytics charts for the analyst dashboard. Each accepts filter state as props and fetches its own data via the corresponding `api.ts` function.

## Offline Read Caching (2026-06-22, branch `feat/offline-every-role`)

This is the read-caching complement to the existing offline **write** pipeline. The encoder `offlineOps` queue and sync engine documented above (under `IncidentForm.tsx`) handle write-queueing; the layer below caches **read** responses for every role so dashboard/list pages can render their last-known server state when the network is unavailable. The cache is populated opportunistically on every successful online fetch and read through a single orchestrator pair, not mounted on read-only pages (no `useAutoSync`).

### Storage layer — `src/frontend/src/lib/offlineStore.ts`

`wims-bfp-db` is now **DB v6**. The `upgrade()` callback appends each store in its own `oldVersion < N` branch and never recreates a store that already exists, so existing offline data carries across version bumps.

| Object store | Encryption | Key shape | TTL | Backing data | Owner |
|---|---|---|---|---|---|
| `incident-queue` (legacy v2) | AES-256-GCM | auto-increment id | n/a | Phase 1A queued incidents | legacy |
| `crypto-keys` | n/a | string | n/a | non-extractable AES-GCM CryptoKey, per-user | all roles |
| `offlineOps` (v3) | AES-256-GCM | UUID `localId` | n/a | write queue (create/update/submit/delete/verify/archive) | encoder (writes) |
| `cachedIncidents` (v3) | AES-256-GCM | numeric `serverId` | n/a | regional incident detail payload | encoder (reads) |
| `analytics-cache` (`READ_CACHE_STORE`, v4) | AES-256-GCM | string key | per-record `ttlMs` | analyst/admin/validator encrypted read cache | analyst + admin + validator |
| `reference-cache` (`REFERENCE_STORE`, v6) | **plaintext** | string `reference:{userId}:{op}:{args}` | per-record `ttlMs` (7d default) | regions/provinces/cities per user | dashboard filter dropdowns + analyst + admin |
| `publicOfflineOps` (v5) | plaintext | UUID `localId` | n/a | civilian anonymous submission queue | civilian |

The pushback-P1 per-user isolation guarantee is enforced by **key namespacing** for `REFERENCE_STORE` (no per-user key exists, so the store is plaintext; isolation comes from the key prefix) and by **per-user key material + destruction on user switch** for the encrypted stores. `setActiveOfflineUser(prev → next)` wipes the prior user's `offlineOps` / `cachedIncidents` / `crypto-keys` (via `wipeAllOfflineData`) AND clears their `reference:{prevUserId}:*` prefix in `REFERENCE_STORE` (via `clearReferenceDataForUser`, pushback P1) so the plaintext RLS-scoped data does not survive a shared-device logout/login cycle.

Generic API (replaces the legacy single-purpose `cacheAnalyticsResponse` / `getCachedAnalyticsResponse` pair; the old names are kept as back-compat aliases):

- `cacheReadResponse<T>(key, data, ttlMs, cachedAt?)` — encrypted write to `READ_CACHE_STORE`, with the per-record `ttlMs` stored on the record for per-record eviction.
- `getReadCachedResponse<T>(key)` — decrypts and returns `{ key, data, cachedAt, ttlMs }` (or `undefined` on miss).
- `cacheReferenceData<T>(key, data, ttlMs, cachedAt?)` — plaintext write to `REFERENCE_STORE`; caller MUST supply a `reference:{userId}:...` key.
- `getCachedReferenceData<T>(key)` — plaintext read.
- `evictExpiredReadCache()` / `evictExpiredReferenceData()` — cursor-scan + per-record `cachedAt + ttlMs < now` delete, capped at 500 deletions/pass, back-compat default 30 min for pre-v3 records missing `ttlMs`. Best-effort (`try/catch` + dev-mode `console.warn`).
- `clearReferenceDataForUser(userId)` — regex-prefix sweep `^reference:{userId}:` over `REFERENCE_STORE`; returns deleted count. Best-effort.

### Orchestrators — `src/frontend/src/lib/api/offlineBase.ts`

`offlineBase.ts` is the single shared base for the four domain wrapper modules. It defines the `OfflineResult<T> = { response: T; fromCache: boolean; cachedAt?: number }` envelope and the two orchestrators:

| Function | Storage | Cache key | Use |
|---|---|---|---|
| `offlineAware<T>(cacheKey, args, prefix, ttlMs, fetcher, errorMessage)` | encrypted `READ_CACHE_STORE` | `${prefix}:${cacheKey}:${stableStringify(args)}` | analyst / admin / validator reads |
| `offlineAwareReference<T>(cacheKey, args, prefix, ttlMs, userId, fetcher, errorMessage)` | plaintext `REFERENCE_STORE` | `${prefix}:${userId}:${cacheKey}:${stableStringify(args)}` | reference data |

Both follow the same control flow: if `shouldServeOffline()` (or `navigator.onLine === false`) → read fresh cache and throw the friendly `errorMessage` on miss/stale; otherwise `await fetcher()` → `await cache…()` (encrypted or unencrypted) → return `{ response, fromCache: false }`. On `isNetworkError` (TypeError / `ERR_*` / `Failed to fetch` / `net::ERR` / `NetworkError`) the orchestrator calls `markConnectivityOffline()` and falls back to a fresh cache read. After every successful write, `incrementCacheWriteCount()` is invoked so the every-25-writes eviction trigger fires.

Helpers exported alongside the orchestrators: `isNetworkError`, `stableStringify` (deterministic, key-sorted, undefined/empty filtered), `isNavigatorOffline`, `shouldServeOffline`, `isFresh`, `buildCacheKey`, `readFreshCacheOrThrow`, `readFreshReferenceCacheOrThrow`, `writeCache`, `OfflineResult<T>`.

### Domain wrapper inventory (12 new offline-aware wrappers)

`offlineAdmin.ts` — encrypted, prefix `admin`, 60s default (30min for config/rate-limits):

| Function | TTL | Backing |
|---|---|---|
| `fetchSystemHealthOfflineAware` | 60s | legacy `fetchSystemHealth` |
| `fetchSystemMetricsOfflineAware` | 60s | legacy `fetchSystemMetrics` |
| `fetchWorkerStatusOfflineAware` | 60s | legacy `fetchWorkerStatus` |
| `fetchActiveSessionsOfflineAware` | 30s | legacy `fetchActiveSessions` |
| `fetchAuditLogsOfflineAware` | 60s | legacy `fetchAuditLogs` |
| `fetchAdminSecurityLogsOfflineAware` | 60s | legacy `fetchAdminSecurityLogs` |
| `fetchSecurityLogsSummaryOfflineAware` | 60s | legacy `fetchSecurityLogsSummary` |
| `fetchAnomaliesOfflineAware` | 60s | legacy `fetchAnomalies` |
| `fetchBreachesOfflineAware` | 60s | `breach.fetchBreaches` |
| `fetchAdminConfigOfflineAware` | 30min | legacy `fetchAdminConfig` |
| `fetchRateLimitsOfflineAware` | 30min | legacy `fetchRateLimits` |

`offlineValidator.ts` — encrypted, prefix `validator`, 60s default:

| Function | TTL | Backing |
|---|---|---|
| `fetchOperationalMapOfflineAware` | 60s | `validator.fetchOperationalMap` |
| `fetchValidatorAuditLogsOfflineAware` | 60s | `validator.fetchValidatorAuditLogs` |

`offlineAnalytics.ts` — encrypted, prefix `analytics`, 30min default:

| Function | TTL | Backing |
|---|---|---|
| `fetchAnalystIncidentWildlandDetailOfflineAware` | 30min | legacy `fetchAnalystIncidentWildlandDetail` |

`offlineReference.ts` — plaintext, prefix `reference`, 7-day TTL, userId-namespaced:

| Function | TTL | Backing |
|---|---|---|
| `fetchRegionsOfflineAware(userId)` | 7d | legacy `fetchRegions` |
| `fetchProvincesOfflineAware(userId, regionId)` | 7d | legacy `fetchProvinces` |
| `fetchCitiesOfflineAware(userId, provinceId)` | 7d | legacy `fetchCities` |

All four wrapper modules re-export the `OfflineResult<T>` envelope as their own domain-specific name (`OfflineAdminResult` / `OfflineAnalyticsResult` / `OfflineValidatorResult` / `OfflineReferenceResult`) so existing consumer code is unaffected.

### Shared UI — `src/frontend/src/components/ui/StaleCacheBanner.tsx`

`StaleCacheBanner` renders nothing when `freshness?.cachedAt` is `null`; otherwise it renders a `<StickyBanner tone="amber">` with the message `"Showing cached data — reconnect to refresh. from HH:MM:SS"` (or a caller-supplied `message`). Every rewired page mounts it once with `{ cachedAt, isOnline }` derived from the wrapper result + `useNetworkStatus()`.

### Page bindings (12 rewires, no `useAutoSync`)

The following pages were rewired to call the offline-aware wrappers, mount `useNetworkStatus()` (not `useAutoSync`), and render `StaleCacheBanner` whenever the wrapper returns `fromCache: true`. None of these pages mount the write-queue `useAutoSync`; only the encoder/validator surfaces that initiate writes do.

| Role | Page | Wrapper(s) used |
|---|---|---|
| Admin | `/admin/monitoring` | `fetchAdminSecurityLogsOfflineAware`, `fetchSecurityLogsSummaryOfflineAware`, `fetchAuditLogsOfflineAware` |
| Admin | `/admin/anomalies` | `fetchAnomaliesOfflineAware` |
| Admin | `/admin/breach` | `fetchBreachesOfflineAware`, `fetchAdminConfigOfflineAware` |
| Admin | `/admin/system/config` | `fetchAdminConfigOfflineAware` |
| Admin | `/admin/system/rate-limits` | `fetchRateLimitsOfflineAware` |
| Validator | `/dashboard/validator/map` | `fetchOperationalMapOfflineAware` |
| Validator | `/dashboard/validator/audit` | `fetchValidatorAuditLogsOfflineAware` |
| Analyst | `/dashboard/analyst/incidents/[id]/wildland` | `fetchAnalystIncidentWildlandDetailOfflineAware` |
| Dashboard | `/dashboard` (filter dropdowns) | `fetchRegionsOfflineAware`, `fetchProvincesOfflineAware`, `fetchCitiesOfflineAware` |
| Analyst | `/dashboard/analyst` (filter dropdown) | `fetchRegionsOfflineAware` |
| Analyst workflow | `/dashboard/analyst/[workflow]` (filter dropdown) | `fetchRegionsOfflineAware` |
| Admin system | `/admin/system` (filter dropdown) | `fetchRegionsOfflineAware` |

The 5 admin pages, 2 validator pages, and the analyst wildland page are full rewires (wrapper + `useNetworkStatus` + `StaleCacheBanner` + cache-miss friendly error state). The other 4 pages (dashboard, analyst, analyst workflow, admin/system) are reference-data swap-only: the filter dropdowns use the `*OfflineAware` reference wrappers so the dropdowns render their last-known region/province/city lists offline; everything else is unchanged.

### Service worker — `src/frontend/public/sw.js`

`CACHE_NAME` bumped to `wims-bfp-cache-v12`. Three new analyst-shell URLs are now in `urlsToCache` (precache at install): `/dashboard/analyst/incidents/1`, `/dashboard/analyst/incidents/1/wildland`, and `/dashboard/analyst/comparative`. The `canonicalPath()` helper was extended to collapse the three analyst URL families to a single canonical shell so the SW navigate handler can serve the precached shell when the user goes offline on a specific incident / wildland / workflow URL. Admin and validator routes are NOT in the precache list (they are not in `urlsToCache`); those pages rely on the encrypted IndexedDB read cache rather than SW shell precache.

A new `PREFETCH_ROLE` `message` handler lets the page ask the SW to warm its cache for the post-login role. The handler opens `CACHE_NAME`, iterates the role's route set, and for each route calls `cache.match` (skip if already present) and otherwise `fetch` + `cache.put`, all wrapped in `Promise.allSettled` so a single failed route does not abort the rest. Role route sets:

- `SYSTEM_ADMIN` → the 5 admin pages + `/admin/system`
- `NATIONAL_ANALYST` → `/dashboard/analyst`, the 6 workflow slugs, and the 3 shells
- `NATIONAL_VALIDATOR` → `/dashboard/validator`, `/dashboard/validator/map`, `/dashboard/validator/audit`
- `REGIONAL_ENCODER` → `/dashboard/regional`

The post-login wiring lives in `src/frontend/src/context/AuthContext.tsx`: after a successful login and once the user role is known, `navigator.serviceWorker.controller?.postMessage({ type: 'PREFETCH_ROLE', role })` is sent (guarded for `controller === null` and SW-unsupported browsers). The handler is fire-and-forget — failures are silent.

### Eviction wiring (pushback P3 + P4)

Four triggers run the per-record eviction pair (`evictExpiredReadCache` + `evictExpiredReferenceData`):

1. **App boot** — `LayoutShell.tsx` calls `maybePruneCaches()` once on mount. A `wims:cachePruneAt` localStorage timestamp ensures the boot guard fires at most once per hour.
2. **Every 25 successful cache writes** — `incrementCacheWriteCount()` (called inside `offlineAware` and `offlineAwareReference` after each successful write) resets a `wims:cacheWriteCount` counter to 0 and runs both evictions once the counter crosses 25.
3. **After every successful sync batch completion** — the existing `wims:sync-complete` listener calls `maybePruneCaches()`.
4. **On user switch** — `setActiveOfflineUser` calls `clearReferenceDataForUser(prev)` (in addition to the crypto-key wipe) so the prior user's plaintext reference data is destroyed.

All four are best-effort (`try/catch` + dev-mode `console.warn`); a failed eviction never blocks the caller. The write counter is reset to 0 BEFORE the eviction call so a slow eviction does not cause the next write to also be at 25.

### Offline photo queue v5 (2026-07-10)

- **IndexedDB v7 upgrade** (`offlineStore.ts`): Added `OFFLINE_PHOTOS_STORE` and `PHOTO_LINK_STORE` with compound indexes (`by_device`, `by_parent_local`). Uses `idb` library. Existing stores (draft ops, offline ops, cached data) are preserved during upgrade.
- **Encryption** (`offlinePhotoKey.ts`): AES-256-GCM with non-extractable `CryptoKey` stored via IndexedDB structured clone. Random 12-byte IV per photo. AAD binds to `photoId + deviceId`. Key loss means permanent failure of queued photos.
- **Photo sync** (`civilianPhotoSync.ts`): Decrypts using shared key, uploads with `client_photo_id` for server-side dedup. Exponential backoff with jitter (max 30s, 5 retries). `markPhotoRetry` persists `retryCount`/`lastAttemptAt`.
- **Sync engine** (`syncEngine.ts`): `syncPublicOfflineOps` always calls `syncPendingPhotos`. After submit success, calls `storePhotoLink` + `updatePhotoReportLink` to resolve queued photos. Export type includes `photoSynced`/`photoFailed`/`photoKeyLost`.

### Scope notes

- The read-caching layer documented here is **scoped to read-only pages** (filter dropdowns, dashboards, monitoring panels, audit/map views, wildland detail). Writes go through the existing `offlineOps` queue + `syncEngine` and are NOT re-implemented here.
- This change does NOT mount `useAutoSync` on any of the 12 rewired pages. That hook remains the encoder/validator write-sync trigger.
- The pre-existing M2 verification target ("verify IndexedDB encryption/sync semantics against M2") is partially closed by this work: the encrypted read cache and reference-cache layer now have a stable, per-record-TTL contract plus user-switch isolation. The full M2 write-queue contract was closed earlier (see `gaps/frs-codebase-gap-register.md` "M2d Offline-first Encoder" entry).
