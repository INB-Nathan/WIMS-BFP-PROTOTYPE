## [2026-07-03] feat(operations): day reset archive board

- **Scope:** Add validator-controlled Operations Board day reset, one-night carryover, archive viewing, and restore support.
- **Files modified:** `src/postgres-init/79_operations_day_reset.sql`, `src/backend/api/routes/operations.py`, `src/backend/schemas/operations.py`, `src/backend/tests/test_operations.py`, `src/frontend/src/app/home/page.tsx`, `src/frontend/src/components/operations/OperationsConsole.tsx`, `src/frontend/src/lib/api/operations.ts`, `src/frontend/src/lib/api/offlineOperations.ts`, `system-wiki/backend/api-route-map.md`, `system-wiki/frontend/route-map.md`, `system-wiki/database/schema-overview.md`.
- **Behavior:** Active operations can be soft-archived by Reset Day unless a validator marks `keep_overnight`; kept operations clear the flag after one reset. Archived operations are shown on a read-only board and can be restored with an explicit fire status.
- **Validation:** `cd src/backend && ruff format --check . && ruff check .`; `cd src/backend && pytest tests/test_operations.py -q`; `cd src/frontend && npm run lint` (0 errors, pre-existing warnings); `cd src/frontend && npx vitest run src/app/home/__tests__/operations-board.test.tsx`; `cd src/frontend && NEXT_PUBLIC_AUTH_API_URL=http://localhost:8080/auth/realms/bfp NEXT_PUBLIC_BASE_URL=http://localhost NEXT_PUBLIC_MAPBOX_TOKEN= npm run build`.

## [2026-07-03] fix(triage): claimable singleton reports and stale self-claim refresh

- **Scope:** Unblock validator triage actions for isolated civilian reports and for clusters whose current user's claim has gone stale in an open modal.
- **Files modified:** `src/backend/services/civilian_triage/queue_projection.py`, `src/backend/tests/integration/test_triage_queue.py`, `src/frontend/src/components/triage/TriageInspectionModal.tsx`, `src/frontend/src/components/triage/useTriageModalState.ts`.
- **Behavior:** Queue materialization now creates a durable one-member `citizen_report_clusters` workflow record for every active unclustered report, not only spatially related reports. The triage modal now shows a **Refresh claim** action when a cluster is already assigned to the current user, allowing the existing claim endpoint to renew `updated_at` before terminal/split/merge actions.
- **Validation:** Backend ruff format/check passed for changed triage files. Targeted integration tests were updated but could not connect locally because the test DB host `postgres` is not resolvable outside Compose.

## [2026-07-01] feat(ai): staged XAI recommended actions

- **Scope:** Keep the stage-1 IDS/XAI narrative on the low-latency `qwen2.5:1.5b` path, then let system admins generate the recommended action as an explicit stage-2 action after the anomaly/evidence narrative is visible.
- **Files modified:** `src/backend/services/ai_service.py`, `src/backend/api/routes/admin/security.py`, `src/backend/tests/test_ai_service_retry.py`, `src/backend/api/routes/admin/config.py`, `src/frontend/src/lib/api/legacy.ts`, `src/frontend/src/lib/api/admin.ts`, `src/frontend/src/app/admin/system/components/SuricataAlertModal.tsx`, `system-wiki/security/security-baseline.md`.
- **Behavior:** `analyze_threat_log()` is back to `qwen2.5:1.5b`, `num_ctx=1024`, and default `num_predict=256` for the normal first-pass narrative. Stage 1 produces anomaly description, log evidence, risk assessment, confidence, and sources only. A new `POST /api/admin/security-logs/{log_id}/recommended-action` endpoint runs a separate focused Ollama prompt for `recommended_action`, merges it into `xai_narrative`, and exposes `GET /recommended-action-status` so the UI can show persistent loading if the modal is reopened while action generation is still running.
- **Admin config:** Added missing admin allowlist entries for IP blocklist, retention, SIEM retention, and related numeric config keys so those settings can be managed through the system-config API.
- **Validation:** `cd src/backend && pytest -q tests/test_ai_service_retry.py` — 20 passed. VPS A/B testing showed `qwen2.5:1.5b` can generate readable stage-1 narratives with JSON repair, while a separate action-only prompt produced recommended actions in ~25–117s depending on prompt strictness/log content.
- **Frontend test added:** `admin-system-analyze-ai.test.tsx` — new Stage 2 test verifies that opening a modal for a log with structured narrative (no recommended_action) shows the "Generate Recommended Action" button, clicking it calls `generateRecommendedAction`, and the recommended action text appears in the UI after completion. All 5 tests pass (4 existing + 1 new).

## [2026-07-01] feat(frontend-test): Stage 2 recommended action test

- **Scope:** Added frontend test coverage for the Stage 2 "Generate Recommended Action" flow in the admin system threat telemetry modal.
- **Files modified:** `admin-system-analyze-ai.test.tsx` — added `mockGenerateRecommendedAction`, `mockCheckRecommendedActionStatus`, and a full Stage 2 integration test.
- **Behavior:** Opens a modal for a mock log with structured JSON narrative (anomaly_description, log_evidence, risk_assessment, confidence, sources — no recommended_action). Verifies "Stage 2: Recommended Action" banner appears, clicks "Generate Recommended Action", asserts the API is called, and verifies the recommended action text appears and the Stage 2 section disappears on completion.
- **Validation:** `npx vitest run src/app/admin/system/admin-system-analyze-ai.test.tsx` — 5 passed (4 existing + 1 new). Frontend lint clean. Backend `ruff check`, `ruff format`, and `pytest tests/test_ai_service_retry.py` — all pass.

## [2026-07-01] fix(deploy): tolerate stale Ollama model-pull container cleanup races

- **Scope:** Harden GitHub Actions production deploy cleanup after `docker compose up --wait` failed on a fixed-name one-shot container conflict for `wims-ollama-model-pull`.
- **Files modified:** `.github/workflows/deploy.yml`
- **Changes:**
  - Removed invalid `docker ps -aq --format ...` usage from stale Compose rename cleanup.
  - Added idempotent container removal helper that tolerates Docker's `removal already in progress` race without aborting the retry path.
  - Explicitly removes stale `wims-ollama-model-pull` before Compose recreate and waits until the exact fixed container name disappears.
  - Keeps `wims-openbao-bootstrap` protected while running; only terminal `exited`/`dead` instances are cleaned.
- **Validation:** Parsed `.github/workflows/deploy.yml` as YAML, extracted the deploy script and ran `bash -n` successfully. Live VPS dry-run removed the exited stale `wims-ollama-model-pull` container and confirmed the stack remained up. `actionlint` was not installed locally.

## [2026-07-01] feat(analytics): AFOR PDF export mode for analyst incident detail

- **Scope:** Wire the analyst incident detail PDF export button to the existing AFOR section-based PDF writer without adding a new endpoint.
- **Files modified:** `src/backend/api/routes/analytics.py`, `src/frontend/src/lib/api/legacy.ts`, `src/frontend/src/app/dashboard/analyst/incidents/[id]/page.tsx`
- **Changes:**
  - Added strict `export_mode: Literal["bulk", "afor"] = "bulk"` to analytics export requests.
  - `POST /api/analytics/export/pdf` now dispatches existing `export_analyst_incidents_task` with `format="pdf"` and `export_mode="afor"` when explicitly requested with `filters.incident_id`.
  - Explicit AFOR PDF requests without `filters.incident_id` return HTTP 400 instead of silently falling back to bulk PDF.
  - Frontend analytics export client passes optional `export_mode` only when provided.
  - Analyst incident detail page sends `export_mode: "afor"` only for PDF; CSV remains the existing tabular export.
- **Validation:** `cd src/backend && ruff check api/routes/analytics.py` passed. `cd src/frontend && npm run lint` passed with 0 errors and 40 pre-existing warnings.

## [2026-06-30] fix(ai,deploy): graceful JSON degradation, keycloak proxy-headers, deploy model check

- **Scope:** 8-edit clean hot-fix on top of `801ad9f` (replacing contaminated PR #492).
- **Files modified:** `src/backend/services/ai_service.py`, `src/docker-compose.yml`, `.gitignore`, `.github/workflows/deploy.yml`
- **Changes:**
  - Graceful JSON degradation in `analyze_threat_log` and `analyze_audit_logs` — instead of HTTP 502 on bad Ollama JSON, falls back to raw text (threat_log) or empty strings (audit_logs) with 0.5 confidence.
  - Prompt softened from "Output strictly JSON" to "Provide a structured analysis as JSON".
  - `confidence_breakdown` DB param uses `None` (SQL NULL) instead of `json.dumps(None)` (JSON `"null"`) on graceful fallback.
  - Docstring fix: `num_predict` default 512 → 256.
  - Keycloak `--proxy-headers xforwarded` CLI flag added (belt-and-suspenders with `KC_PROXY_HEADERS` env var).
  - `.pi/sessions/` added to `.gitignore`.
  - Deploy workflow model check: `qwen2.5:3b` → `qwen2.5:1.5b`.
- **Validation:** 16/16 tests pass, ruff check + format clean, reviewer subagent audit passed with no issues.
- **Edge case noted:** `xai_confidence_breakdown` in the `analyze_threat_log` return dict can now be `None` (JSON `null`) on graceful fallback, where it was previously always a `dict`. No current callers iterate it as a dict, but future callers should guard against `None`. Documented in `system-wiki/backend/services.md`.

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


## [2026-06-30] refactor: replace 3-layer GitHub PoC with pi gh extension

- **Decision:** Dropped the 3-layer approach (PyGithub backend + Octokit frontend + gh CLI CI) in favor of pure `gh` CLI everywhere.
- **Rationale:** `gh` CLI handles all needed GitHub operations (issue creation, PR comments, repo queries, CI automation). The Octokit frontend route added Octokit dependency for no benefit. PyGithub Celery tasks would duplicate what `gh` already does.
- **What changed:**
  - Removed `src/frontend/src/app/api/github/repo-summary/route.ts` (PoC 2 — Octokit)
  - Removed `@octokit/rest` from frontend dependencies
  - Kept `.github/workflows/ci.yml` github-integration job (PoC 3 — gh CLI in CI, already committed in 9e18ee4)
  - Added `.pi/extensions/github-tools.ts` — pi extension registering 5 custom tools (`gh_repo_summary`, `gh_create_issue`, `gh_pr_comment`, `gh_list_prs`, `gh_list_issues`) that wrap `gh` CLI with auto repo detection and graceful degradation
- **PoC 1 remnants** (uncommitted, on disk): `celery_config.py` and `tasks/__init__.py` still have `github_integration` registration; `tests/test_github_integration.py` is untracked. `tasks/github_integration.py` was lost. These should be cleaned up.

## [2026-06-30] feat(ext): pi extensions for gh CLI + VPS SSH diagnostics

- **Added `.pi/extensions/github-tools.ts`** — 5 custom tools wrapping `gh` CLI:
  `gh_repo_summary`, `gh_create_issue`, `gh_pr_comment`, `gh_list_prs`, `gh_list_issues`.
  Auto-detects repo, graceful degradation when `gh` unauthenticated/uninstalled.
- **Added `.pi/extensions/vps-ssh.ts`** — 6 custom tools for production VPS ops:
  `vps_ssh`, `vps_compose_ps`, `vps_compose_logs`, `vps_compose_up`,
  `vps_deploy_check`, `vps_compose_down`. Auto-connects to wims@194.233.81.162.
- **Removed** `src/frontend/src/app/api/github/repo-summary/route.ts` + `@octokit/rest`
- **Remaining PoC 1 debris** (uncommitted): celery_config.py, tasks/__init__.py still
  reference `tasks.github_integration`; untracked test_github_integration.py on disk.
  Needs cleanup when convenient.
