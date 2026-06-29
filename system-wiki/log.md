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

