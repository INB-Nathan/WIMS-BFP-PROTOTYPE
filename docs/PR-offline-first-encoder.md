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

## VPS Compatibility

The DigitalOcean VPS setup is **fully compatible** without infrastructure changes. Specific checks:

| Requirement | Status | Detail |
|---|---|---|
| HTTPS for Service Workers | ✅ | `wimsbfp.tech` has TLS 1.3 via Let's Encrypt. `__Host-` cookie prefix also requires HTTPS — satisfied on VPS. |
| No nginx API response caching | ✅ | The nginx config has no `proxy_cache` directive on `/api/*` routes. Offline reads bypass nginx entirely (they read from IndexedDB). |
| SW static file served from Next.js | ✅ | `sw.js` is in `public/` — nginx proxies `/` to `frontend:3000` which serves it. No nginx config change needed. |
| `client_id` column migration | ✅ | Self-healing: `main.py` startup applies `ADD COLUMN IF NOT EXISTS` on every container restart. Existing incidents are unaffected (column is nullable). No `down -v` required. |
| `credentials: 'include'` sync requests | ✅ | The nginx `/api/` block forwards cookies and sets `Access-Control-Allow-Credentials: true`. `proxy_cookie_domain nginx-gateway $host` keeps the cookie domain in sync with the browser. |

**One nginx note**: `sw.js` should ideally be served with `Cache-Control: no-cache` (not `no-store`) so browsers always re-validate it but can still serve a stale copy offline. Next.js defaults work here — it does not aggressively cache files in `public/`. If issues arise, add to the nginx HTTPS block:
```nginx
location = /sw.js {
    proxy_pass http://frontend:3000;
    add_header Cache-Control "no-cache";
}
```

---

## How to Test Locally

Service Workers require a **secure context** (HTTPS or `localhost`). The existing Docker stack serves `localhost` over plain HTTP — browsers treat `localhost` as a secure origin, so SW registration and `__Host-` cookies both work.

```bash
# 1. Start the full stack
cd src && docker compose up --build -d

# 2. Seed dev users (first boot only)
bash scripts/seed-dev-users.sh

# 3. Open http://localhost and log in as a REGIONAL_ENCODER
#    (e.g. encoder01 / password from seed script)

# 4. Navigate to the regional dashboard
#    → You should see SyncStatusBar (green "All synced" when online)
```

**Simulate offline in Chrome/Firefox:**
```
DevTools → Network tab → throttle dropdown → "Offline"
```
Then:
1. Open "Manual Entry" form → fill required fields → click Submit
   - Expected: amber toast "Saved locally — will sync when connection is restored"
   - SyncStatusBar shows "Offline · 1 incident queued"
2. Refresh the page
   - Expected: form draft is restored from IndexedDB (not lost)
3. Dashboard page while offline
   - Expected: amber "Showing cached data" banner; list populated from cache
   - If you had queued a create: "Queued Locally (1)" section appears above the list
4. Go back online (remove the throttle)
   - Expected: SyncStatusBar shows "Syncing 1 incident..." then "All synced"

**Verify in the database:**
```sql
-- Connect: docker exec -it wims-postgres psql -U wims wims
SELECT incident_id, client_id, verification_status, created_at
FROM wims.fire_incidents
ORDER BY created_at DESC LIMIT 5;
-- The row created via offline sync should have a non-null client_id UUID.
```

**Simulate idempotency (duplicate-safe retry):**
```bash
# While online, POST the same incident twice with the same client_id
curl -s -X POST http://localhost/api/regional/incidents \
  -H "Content-Type: application/json" \
  -b "__Host-access_token=<token>" \
  -d '{"latitude":14.5,"longitude":121.0,"region_id":1,"client_id":"aaaaaaaa-0000-0000-0000-000000000001"}'

# Second POST with same client_id — should return the same incident_id, not a new row
curl -s -X POST http://localhost/api/regional/incidents \
  -H "Content-Type: application/json" \
  -b "__Host-access_token=<token>" \
  -d '{"latitude":14.5,"longitude":121.0,"region_id":1,"client_id":"aaaaaaaa-0000-0000-0000-000000000001"}'
```

---

## How Changes Are Validated as Authenticated

Every sync request goes through the same auth stack as any other API call. There is no separate offline-auth mechanism — the offline queue just defers the request until connectivity returns, then submits normally.

**Request path for a synced op:**

```
Browser (syncEngine.ts)
  │
  │  POST /api/regional/incidents
  │  credentials: 'include'               ← sends __Host-access_token cookie automatically
  │
  ▼
Nginx (/api/ block)
  │  proxy_cookie_domain nginx-gateway $host  ← keeps cookie domain valid
  ▼
FastAPI (auth.py: get_current_user)
  │  token = request.cookies.get("__Host-access_token")
  │  if not token → 401
  │  jwt.decode(token, keycloak_public_key, algorithms=["RS256"])
  │    verifies: exp, iat, iss, aud, azp == "wims-web"
  │    checks Redis session-revocation blacklist
  ▼
FastAPI (auth.py: get_current_wims_user)
  │  SELECT user_id, role FROM wims.users
  │  WHERE keycloak_id = token.sub AND is_active = TRUE
  │  if not found → 403
  ▼
FastAPI (routes/regional.py: create_incident)
  │  SET LOCAL wims.current_user_id = user_id   ← RLS GUC
  │  INSERT INTO wims.fire_incidents ...
  │    RLS policy enforces region_id matches encoder's assigned region
  │  client_id UNIQUE index prevents duplicate if retried
  ▼
  201 Created / 200 OK (idempotent return)
```

Key points:
- The **Authorization header is not used** — only the `__Host-access_token` HttpOnly cookie. This cookie cannot be read by JavaScript (XSS-safe) and is `SameSite=Strict` (CSRF-safe).
- The sync engine calls `refreshToken()` before every batch, which hits `/api/auth/refresh`. This exchanges the `__Host-refresh_token` (8-hour lifetime) for a fresh access token. If the refresh token is expired or revoked, `refreshToken()` returns `false` and the batch aborts with `abortReason: 'auth'` — no data is submitted.
- The `client_id` UUID is an **idempotency key only**, not an auth mechanism. It prevents duplicate rows but carries no identity claims.
- RLS at the database level enforces that the encoder can only write to their own region regardless of what `region_id` the client sends.

---

## What Happens if They Cannot Log In

The offline capability is specifically for **encoders who lose connectivity mid-session**, not for unauthenticated access. Here is what happens in each scenario:

### Scenario A — Encoder loses internet while already logged in (< 8 hours)

This is the intended use case. The `__Host-refresh_token` has an 8-hour lifetime.

| Phase | What Happens |
|---|---|
| Goes offline | App shell loads from SW cache. Dashboard reads from `cachedIncidents`. Form autosave continues to IndexedDB. |
| Submits incident offline | Queued to `offlineOps` as `status: pending`. "Saved locally" toast. |
| Reconnects within 8 hours | `syncEngine` calls `refreshToken()` → succeeds → gets a fresh 5-min access token → submits queued ops → "All synced". |
| Reconnects after > 8 hours | `refreshToken()` → Keycloak rejects the expired refresh token → clears both cookies → returns `false`. Sync aborts with `abortReason: 'auth'`. SyncStatusBar shows "Session expired — please log in again." |

**Queued ops are NOT lost** when the session expires. They remain in IndexedDB until the encoder logs back in, at which point the next sync cycle will pick them up.

### Scenario B — Encoder has never logged in on this device

They cannot access the app at all. Keycloak must be reachable to complete the OIDC login flow — the browser redirect to `/auth/realms/bfp/protocol/openid-connect/auth` will fail with a network error. The login page itself requires connectivity.

**There is no offline login mechanism.** This is by design — anonymous access to the encoder dashboard violates the role-based access requirements.

### Scenario C — Encoder's account is deactivated mid-session

The Redis session-revocation blacklist (`utils/session.py`) is checked on every authenticated request. However:
- While **offline**, the blacklist check never fires (no network → no API calls).
- The queued ops remain in IndexedDB locally.
- When **reconnecting**, the sync engine calls `refreshToken()` first. If the account is deactivated, Keycloak will reject the refresh token → `refreshToken()` returns `false` → batch aborts → ops are NOT submitted.
- The deactivation is enforced at reconnect, not at the moment of deactivation (unavoidable for offline-first systems — the device is unreachable).

### Scenario D — Private browsing / incognito

IndexedDB is available but cleared when the private session ends. Draft recovery and cached incidents will not survive closing the private window. The `localStorage` fallback for the form draft also does not persist across private sessions. This is expected behaviour — private mode opts out of persistence.

---

## Testing

```bash
# Frontend unit tests (all 161 pass)
cd src/frontend && npx vitest run

# TypeScript — no errors in production files
cd src/frontend && npx tsc --noEmit
```

## Deferred (Phase 1E+)

- **Conflict resolution UI**: Requires OCC branch (`65-featregional-...`) to be merged. `IncidentConflictMergePanel` already exists; needs to be wired to `syncStatus === 'conflict'` ops from the `offlineOps` store.
- **AFOR import offline block**: Graceful "requires internet connection" message when encoder tries to upload while offline.
- **Crypto key rotation on logout**: `clearCryptoKey()` should be called on session end so cached incidents from one encoder are not readable by the next user on the same device.
- **Online create path in `IncidentForm`**: Still routes through `edgeFunctions.uploadBundle()`. Should use `createRegionalIncident()` for consistency with the offline path.
