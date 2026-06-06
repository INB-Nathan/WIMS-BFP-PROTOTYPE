# feat(offline): offline-first architecture for Regional Encoder workflow

## Summary

- **Critical bug fix**: `LayoutShell` was unregistering all service workers on every page load, destroying all PWA and offline capability. Now calls `registerServiceWorker()` instead.
- **Critical bug fix**: `syncEngine.ts` was POSTing to the civilian endpoint (`/api/v1/public/report`) instead of the regional encoder endpoint (`/api/regional/incidents`).
- **IndexedDB v3**: Added `offlineOps` store (operations queue with per-op metadata) and `cachedIncidents` store (encrypted read-path cache). Legacy `incident-queue` store preserved for backward compatibility.
- **Unified offline store**: `IncidentForm` autosave migrated from `localStorage` to IndexedDB `offlineOps` store. A `draft` sync status distinguishes in-progress autosaves from queued submissions. `localStorage` fallback retained for private browsing.
- **Sync engine rewrite**: `syncPendingIncidents(encoderId)` now processes ops sequentially (create → submit dependency chain), refreshes auth token before each batch, supports all four operation types (create, update, submit, delete), marks ops with fine-grained status (`pending`, `syncing`, `synced`, `conflict`, `error`), and aborts on network error.
- **Idempotency key**: Every offline create op carries a client-generated UUID (`client_id`). Backend stores it with a `UNIQUE` partial index on `wims.fire_incidents`. On retry of a timed-out POST, the backend returns the existing incident instead of creating a duplicate.
- **Self-healing migration**: `main.py` startup hook applies `ADD COLUMN IF NOT EXISTS client_id UUID` and the unique index on every container restart, so existing deployments gain the column without a full `down -v` cycle.
- **Read-path cache**: `fetchRegionalIncidentsOfflineAware` and `fetchRegionalIncidentOfflineAware` wrappers write every successful API response into `cachedIncidents` (AES-256-GCM encrypted). When offline, they read from the cache and set `fromCache: true`.
- **Stale data banner**: Regional dashboard and incident detail page show an amber "Showing cached data — last updated X ago" banner when serving from cache.
- **Queued incidents section**: When offline, the regional dashboard shows pending `create` ops from `offlineOps` as a "Queued Locally" list above the cached incident table, so encoders know what will sync on reconnect.
- **SyncStatusBar**: Mounted in the regional layout shell; shows offline/reconnecting/syncing/all-synced/conflict states. Includes conflict callout linking to the resolution tab.
- **Auto-reconnect refresh**: `loadIncidents` in the regional dashboard includes `isOnline` as a dependency, so the incident list re-fetches from the server the moment connectivity returns and the stale banner clears automatically.
- **Network error batch abort fix**: All four op processors (`processCreate`, `processUpdate`, `processSubmit`, `processDelete`) now propagate `status: 0` on network errors so the main sync loop correctly detects connectivity loss and aborts instead of continuing to the next op.
- **Test rewrites**: `syncEngine.test.ts` and `useAutoSync.test.ts` fully updated to match the new API (`syncPendingIncidents(encoderId)`, `getPendingOpsCount`, `SyncResult.conflicts`, `SyncError.localId`).

## Changed Files

| File | Change |
|---|---|
| `src/frontend/src/components/LayoutShell.tsx` | Remove SW unregistration; call `registerServiceWorker()` on mount |
| `src/frontend/src/lib/offlineStore.ts` | Bump DB to v3; add `offlineOps` + `cachedIncidents` stores; export full ops + cache API |
| `src/frontend/src/lib/syncEngine.ts` | Full rewrite — regional endpoints, token refresh, sequential ops, network error propagation |
| `src/frontend/src/lib/useAutoSync.ts` | Use `getPendingOpsCount`; pass `encoderId` to sync; expose `conflictCount` |
| `src/frontend/src/components/IncidentForm.tsx` | Migrate autosave to IndexedDB; draft recovery from IndexedDB on mount; offline submit queues op |
| `src/frontend/src/components/SyncStatusBar.tsx` | Conflict callout; `conflictCount` from `useAutoSync` |
| `src/frontend/src/app/dashboard/regional/layout.tsx` | New — mounts `SyncStatusBar` on all encoder pages |
| `src/frontend/src/app/dashboard/regional/page.tsx` | Offline-aware list fetch; stale data banner; queued incidents section; reconnect re-fetch |
| `src/frontend/src/app/dashboard/regional/incidents/[id]/page.tsx` | Offline-aware detail fetch; cache banner; background poll skips when offline |
| `src/frontend/src/lib/api/offlineRegional.ts` | New — `fetchRegionalIncidentsOfflineAware` + `fetchRegionalIncidentOfflineAware` wrappers |
| `src/backend/schemas/regional.py` | Add `client_id: str | None` to `IncidentCreateRequest` |
| `src/backend/api/routes/regional.py` | Idempotency check on `POST /regional/incidents` using `client_id` |
| `src/backend/main.py` | Startup self-healing patch: `ADD COLUMN IF NOT EXISTS client_id UUID` + unique index |
| `src/postgres-init/45_add_client_id_to_incidents.sql` | New migration — `client_id UUID` column + partial unique index on `fire_incidents` |
| `src/frontend/src/lib/__tests__/syncEngine.test.ts` | Full rewrite to match new `syncPendingIncidents(encoderId)` API |
| `src/frontend/src/lib/__tests__/useAutoSync.test.ts` | Updated mocks for `getPendingOpsCount`, `SyncResult.conflicts`, `SyncError.localId` |

## Architecture Notes

### Why operations queue, not payload snapshots

The old `incident-queue` store held raw payloads. This was sufficient for create-only offline submissions but breaks down the moment an encoder creates an incident offline, saves it, then submits it — also offline. By the time connectivity returns, the sync engine needs to know:
1. POST the payload to create the incident and get back a `serverId`
2. PATCH `/submit` on that `serverId`

Without an operations queue the engine cannot resolve step 2's dependency on step 1. The new `offlineOps` store links ops via `linkedLocalId` and a within-batch `syncedServerIds: Map<string, number>` that is populated as creates succeed.

### Why sequential sync (not parallel)

Parallel dispatch would break the create→submit ordering guarantee. A create and its linked submit would race; if the submit fires first it has no `serverId` and fails. Sequential processing preserves causal ordering with negligible overhead for the expected queue size (single digits for field encoders).

### Why `client_id` on the backend

Network timeouts are indistinguishable from server-side failures from the client's perspective. Without idempotency, a timed-out POST that actually succeeded server-side results in a duplicate incident on retry. The `client_id` UUID + `UNIQUE` partial index turns the create endpoint idempotent: a duplicate `client_id` returns the existing row instead of inserting.

### Security

All `offlineOps` and `cachedIncidents` payloads are encrypted with AES-256-GCM using a per-browser `CryptoKey` stored in IndexedDB. The key is never exported to `localStorage`. The key should be cleared on logout (Phase 1E cleanup). Auth is refreshed before every sync batch so a revoked session cannot submit queued ops.

## Testing

```bash
# Frontend unit tests (all 161 pass)
cd src/frontend && npx vitest run

# TypeScript — no errors in production files
cd src/frontend && npx tsc --noEmit

# Manual integration scenario
# 1. docker compose up --build -d
# 2. Open encoder dashboard; fill IncidentForm
# 3. Chrome DevTools → Network → Offline
# 4. Submit → "Saved locally" toast; SyncStatusBar shows queued count
# 5. Reload → form draft recovered from IndexedDB
# 6. Network → Online → SyncStatusBar shows "Syncing 1 incident..." then "All synced"
# 7. SELECT * FROM wims.fire_incidents ORDER BY created_at DESC LIMIT 3;
#    -- Confirm client_id is set, no duplicate rows
```

## Deferred (Phase 1E+)

- **Conflict resolution UI**: Requires OCC branch (`65-featregional-...`) to be merged. `IncidentConflictMergePanel` already exists; needs to be wired to `syncStatus === 'conflict'` ops from the `offlineOps` store.
- **AFOR import offline block**: Graceful "requires internet connection" message when encoder tries to upload while offline.
- **Crypto key rotation on logout**: `clearCryptoKey()` should be called on session end so cached incidents from one encoder are not readable by the next user on the same device.
- **Online create path in `IncidentForm`**: Still routes through `edgeFunctions.uploadBundle()`. Should use `createRegionalIncident()` for consistency with the offline path.
