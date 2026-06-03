---
title: PWA/Offline-First, Tests & CI/CD
created: 2026-05-16
updated: 2026-06-03
type: architecture
tags: [wims-bfp, pwa, offline-first, testing, ci-cd, service-worker]
sources: [src/frontend/src/lib/, src/frontend/public/sw.js, .github/workflows/]
status: draft
---

# PWA/Offline-First, Tests & CI/CD

## Offline-First Infrastructure (FRS M2)

### `offlineStore.ts` — IndexedDB Queue

**File:** `src/frontend/src/lib/offlineStore.ts`

Wraps IndexedDB (via Jake Archibald's `idb` library) with a single object store `incident-queue` in database `wims-bfp-db`.

| Export | Signature | Description |
|---|---|---|
| `queueIncident(payload)` | `(Record<string,unknown>) => Promise<void>` | Inserts pending incident with `createdAt=Date.now()`, `status='pending'` |
| `getPendingIncidents()` | `() => Promise<PendingIncident[]>` | Returns all records where `status === 'pending'` |
| `markSynced(id)` | `(number) => Promise<void>` | Marks item synced then deletes it |
| `clearSynced()` | `() => Promise<void>` | Deletes all synced items |

### `syncEngine.ts` — Core Sync Logic (FR-3B, FR-3F)

**File:** `src/frontend/src/lib/syncEngine.ts`

Reads pending items from IndexedDB, POSTs each to `/api/v1/public/report`, marks synced.

| Export | Signature | Description |
|---|---|---|
| `syncPendingIncidents()` | `() => Promise<SyncResult>` | Iterates pending items, POSTs each, returns `{ synced, failed, errors }` |

**Conflict resolution:** Last-write-wins (LWW) on HTTP 409. If `server_updated_at` is older than local `createdAt`, retries with `X-Conflict-Resolution: overwrite` header.

### `useNetworkStatus.ts` — Network State Hook (FR-3A)

**File:** `src/frontend/src/lib/useNetworkStatus.ts`

| Export | Signature | Description |
|---|---|---|
| `useNetworkStatus()` | `() => NetworkStatus` | Returns `{ isOnline, isReconnecting }`. `isReconnecting` is true for 3s after transitioning offline→online |

### `useAutoSync.ts` — Auto-Sync on Reconnect (FR-3C)

**File:** `src/frontend/src/lib/useAutoSync.ts`

| Export | Signature | Description |
|---|---|---|
| `useAutoSync()` | `() => AutoSyncState` | Returns `{ syncing, lastSyncedAt, pendingCount, syncNow }`. Uses a mutex (`useRef`) to prevent concurrent syncs. Triggers sync after 2s debounce on reconnecting. |

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
- **Fetch:** Cache-first for non-API/non-auth routes; pass-through for `/api/` and `/auth/`
- **Background Sync:** Listens for `sync-pending-incidents` tag, reads `wims-bfp-db`/`incident-queue` directly in SW context, POSTs each, deletes on success, notifies clients via `postMessage({ type: 'sync-complete' })`

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
├── conftest.py              # Env load, AES key, marker registration, rate-limit flush fixture
├── integration/             # Full-stack integration tests
│   ├── conftest.py          # No-op rate-limit fixture
│   ├── test_admin_api.py
│   ├── test_analytics_api.py
│   ├── test_analytics_security.py
│   ├── test_analyst_dashboard_queue.py
│   ├── test_auth_flow.py
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

Total: 30 test files (10 unit, 19 integration, 2 conftest).

### Key Test Patterns

**1. SQL Contract Tests (`test_analyst_incidents_sql_contract.py`)**
Unique static analysis pattern. Uses `inspect.getsource()` to capture route function source code and asserts on raw SQL string content — no database required. 5 tests guarding against schema regressions in analyst list/detail queries.

**2. Standard Unit Tests (`test_analyst_export.py`)**
Uses `unittest.mock` (MagicMock, patch), `tmp_path`, `monkeypatch`. No database needed. Tests: column allowlist filtering, Celery task dispatch, argument deduplication, role rejection, file I/O verification with `csv.DictReader`.

**3. Integration Tests (`test_keycloak_password_reset.py`)**
~750 lines, full e2e against live services. Patterns: fixture-based prerequisites (auto-skip if Keycloak unreachable), resource setup/teardown, helper functions for API interaction, MailHog email extraction. Tests pre-flight config (5) + full e2e flow (4) including OWASP user enumeration prevention, single-use token enforcement.

**4. ci.yml exclusions** — 8 test files explicitly excluded from CI runner: rate-limiting, suricata, infra-config, bootstrap, OTP, schema, RLS policy, SQL quality (need special Docker setup).

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
| `backend` | ubuntu-latest | Python 3.12, PostGIS + Redis 7 service containers. `ruff check` → `ruff format --check` → `pytest -v --tb=short` (8 test files excluded) |
| `docker-build` | ubuntu-latest | `docker compose config` validation + `docker compose build --parallel` |
| `security-scan` | ubuntu-latest | OWASP ZAP baseline scan + Nmap port scan. Uses `.zap/rules.tsv` to ignore 7 pre-existing WARN alerts (CSP/COEP headers, Keycloak upstream, Next.js informational). Sets ZAP artifact name to `zap-scan` to avoid the legacy action default `zap_scan` artifact-upload rejection. `fail_action: true` — only new HIGH/CRITICAL block merge. |
| `merge-gate` | ubuntu-latest | **Blocks merge** unless migrations, frontend, backend, docker-build, and security-scan all pass |

### CD — `.github/workflows/cd.yml`

**Trigger:** Push to `master` only

**Concurrency:** Single deploy at a time (no cancel-in-progress)

| Job | Description |
|---|---|
| `build-images` | Matrix over backend → `wims-backend`, frontend → `wims-frontend`. Docker Buildx with GHCR cache (`type=gha`), pushes to `ghcr.io/{owner}/wims-{backend|frontend}` with `{sha}` + `latest` tags |
| `notify` | Writes job summary table to `$GITHUB_STEP_SUMMARY` with built images, commit SHA, branch, trigger |

### VPS Deploy — `.github/workflows/deploy.yml`

**Trigger:** Push to `master` only

The deploy workflow has a `ci` gate before SSH deployment. The backend test step runs on the GitHub runner, so it must use GitHub Actions service containers rather than Docker Compose service DNS names. The gate now provisions PostGIS (`localhost:5432`) and Redis (`localhost:6379`), initializes `wims_test` by applying `src/postgres-init/*.sql` in lexical order, and runs the same backend pytest exclusion set used by `.github/workflows/ci.yml`.

The SSH deployment step exports production secrets such as `DATABASE_URL`, `REDIS_URL`, Keycloak settings, and `WIMS_MASTER_KEY`, then updates `/opt/wims-bfp` from `origin/master` with `git fetch` + `git checkout -B master origin/master`. This avoids ambiguous `git pull` behavior on a VPS checkout after a force-updated remote. It performs a pre-deploy database connectivity check from the backend container before rebuilding and restarting the backend service. The rollback-tag step uses Docker's quiet image output directly, avoiding a `jq` dependency on the VPS.

Post-restart health polling uses a 15-second settle delay plus 45 iterations × 2s = 90s total capacity. The health check is performed inside the `wims-backend` container using Python/httpx against `http://localhost:8000/health` (the backend's actual route). This avoids depending on curl being installed in the container, bypasses the nginx proxy (which forwards the full `/api/health` path, causing 404 since the backend route is `/health`), and checks the backend directly from within its own network namespace. The `/health` endpoint is served directly by nginx at line 16 of `nginx.conf` for external uptime monitors.

The SSH action's `envs:` list must include every variable the script references. `DEPLOY_COMMIT` is set in the `deploy` job's `env:` block (`DEPLOY_COMMIT: ${{ github.sha }}`) but was missing from the `Deploy via SSH` step's `envs:` passthrough, causing `set -euo pipefail` to exit 1 on the unbound variable before the health check ran.
