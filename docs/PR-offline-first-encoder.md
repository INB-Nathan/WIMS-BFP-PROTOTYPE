# feat(offline): offline-first architecture for Regional Encoder

Adds full offline capability for `REGIONAL_ENCODER` role. Encoders can create, view,
edit, and submit incidents without an internet connection; data syncs automatically on
reconnect. All 13 spec items (A1–G13) are implemented.

## Summary

| Area | What was built |
|---|---|
| **Service worker** | `sw.js` v7 — navigation fallback to cached app shell; canonical path collapsing for incident-detail routes so any prefetched ID makes all IDs (including offline-created UUIDs) navigable offline; RSC miss returns `Response.error()` to trigger Next.js hard-nav fallback instead of crashing the router |
| **IndexedDB (v3)** | `offlineOps` store (operations queue) + `cachedIncidents` store (encrypted read-path cache). Per-user non-extractable AES-256-GCM `CryptoKey` — derived from SHA-256(per-install salt ‖ userId). Account switch wipes all data automatically |
| **Sync engine** | `syncPendingIncidents(encoderId)` — sequential ops (create → submit dependency chain), token refresh before each batch, four op types (create/update/submit/delete), `client_id` idempotency, abort on network error or auth failure. Sync-complete modal lists each synced item with op type and result |
| **Idempotency** | Every offline `create` op carries a UUID `client_id`. The `POST /api/incidents/upload-bundle` endpoint returns the existing incident on duplicate `client_id`. Column added via self-healing `ADD COLUMN IF NOT EXISTS` in `main.py` startup and `postgres-init/45_add_client_id_to_incidents.sql` |
| **Read-path cache** | `fetchRegionalIncidentsOfflineAware` + `fetchRegionalIncidentOfflineAware` write every successful response to IndexedDB. `buildCachedListResult()` applies the same status / category / date / archived filters as the online list — no ghost cards. Cache age shows most-recent refresh timestamp (`Math.max`) |
| **Connectivity monitor** | Singleton `startConnectivityMonitor()` in `connectivity.ts` — one set of event listeners and one exponential-backoff recheck loop (2 s → 30 s) for the whole app. `useNetworkStatus` is a thin `useSyncExternalStore` subscriber; no per-hook intervals |
| **Offline mode setup (E10)** | `offlineEnable.ts` + `OfflineModeManager`. User triggers "Enable offline mode" from My Profile; it prefetches routes, warms form/map JS chunks, and populates up to 100 list items + 40 full incident detail records. Dashboard shows a persistent banner until enabled |
| **Per-user isolation (F12)** | `setActiveOfflineUser(userId)` called from `AuthContext` on every session. On account switch: all three IndexedDB stores wiped, new per-user key created. `clearAllOfflineData()` (Profile "Clear" button) resets everything |
| **Restricted-route offline guard (D9)** | `/dashboard/regional/audit`, `/home`, `/afor/import` precached in SW; pages render their own "unavailable offline" guard instead of the browser's error page |
| **Caller name/contact in list view** | Backend `GET /regional/incidents` now decrypts the AES PII blob per row; `caller_name` and `caller_number` are no longer null for encrypted records |
| **Offline toast (A1)** | Shown once on going offline via `offlineToastShownRef`; never re-pops during probe cycles |
| **PENDING withdrawal (C8)** | Detail page blocks edit when a queued-submit op is linked; Withdraw button removes the submit op and re-enables editing |
| **Auth** | `IncidentForm` autosave uses IndexedDB `offlineOps` store (draft status). Logout clears cached incidents; pending ops are preserved (encrypted, encoder-scoped) so unsynced work survives re-login |

## FRS Traceability

This PR implements **FRS Module 2 (Offline-First Incident Management)**.

| FRS item | Coverage | Evidence |
|---|---|---|
| M2-a (Incident Data Entry) | ✅ | Encoder create/edit form with client-side validation; autosave to IndexedDB `offlineOps` (draft) |
| M2-b (Offline Data Capture and Storage) | ✅ | IndexedDB v3 `offlineOps` + `cachedIncidents` stores; per-user AES-256-GCM encryption; "Offline Mode" indicator via `OfflineModeManager` banner; full CRUD offline |
| M2-c (Data Synchronization) | ✅ | `syncPendingIncidents(encoderId)` auto-sync on reconnect; atomic per-op with `client_id` idempotency; exponential-backoff token refresh; sync-complete modal with per-item results |
| M2-d (Incident Status Tracking) | ✅ | Draft→Pending→Validated/Flagged/Rejected lifecycle; status transitions logged; encoder-visible status history |

**Traceability links:**
- FRS module map: [[concepts/frs-module-map]] (M2 row)
- Offline-first architecture: [[architecture/pwa-tests-cicd]] § Offline-First Infrastructure (FRS M2)
- Gap register: M2b (Offline Encryption), M2c (Sync Toasts), M2d (Offline-first Encoder) all CLOSED — see [[gaps/frs-codebase-gap-register]]
- FRS source: `system-wiki/raw/frs/frs-offlinefirst.md`

## Changed Files

### New files

| File | Purpose |
|---|---|
| `src/frontend/src/lib/connectivity.ts` | Singleton connectivity monitor — backoff loop, browser event listeners, `subscribeConnectivity`, `startConnectivityMonitor`, `probeConnectivity` |
| `src/frontend/src/lib/offlineEnable.ts` | E10 flow — `enableOfflineMode()`, `isOfflineModeEnabled()`, `markOfflineModeEnabled()`, `clearOfflineModeEnabled()` |
| `src/frontend/src/lib/api/offlineRegional.ts` | `fetchRegionalIncidentsOfflineAware`, `fetchRegionalIncidentOfflineAware`, `buildCachedListResult` |
| `src/frontend/src/components/regional/OfflineModeManager.tsx` | `variant="banner"` (dashboard — persistent until enabled) + `variant="panel"` (Profile — Enable/Update/Clear + progress bar) |
| `src/frontend/src/app/dashboard/regional/layout.tsx` | Mounts `SyncStatusBar` on all encoder pages |
| `src/postgres-init/45_add_client_id_to_incidents.sql` | `client_id UUID` column + partial unique index on `wims.fire_incidents` |

### Modified files

| File | Change |
|---|---|
| `src/frontend/public/sw.js` | v7 — `canonicalPath()` for detail routes; precached audit/home/regional routes; `Response.error()` on RSC miss; navigation handler stores canonical key |
| `src/frontend/src/lib/offlineStore.ts` | Per-user AES key derivation (`setActiveOfflineUser`, `getKeySalt`, `keyStorageName`); account-switch wipe; `clearAllOfflineData()`; `getLinkedSubmitOpLocalId()` |
| `src/frontend/src/lib/syncEngine.ts` | Bundle endpoint for create ops; `SyncedIncidentSummary` with `operation` + `result`; `OP_RESULT_LABEL` / `OP_PRECEDENCE`; `recordSynced()` helper |
| `src/frontend/src/lib/useAutoSync.ts` | `offlineToastShownRef` (show-once toast); `encoderId` passed to sync; `conflictCount` exposed |
| `src/frontend/src/lib/useNetworkStatus.ts` | Thin `useSyncExternalStore` subscriber; delegates loop to `startConnectivityMonitor()` |
| `src/frontend/src/components/LayoutShell.tsx` | Removed SW unregistration; calls `registerServiceWorker()` |
| `src/frontend/src/components/IncidentForm.tsx` | Autosave to IndexedDB `offlineOps`; draft recovery from IndexedDB on mount; offline submit queues op |
| `src/frontend/src/components/SyncStatusBar.tsx` | Conflict callout; `conflictCount` from `useAutoSync` |
| `src/frontend/src/app/dashboard/regional/page.tsx` | `OfflineModeManager variant="banner"`; offline-aware list; stale data banner; queued-create section; sync-complete modal; route prefetch |
| `src/frontend/src/app/dashboard/regional/incidents/[id]/page.tsx` | Offline-aware detail fetch; C8 edit-block + Withdraw; context-aware PENDING_SYNC banner |
| `src/frontend/src/app/profile/page.tsx` | `OfflineModeManager variant="panel"` |
| `src/frontend/src/context/AuthContext.tsx` | `setActiveOfflineUser(user.id)` on session fetch and offline cache restore; `clearAllCachedIncidents()` on logout |
| `src/backend/api/routes/regional/encoder.py` | `GET /regional/incidents` — decrypts PII blob per row so `caller_name` / `caller_number` / `owner_name` are populated |
| `src/backend/api/routes/incidents.py` | `POST /api/incidents/upload-bundle` — idempotency check on `client_id`; returns existing incident on duplicate |
| `src/backend/main.py` | Startup self-healing: `ADD COLUMN IF NOT EXISTS client_id UUID` + unique index |

## Architecture Notes

### Operations queue, not payload snapshots

An encoder can create an incident offline, then submit it — also offline. The sync engine must:
1. POST the payload → get `serverId`
2. PATCH `/submit` on that `serverId`

Without an operations queue, step 2 cannot resolve its dependency on step 1. The `offlineOps` store links ops via `linkedLocalId`; a within-batch `syncedServerIds` map propagates `serverId` from create to submit.

### Sequential sync

Parallel dispatch would break the create→submit ordering guarantee (the submit would fire with no `serverId`). Sequential processing preserves causal ordering with negligible overhead for the expected queue depth (single digits for field encoders).

### Idempotency via `client_id`

Network timeouts are indistinguishable from server failures from the client. Without idempotency, a timed-out POST that succeeded server-side produces a duplicate on retry. The `client_id` UUID + `UNIQUE` partial index turns the bundle endpoint idempotent — duplicate `client_id` returns the existing row instead of inserting.

### Per-user AES key isolation

Each encoder account gets a non-extractable `CryptoKey` derived from `SHA-256(per-install random salt ‖ userId)`. The key cannot be exported. On account switch, all three IndexedDB stores are wiped and a new key is generated. This is cross-account isolation only — same-origin same-session can always decrypt its own data (documented limitation in `OFFLINE_HANDOVER.md`).

### SW canonical path for incident detail

All `/dashboard/regional/incidents/<id>` routes share one SW cache key (`__detail__`). Prefetching any incident ID caches the same `'use client'` shell that serves all IDs. This makes offline-created local UUIDs navigable without a per-ID prefetch.

### PII in the list view

`sd.caller_name` and `sd.caller_number` are `NULL` for AES-encrypted records (plaintext columns are always null for new writes; the data lives in `pii_blob_enc`). The list endpoint now decrypts the blob per row using the same `SecurityProvider` pattern as the detail endpoint, with `CRITICAL` log + plaintext fallback on `SecurityProviderError`.

## VPS Compatibility

| Requirement | Status | Detail |
|---|---|---|
| HTTPS for Service Workers | ✅ | `wimsbfp.tech` has TLS 1.3 via Let's Encrypt |
| No nginx API response caching | ✅ | No `proxy_cache` directive on `/api/*`. Offline reads bypass nginx (IndexedDB) |
| SW static file served from Next.js | ✅ | `sw.js` in `public/` — nginx proxies `/` to `frontend:3000`. No nginx change needed |
| `client_id` column | ✅ | Self-healing via `main.py` startup + migration 45. Existing incidents unaffected (nullable) |
| `credentials: 'include'` sync requests | ✅ | nginx `/api/` block forwards cookies; `proxy_cookie_domain` keeps domain valid |

**nginx note for `sw.js`**: add `Cache-Control: no-cache` to prevent stale SW serving:
```nginx
location = /sw.js {
    proxy_pass http://frontend:3000;
    add_header Cache-Control "no-cache";
}
```

## How to Test Locally

Service Workers require a secure context. `http://localhost` qualifies — browsers treat it as secure.

```bash
cd src && docker compose up --build -d
bash scripts/seed-dev-users.sh   # first boot only
# Open http://localhost → log in as REGIONAL_ENCODER (encoder01 from seed script)
```

**Simulate offline (Chrome/Firefox):**
```
DevTools → Network → throttle → Offline
```

1. Dashboard → **My Profile** → Enable offline mode → confirm progress bar completes
2. Set throttle to Offline
3. Navigate to dashboard — stale data banner appears; incident cards load from cache; caller name/contact visible
4. Manual Entry → fill form → Submit — amber toast "Saved locally"; SyncStatusBar shows queued count
5. Open a queued incident — view works; Edit blocked until submitted; Withdraw button clears the queued submit
6. Navigate to Audit Log and AFOR Import — restricted-route guards show, no browser dino page
7. Remove throttle — SyncStatusBar syncs, sync-complete modal lists results; banner disappears from dashboard

**Verify in the database:**
```sql
-- docker exec -it wims-postgres psql -U wims wims
SELECT incident_id, client_id, verification_status FROM wims.fire_incidents
ORDER BY created_at DESC LIMIT 5;
-- Offline-synced rows have a non-null client_id UUID.
```

## Auth flow for synced ops

Every queued op is submitted through the same auth stack as an online request — no separate mechanism.

```
Browser (syncEngine.ts)  →  POST /api/incidents/upload-bundle
                              credentials: 'include'  (HttpOnly __Host-access_token cookie)
  ↓
Nginx  →  FastAPI auth.py
  jwt.decode(token, keycloak_public_key)  — verifies exp/iss/aud/azp
  Redis blacklist check  — rejects revoked sessions instantly
  ↓
get_current_wims_user  →  SELECT user_id, role WHERE is_active = TRUE
  ↓
upload_incident_bundle  →  SET LOCAL wims.current_user_id  (RLS GUC)
  INSERT ... client_id UNIQUE index prevents duplicate on retry
  → 201 Created / 200 OK (idempotent)
```

- `refreshToken()` runs before every sync batch. Expired/revoked refresh token → batch aborts with `abortReason: 'auth'`; queued ops are preserved.
- RLS enforces the encoder can only write to their assigned region regardless of client-supplied `region_id`.
- `client_id` is an idempotency key only — no identity claim.

## Offline session scenarios

| Scenario | Behaviour |
|---|---|
| Loses internet mid-session (< 8 h) | App shell from SW cache; dashboard from IndexedDB; offline create/edit queued. On reconnect: `refreshToken()` succeeds → sync runs → "All synced" |
| Reconnects after > 8 h | `refreshToken()` fails → session cleared → `abortReason: 'auth'`. Queued ops preserved in IndexedDB; sync resumes after re-login |
| Never logged in on this device | Login requires Keycloak reachability. No offline login mechanism by design |
| Account deactivated mid-session | Blacklist check fires at reconnect via `refreshToken()` failure → batch aborts; ops NOT submitted |
| Private browsing | IndexedDB cleared when private window closes. Expected — private mode opts out of persistence |

## Validation

```
Frontend: npx vitest run  → 236 passed (38 test files)
          npm run lint     → 0 errors, 16 warnings
Backend:  ruff check .     → All checks passed!
```

## Deferred

- **Conflict resolution UI (M2-c)**: `IncidentConflictMergePanel` exists; needs wiring to `syncStatus === 'conflict'` ops. Blocked on OCC branch (`65-featregional-...`) merge.
- **Crypto key rotation on logout**: `clearCryptoKey()` is intentionally not called on logout (would orphan encrypted pending ops). Read cache is cleared instead. Full rotation needs a drain-then-wipe flow.
