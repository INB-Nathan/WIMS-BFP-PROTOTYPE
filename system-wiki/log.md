## [2026-06-30] fix(ai): bound Ollama auto-analysis on CPU VPS

- **Scope:** Production VPS diagnosis showed Ollama connectivity was healthy, but Celery auto-AI requests to `qwen2.5:3b` took 5-16 minutes on CPU and could return 500/time out.
- **Files modified:**
  - `src/postgres-init/75_security_log_rollups.sql` — seed `auto_ai_analysis_enabled=false` so background HIGH/CRITICAL alert analysis is opt-in/manual by default. The deploy migration loop replays this idempotent seed.
  - `src/backend/services/ai_service.py` — centralize Ollama payload construction and add `options.num_predict` default cap of 256, overrideable by `OLLAMA_NUM_PREDICT`.
  - `src/docker-compose.yml` — set `OLLAMA_NUM_PARALLEL=1` and `OLLAMA_MAX_LOADED_MODELS=1` on Ollama; pass `OLLAMA_NUM_PREDICT` to backend and Celery.
  - `src/backend/tests/test_ai_service_retry.py` and `src/backend/tests/test_auto_ai_defaults.py` — regression coverage for bounded generation, compose concurrency env, and auto-AI default-off seed.
  - `system-wiki/backend/services.md` — document timeout, generation cap, concurrency guard, and auto-AI default.
- **Behavior:** Manual XAI analysis still works. Background `tasks.ai_forwarding.process_ai_queue` now remains opt-in by default, preventing automatic Suricata alert bursts from monopolizing the CPU-only Ollama service. JSON generation requests are bounded to reduce worst-case runtime.
- **Validation:** Targeted backend tests and lint run from `src/backend` before PR.

## [2026-06-30] fix(ci): isolate Compose dynamic IPs from static host mappings

- **Scope:** PR #487 CI follow-up. GitHub Actions Security Scan failed during `docker compose up -d --build` with Docker daemon `Address already in use` immediately after one-shot/dynamic services started and before the full stack reached nginx. The failure is consistent with dynamic Compose network allocations colliding with low static IPs that are only claimed when their containers start.
- **Files modified:**
  - `src/docker-compose.yml` — keep `wims_internal` on `172.18.0.0/24`, add `ipam.config.ip_range: 172.18.0.128/25` for dynamic containers, remove the unnecessary static IP from `celery-worker`, and remove the temporary `backend -> celery-worker` startup dependency.
  - `src/backend/tests/test_suricata_redis_host_networking.py` — update the subnet contract to `/24` and add a regression test proving the dynamic `ip_range` does not overlap static service IPs.
  - `src/nginx/nginx.conf`, `src/nginx/nginx.local.conf`, `src/nginx/nginx.ci.conf` — narrow `set_real_ip_from` from `172.18.0.0/16` to the configured `172.18.0.0/24` bridge subnet.
  - `src/backend/tests/test_nginx_forwarded_headers.py` — pin the `/24` real-IP trust range so it stays aligned with Compose.
  - `system-wiki/architecture/infrastructure-config.md`, `system-wiki/security/asvs-l2-state.json` — document the static-low/dynamic-high IPAM layout and nginx trusted proxy range.
- **Behavior:** Static host mappings remain stable for redis/postgres/ollama/keycloak/openbao, while dynamic services (mailhog, bootstraps, model-pull, backend, celery, frontend, nginx) are allocated from `172.18.0.128/25`, avoiding Docker 28/Compose parallel-start address collisions in CI. Nginx's trusted proxy range now matches the `/24` bridge instead of trusting the broader `/16`.
- **Validation:**
  - `cd src/backend && pytest tests/test_suricata_redis_host_networking.py tests/test_nginx_forwarded_headers.py -q` — 26 passed.
  - `cd src/backend && ruff check tests/test_suricata_redis_host_networking.py tests/test_nginx_forwarded_headers.py && ruff format --check tests/test_suricata_redis_host_networking.py tests/test_nginx_forwarded_headers.py` — clean.
  - `cd src && docker compose -f docker-compose.yml -f docker-compose.ci.yml config --quiet` — valid.
  - `/tmp/repro/no-iprange-race.yml` local Compose reproduction with low static IPs and no dynamic range split — reproduced Docker `Address already in use` during concurrent startup.
  - `/tmp/repro/iprange-race.yml` local Compose reproduction with the same static-low/dynamic-high pattern — 12 alpine containers started concurrently without `Address already in use`, then were torn down.

## [2026-06-29] fix(pen-test): Suricata redis host-networking follow-up

- **Scope:** Follow-up to the 2026-06-29 pen-test fix (R2). PR #483 changed `suricata.yaml` from `redis-server: "127.0.0.1"` to `redis-server: "redis"`, but `wims-suricata` uses `network_mode: "host"` for AF_PACKET capture, so the `redis` hostname cannot be resolved via Docker DNS. The live VPS was relying on a hand-added `172.18.0.5 redis` entry in the host's `/etc/hosts` to make the pipeline work — not reproducible across fresh deploys.
- **Files modified:**
  - `src/docker-compose.yml` — three coordinated changes:
    1. `networks.wims_internal` — add `ipam.config.subnet: 172.18.0.0/16` (so the static IP is in a valid range).
    2. `services.redis` — pin to `172.18.0.5` via `networks.wims_internal.ipv4_address` (matches the live VPS's dynamic IP, so the change is in-place; no other service gets renumbered).
    3. `services.wims-suricata` — add `extra_hosts: ["redis:172.18.0.5"]` so the hostname resolves inside the container even under `network_mode: "host"`.
  - `src/suricata/suricata.yaml` — replace the PR #483 comment with a fuller explanation that references the `extra_hosts` dependency and the `network_mode: "host"` constraint.
  - `src/backend/tests/test_suricata_redis_host_networking.py` — NEW: 9 contract tests pinning the structure (host networking, extra_hosts entry, static redis IP, IPAM subnet, in-subnet check, hostname vs IP in suricata.yaml, pen-test comment references extra_hosts + network_mode + date stamp).
  - `system-wiki/architecture/infrastructure-config.md` — new "Suricata <-> Redis host networking" section documenting the constraint, the fix, why `127.0.0.1` would also work, and the contract test.
- **Behavior:** After `docker compose up -d` on a fresh host, Suricata can resolve `redis` and alerts flow to `suricata:alerts` in Redis without requiring a host-level `/etc/hosts` entry. The static IP + IPAM subnet makes the `extra_hosts` mapping stable across `docker compose down && up` cycles.
- **Validation:**
  - `cd src/backend && pytest tests/test_suricata_redis_host_networking.py` — 9 passed.
  - `pytest tests/test_security_log_rollups_rls.py tests/test_rls_init_contract.py` — 13 passed (no regression).
  - `pytest tests/test_suricata_ingestion.py` — 18 passed (TestParseEveAlertLine, TestEveToThreatLogRow, TestEveClassifier); 2 pre-existing failures in TestIngestEveFile require a live Postgres (same gap as the 2026-06-29 pen-test fix).
  - `ruff check` + `ruff format --check` on the new test — clean.
  - `yaml.safe_load(src/docker-compose.yml)` + `yaml.safe_load(src/suricata/suricata.yaml)` — valid.
- **Live VPS validation still required:** `cd /opt/wims-bfp/src && docker compose up -d` will recreate the wims_internal network with the new IPAM config and the redis container with the static IP. Because 172.18.0.5 was the existing dynamic IP, no service should be renumbered. After the recreate, remove the hand-added `/etc/hosts` entry (it's no longer needed) and restart wims-suricata: `docker compose restart wims-suricata`.
- **Rollback:** Revert the three docker-compose changes and the suricata.yaml comment. The static IP is the only "destructive" change (it pins redis to one IP) — if the live VPS is already on 172.18.0.5 dynamically, the rollback is in-place. If somehow redis is on a different IP, the rollback could trigger IP renumbering for redis-dependent services.

## [2026-06-29] fix(pen-test): three logging pipeline gaps from 2026-06-29 review

- **Scope:** Three independent root causes were preventing pen-test alerts from reaching the System Admin hub (`/admin/audit`, `/admin/monitoring`, `/admin/system`): (R1) Suricata file-tail ingestion blocked by RLS policy mismatch on `security_threat_log_rollups`; (R2) Suricata Redis output writing to loopback, never reaching the Redis container; (R3) Keycloak SPI audit events rejected with HTTP 422 (JSON decode error) due to Java `HttpClient` defaulting to HTTP/2 against uvicorn (HTTP/1.1-only).
- **Files modified:**
  - `src/postgres-init/75_security_log_rollups.sql` — replace single `FOR ALL` policy with three granular policies (`security_rollups_insert`, `security_rollups_update`, `security_rollups_delete`); flip `siem.store_low_value_raw` default from `false` to `true` for pen-test visibility in `/admin/monitoring`.
  - `src/postgres-init/77_security_log_rollups_policy_fix.sql` — NEW: live-DB migration that re-applies the granular policies and updates the `siem.store_low_value_raw` config on the running VPS. Idempotent.
  - `src/suricata/suricata.yaml` — fix `redis-server` from `127.0.0.1` (Suricata's own loopback) to `redis` (Docker service hostname). R2 fix.
  - `src/keycloak/wims-audit-event-listener/src/main/java/gov/bfp/wims/keycloak/WimsAuditEventListenerProvider.java` — add `.version(HttpClient.Version.HTTP_1_1)` to request builder (R3 root cause); include response body in error log and request body in debug log for diagnosis.
  - `src/backend/api/routes/security_events.py` — add `WIMS_DEBUG_KEYCLOAK_BODY` env-var-gated raw body capture in `/api/auth/keycloak-event` for diagnosis.
  - `src/backend/tests/test_security_log_rollups_rls.py` — NEW: 10 contract tests pinning the RLS policy structure (granular policies exist, INSERT/UPDATE allow NATIONAL_ANALYST, DELETE is admin-only, low-value raw default is `true`, 77 is idempotent).
  - `system-wiki/database/sql-init-files.md` — document files 75, 76, 77 and the granular RLS policy structure.
- **Behavior:**
  - **R1:** The `svc_suricata` service account (role `NATIONAL_ANALYST`) can now INSERT and UPDATE rollup rows; the `record_security_threat_rollups` upsert no longer aborts the whole transaction. DELETE remains `SYSTEM_ADMIN`-only for audit integrity. The Celery task `tasks.suricata.ingest_suricata_eve` should resume ingesting within 10 seconds after the live-DB migration runs.
  - **R2:** After Suricata is restarted with the fixed config, `redis-server: "redis"` reaches the Redis container on the bridge network. `XLEN suricata:alerts` should grow within seconds. The Celery task `tasks.suricata_redis.subscribe_alerts` then processes alerts in real time.
  - **R3:** The SPI now forces HTTP/1.1, eliminating the protocol-negotiation path that was corrupting the request body. The 422 JSON decode error on `/api/auth/keycloak-event` should resolve to 202. `failed` login events from `LOGIN_ERROR` and `USER_DISABLED_BY_PERMANENT_LOCKOUT` reach `wims.system_audit_trails` as `FAILED_LOGIN` with `source: "keycloak_spi"`.
  - **Open question resolved (low-value alert visibility):** Chose option (a) — flip `siem.store_low_value_raw` to `true` so admin monitoring views see scanner/probe/bot traffic. 1-day raw retention bounds storage cost. Rollups remain intact for long-term analytics.
- **Validation:**
  - `cd src/backend && pytest tests/test_security_log_rollups_rls.py -v` — 10 passed.
  - `cd src/backend && pytest tests/test_rls_init_contract.py tests/test_security_monitoring.py -v` — 27 passed.
  - `cd src/backend && ruff check api/routes/security_events.py tests/test_security_log_rollups_rls.py` — clean.
  - `cd src/backend && ruff format --check api/routes/security_events.py tests/test_security_log_rollups_rls.py` — clean.
  - Tests that depend on the live DB (`test_security_events.py` rate-limit, `test_suricata_ingestion.py` `TestIngestEveFile`) require `DATABASE_ADMIN_URL` and a reachable Postgres/Redis — they were not run in the host environment, matching the existing 2026-06-29 triage-fix validation gap.
  - **Live VPS validation still required:** the 77 migration must be applied via `psql` against the live DB; the SPI JAR must be rebuilt and the Keycloak container restarted; Suricata must be restarted with the updated `suricata.yaml`.
- **Rollback:** See `Penetration Test Logging Gap Fixes` doc — `DROP POLICY IF EXISTS` for the three granular policies + recreate the single `FOR ALL` policy; restore original `suricata.yaml`; revert SPI to remove `.version(HttpClient.Version.HTTP_1_1)`.

## [2026-06-29] fix(triage): split/merge cluster integrity guards

- **Scope:** Hardened civilian triage split/merge workflow behavior so split operations keep valid anchors, reject source-emptying splits, and merge operations move members with one atomic delete-returning/insert statement.
- **Files modified:** `src/backend/services/civilian_triage/workflow.py`, `src/backend/tests/integration/test_triage_queue.py`.
- **Behavior:** `split_cluster_command` now orders selected members by `report_id`, assigns deterministic new-cluster anchors, re-anchors the source cluster when its old anchor is moved, and returns HTTP 422 when a split would leave the source cluster empty. `merge_clusters_command` now uses a single `WITH moved AS (DELETE ... RETURNING) INSERT ... SELECT FROM moved` flow so the moved set and inserted set stay aligned.
- **Validation:** `cd src/backend && ruff format services/civilian_triage/workflow.py tests/integration/test_triage_queue.py` and `ruff check services/civilian_triage/workflow.py tests/integration/test_triage_queue.py` passed. `pytest -q tests/integration/test_triage_queue.py` could not run in the host environment because `fastapi` is not installed, and Docker-based fallback was unavailable because `docker` is not installed.

## [2026-06-28] fix(audit): RP-06 NSD tamper detection + RP-14 analytics export audit (WS-D)

Branch: `fix/ws-d-rp06-rp14-audit`

### Scope
Two non-repudiation gaps closed: (1) direct DB edits to `wims.incident_nonsensitive_details` were undetectable by the integrity check; (2) bulk analytics exports were invisible to anomaly detectors.

### Changes
- **`src/backend/services/regional_incidents/helpers.py`** — `verify_incident_hash_chain()`: provenance JOIN and `compute_incident_data_hash()` recompute now run before the no-chain early return. Mismatch → `integrity_status="tampered"` with `INTEGRITY_VIOLATION` audit row written via `_AdminSessionLocal`. Valid no-chain result (hashes match) → `"valid"`. No-hash incident → `"unverified"` (unchanged).
- **`src/backend/main.py`** — `_backfill_verified_data_hash()` startup patch: populates `data_hash` for VERIFIED incidents with NULL hash (covers bootstrap seed data). Idempotent and non-fatal.
- **`src/backend/tasks/exports.py`** — `_insert_export_log()`: adds `log_system_audit(..., "BULK_EXPORT", ...)` alongside the `analytics_export_log` INSERT, sharing the same transaction commit. Non-fatal if audit write fails.
- **`src/backend/tests/integration/test_rp06_nsd_tamper.py`** — 3-case integration test: unmodified incident → `"valid"`, direct NSD tamper → `"tampered"` with `"NSD tamper detected"` violation, null data_hash → `"unverified"`.

### Register updates
- `system-wiki/gaps/frs-codebase-gap-register.md` — RP-06 closed (NSD recompute); RP-14 closed (BULK_EXPORT audit).
- `system-wiki/gaps/functional-bug-register.md` — F-15 (RP-06), F-16 (RP-14) added.
## [2026-06-28] ops: SIEM raw retention, rollups, and noise gating

- **Scope:** Raw Suricata threat logs are now retained for 1 day while hourly/daily rollups preserve weekly and 90-day time-range telemetry.
- **Files modified:** `src/postgres-init/75_security_log_rollups.sql`, `src/backend/services/security_rollups.py`, `src/backend/services/suricata_ingestion.py`, `src/backend/tasks/data_retention.py`, `src/backend/api/routes/admin/security.py`, and security docs.
- **Behavior:** Ingestion increments rollups for every alert, stores low-value scanner/bot/background alerts only in rollups by default, keeps HIGH/CRITICAL and credential/high-signal alerts raw, and deduplicates raw rows within a 5-minute window. `/api/admin/security-logs/rollups` exposes hourly/daily time-range data.
- **Validation:** `ruff check` passed for changed backend files; `SKIP_DB_TESTS=1 pytest -q tests/test_suricata_auto_incident.py tests/test_suricata_rules.py tests/test_suricata_ingestion.py tests/test_security_monitoring.py` passed (48 passed, 9 skipped).

## [2026-06-28] ops: Contabo GitOps deploy and Qwen2.5-3B resource tuning

- **Scope:** Production deployment now targets the hardened Contabo VPS via the non-root `wims` SSH user and restores the XAI model to `qwen2.5:3b`.
- **Files modified:** `.github/workflows/deploy.yml`, `src/docker-compose.yml`, `src/docker-compose.prod.yml`, `src/backend/services/ai_service.py`, `src/backend/tests/test_ai_service_retry.py`, and `system-wiki/architecture/infrastructure-config.md`.
- **Behavior:** GitHub Actions SSH uses `wims` with passwordless sudo for root-only certbot operations; Ollama is capped at 4 vCPU / 6 GB RAM for Qwen2.5-3B while leaving host capacity for Postgres, Keycloak, backend, Celery, Suricata, Redis, nginx, and OS cache.
- **Validation:** `src/backend/tests/test_ai_service_retry.py` passed in a temporary venv; production compose config was validated on the Contabo VPS with the updated compose files. Deploy still performs post-restart backend, gateway, Keycloak, frontend, API, and Ollama model checks.

## [2026-06-27] feat(offline): regional encoder offline UX overhaul

- **Scope:** PR #466 improves regional encoder offline visibility and control: split queued/failed/conflict counts, per-incident offline overlays, Offline Work center, conflict merge UX, cancel/withdraw controls, sync progress, enable-offline cancellation, and Sidebar badge navigation.
- **Files created:**
  - `src/frontend/src/lib/offlineModeFlags.ts` — localStorage flag helpers extracted to avoid offline-store/offline-enable circular imports.
  - `src/frontend/src/lib/regionalOfflineStatus.ts` — maps offline ops to per-incident card overlay badges.
  - `src/frontend/src/lib/offlineOpActions.ts` — cancel/withdraw helper with fresh IndexedDB sync-status re-check before delete.
  - `src/frontend/src/lib/useOfflineWorkCounts.ts` — shared pending/failed/conflict/draft count hook for nav and dashboards.
  - `src/frontend/src/app/dashboard/regional/offline-work/page.tsx` — Drafts / Queued / Failed / Conflicts work center.
  - `system-wiki/architecture/regional-offline-ux-overhaul-2026-06.md` — synthesis page for the new UX/data-flow model.
- **Files modified:** `offlineStore.ts`, `offlineEnable.ts`, `syncEngine.ts`, `useAutoSync.ts`, `SyncStatusBar.tsx`, `IncidentCard.tsx`, `OfflineModeManager.tsx`, `IncidentConflictMergePanel.tsx`, `Sidebar.tsx`, and `dashboard/regional/page.tsx`.
- **Behavior:** `offline_enabled` clears on different-user switch, conflicts/failed ops no longer hide behind generic pending counts, card-level overlays show queued/conflict/failed work, and encoders can cancel queued operations unless the latest IndexedDB state is already syncing.
- **Related non-offline changes in same PR:** `/fire-stations` geolocation centering, map-pin reverse-geocode fill, PSGC NIR corrections, and live-badge text removal are documented in the following log entry and synthesis notes.

## [2026-06-27] fix | center /fire-stations around user location when available

- **Scope:** `/fire-stations` no longer forces the initial map viewport to fit all nationwide stations when browser geolocation succeeds. It centers on the user's location at local zoom while still rendering all station markers.
- **Files modified:**
  - `src/frontend/src/app/fire-stations/page.tsx` — requests browser geolocation on load, passes `userLocation` to the map, and refreshes `/api/ref/emergency-services` with `lat/lon` for distance metadata when available. Denied/unavailable geolocation keeps the existing national fallback.
  - `src/frontend/src/app/fire-stations/FireStationsMapInner.tsx` — accepts `userLocation`, skips nationwide `fitBounds` when present, centers at zoom 12, and renders the shared user-location marker.
  - `src/frontend/src/app/fire-stations/FireStationsMapInner.test.tsx` — adds coverage for user-location centering.
- **Validation:** Targeted Vitest command could not run in the current host checkout because `vitest/config` is missing from local `node_modules`; no application test failure observed.
- **Route map:** `system-wiki/frontend/route-map.md` still omits `/fire-stations` as a pre-existing route-table gap; behavior change logged here.

## [2026-06-27] fix: remove orphaned AI incident narrative endpoints (dead code)

Branch: cleanup-ai-narrative-and-geography (off origin/master).

### Scope
Removed the AI incident narrative feature (PR #104 / #69) — backend-only feature that was never wired to the frontend and is not in the FRS.

### Changes
- **Deleted:** `src/backend/tasks/narrative.py` — Celery batch task (`batch_generate_narratives`)
- **Deleted:** `src/backend/tests/test_incident_narrative.py` — 7 tests for the orphaned endpoints
- **Removed:** `generate_incident_narrative()` from `src/backend/services/ai_service.py` (~160 lines incl. Ollama prompt, encryption, DB write)
- **Removed:** Two POST endpoints from `src/backend/api/routes/analytics.py` — `POST /incidents/{incident_id}/narrative` and `POST /incidents/batch-narratives`
- **Removed:** `TestNarrativeTaskReturnShape` from `tests/test_ai_service_retry.py`
- **Cleaned:** `celery_config.py` — removed `"tasks.narrative"` from both `include` and `imports`
- **Cleaned:** Unused imports in `ai_service.py` — `get_crypto_provider`, `SecurityProviderError`

### Preserved
- DB columns (`ai_narrative`, `ai_narrative_enc`, etc.) — harmless, no migration needed
- Historical migration script `encrypt_ai_narratives_backlog.py` — reference only
- `xai_narrative` feature for security threat logs — unrelated, actively used
- `narrative_report` field — human-written, unrelated

