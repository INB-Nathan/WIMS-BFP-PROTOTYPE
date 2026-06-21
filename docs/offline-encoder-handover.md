# WIMS-BFP Offline-First Implementation — Handover

**Branch:** `feat/offline-first-encoder`  
**Last updated:** 2026-06-11  
**Scope:** Regional Encoder offline-first workflow

---

## 1. What Was Built

The encoder can now work entirely without internet. Incidents are created, edited, and submitted locally; they sync automatically when connectivity returns.

### Supported offline actions
| Action | Offline behaviour |
|---|---|
| View dashboard | Served from IndexedDB cache |
| View incident detail | Served from IndexedDB cache (if visited while online) |
| Create incident (manual entry) | Queued as `offlineOps` pending-create; amber card shown |
| Edit draft | Queued as `offlineOps` pending-update |
| Submit for review | Queued as `offlineOps` pending-submit |
| Navigate to `/afor/create` | JS chunk pre-cached; works offline after first online visit |
| Navigate to `/afor/import` | JS chunk pre-cached |
| View `/home` (Operations) | Offline error page — requires live connection |
| View Activity Log | Offline error page — requires live connection |

---

## 2. Architecture

### IndexedDB stores (`wims-offline-db`)

| Store | Key | Purpose |
|---|---|---|
| `offlineOps` | `localId` (UUID) | Pending ops queue (create/update/submit/delete) |
| `cachedIncidents` | `serverId` | Encrypted flat incident cache |

All values are AES-256-GCM encrypted at rest using `WIMS_MASTER_KEY`. See `src/frontend/src/lib/offlineStore.ts`.

### Op structure (`offlineOps`)
```
localId         UUID — idempotency key (also sent as client_id to backend)
operation       'create' | 'update' | 'submit' | 'delete'
payload         Full incident bundle (nested: nonsensitive + sensitive details)
syncStatus      'pending' | 'syncing' | 'synced' | 'error' | 'conflict/409_*'
serverId        null until sync completes (create); incident ID otherwise
linkedLocalId   For submit/update ops: the localId of the create op they depend on
regionId        Encoder's assigned region_id
retryCount      Increments on non-network error; op skipped at MAX_RETRY (5)
serverUpdatedAt OCC version timestamp for update conflict detection
```

### Sequential sync order
The sync engine (`src/frontend/src/lib/syncEngine.ts`) processes ops in creation order:
1. `create` — POST `/api/incidents/upload-bundle` with `client_id: localId`
2. `update` — PUT `/api/regional/incidents/{serverId}`
3. `submit` — PATCH `/api/regional/incidents/{serverId}/submit`

A `submit` or `update` op resolves `serverId` via `linkedLocalId` → `syncedServerIds` map, enabling same-session dependency chains without a server round-trip.

### Connectivity state machine
File: `src/frontend/src/lib/connectivity.ts`

```
checking → online     (health probe succeeds on first load)
online   → offline    (browser 'offline' event or health probe fails)
offline  → checking   (setInterval fires every 5s)
checking → reconnecting  (health probe succeeds after offline)
reconnecting → online (second probe confirms stable)
```

The `/health` endpoint is at `GET /health` — handled by nginx directly (no Next.js round-trip, returns `{"status":"ok","via":"nginx-gateway"}`).

### Sync trigger points
1. **On reconnect** — `useAutoSync` debounces 2s after `isReconnecting` fires
2. **On mount** — if already online with pending ops (re-login case)
3. **Service worker Background Sync** — `sync-pending-incidents` tag (when SW is registered)
4. **Manual** — `syncNow()` exposed by `useAutoSync`

---

## 3. File Map

### Core offline libraries
| File | Purpose |
|---|---|
| `src/frontend/src/lib/offlineStore.ts` | IndexedDB CRUD, AES encryption, pending ops management |
| `src/frontend/src/lib/syncEngine.ts` | Replay pending ops against API; conflict/error handling |
| `src/frontend/src/lib/connectivity.ts` | Singleton connectivity state machine |
| `src/frontend/src/lib/useNetworkStatus.ts` | React hook wrapping connectivity singleton; 5s recheck |
| `src/frontend/src/lib/useAutoSync.ts` | Reconnect listener, debounce, toast notifications, event dispatch |
| `src/frontend/src/lib/api/offlineRegional.ts` | Offline-aware API wrappers for list + detail fetches |
| `src/frontend/src/lib/swRegistration.ts` | Service worker registration + Background Sync |
| `src/frontend/public/sw.js` | Service worker: cache navigation + JS chunks, offline shell |
| `src/frontend/src/lib/auth-refresh.ts` | Token refresh (used by sync engine before replaying ops) |

### UI components changed for offline
| File | What changed |
|---|---|
| `src/frontend/src/components/regional/IncidentCard.tsx` | `isDetailCached` + `isOnline` props; "Go online to view" badge; disabled click |
| `src/frontend/src/components/IncidentForm.tsx` | Offline create queuing; classification type validation; redirect to detail on create |
| `src/frontend/src/components/SyncStatusBar.tsx` | Live sync status bar (pending count, syncing spinner, error) |
| `src/frontend/src/components/LayoutShell.tsx` | SW registration on mount; offline-aware login redirect guard |
| `src/frontend/src/lib/oidc.ts` | `automaticSilentRenew: false` (prevents Keycloak token probes while offline) |
| `src/frontend/src/context/AuthContext.tsx` | Proactive JWT refresh skipped when offline |
| `src/frontend/src/lib/auth.tsx` | Same proactive refresh guard |

### Pages with offline behaviour
| Route | File | Offline behaviour |
|---|---|---|
| `/dashboard/regional` | `page.tsx` | Reads IndexedDB cache; shows pending ops as amber cards |
| `/dashboard/regional/incidents/[id]` | `[id]/page.tsx` | Reads IndexedDB cache; "Showing cached data" banner |
| `/dashboard/regional/incidents/local/[localId]` | `local/[localId]/page.tsx` | Shows queued (unsynced) incident for editing |
| `/afor/create` | `create/page.tsx` | IncidentForm queues offline ops |
| `/afor/import` | `import/page.tsx` | Offline guard; import disabled; existing queue visible |
| `/dashboard/regional/audit` | `audit/page.tsx` | **Offline error page** — live data required |
| `/home` | `page.tsx` | **Offline error page** — live data required |
| `/dashboard/regional/layout.tsx` | `layout.tsx` | Eager-loads IncidentForm JS chunk on mount |

---

## 4. Service Worker

File: `src/frontend/public/sw.js`  
Cache name: `wims-bfp-cache-v5` (tile cache: `wims-tiles-v1`)  
Registered in: `src/frontend/src/components/LayoutShell.tsx`

### What it caches
- **Navigation requests** — HTML for every page visited while online (network-first, cached on success)
- **RSC payloads** — Next.js App Router RSC fetches (identified by `RSC: 1` header or `_rsc` param); cached under path-normalized keys so the 5-minute router-cache TTL doesn't evict offline navigation
- **Static assets** — `/_next/static/` chunks, scripts, styles, images, fonts (cache-first)
- **Map tiles** — OSM tiles + Leaflet CDN assets (separate `wims-tiles-v1` cache; transparent GIF fallback when offline)
- **Offline shell fallback** — if offline and page not in cache, serves `APP_SHELL (/dashboard)` or inline HTML

### Why the SW is critical for offline navigation
Next.js App Router fetches an RSC payload from the server on EVERY client-side navigation (even to `'use client'` pages). Without the SW intercepting these requests, navigating to `/afor/create` while offline fetches from the server, which fails, causing "Application error: a client-side exception."

The SW intercepts the navigation request, serves the cached HTML response, and the page loads from the browser's chunk cache. **This is the primary offline navigation mechanism.**

### SW registration failure on `https://localhost`
Chrome rejects SW scripts from `https://localhost` when the SSL cert does not cover `localhost`. The cert in `.ssl/` is for `wimsbfp.tech` — a cert mismatch. Chrome applies strict SSL validation to SW script fetches even if the user accepted the cert warning for normal page loads.

**Fix: Use `http://localhost` for local development.** See section 6.

### SW registration failure — fallback behaviour
When the SW is not registered (dev with bad cert):
- Navigation RSC payloads are served by `router.prefetch` (5-minute in-memory cache)
- JS chunks are served from browser HTTP cache (if previously downloaded)
- Two backup mechanisms ensure chunks are pre-loaded:
  1. `router.prefetch('/afor/create')` fires on dashboard mount
  2. `import('@/components/IncidentForm')` fires in the regional layout

---

## 5. Dashboard Offline Logic

File: `src/frontend/src/app/dashboard/regional/page.tsx`

### List loading (`loadIncidents`)
```
isOnline=true  → fetchRegionalIncidentsOfflineAware → API → writes to IndexedDB cache
isOnline=false → fetchRegionalIncidentsOfflineAware → reads IndexedDB cache
```

On cache hit: `isFromCache=true`, `cachedAt` shows the timestamp, banner appears.

### Queued ops display
Pending ops from `offlineOps` with `operation='create'` and `syncStatus != 'synced'` are shown as amber cards above the main list. They are deduplicated against the fresh API list by comparing `op.serverId` against `serverIds` — prevents doubles when the same incident appears in both the cache and the queue after a partial sync.

### Sync notification modal
After reconnect sync, `wims:sync-complete` DOM event fires with `{ incidents: SyncedIncidentSummary[] }`. The dashboard listens, stores the list in `syncNotification` state, and shows a modal requiring "Confirm" before dismissing. The incident list also auto-refreshes.

### PENDING count poll
Background `setInterval` (20s) polls `/api/regional/incidents?status=PENDING&limit=1` to detect when a validator has actioned a submission. Guarded with `getConnectivitySnapshot().isOnline` — no requests fired while offline.

### Filter persistence
Filters (dateFilter, statusFilter, categoryFilter, pageIndex, pageSize, specificDate) are saved to `localStorage` under `wims:regional_filters` and restored on mount. Cleared by the "Clear Filters" button (setters already call the same savers).

---

## 6. Local Development: Service Worker Setup

### Problem
`docker-compose.override.yml` mounts `nginx.local.conf` which:
- Redirects HTTP (port 80) → HTTPS (port 443)
- Uses SSL cert for `wimsbfp.tech` (not `localhost`)
- Chrome blocks SW registration: cert mismatch

### Fix (implemented)
`nginx.local.conf` port 80 now serves the app directly (no redirect). Users access `http://localhost`.

### Steps to apply after pulling this branch
```powershell
cd src
docker compose down
docker compose up --build -d
```

Then open `http://localhost` (not `https://`). The service worker will register on first load. After that, all pages visited while online are cached for offline use.

### HTTPS still works
Port 443 still serves HTTPS (useful for Keycloak TOTP, secure cookie testing). The service worker won't register on HTTPS unless you install a proper localhost cert (see below).

### Proper HTTPS fix (optional, not required)
```powershell
winget install mkcert
mkcert -install           # one-time: installs root CA into Chrome trust store
mkcert localhost          # generates localhost.pem + localhost-key.pem
```
Then update `nginx.local.conf` ssl_certificate paths to use the mkcert output. The SW will then register on `https://localhost` too.

---

## 7. Production / VPS Behaviour

**All JS changes apply on VPS as-is.** The offline error pages, classification validation, sync modal, filter persistence, and prefetch improvements are all frontend code that ships in the Next.js build regardless of environment.

**The nginx.local.conf change does NOT affect VPS.** `docker-compose.override.yml` is only mounted locally. On VPS, `docker-compose.prod.yml` (or the plain `docker-compose.yml`) is used, which mounts `nginx.conf`.

**The service worker works correctly on VPS.** The VPS serves `https://wimsbfp.tech` with a valid Let's Encrypt cert — Chrome trusts it, the SW registers and caches everything from the first page load.

---

## 8. Known Limitations

### `isDetailCached` — list vs detail distinction
Cached incidents are stored as flat list-item fields. If the user never visited the incident detail page while online, `isDetailCached=false` and the card shows "Go online to view" with click disabled. Only incidents whose detail was fetched (by visiting the detail page) have the `nonsensitive` field present in the cache.

### RSC payload cache TTL (fallback mode, no SW)
Without the SW, `router.prefetch` caches the RSC metadata in Next.js's in-memory router cache for 5 minutes. After 5 minutes offline, client-side navigation to `/afor/create` will fail. The user must reload the dashboard while online to refresh the cache. **With the SW registered, this is not a problem** — the SW caches the full navigation response persistently.

### Offline sync error states
| `syncStatus` | Meaning |
|---|---|
| `conflict/409_duplicate` | Server detected a duplicate incident; op will not retry |
| `conflict/409_conflict` | OCC conflict; server version attached (`serverVersion`) |
| `error` | Non-network server error; retries up to 5 times |

Conflict resolution UI is not yet implemented. The `server_version` field is stored in IndexedDB but no diff/merge UI exists (deferred as M4-D).

### Import AFOR offline
Importing AFOR workbooks requires the server (parsing, validation, duplicate detection). The import page shows an offline error state and the commit button is disabled. Existing queued import ops are shown.

### DevTools "Offline" simulation
Chrome DevTools → Network → Offline blocks ALL requests including `http://localhost` (loopback). In this mode, nothing works unless the SW is registered and has previously cached the responses. Use physical network disconnect (unplug ethernet / disable WiFi) for more realistic testing — in that mode, Docker on localhost remains reachable.

---

## 9. Security Constraints (do not change without review)

- Auth cookie names must not change
- Keycloak realm/client config must not change without approval
- AES-256-GCM encryption of all IndexedDB stores must remain
- Per-user key isolation must remain (see §9a): keys are non-extractable, named by
  `SHA-256(salt ‖ uid)`, and a different-uid login wipes all offline data + keys.
  `setActiveOfflineUser` must be called whenever the authenticated user is set.
- `offlineOps` schema changes require explicit approval (would need DB version bump).
  Note: the F12 change adds no fields and does not bump the DB version — it only
  changes the crypto-key storage slot naming, leaving the `offlineOps`/`cachedIncidents`
  object stores byte-identical.
- Sequential sync order (create → update/submit) must be preserved
- `client_id/localId` idempotency key must be preserved on all creates
- `automaticSilentRenew: false` in `oidc.ts` must remain — the library's built-in renew fires Keycloak token endpoints directly from the browser, breaking offline mode

---

## 9a. Offline data lifecycle & per-user isolation (2026-06-12)

### Per-user encryption isolation (item F12)
Each encoder account on a shared device now gets its **own** AES-256-GCM key
(`src/frontend/src/lib/offlineStore.ts`):

- The key is a **non-extractable** `CryptoKey` (raw bytes cannot be exported even
  when read back from IndexedDB).
- Its storage slot is named `aeskey:<hex>` where `<hex> = SHA-256(random per-install
  salt ‖ userId)` — **not** a guessable plaintext uid. The random salt
  (`__wims_key_salt__`) is required to locate another user's key, so a second
  account cannot derive the first user's key slot from a known uid alone.
- `setActiveOfflineUser(userId)` binds the store to the logged-in encoder. It is
  called from `AuthContext` on every session (re)establish, including the
  offline cache-restore path.

**Decisive protection — destruction on account switch:** when a *different* uid
logs in, `setActiveOfflineUser` runs a **full wipe** (`offlineOps`,
`cachedIncidents`, **and all keys**) *before* creating the new user's key. This
clears prior data on the new login — covering the "previous user forgot to log
out" case — not only on the prior user's logout. The previous user's blobs are
both deleted and rendered permanently undecryptable.

**First-run migration:** if a legacy single key (`aes-gcm-key`) exists and this is
the first per-user binding (no prior active uid), that key is adopted under the
new derived name so existing offline work is not orphaned by the upgrade.

**Honest browser limitation:** while a user is the active session, same-origin
code under that session can decrypt *that user's own* data — unavoidable in a
pure client-side PWA without a server-held or user-supplied secret. The
guarantee here is strictly **cross-account**: account B can never read account
A's offline data.

### Cleanup rule (item F11)
Stale/unnecessary offline data is cleared by these rules:

| Trigger | What is cleared |
|---|---|
| **Different uid logs in** | Everything (ops + cache + keys) — `setActiveOfflineUser` |
| **Logout (same device)** | Read cache only (`clearAllCachedIncidents`); unsynced ops kept for same-user re-login |
| **Manual "Clear offline data" button** | Everything (`clearAllOfflineData`), then re-binds current user |
| **After a successful sync** | Synced ops older than 7 days (`purgeSyncedOps`); cached incidents older than 7 days (`evictStaleCachedIncidents`) |

The manual control lives in `OfflineModeManager` on the regional dashboard.

### "Enable offline mode" flow (item E10)
`src/frontend/src/lib/offlineEnable.ts` + `src/frontend/src/components/regional/OfflineModeManager.tsx`:

- A dismissible **banner** appears on the regional dashboard on first online load,
  plus a persistent **Enable / Update offline data** button (and the **Clear
  offline data** button above).
- `enableOfflineMode()` (1) prefetches the offline-capable routes, (2) warms the
  manual-entry form, wildland form, and map chunks via `import()` (SW caches
  them under `/_next/static`), and (3) pre-populates the encrypted IndexedDB
  cache with the encoder's incident list + a capped batch (40) of full incident
  details so view/create/edit work offline without a prior manual visit.
- This is now the **primary** offline-prep mechanism. The pre-existing
  `router.prefetch` (dashboard mount) and eager `import()` (regional layout)
  remain as a passive fallback.

### Health-probe backoff while offline (item G13)
`useNetworkStatus` no longer fires a fixed 5s `/health` probe while offline.
Investigation: the probe errors were harmless (the `fetch` rejection is caught in
`connectivity.ts`), but the browser logged a failed request every 5s as console
noise. The recheck now uses a self-scheduling timeout with **exponential backoff**
(2s → 30s ceiling) that resets on reconnect.

---

## 10. Change Log (this branch)

### 2026-06-12 — Stabilization pass 2 (review fixes)
- **Single connectivity monitor (fixes constant /health failures):** the
  `/health` recheck loop + browser online/offline/focus listeners now live in ONE
  singleton in `connectivity.ts` (`startConnectivityMonitor`). Previously every
  `useNetworkStatus` consumer (dashboard, sync bar, forms, …) ran its own 5s
  interval, so the endpoint was probed many times in parallel. The single loop
  uses exponential backoff (2s→30s) while offline. `useNetworkStatus` is now a
  thin subscriber.
- **Offline toast no longer re-pops:** the persistent "You are offline" toast is
  shown once via a ref and only dismissed when back online; the transient
  `checking` state emitted by each probe no longer dismisses-then-reshows it.
  Wording updated to "You are offline — some features are unavailable…".
- **Offline-mode controls moved to My Profile (`OfflineModeManager variant`):**
  the dashboard now shows only the dismissible first-run banner; the persistent
  Enable/Update + Clear controls live in the Profile tab. Dismissing the banner
  toasts "You can enable offline mode anytime from your Profile tab."
- **Cache-age banner accuracy (#4):** "last updated" now uses the MOST RECENT
  cache write (`Math.max(cachedAt)`) instead of the oldest entry.
- **Offline list now respects filters (#7):** the offline cache path
  (`buildCachedListResult` in `offlineRegional.ts`) applies the same
  status/category/date/archived filters as the online list, instead of dumping
  every cached incident. This removes the "ghost" cards (e.g. yesterday's
  incidents showing under a Today filter). Combined with per-user cache scoping
  (§9a), the offline dashboard only shows the current encoder's relevant records.
- **Offline navigation to unvisited/dynamic routes (#5, #6):** `sw.js` (v7) now
  collapses all `/dashboard/regional/incidents/<id>` routes to ONE canonical
  cache key, so prefetching/visiting any incident online makes EVERY incident —
  including offline-created local UUIDs — viewable offline via soft navigation.
  The detail page is `'use client'`, so the dashboard prefetches a placeholder
  detail route on mount to warm this cache even with zero server incidents.
  Restricted routes (`/dashboard/regional/audit`, `/home`, `/afor/import`) are
  prefetched + precached so they open offline and render their own
  "unavailable offline" guard instead of the browser's offline error page. On a
  true RSC cache miss the SW now returns a network error (triggering Next's hard-
  navigation fallback to the cached shell) instead of `{}` (which crashed the
  router). **Requires the service worker to be registered** — use
  `http://localhost` in dev (see §6); on a valid cert / VPS it registers
  automatically.

### 2026-06-12 — Encoder offline stabilization pass
- **A2 — Richer sync-complete modal:** `SyncedIncidentSummary` now carries
  `operation` (create/update/submit/delete) and a human `result` label. The
  sync engine builds one entry per incident (merged by serverId; highest-order
  action wins) for update/submit/delete ops too, not just creates. The dashboard
  modal lists each item with classification, location, action, and resulting
  status. (`syncEngine.ts`, `dashboard/regional/page.tsx`, `syncEngine.test.ts`)
- **C8 — Withdraw-before-edit for offline-originated pending:** an offline-created
  incident that was submitted offline (queued create + linked submit) now requires
  withdrawing the queued submit before it can be edited, mirroring the online
  PENDING rule. New `getLinkedSubmitOpLocalId` store helper; detail page gates
  Edit behind a withdraw popup and adds a Withdraw button for the local case.
  (`offlineStore.ts`, `incidents/[id]/page.tsx`)
- **E10 / F11 / F12 / G13:** see section 9a above. New files
  `lib/offlineEnable.ts`, `components/regional/OfflineModeManager.tsx`; modified
  `offlineStore.ts` (per-user keys, `setActiveOfflineUser`, `clearAllOfflineData`,
  `getLinkedSubmitOpLocalId`), `AuthContext.tsx` (binds active offline user),
  `useNetworkStatus.ts` (backoff).
- **Verified, unchanged:** B4 (offline-created incidents open in view + edit —
  detail page handles non-numeric local IDs and `handleEditClick`), B5 (offline
  edits to existing incidents queue `update` ops; the backend `encoder_crud`
  update endpoint writes an `EDITED` activity-log entry on sync, so offline edits
  appear in the activity log once connectivity returns — no backend change
  needed), D9 (`/home`, `/audit`, `/afor/import` offline messaging).
- **Tests:** full frontend Vitest suite green (193 tests). New F12 isolation
  tests in `offlineStore.ops.test.ts` (account-switch wipe + same-user preserve).
  Typecheck and lint clean on all touched files.

### Root cause fixes (HAR-confirmed)
- **Fix A:** `oidc.ts` — `automaticSilentRenew: false` — prevents oidc-client-ts timer from calling Keycloak directly while offline
- **Fix B:** `offlineRegional.ts` — reverted detail-before-cache regression; list items now cached immediately on fetch

### Offline navigation (Manual Entry)
- `nginx.local.conf` — port 80 now serves app directly (no HTTP→HTTPS redirect)
- `dashboard/regional/layout.tsx` — eager `import('@/components/IncidentForm')` on mount downloads chunk while online
- `dashboard/regional/page.tsx` — `router.prefetch('/afor/create')` + `router.prefetch('/afor/import')` on mount (unconditional, not gated on `isOnline`)

### Offline error pages
- `/home/page.tsx` — offline guard renders "Operations Unavailable Offline" + back button
- `dashboard/regional/audit/page.tsx` — offline guard renders "Activity Log Unavailable Offline" + back button; `load()` skipped when offline

### Dashboard improvements
- `page.tsx` — `checkPending` poll guarded: `getConnectivitySnapshot().isOnline` returns early when offline
- `page.tsx` — duplicate card fix: pending ops deduplicated against fresh server list by `serverId`
- `page.tsx` — sync notification modal: `wims:sync-complete` event → modal listing synced incidents → Confirm button
- `page.tsx` — filter state persisted to `localStorage` (`wims:regional_filters`)

### IncidentForm
- Classification type validation: cannot save if `classification_of_involved` is set but matching `type_of_involved_general_category` is empty/mismatched
- Online create redirects to incident detail page (not dashboard)
- Removed `base64ToBlob` dead code

### Offline navigation hardening (post-review session)
- `sw.js` v5: Added RSC payload caching (prevents 5-min router-cache expiry breaking offline nav); added OSM tile cache (`wims-tiles-v1`) with transparent GIF fallback
- `afor/error.tsx`: Error boundary auto-reloads on reconnect when stale chunk detected (`ChunkLoadError`); shows "Reconnecting…" during connectivity probe instead of misleading offline message
- `MapPickerInner.tsx`: Marker icons now from `leaflet/dist/images/` (bundled by Next.js, cached by SW); offline amber banner overlay
- `offlineStore.ts`: Added `getOfflineOpByServerId` for offline detail reconstruction of synced incidents
- `offlineRegional.ts`: Added `offlineOps` fallback in detail fetch — reconstructs `RegionalIncidentDetailResponse` from create payload when `cachedIncidents` has no entry
- `dashboard/regional/layout.tsx`: Eager-imports `IncidentForm` so `/afor/create` succeeds offline

### Security / correctness fixes (post-review)
- `main.py`: Removed hardcoded `wimsapp` DB credential; password now derived from `DATABASE_URL` env var (or explicit `WIMS_APP_USER_PASSWORD`)
- `incidents.py`: Idempotency race fixed — INSERT now uses `ON CONFLICT (client_id) DO NOTHING` rather than SELECT-then-INSERT; removes duplicate-key 500 under concurrent retries
- `encoder_crud.py`: Added UUID validation for `client_id` before SQL cast (raises 422 on malformed input); same ON CONFLICT atomicity applied to direct create endpoint
- `keycloak/Dockerfile`, `docker-compose.yml`, `bfp-realm.json`: Removed demo OTP bypass (`WimsDemoOtpFormAuthenticator` / `123123` hardcoded code); reverted to standard `auth-otp-form` authenticator and base Keycloak image
- `syncEngine.ts`: Replaced `as never` / `as unknown as string` type erasure with `ApiFetchResult` discriminated union; `checkSession()` no longer maps 5xx/429 to `offline` (treats as auth/server error instead)

### syncEngine / useAutoSync
- `SyncedIncidentSummary` type added; populated on successful create sync
- `wims:sync-complete` custom event dispatched with `{ incidents: SyncedIncidentSummary[] }` after sync batch

### IncidentCard
- `isDetailCached?: boolean` and `isOnline?: boolean` props
- `offlineUncached` flag disables click, shows "Go online to view" badge, sets `cursor-not-allowed opacity-60`

### Offline incident sync/view stabilization (2026-06-11 follow-up)
- **Root cause of upload-bundle 500:** Postgres rejected `INSERT ... ON CONFLICT` on `wims.fire_incidents` because immutable-record rules exist on that table (`psycopg2.errors.FeatureNotSupported: INSERT with ON CONFLICT clause cannot be used with table that has INSERT or UPDATE rules`).
- **Backend fix:** `src/backend/api/routes/incidents.py` and `src/backend/api/routes/regional/encoder_crud.py` now use `pg_advisory_xact_lock(hashtext('fire_incidents_client_id'), hashtext(client_id))` plus a normal `SELECT` before insert for idempotent offline retries. This preserves `client_id/localId` retry safety without `ON CONFLICT`.
- **UI fix:** Queued offline creates on `/dashboard/regional` now render through the same `IncidentCard` rich tile component with status `PENDING_SYNC` and open `/dashboard/regional/incidents/{localId}`.
- **Detail fix:** `/dashboard/regional/incidents/[id]` now accepts non-numeric local IDs, reconstructs a normal `RegionalIncidentDetailResponse` from the encrypted offline op, and renders the standard read-only incident view. Editing a pending-sync incident updates the existing offline op via `offlineLocalId`; server-only actions remain unavailable until sync creates the real server incident.
- **Compatibility:** The old `/dashboard/regional/incidents/local/[localId]` page still exists for older links, but the dashboard no longer routes users there.
- **Validation:** Backend targeted tests passed: `tests/test_upload_bundle_idempotency.py` and `tests/test_encoder_crud_idempotency.py` (4 passed). Frontend targeted lint passed for the touched files. Offline/sync Vitest suite passed: `syncEngine.test.ts`, `offlineRegional.test.ts`, and `offlineStore.ops.test.ts` (24 passed).

### Offline pending incident full-page actions (2026-06-11 follow-up 2)
- **Full-page offline view:** `/dashboard/regional/incidents/[id]` remains the canonical page for pending-sync local IDs. It does not call the server for non-numeric local IDs; it reads `offlineOps` with `getOfflineOp(localId)`, reconstructs the detail response, and renders the same report sections used by online incidents.
- **Delete pending sync:** Encoders can now delete a pending-sync incident from the normal detail page. `src/frontend/src/lib/offlineStore.ts` adds `deleteOfflineOpCascade(localId)`, which removes the local create op and any queued ops linked to it (for example a linked submit) so reconnect does not replay stale work.
- **Edit pending sync:** The standard Edit button stays on the normal detail page. Saving passes `offlineLocalId` into `IncidentForm`, so edits update the queued create payload in place instead of creating another local incident or calling the server.
- **Legacy route:** `/dashboard/regional/incidents/local/[localId]` is now only a redirect shim to `/dashboard/regional/incidents/{localId}`. Users no longer land on a separate "Edit Local Incident" page.
- **Validation:** Targeted frontend lint passed for the touched route/store/test files. Offline/sync Vitest suite passed: `offlineStore.ops.test.ts`, `syncEngine.test.ts`, and `offlineRegional.test.ts` (25 passed).
