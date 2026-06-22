---
title: PWA/Offline-First, Tests & CI/CD
created: 2026-05-16
updated: 2026-06-21
type: architecture
tags: [wims-bfp, pwa, offline-first, testing, ci-cd, service-worker, sync-engine, validator-offline]
sources: [src/frontend/src/lib/, src/frontend/src/lib/api/offlineAnalytics.ts, src/frontend/src/lib/api/offlineValidator.ts, src/frontend/src/lib/api/offlineBase.ts, src/frontend/public/sw.js, src/frontend/src/app/home/__tests__/operations-board.test.tsx, .github/workflows/, src/backend/main.py, src/backend/tests/test_immutable_records.py, src/backend/tests/test_schema_patch_startup_guard.py]
status: draft
---

# PWA/Offline-First, Tests & CI/CD

## Offline-First Infrastructure (FRS M2)

### `offlineStore.ts` — IndexedDB Queue + Encrypted Analytics Read Cache

**File:** `src/frontend/src/lib/offlineStore.ts`

Wraps IndexedDB (via Jake Archibald's `idb` library) in database `wims-bfp-db`. The database is now version 6: legacy offline incident queue records remain in `incident-queue`, reusable AES-GCM key material remains in `crypto-keys`, analyst/admin/validator offline read caching uses the encrypted `analytics-cache` object store keyed by `{prefix}:{cacheKey}`, and a new unencrypted `reference-cache` object store (DB v6) holds per-user-namespaced reference data (`reference:{userId}:...`) such as regions/provinces/cities. Encrypted cached values are stored as `{ key, encrypted, cachedAt, ttlMs }`; reference cached values are stored as `{ key, data, cachedAt, ttlMs }` (plaintext). No heatmap/detail/sensitive payload is written to IndexedDB in raw form. Per-record `ttlMs` (pushback P3) lets eviction prune by the record's own expiry.

Account-switch and manual offline-data clearing now wipe the legacy Phase 1A `incident-queue` store in addition to `offlineOps`, `cachedIncidents`, `crypto-keys`, and the prior user's `reference:{prevUserId}:*` prefix in `reference-cache` (pushback P1), so pre-Phase 1B queued rows are not carried over on shared devices after a different encoder logs in and the prior user's plaintext RLS-scoped ref data does not survive.

| Export | Signature | Description |
|---|---|---|
| `queueIncident(payload, options?)` | `(Record<string,unknown>, { opType?, localId? }?) => Promise<void>` | Inserts pending incident with `createdAt=Date.now()`, `status='pending'`; persists validator op metadata for sync dispatch/idempotency. |
| `getPendingIncidents()` | `() => Promise<PendingIncident[]>` | Returns all records where `status === 'pending'` |
| `markSynced(id)` | `(number) => Promise<void>` | Marks item synced then deletes it |
| `clearSynced()` | `() => Promise<void>` | Deletes all synced items |
| `cacheReadResponse(key, data, ttlMs, cachedAt?)` | `(string, unknown, number, number?) => Promise<void>` | Encrypts and stores a generic read response in `analytics-cache`; stores per-record `ttlMs` for per-record eviction. |
| `getReadCachedResponse(key)` | `(string) => Promise<CachedResponse \| undefined>` | Decrypts a cached read response and returns `{ key, data, cachedAt, ttlMs }`. |
| `cacheReferenceData(key, data, ttlMs, cachedAt?)` | `(string, unknown, number, number?) => Promise<void>` | Plaintext write to the unencrypted `reference-cache` store. Caller MUST build a userId-namespaced key (`reference:{userId}:...`) so per-user isolation is achieved. |
| `getCachedReferenceData(key)` | `(string) => Promise<CachedResponse \| undefined>` | Plaintext read from `reference-cache`. |
| `evictExpiredReadCache()` | `() => Promise<number>` | Cursor-scan `analytics-cache`; delete records whose `cachedAt + ttlMs < now`; per-record TTL; capped at 500 deletions/pass; back-compat default 30min when `ttlMs` missing. Best-effort. |
| `evictExpiredReferenceData()` | `() => Promise<number>` | Same for `reference-cache`; 7-day TTL for ref entries. Best-effort. |
| `clearReferenceDataForUser(userId)` | `(string) => Promise<number>` | Regex prefix sweep `^reference:{userId}:` on `reference-cache`; returns deleted count. Best-effort, never throws. |
| `clearAnalyticsCache()` | `() => Promise<void>` | Clears the encrypted read cache |

### `connectivity.ts` — Reachability Snapshot

**File:** `src/frontend/src/lib/connectivity.ts`

Adds a small shared connectivity module for offline-aware API wrappers. It tracks `online`, `offline`, `checking`, and `reconnecting` states from `navigator.onLine` plus a `/health` probe, exposes `getConnectivitySnapshot()`, `subscribeConnectivity()`, `probeConnectivity()`, `isReachable()`, and `markConnectivityOffline()`, and lets wrappers fail over to IndexedDB when fetch/network errors imply an effective offline state. `src/frontend/src/lib/__tests__/connectivity.test.ts` covers snapshot shape, subscriber notifications, offline marking, probe success/failure, probe deduplication, and reachability helpers.

### `api/offlineAnalytics.ts` — Analyst Offline-First Read Wrappers

**File:** `src/frontend/src/lib/api/offlineAnalytics.ts`

Adds 9 offline-aware read wrappers for the National Analyst surface: heatmap, trends, comparative, type distribution, response time, top-N, filter options, analyst incident detail, and analyst sensitive detail. Each wrapper returns `{ response, fromCache, cachedAt? }`, uses a 30-minute TTL, reads a valid encrypted cache without calling the network when connectivity is offline, caches successful online responses, marks connectivity offline on network-style errors (`TypeError`, `ERR_*`, `Failed to fetch`, `NetworkError`, `net::ERR`), and throws a friendly offline-unavailable error on cache miss/stale entries. Export queueing is not cached.

### `syncEngine.ts` — Core Sync Logic (FR-3B, FR-3F)

**File:** `src/frontend/src/lib/syncEngine.ts`

Reads pending encoder operations from IndexedDB and replays them against the authenticated regional incident APIs in creation order. Offline create ops use the full-fidelity `/api/incidents/upload-bundle` path with `client_id` idempotency so nested AFOR details are preserved and retry-safe.

| Export | Signature | Description |
|---|---|---|
| `syncPendingIncidents(encoderId, options?)` | `(string, { bypassBackoff?: boolean }) => Promise<SyncResult>` | Verifies app reachability, refreshes auth, replays queued create/update/submit/delete/archive-action ops oldest-first, returns `{ synced, conflicts, failed, errors, abortReason? }`. Auto/background sync respects exponential backoff; manual Sync Now passes `bypassBackoff: true` so an encoder can immediately retry queued failures. |

**Failure behavior:** offline/unreachable aborts with `abortReason: 'offline'` and keeps the queue intact; expired auth aborts with `abortReason: 'auth'`; network loss during a batch marks the current op `network` and stops; 409 moves the op to conflict state.

`src/frontend/src/lib/__tests__/offlineRegional.test.ts` now covers regional cached-list fallback filter parity for status, category, date range, archived/non-archived views, empty matches, newest `cachedAt`, and offline-branch isolation so the encoder dashboard's offline list behavior stays aligned with online filters.

Encoder archive/unarchive actions now use `src/frontend/src/lib/api/offlineRegionalActions.ts`: when offline or when an online request fails with a network error, the dashboard queues an `archive_action` offline op with `scope: 'encoder'`. `syncEngine.ts` routes scoped encoder archive actions to `/api/regional/incidents/{id}/archive|unarchive` while preserving existing validator archive actions on `/api/regional/validator/incidents/{id}/archive|unarchive`.

`src/frontend/src/components/__tests__/IncidentForm.offline.test.tsx` covers the encoder `IncidentForm` offline create path: Save as Draft queues one `create` op and redirects to `/dashboard/regional`, while Submit for Review queues a `create` op plus linked `submit` op so sync replays the draft and immediate submission in order.

Regional incident cards preserve visible-but-disabled online incidents while offline when their detail payload is not cached. `page.tsx` now computes cached detail availability from `cachedIncidents` regardless of whether the visible list was loaded online or from cache, and `IncidentCard.test.tsx` verifies offline uncached cards show `Go online to view` without dispatching navigation while cached cards remain clickable. Pending-sync local incident drafts use the same dynamic detail page; the service worker precaches `/dashboard/regional/incidents/1` and falls back to that detail shell for arbitrary `/dashboard/regional/incidents/<localId>` offline navigations before using the generic dashboard/offline fallback. The detail page reads the incident id from the live browser pathname (via `extractRegionalIncidentRouteId`) rather than cached App Router params so an offline shell cached from `/incidents/1` still opens the requested local UUID draft.

### `api/offlineValidator.ts` — Validator Offline-First Action Wrappers (GH #269)

**File:** `src/frontend/src/lib/api/offlineValidator.ts`

Adds offline-aware write wrappers for the National Validator dashboard: queue fetch, verification, and archive/unarchive. Each action wrapper checks connectivity snapshot; when offline or navigator.onLine is false, queues via `queueIncident()` with appropriate `opType` (`'verify'` or `'archive_action'`) and a generated `localId` (`crypto.randomUUID()`). When online, calls the real API via `apiFetch`. On network errors mid-flight, marks connectivity offline and falls back to queuing. 409 responses (including `DUPLICATE_DETECTED`) are surfaced to the caller for UI handling.

| Export | Signature | Description |
|---|---|---|
| `submitVerificationOfflineAware(incidentId, action, notes, originalIncidentId?)` | `(number, VerifyAction, string \| null, number?) => Promise<OfflineQueueResult>` | Accept/reject/accept_replace verification; returns `{ queued, localId }`. Queues as `opType: 'verify'` with `original_incident_id` when offline or on network failure. |
| `submitArchiveActionOfflineAware(incidentId, action)` | `(number, 'archive' \| 'unarchive') => Promise<OfflineQueueResult>` | Generic archive/unarchive; returns `{ queued, localId }`. Queues as `opType: 'archive_action'`. |
| `archiveIncidentOfflineAware(incidentId)` | `(number) => Promise<OfflineQueueResult>` | Convenience wrapper calling `submitArchiveActionOfflineAware(id, 'archive')`. |
| `unarchiveIncidentOfflineAware(incidentId)` | `(number) => Promise<OfflineQueueResult>` | Convenience wrapper calling `submitArchiveActionOfflineAware(id, 'unarchive')`. |
| `fetchValidatorQueueOfflineAware<T>(params, fetcher, userId?)` | `(Record<...>, () => Promise<T>, string?) => Promise<OfflineValidatorQueueResult<T>>` | Queue fetch with 30-min TTL encrypted read cache keyed as `validator:queue:{userId}:{params}`. Returns `{ response, fromCache, cachedAt? }`. Follows same pattern as `offlineAnalytics.ts`. |

**Validator dashboard wiring (GH #269):** The `/dashboard/validator` page now mounts `useNetworkStatus()` and `useAutoSync()`, calls the wrappers for queue fetch, archive, unarchive, and verification (accept/reject/accept_replace). Delete, bulk approve, and forced duplicate "accept as new" remain online-only. A stale-cache amber banner appears when data is served from the encrypted IndexedDB cache. A validator-only pending ops count, sync-complete notification, and offline indicator badges are shown in the page header. The page listens for both current service-worker `sync-complete` messages and issue-named `wims:sync-complete` messages, then refreshes the queue after background sync completes.

### `useNetworkStatus.ts` — Network State Hook (FR-3A)

**File:** `src/frontend/src/lib/useNetworkStatus.ts`

| Export | Signature | Description |
|---|---|---|
| `useNetworkStatus()` | `() => NetworkStatus` | Returns `{ isOnline, isReconnecting }`. `isReconnecting` is true for 3s after transitioning offline→online |

### `useAutoSync.ts` — Auto-Sync on Reconnect (FR-3C)

**Current stabilization (2026-06-07):** `lib/connectivity.ts` is now the shared source of truth. Browser `online/offline`, focus, and visibility events are hints only; the state remains `checking/offline/reconnecting/online` until a same-origin `/health` probe confirms reachability. `useNetworkStatus()` now exposes `{ state, isOnline, isChecking, isReconnecting, lastCheckedAt }`, and fetch/network failures can force offline through `markConnectivityOffline()`.

**File:** `src/frontend/src/lib/useAutoSync.ts`

| Export | Signature | Description |
|---|---|---|
| `useAutoSync()` | `() => AutoSyncState` | Returns `{ syncing, lastSyncedAt, pendingCount, conflictCount, authFailed, syncNow }`. Uses a mutex to prevent concurrent syncs, runs once on reconnect/re-login when pending ops exist, suppresses repeated auth-expired toasts, and listens for SW `run-sync` messages. `syncNow()` bypasses the retry backoff window so the visible encoder button performs an immediate retry. |

### `swRegistration.ts` — Service Worker Registration (FR-3D)

**File:** `src/frontend/src/lib/swRegistration.ts`

| Export | Signature | Description |
|---|---|---|
| `registerServiceWorker()` | `() => Promise<ServiceWorkerRegistration\|null>` | Registers `/sw.js`. Safe to call on mount. |
| `registerBackgroundSync()` | `() => Promise<boolean>` | Registers Background Sync with tag `sync-pending-incidents` |
| `getRegistration()` | `() => ServiceWorkerRegistration\|null` | Returns current SW registration |

### Service Worker

**File:** `src/frontend/public/sw.js`

Vanilla (no-workbox) service worker:

- **Install:** Cache-first for `['/', '/dashboard', '/login', '/manifest.webmanifest']`
- **Activate:** Cache whitelist cleanup, `self.clients.claim()`
- **Fetch:** API/auth routes remain network-only; document navigations are network-first and fall back to a cached app shell or friendly offline HTML instead of a browser network error; visited Next.js static chunks are cached for later offline rendering.
- **Background Sync:** Listens for `sync-pending-incidents` and posts `run-sync` to open clients. The page owns auth refresh and ordered create-to-submit replay; the SW does not POST queued incidents directly.

### Web App Manifest

**File:** `src/frontend/public/manifest.webmanifest`

| Field | Value |
|---|---|
| `name` | WIMS-BFP Prototype |
| `short_name` | WIMS-BFP |
| `start_url` | `/dashboard` |
| `display` | `standalone` |
| `background_color` | `#ffffff` |
| `theme_color` | `#dc2626` (red) |

---

## Test Infrastructure

### Test Framework

pytest with `pytest-asyncio` for async tests. Markers: `unit`, `integration`, `requires_keycloak`, `requires_docker`, `slow`.

### Test File Layout

```
src/backend/tests/
├── conftest.py              # Env load, AES key, marker registration, Redis rate-limit key flush fixture (4 namespaces: `public_rate_limit:*`, `rate_limit:*`, `wims:rl:public_consent:*`, `wims:rl:public_notify:*`)
├── integration/             # Full-stack integration tests
│   ├── conftest.py          # No-op rate-limit fixture
│   ├── test_admin_api.py
│   ├── test_analytics_api.py
│   ├── test_analytics_security.py
│   ├── test_analyst_dashboard_queue.py
│   ├── test_auth_callback.py
│   ├── test_auth_otp_policy.py
│   ├── test_backup_api.py
│   ├── test_civilian_api.py
│   ├── test_database_schema.py
│   ├── test_incidents_api.py
│   ├── test_keycloak_password_reset.py  # ~750 lines, full e2e Keycloak+MailHog
│   ├── test_regional_afor_unified_import.py
│   ├── test_regional_crud.py
│   ├── test_rls_api_enforcement.py
│   ├── test_rls_policy_enforcement.py
│   ├── test_sql_quality_audit.py
│   ├── test_triage_api.py
│   └── test_wims_initial_schema_bootstrap.py
├── test_analyst_export.py
├── test_analyst_incidents_sql_contract.py
├── test_afor_import.py
├── test_crypto.py
├── test_fire_incident_location.py
├── test_immutable_records.py
├── test_infra_config.py
├── test_rate_limiting.py
└── test_suricata_ingestion.py
```

Total: 31 documented test files plus conftest files. `test_dev_user_seed_mapping.py` statically verifies the canonical dev encoder usernames, deterministic Keycloak UUIDs, seed scripts, SQL bootstrap rows, and realm-export passwords.

### Key Test Patterns

**1. SQL Contract Tests (`test_analyst_incidents_sql_contract.py`)**
Unique static analysis pattern. Uses `inspect.getsource()` to capture route function source code and asserts on raw SQL string content — no database required. 5 tests guarding against schema regressions in analyst list/detail queries.

**2. Standard Unit Tests (`test_analyst_export.py`)**
Uses `unittest.mock` (MagicMock, patch), `tmp_path`, `monkeypatch`. No database needed. Tests: column allowlist filtering, Celery task dispatch, argument deduplication, role rejection, file I/O verification with `csv.DictReader`.

**3. Integration Tests (`test_keycloak_password_reset.py`)**
~750 lines, full e2e against live services. Patterns: fixture-based prerequisites (auto-skip if Keycloak unreachable), resource setup/teardown, helper functions for API interaction, MailHog email extraction. Tests pre-flight config (5) + full e2e flow (4) including OWASP user enumeration prevention, single-use token enforcement. The test uses `KEYCLOAK_PASSWORD_RESET_CLIENT_ID` (default `bfp-client`) for Direct Grant-specific checks so CI/global backend auth defaults can remain `wims-web`/`wims-web`.

**4. Rate-limit test isolation** — root `conftest.py` clears four Redis namespaces before each test: `public_rate_limit:*` (DMZ), `rate_limit:*` (PKCE callback), `wims:rl:public_consent:*` (`/api/auth/consent` 5/IP/hr), and `wims:rl:public_notify:*` (`/api/civilian/reports/{id}/notify` 5/IP/hr). The `wims:rl:public_*` namespaces were added in the 2026-06-22 follow-up to the WS1 XFF→`trusted_client_ip` migration; without them, consent/notify tests collide on the shared TestClient fallback IP ("testclient") once ~5 prior tests have spent the bucket. This prevents public submission, PKCE callback, consent, and notify endpoint tests from inheriting a spent sliding-window budget from earlier tests while preserving per-test burst behavior.

**5. ci.yml exclusions** — 8 test files explicitly excluded from CI runner: rate-limiting, suricata, infra-config, bootstrap, OTP, schema, RLS policy, SQL quality (need special Docker setup).

**6. Startup DDL and pytest lock-hang regression (PR #207)**
`src/backend/main.py` intentionally does not patch `wims.users.email` at FastAPI startup. Migration `src/postgres-init/44_add_email_to_users.sql` owns that column plus the local unique email index for fresh CI databases. Runtime DDL on `wims.users` can block indefinitely when tests hold ordinary SQLAlchemy sessions open: `src/backend/tests/test_immutable_records.py` reads `wims.users` in region fixtures, then creates `TestClient(app)`, which triggers startup before fixture teardown. A startup `ALTER TABLE wims.users ...` queued for `AccessExclusiveLock` behind the open `AccessShareLock`, making CI appear to stop after the preceding fire-location test. Future startup schema patches should avoid user-table DDL or use bounded lock handling.

**7. Operations Board offline-guard test mock (2026-06-12)**
`src/frontend/src/app/home/page.tsx` uses `useNetworkStatus()` to render an offline restricted-route guard for `/home`. `src/frontend/src/app/home/__tests__/operations-board.test.tsx` must mock `useNetworkStatus()` as online for Operations Board tests; otherwise jsdom renders "Operations Unavailable Offline" and hides the board controls. After the merge fix, `npx.cmd vitest run` passed 38 frontend test files / 236 tests.

**8. Backend startup schema patch guard** — `src/backend/main.py` runs compatibility schema repairs for old containers at FastAPI startup, but guards the routine with a process-local lock/attempt flag so repeated `TestClient(app)` lifespans in pytest do not rerun DDL/RLS patch blocks. `src/backend/tests/test_schema_patch_startup_guard.py` verifies that repeated calls reopen no second admin DB session and rerun no patch helpers.

**9. Auth/RLS test override pattern** — tests that override role-specific dependencies such as `get_regional_encoder` or `get_system_admin` must also override `get_current_wims_user` or `get_db_with_rls` when the route uses an RLS-scoped DB dependency. Reference-table RLS tests use a `wims_app_user` connection instead of the CI postgres superuser so PostgreSQL row-level policies are actually enforced.

**10. RLS init contract tests** — `src/backend/tests/test_rls_init_contract.py` statically guards the database bootstrap path: `wims.current_user_role()` must be defined only by `src/postgres-init/09_rls_helpers.sql`, backend startup repair must not recreate helper functions with ad hoc SQL quoting, and `14a_assign_ncr_to_test_users.sql` must assign NCR to canonical `encoder_ncr` rather than legacy `encoder_test`.

---

## CI/CD Pipelines

### CI — `.github/workflows/ci.yml`

**Trigger:** PRs to `master` + pushes to `master`, `fix/*`, `feature/*`, `refactor/*`, `hotfix/*`

**Concurrency:** Grouped by ref, cancels in-progress.

**Jobs (parallel, merge-gate blocks):**

| Job | Runner | What It Runs |
|---|---|---|
| `security-audit` | ubuntu-latest | `pip-audit` + `npm audit --omit=dev` (continue-on-error) |
| `migrations` | ubuntu-latest | PostGIS 15-3.4 service container, applies all .sql files in lexical order, asserts schema |
| `frontend` | ubuntu-latest | Node 20, `npm ci` → `npm run lint` → `npx vitest run` → `npm run build` |
| `backend` | ubuntu-latest | Python 3.12, PostGIS + Redis 7 service containers. `KEYCLOAK_CLIENT_ID`/`KEYCLOAK_AUDIENCE` are set to `wims-web`/`wims-web`; Direct Grant tests scope `bfp-client` separately. `ruff check` → `ruff format --check` → `pytest -v --tb=short` (8 test files excluded) |
| `docker-build` | ubuntu-latest | Copies root `.env.example` to `src/.env` for required compose interpolation, then runs `docker compose config` validation + `docker compose build --parallel` |
| `security-scan` | ubuntu-latest | Copies root `.env.example` to `src/.env`, then runs OWASP ZAP baseline scan + Nmap port scan. Uses `.zap/rules.tsv` to ignore 7 pre-existing WARN alerts (CSP/COEP headers, Keycloak upstream, Next.js informational). Uses `zaproxy/action-baseline@v0.15.0` plus explicit artifact name `zap-scan` to avoid legacy artifact-upload rejection in older ZAP action packaging. `fail_action: true` — only new HIGH/CRITICAL block merge. Stack is brought up with `docker compose -f docker-compose.yml -f docker-compose.ci.yml` to use the HTTP-only `nginx.ci.conf`, avoiding TLS certificate requirements that exist in the local (`nginx.local.conf`) and production (`nginx.conf`) configs. |
| `merge-gate` | ubuntu-latest | **Blocks merge** unless migrations, frontend, backend, docker-build, and security-scan all pass |

The backend job still runs a second advisory coverage pass after the main pytest pass. If backend runtime spikes while the first `Run tests` step is still active, inspect startup/test fixture behavior before changing the coverage step.

### CD — `.github/workflows/cd.yml`

**Trigger:** Push to `master` only

**Concurrency:** Single deploy at a time (no cancel-in-progress)

| Job | Description |
|---|---|
| `build-images` | Matrix over backend → `wims-backend`, frontend → `wims-frontend`. Docker Buildx with GHCR cache (`type=gha`), pushes to `ghcr.io/{owner}/wims-{backend|frontend}` with `{sha}` + `latest` tags |
| `notify` | Writes job summary table to `$GITHUB_STEP_SUMMARY` with built images, commit SHA, branch, trigger |

### VPS Deploy — `.github/workflows/deploy.yml`

**Trigger:** Push to `master` only

The deploy workflow has a `ci` gate before SSH deployment. The backend test step runs on the GitHub runner, so it must use GitHub Actions service containers rather than Docker Compose service DNS names. The gate now provisions PostGIS (`localhost:5432`) and Redis (`localhost:6379`), initializes `wims_test` by applying `src/postgres-init/*.sql` in lexical order, sets backend auth envs to `wims-web`/`wims-web`, and runs the same backend pytest exclusion set used by `.github/workflows/ci.yml`.

The SSH deployment step exports production secrets such as `DATABASE_URL`, `REDIS_URL`, Keycloak realm URL, and `WIMS_MASTER_KEY`, plus the non-secret web OIDC defaults `KEYCLOAK_CLIENT_ID=wims-web` and `KEYCLOAK_AUDIENCE=wims-web`; then it updates `/opt/wims-bfp` from `origin/master` with `git fetch` + `git checkout -B master origin/master`. This avoids ambiguous `git pull` behavior on a VPS checkout after a force-updated remote. It performs a pre-deploy database connectivity check from the backend container before rebuilding and restarting the backend service. The rollback-tag step uses Docker's quiet image output directly, avoiding a `jq` dependency on the VPS.

Post-restart health polling uses a 15-second settle delay plus 45 iterations × 2s = 90s total capacity. The health check is performed inside the `wims-backend` container using Python/httpx against `http://localhost:8000/health` (the backend's actual route). Deployment also requests public `/api/public/emergency-services` because nginx serves `/health` itself; the real API probe verifies nginx can reach the current backend container address after a recreation. Compose startup uses `--wait`, and deployment verifies that `qwen2.5:3b` is present after the one-shot Ollama model-pull service completes.

The SSH action's `envs:` list must include every variable the script references. `DEPLOY_COMMIT` is set in the `deploy` job's `env:` block (`DEPLOY_COMMIT: ${{ github.sha }}`) but was missing from the `Deploy via SSH` step's `envs:` passthrough, causing `set -euo pipefail` to exit 1 on the unbound variable before the health check ran.
