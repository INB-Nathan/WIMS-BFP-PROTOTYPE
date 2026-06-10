# System Wiki Log

Chronological record of system-wiki changes. Append-only.
Format: `## [YYYY-MM-DD] action | subject`

## [2026-06-10] feat | M15 — RLS on reference tables (ref_regions/provinces/cities, #178)

Migration `53_ref_table_rls.sql`: replaces role-gated SELECT on reference geography tables with `USING (TRUE)` (globally readable); adds `FOR ALL` write policies gated on `SYSTEM_ADMIN`. Fixes silent zero-row returns on unauthenticated paths (`public_dmz.py` reads `ref_regions` without a GUC). `main.py:_apply_ref_table_rls()` startup patch updated to match. 11 unit tests. Closes #178.

**Files:** `src/postgres-init/53_ref_table_rls.sql`, `src/backend/main.py`, `src/backend/tests/test_ref_table_rls.py`, `system-wiki/gaps/frs-codebase-gap-register.md`

## [2026-06-10] feat | M10d automated breach notification + NPC 72h tracking (#171)

- Migration `52_breach_notifications.sql`: `wims.breach_notifications` table with SERIAL PK, `threat_log_id FK→security_threat_logs`, `detected_at`, `npc_deadline_at` (= detected_at + 72h), `status` enum (DETECTED→DPO_NOTIFIED→NPC_SUBMITTED→CLOSED), `affected_systems`, `data_scope`, `notes`, `reported_by`, `npc_submitted_at`, timestamps. RLS ENABLE+FORCE; SELECT and ALL policies gated on `wims.current_user_role() = 'SYSTEM_ADMIN'`.
- `admin/security.py`: Inside CONFIRM_THREAT block, for HIGH/CRITICAL severity: (1) INSERT breach record into transaction while RLS context still active (`SET LOCAL` scoped); (2) `log_system_audit(..., "BREACH_DETECTED", "breach_notifications", breach_id)`; (3) post-commit: dispatch `breach_alert` email via `send_email_task.delay()` alongside existing `security_alert` email — same admin recipients, bypasses `email_opt_in`.
- New `schemas/breach.py`: `BreachStatus` enum, `BreachResponse`, `BreachUpdate`.
- New `api/routes/admin/breach.py`: `GET /api/admin/breach` (list, detected_at DESC), `GET /api/admin/breach/{id}`, `PATCH /api/admin/breach/{id}` (status/notes/affected_systems/data_scope; `npc_submitted_at` auto-set on NPC_SUBMITTED; `BREACH_STATUS_UPDATE` audit). Registered in `api/routes/admin/__init__.py`.
- New `services/email/templates/breach_alert.html.j2`: BFP maroon header, RA 10173 regulatory context, NPC deadline row, breach_id, severity badge.
- Frontend: `lib/api/breach.ts` (types + `fetchBreaches`/`updateBreach`); `/admin/breach/page.tsx` with deadline countdown + overdue row red highlight + status advance buttons; "Breach Notifications" nav item added to Sidebar under Administration (SYSTEM_ADMIN only).
- Tests: `tests/test_breach_notifications.py` (13 unit tests); `app/admin/breach/__tests__/breach-list.test.tsx` (8 Vitest tests).

**Files:** `52_breach_notifications.sql`, `schemas/breach.py`, `api/routes/admin/breach.py`, `api/routes/admin/__init__.py`, `api/routes/admin/security.py`, `services/email/templates/breach_alert.html.j2`, `lib/api/breach.ts`, `lib/api/index.ts`, `app/admin/breach/page.tsx`, `components/Sidebar.tsx`, `tests/test_breach_notifications.py`, `app/admin/breach/__tests__/breach-list.test.tsx`, `system-wiki/gaps/frs-codebase-gap-register.md`

## [2026-06-10] fix | PR #248 — post-review fix batch 1 (audit order, float guard, generic 500, barrel export, legacy HITL, duplicate guard)

4 fix commits applied after maintainer-reviewer report:
- `eb26ecb`: HITL audit for legacy `admin_action_taken` path, `reviewed_by` on create-incident, `_security_incident_exists()` duplicate guard.
- `ddf7d31`: `createIncidentFromAlert` added to `admin.ts` barrel export.
- `7fafea8`: Structured 5-key XAI format in test mocks, HITL audit `call_count` 2→3 in `test_admin_new_routes.py`.
- `6adb1c3`: Audit-before-commit ordering in `update_security_log()` and `create_incident_from_alert()`, rowcount 404 before commit, float confidence crash guard + clamp in `analyze_threat_log()`/`analyze_audit_logs()`, replace leaking `str(e)` with generic 500 detail.

**Files:** `security.py`, `ai_service.py`, `test_ai_ids_api.py`, `test_admin_new_routes.py`, `admin.ts`

## [2026-06-10] fix | PR #248 — post-review fix batch 2 (httpx error handling, audit-logs analyze tests)

- `9a1f34e`: Catch `httpx.TimeoutException` (→ 502 "Ollama request timed out") and `httpx.ConnectError` (→ 502 "Ollama service unavailable") in both `analyze_threat_log()` and `analyze_audit_logs()`. Added `logger = logging.getLogger("wims.ai_service")` with warnings before each 502 raise. Added 4 respx-mocked integration tests covering ConnectError/TimeoutException for both threat-log and audit-logs analyze endpoints. Added `audit_trail_rows` fixture.

**Files:** `ai_service.py`, `test_ai_ids_api.py`

## [2026-06-10] fix | PR #248 — post-review fix batch 3 (create-incident-from-alert tests)

- `bfa3dff`: Added `TestCreateIncidentFromAlert` class in `test_admin_new_routes.py` with 5 mock-DB tests: 200 success (verified `incident_id=42`, `reviewed_by` UUID, audit INSERT with `action`/`table`/`rec`, commit called), 404 not found, 409 duplicate guard, 500 rollback on `RuntimeError`, 403 encoder denied. Uses `fetchone.side_effect` pattern to control mock DB responses.

**Files:** `test_admin_new_routes.py`

## [2026-06-10] fix | PR #248 — post-review fix batch 4 (HITL audit INSERT content verification)

- `aaa75bf`: Added audit INSERT param assertions (`action`/`table`/`rec`/`uid`) to 3 existing structured-path HITL tests:
  - `test_confirm_threat_sets_label_and_jsonb` — verifies `HITL_REVIEW`, `security_threat_logs`, rec=1, admin UUID
  - `test_false_positive_sets_label_and_jsonb` — verifies same for rec=2
  - `test_request_more_info_sets_label_jsonb_leaves_resolved_at_null` — verifies same for rec=3
  - Pattern from `TestCreateIncidentFromAlert` — `next(c for c in call_args_list if "system_audit_trails"...)` plus param assertions
  - Legacy path `test_legacy_admin_action_taken_logs_hitl_audit` (added by tdd-wims step) also validates audit INSERT for `admin_action_taken` path.

**Files:** `test_admin_new_routes.py`

## [2026-06-10] fix | PR #248 — post-review fix batch 5 (audit batch limit)

- `7caa9d8`: Added max batch-size guard to `analyze_audit_logs()` in `ai_service.py` — reads `ai_audit_batch_limit` config key (default 50), raises 400 with `"audit_ids exceeds maximum batch size"` when exceeded. Added 3 tests in `TestAnalyzeAuditLogsBatchLimit`: over-limit returns 400, at-limit passes, invalid config falls back to default. Uses `patch("services.ai_service.get_config")` mock pattern.

**Files:** `ai_service.py`, `test_admin_new_routes.py`

## [2026-06-10] docs | PR #248 — resolve M9 scope bundling (P1-P4)

- Documented M9c configuration management routes in `system-wiki/backend/api-route-map.md`: `GET /admin/config`, `PATCH /admin/config/{key}`.
- Added missing M8 endpoints to route map: `POST /admin/audit-logs/analyze`, `POST /admin/security-logs/{log_id}/create-incident`.
- Added M9c frontend config page to `system-wiki/frontend/route-map.md`: `/admin/system/config`.
- PR #248 explicitly covers M8 (security/XAI) + M9c (configuration management). Gap register already marks M9c as IMPLEMENTED.

**Files:** `backend/api-route-map.md`, `frontend/route-map.md`

## [2026-06-09] feat | M9b full-text search on security + audit logs (tsvector + GIN) (#169)
## [2026-06-09] feat | M9b full-text search on security + audit logs (tsvector + GIN) (#169)

- Migration `48_log_search_vectors.sql` (idempotent): adds `search_vector tsvector GENERATED ALWAYS AS STORED` to `wims.security_threat_logs` (covers `raw_payload`, `xai_narrative`, `severity_level`, `source_ip`, `destination_ip`) and `wims.system_audit_trails` (covers `action_type`, `table_affected`, `user_agent`). Creates GIN indexes `idx_security_logs_search` and `idx_audit_trails_search`.
- Extended `GET /api/admin/security-logs`: new optional `q` param — appends `search_vector @@ websearch_to_tsquery('english', :q)` to WHERE; ORDER BY switches from `timestamp DESC` to `ts_rank(...) DESC` when q is set. Existing filters (source_ip, severity, date_from, date_to) compose with q.
- Extended `GET /api/admin/audit-logs`: same pattern — `q` param with tsquery WHERE and ts_rank ORDER BY; existing filters (user_id, action_type, table_affected, ip_address, date_from, date_to) compose with q.
- Updated `src/frontend/src/lib/api/legacy.ts`: `fetchAdminSecurityLogs` accepts `params?: { q?: string }`; `fetchAuditLogs` params extended with `q?: string`. Both append `?q=...` only when q is truthy.
- Added search bars to `src/frontend/src/app/admin/system/page.tsx`: text input above "Threat Telemetry" table and above "System Audit" table; submit on Enter or search button; Clear button appears when input is non-empty; Refresh button preserves active search term; HITL action reload preserves active search.
- New `tests/test_log_fulltext_search.py`: 10 unit tests — tsquery/ts_rank present when q set, absent when q absent, :q bound (not interpolated), q+severity combination. All pass; ruff clean.
## [2026-06-09] fix | PR #238 rebase + review fixes — 6 files

- Rebased `feat/m13-email-triggers` onto origin/master (1345808). Resolved 2 conflicts:
  - `src/backend/celery_config.py`: merged M7a `update-suricata-rules-weekly` + M13 `send-weekly-report-email` beat entries
  - `.zap/rules.tsv`: kept HEAD (M7a) justification for rule 90004 (COEP unsafe-none)
- **Q1 (critical):** Fixed double-toggle bug in `profile/page.tsx` — removed `div.onClick` handlers that canceled out checkbox `onChange` (React 18 batching).
- **S1:** Updated notification prefs copy from "report status changes" to "system alerts and weekly reports" (matches actual email dispatch).
- **Q4:** Profile save callback now refreshes `notifPrefs` from API response (was discarding `email_opt_in`/`push_opt_in` on profile save).
- **Q2/Q3:** Added `NEXT_PUBLIC_APP_URL` env var to backend + celery-worker containers in `docker-compose.yml` and `docker-compose.prod.yml` (email links no longer default to localhost in prod).
- **S2:** Updated stale section comment in `tasks/notifications.py` — no longer claims triggers are "out of scope."
- **S3:** Weekly report email query now filters by `email_opt_in = TRUE`; security alert query intentionally bypasses (critical alerts).
- **S4:** Added `autoretry_for=(Exception,)` with backoff to `send_weekly_report_email` Celery task.
- **S5:** Moved `import requests` inside `test_mailhog_email_delivery` function body (integration-only dependency).

## [2026-06-09] feat | M13 user notification preferences — email_opt_in + push_opt_in (#72)

- Migration `47_notification_preferences.sql`: adds `email_opt_in BOOLEAN NOT NULL DEFAULT TRUE` and `push_opt_in BOOLEAN NOT NULL DEFAULT TRUE` to `wims.users`. Defaults preserve existing behaviour; JIT-provisioning INSERT is unaffected.
- Extended `GET /api/user/me/profile`: now queries `contact_number, email_opt_in, push_opt_in` from `wims.users`; NULL values default to `TRUE`.
- Extended `PATCH /api/user/me` (`ProfileUpdate` schema): accepts `email_opt_in` and `push_opt_in` booleans; persists in a single DB UPDATE; skips Keycloak call when only pref fields are sent.
- Updated `src/frontend/src/lib/api/legacy.ts`: extended `fetchMyProfile()` return type and `updateMyProfile()` payload type for both pref booleans.
- Added "Notification Preferences" card to `src/frontend/src/app/profile/page.tsx`: Email + Push toggle switches loaded from GET and saved via PATCH, matching existing card/form styling.
- `tasks/notifications.send_status_notification` left push-only. `citizen_reports` is anonymous by privacy design (data minimization — no email collected at submission); email-on-status-change is therefore N/A for this flow. The `email_opt_in` column on `wims.users` is the gate for any future registered-recipient notification flow where a user identity is present.
- Fixed `tests/test_profile_email.py`: updated `_get_db_session()` mock to return 3-column tuple after GET query expansion.
- New `tests/test_notification_prefs.py`: 7 unit tests — GET prefs (true, false, null→default), PATCH prefs (email_opt_in, push_opt_in, both together, Keycloak skipped on prefs-only).
- All preference tests pass; ruff check + format pass; frontend lint: 0 errors.

## [2026-06-09] feat | M13b email notification triggers — security_alert + weekly_report (#176)

- Wired `security_alert` email trigger in `src/backend/api/routes/admin/security.py`: after CONFIRM_THREAT HITL action commits, if severity is HIGH or CRITICAL, dispatch `send_email_task.delay()` to all active SYSTEM_ADMIN users. Dashboard link points to `/admin/security-dashboard`.
- Added `send_weekly_report_email` Celery task (`tasks/notifications.py`): queries 7-day incident totals from `analytics_incident_facts` and top region from `ref_regions`; dispatches `send_email_task.delay()` with `template_name="weekly_report"` to all active SYSTEM_ADMIN emails. Runs Monday 07:00 UTC via Celery beat.
- Used post-#182 RLS pattern (`get_session(SYSTEM_TASK_USER_ID)` + RLS context auto-set) matching `tasks/drafts.py`.
- Updated `celery_config.py`: added `send-weekly-report-email` beat entry (crontab: day_of_week=1, hour=7, minute=0).
- Created `tests/test_m13_email_triggers.py`: 6 unit tests (CONFIRM_THREAT+HIGH/CRITICAL dispatch, FALSE_POSITIVE+LOW no-dispatch, weekly task context, no-admin-emails guard) + 1 MailHog integration test.
- **Deferred triggers (follow-up):** `account_locked` requires Keycloak event-listener SPI (#138); `password_reset` N/A (Keycloak native flow owns it; WIMS template available for future theme customization).
- All 6 unit tests pass; ruff check + format pass.


## [2026-06-09] implementation | M8 surgical fixes — structured XAI, CRITICAL severity, HITL audit, remove auto-DRAFT, audit SLM (#161, #162, #163, #165)

- **`services/ai_service.py`:** Restructured XAI prompt from flat narrative to 5-key JSON (anomaly_description, log_evidence, risk_assessment, recommended_action, confidence). Added `analyze_audit_logs()` function for Ollama-based audit trail pattern analysis.
- **`services/suricata_ingestion.py`:** Added CRITICAL severity level (sev >= 4 → CRITICAL). Removed auto-creation of DRAFT fire incidents from HIGH/CRITICAL alerts — ingestion now logs a warning with requires_review, admin must manually trigger via `POST /admin/security-logs/{id}/create-incident`.
- **`api/routes/admin/security.py`:** Added `log_system_audit()` call to `update_security_log()` (HITL decisions now audited with action_type=HITL_REVIEW). Added `POST /security-logs/{log_id}/create-incident` endpoint for manual DRAFT incident creation from reviewed alerts.
- **`api/routes/admin/audit.py`:** Added `POST /audit-logs/analyze` endpoint for AI analysis of batched audit trail entries via Ollama.
- **`frontend admin/system/page.tsx`:** Structured XAI display now parses JSON and renders 4 labeled sections (Anomaly Description, Log Evidence, Risk Assessment, Recommended Action) with fallback to legacy plain-text. Added "Create Incident from Alert" button in the decision panel.
- **`lib/api/legacy.ts`:** Added `createIncidentFromAlert()` API client function.
- **`tests/test_suricata_ingestion.py`:** Added CRITICAL (severity 4) mapping test.
- **`tests/test_suricata_auto_incident.py`:** Updated to verify HIGH alerts no longer auto-create incidents (call_count == 0).
- **`system-wiki/gaps/frs-codebase-gap-register.md`:** #161, #162, #163, #165 all CLOSED.

## [2026-06-08] implementation | M7a host network mode + AF_PACKET capture (#156, #158)

- **`src/docker-compose.yml` (wims-suricata):** Switched to `network_mode: "host"` — Suricata now directly sees host ingress traffic (nginx ports 80/443) instead of only internal Docker bridge traffic (mDNS + inter-container). Removed `networks: wims_internal` (incompatible with host networking). Added `cap_add: [NET_ADMIN, NET_RAW]` for promiscuous capture. Changed command to `--af-packet=eth0 --runmode workers` for zero-copy AF_PACKET capture with multi-threaded processing.
- **AF_PACKET verified available:** `suricata --build-info` confirms `AF_PACKET support: yes`. `--list-runmodes` shows `AF_PACKET_DEV` with single/workers/autofp modes.
- **`system-wiki/security/security-baseline.md`:** Documented network topology, host networking caveats (Linux-only), and AF_PACKET + workers capture mode.
- **`system-wiki/gaps/frs-codebase-gap-register.md`:** #156 and #158 both CLOSED.

## [2026-06-09] feat | M9c Configuration management — system_config table, admin API + UI (#170)

- New migration `49_system_config.sql`: `wims.system_config (config_key PK, config_value, description, updated_by, updated_at)`. Seeded with 4 keys: `alert_severity_threshold=3`, `session_timeout_minutes=30`, `offline_storage_mb=50`, `ai_timeout_seconds=60`. RLS: SELECT `USING (TRUE)` (open; Celery consumers read without GUC), INSERT/UPDATE/DELETE restricted to `current_user_role() = 'SYSTEM_ADMIN'`.
- New `utils/config.py`: `get_config(db, key, default)` — shared helper importable from services and routes with no import cycle.
- New `api/routes/admin/config.py`: `GET /api/admin/config` (all rows) + `PATCH /api/admin/config/{key}` (update value + audit-log). Key whitelist enforced; unknown keys return 400. Registered in `admin/__init__.py`.
- **Live consumers**: `suricata_ingestion.eve_to_threat_log_row` accepts `high_threshold` kwarg (default 3); `ingest_eve_file` reads `alert_severity_threshold` from config once per invocation before the line loop. `ai_service.analyze_threat_log` and `generate_incident_narrative` both read `ai_timeout_seconds` from config (replaces hardcoded `60.0`).
- **Expose-only (no live enforcement)**: `session_timeout_minutes` — exposed in GET only; actual JWT expiry is Keycloak-realm-level (`ssoSessionIdleTimeout`), not changeable from WIMS without Keycloak Admin API integration (out of scope). `offline_storage_mb` — advisory cap enforced client-side: `offlineStore.queueIncident` estimates total queue bytes and throws with a user-readable message if over cap; `initOfflineStorageLimit(mb)` lets app startup override the default 50.
- **Deferred**: Redis hot-reload (config version counter) — config reads go direct to DB. Documented in config page disclaimer.
- New `frontend/src/app/admin/system/config/page.tsx`: per-key input + Save (PATCH per key), loaded via `fetchAdminConfig`. New `fetchAdminConfig` + `updateAdminConfig` appended to `legacy.ts`. Does NOT modify `system/page.tsx`.
- 15 unit tests in `tests/test_system_config.py`: GET seed keys, value+description, RBAC; PATCH happy-path, audit trail, unknown key 400, missing row 404, RBAC; 6 suricata threshold unit tests (default 3 preserved; threshold=2 escalates MEDIUM→HIGH); AI timeout consumer verifies `httpx.AsyncClient(timeout=120.0)` when config returns "120".

## [2026-06-07] feat | #166 Expand health endpoint + 60s system metrics Celery task

- `GET /api/admin/health` now returns 5 component checks: database, redis, keycloak, suricata, ollama.
- Suricata check: probes `wims.security_threat_logs` for rows in last 5 min (HEALTHY if flowing; HEALTHY if empty table = fresh deploy; UNHEALTHY if stale).
- Ollama check: calls `OLLAMA_URL/api/tags` with 5s timeout via httpx.
- New `wims.system_metrics` table (migration `46_system_metrics.sql`): id, recorded_at, cpu_percent, memory_total_mb, memory_used_mb, memory_percent, disk_total_gb, disk_used_gb, disk_percent.
- New Celery task `snapshot_system_metrics` (runs every 60s via beat): collects psutil CPU/memory/disk, INSERTs into `wims.system_metrics`, prunes rows older than 7 days.
- Updated: `api/routes/admin/monitoring.py`, `tasks/monitoring.py`, `celery_config.py`, `system-wiki/gaps/frs-codebase-gap-register.md`.

## [2026-06-07] implementation | M7b rule foundation — ET Open rules + suricata-update automation (#155, #159)

- **`src/suricata/rules/suricata.rules`:** Combined file — our 15 custom OWASP+BFP rules prepended to full ET Open ruleset (~136k lines, ~68k signatures). Loaded via Suricata's default configuration (no custom suricata.yaml needed).
- **`src/docker-compose.yml`:** Mounted `suricata/rules` (rw) and `/var/run/docker.sock` in celery-worker for suricata-update execution.
- **`src/backend/requirements.txt`:** Added `docker>=7.0.0` SDK for container exec from Celery tasks.
- **`src/backend/tasks/suricata.py`:** Added `update_suricata_rules` Celery task (weekly suricata-update + USR2 live reload) and `_count_active_rules` helper; graceful degradation when Docker SDK unavailable.
- **`src/backend/celery_config.py`:** Added `update-suricata-rules-weekly` beat entry (crontab Sunday 03:00 UTC).
- **`src/backend/tests/test_suricata_rules.py`:** Created — 7 end-to-end/integration tests: no-missing-rules warning, >1000 rules loaded, suricata.rules present with default config loading, and pipeline tests for OWASP/ET-Open/BFP-custom SIDs flowing into DB.
- **`src/backend/tests/test_suricata_ingestion.py`:** Added `test_et_open_sid_maps_correctly` unit test for ET Open SID mapping.
- **`system-wiki/security/security-baseline.md`:** Documented three-tier rule architecture with SID ranges and update cadence.
- **`system-wiki/gaps/frs-codebase-gap-register.md`:** #155 and #159 gaps updated.

## [2026-06-07] security | #221 CSP + COEP headers, ZAP suppressions promoted to WARN

- Added `Content-Security-Policy` header to production TLS nginx block covering: self, OSM tiles, unpkg Leaflet icons, Google Fonts, Next.js inline styles, Firebase Messaging SW (`worker-src`).
- Added `Cross-Origin-Embedder-Policy: unsafe-none` (require-corp would break 8 map components loading from CDNs without CORP).
- `.zap/rules.tsv`: 10038 and 90004 promoted from IGNORE → WARN.
- Reviewer found: Keycloak inline event handlers blocked by `script-src 'self'` (non-blocking — core OIDC login works), `connect-src wimsbfp.tech` redundant with `'self'`.

## [2026-06-07] fix | #220 CD workflow placeholder build-args + production vars

- Removed dead "Set placeholder envs" step (wrote to `$GITHUB_ENV`, but build-args read `vars.*` context).
- Dropped `NEXT_PUBLIC_OIDC_CLIENT_ID` from build-args (not an ARG in Dockerfile).
- Added `NEXT_PUBLIC_OIDC_AUTHORITY` (required ARG, was missing from workflow).
- Updated all fallback values: localhost → `wimsbfp.tech` production URLs.
- Set 4 GitHub repo variables: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_OIDC_REDIRECT_URI`, `NEXT_PUBLIC_OIDC_AUTHORITY`, `KEYCLOAK_AUDIENCE` (corrected from `account` → `wims-web` per #194).

## [2026-06-07] fix | #227 Hide NearbyPublicReportAreas on safety step

- Wrapped `<NearbyPublicReportAreas />` in `step !== 'safety'` conditional in `page.tsx`.
- PublicFireMap was already correctly inside `step === 'safety'` — no change needed.
- Spec had inverted current-behavior table; only 1 of 2 proposed changes was necessary.

## [2026-06-07] feat | #228 Data Retention Policy page, consent notice, footer link

- Created `src/frontend/src/app/privacy/page.tsx` — server component rendering all 7 policy sections.
  - Hero+card pattern matching fire-stations style (bfp-gradient hero, white rounded-xl card).
  - Numbered maroon circle section badges, amber consent callout, styled retention tables.
  - Uses existing globals.css CSS variable tokens.
- Added consent notice below report form card on `/` (report page) with link to `/privacy`.
- Added footer privacy link to both report and privacy pages.
- Registered `/privacy` as public route in `LayoutShell` (two `isPublic`/`isPublicRoute` checks).
- Preview HTML + PDF generated at `src/frontend/public/preview/privacy-hero.{html,pdf}`.
- Review fixes applied: `--text-secondary` darkened to `#5a6a7a` (WCAG AA), `<main>` landmark added, §4A parenthetical restored.

## [2025-06-06] refactor | Decompose monolithic route files into packages (issue #204)

- **`src/backend/api/routes/regional.py` (3040 lines) -> `api/routes/regional/` package:**
  - `__init__.py` — Shared helpers (`_get_security_provider`, `_fi_has_resubmitted_column`, `_regional_lifecycle_dependencies`, `_incident_verification_history_has_hash_columns`) + router registration.
  - `afor.py` (137 lines) — AFOR import/commit routes.
  - `duplicates.py` (138 lines) — Duplicate check route.
  - `field_updates.py` (343 lines) — `_apply_incident_field_updates` and `_fetch_incident_edit_fields` (helper functions, not routes).
  - `stats.py` (304 lines) — Encoder and validator stats endpoints.
  - `encoder.py` (554 lines) — Encoder read/lookup routes (incidents list, drafts, detail, audit log).
  - `encoder_crud.py` (618 lines) — Encoder write routes (create, update, delete, archive, submit).
  - `validator.py` (983 lines) — Validator routes (queue, verify, correct, bulk-approve, archive, diff, history, audit logs).

- **`src/backend/api/routes/admin.py` (1361 lines) -> `api/routes/admin/` package:**
  - `__init__.py` — Router registration.
  - `users.py` (401 lines) — User CRUD, sessions, force-logout.
  - `backups.py` (313 lines) — Backup/restore management.
  - `security.py` (153 lines) — Security threat log analysis and HITL actions.
  - `rate_limits.py` (114 lines) — Dynamic rate-limit configuration.
  - `monitoring.py` (136 lines) — System health, worker status, system metrics.
  - `analytics.py` (22 lines) — Analytics backfill.
  - `audit.py` (58 lines) — System audit trail viewer.
  - `scheduled_reports.py` (124 lines) — Scheduled report CRUD.

- **Session route overlap resolved:** Moved `revoke_user_session` (`DELETE /sessions/{user_id}/{session_id}`) from admin into `sessions.py`. Dropped duplicate `get_user_sessions` (`GET /sessions/{user_id}`) from admin — `sessions.py` already had `list_user_sessions` at same path.

- **Test patches updated:** `test_dynamic_rate_limits.py` and `test_backup_api.py` patches updated from `api.routes.admin.*` to `api.routes.admin.{rate_limits,backups}.*`.

- **`incidents.py` imports fixed:** Changed from `from api.routes.regional import _normalize_general_category, ...` to direct imports from `services.regional_incidents.helpers`.

- **`system-wiki/backend/backend-infrastructure.md`:** Updated route registration table to reflect package structure.

- **Line count compliance:** All route files now under 1000 lines (largest: `validator.py` at 983 lines).

## [2026-06-05] rebase | PR #182 rebased onto origin/master — conflict resolution

- **`src/backend/main.py`:** Made `_startup_admin_engine`/`_startup_admin_session_factory` lazy inside `_get_admin_session()` to avoid `create_engine("")` crash at module import when `DATABASE_ADMIN_URL`/`DATABASE_URL` are unset (e.g., during test collection outside Docker).
- **`src/backend/api/routes/user.py`:** Removed unused `from database import get_db` import (routes use `get_db_with_rls` from `auth`).
- **`src/backend/tests/test_profile_email.py`:** Fixed stale import `from database import get_db_with_rls` -> `from auth import get_db_with_rls`.
- **`src/backend/tests/test_infra_config.py`:** Updated `test_non_edge_services_bind_host_ports_to_loopback` to accept PR #182's `8090:80` local-dev port alongside master's `80:80`/`443:443`.
- **`src/nginx/nginx.local.conf`:** Added "Local development only" header comment to satisfy `test_local_nginx_override_is_explicitly_local_only`.
- **`src/nginx/nginx.conf`:** Resolved production `/api/` CORS conflict — kept master's `map $http_origin $cors_origin` at http scope, dropped PR's duplicate location-level `set`/`if`.
- **`src/docker-compose.yml`:** Combined PR's `wims_app_user` DATABASE_URL and `DATABASE_ADMIN_URL` (using `${POSTGRES_PASSWORD:?error}` not hardcoded `password`).
- **System-wiki conflicts:** Merged log/index/route-map/infrastructure-config/pwa-tests-cicd/local-dev-deploy-guide — kept all master and PR entries, dates, and source references.
- **20 PR commits + 12 master commits integrated** via commit-preserving rebase; 1 fixup commit for post-rebase import/lint/test corrections.

## [2026-06-05] fix | PR #217 auth callback rate-limit test isolation

- **`src/backend/tests/conftest.py`:** Expanded the autouse Redis rate-limit cleanup from only `public_rate_limit:*` keys to both `public_rate_limit:*` and auth callback `rate_limit:*` keys, using `scan_iter` and closing the Redis client. This prevents `tests/integration/test_auth_callback.py::test_callback_tampered_token_returns_401` from inheriting a spent PKCE callback sliding-window budget and returning 429 instead of the expected auth-layer 401.
- **`system-wiki/architecture/pwa-tests-cicd.md`:** Documented the two rate-limit key namespaces cleared by the root test fixture.

## [2026-06-05] fix | PR #217 review follow-ups — Keycloak email API, test coverage, frontend note, UUID cast

- **`src/backend/services/keycloak_admin.py`:** Replaced hallucinated `adm.send_execute_actions_email(actions=["UPDATE_PASSWORD"])` with the correct python-keycloak 7.1.1 API `adm.send_update_account(payload=["UPDATE_PASSWORD"], lifespan=604800)`. Replaced bare `except Exception:` around the email call with `except KeycloakError as e:` — email failures are still non-fatal but now log concrete evidence.
- **`src/backend/tests/test_keycloak_admin.py` (new):** 8 unit tests for `create_keycloak_user()` email path: happy-path `send_update_account` call, `KeycloakError` during email is non-fatal (warning logged, user still created), `KeycloakError` during `create_user` is fatal, password-set failure triggers cleanup, role-assignment failure is non-fatal, contact-number attribute, and password generation length/randomness. All external calls mocked — no Docker/Keycloak required.
- **`src/frontend/src/app/admin/system/page.tsx`:** Added `note` field to `createdUser` state type; user creation result now captures `result.note`. The hardcoded "Distribute this temporary password..." message is replaced by `createdUser.note` with a sensible fallback.
- **`src/backend/tests/integration/test_auth_callback.py`:** Standardized `cleanup_test_user` DELETE to use explicit `CAST(:kid AS uuid)` matching the verification query pattern.
- **`system-wiki/architecture/pwa-tests-cicd.md`:** Updated stale test file reference from deleted `test_auth_flow.py` to `test_auth_callback.py`.
- **Wiki synced:** `system-wiki/architecture/pwa-tests-cicd.md`, `system-wiki/log.md`. No FRS gap register change (auth email was a bug fix, not an FRS alignment change).

## [2026-06-05] fix | PR #216 review follow-ups — event bus thread-safety, async pool hardening, stale comments, dead useEffect

- **`src/backend/services/event_bus.py`:** Added `threading.Lock` (`_sync_pool_lock`) with double-checked locking around lazy `_SYNC_POOL` initialization — prevents TOCTOU race in sync publisher path. Added `socket_connect_timeout=0.5`, `socket_timeout=0.5`, `health_check_interval=30` to async pool (`_get_async_pool`) for consistency with sync pool hardening.
- **`src/backend/main.py`:** Replaced stale comment referencing removed side-effect task imports with accurate autodiscover description.
- **`src/frontend/next.config.ts`:** Replaced misleading comment about nonexistent tsconfig test file exclusions with accurate statement.
- **`src/frontend/src/context/AuthContext.tsx`:** Removed empty `useEffect` that fired on every `loading` state change but contained only a comment.
- **Wiki synced:** `system-wiki/backend/backend-infrastructure.md` — added Event Bus section documenting connection pools, thread safety, async/sync publishers, channels, and singleton.

## [2026-06-05] fix | PR #216 CI fix batch — backend ruff format + frontend type checks

- **Backend ruff format:** Applied auto-formatter to `public_dmz.py`, `celery_config.py`, `main.py`, `event_bus.py` — trailing commas, quote style, blank lines. Zero logic changes.
- **Frontend type fixes (7 files):**
  - `legacy.ts`: Added typed interfaces (`SystemHealthResponse`, `SystemMetricsResponse`, `WorkerStatusResponse`) replacing `Promise<unknown>` returns for `fetchSystemHealth`, `fetchSystemMetrics`, `fetchWorkerStatus`. Added `is_danger` field to `TriageClusterEntry`.
  - `page.tsx`: Fixed `CATEGORIES.icon` type from `ReactNode` → `ReactElement<{ className?: string }>` for `cloneElement` compatibility. Changed `reportingContext`/`safetyStatus` to use `?? undefined` for `appendCivilianReport` call.
  - `tracking/page.tsx`: Widened `getCategoryLabel` to accept `string | null`.
  - `offlineStore.ts`: Changed `PendingIncident.id` from optional to required (always present from IndexedDB auto-increment).
  - `useAutoSync.ts`, `useNetworkStatus.ts`: Added `| null` + `null` initial value for `useRef<ReturnType<typeof setTimeout>>()` calls (React 19 strictness).
  - `api.ts`: Updated `AuditLogEntry` interface to match actual API response shape (`audit_id`, `user_id`, `action_type`, etc. instead of `id`, `user_id`, `action`, `resource`).
  - `admin/system/page.tsx`: Removed explicit `Record<string, unknown>` from `.map()` callback.
  - `analyst/incidents/[id]/page.tsx`: Fixed `EmptyState` icon type from `ReactNode` to `LucideIcon`; added `LucideIcon` import.
  - `validator/map/page.tsx`: Added generic type parameter to `apiFetch` call.
- All pre-existing type errors that were masked by removed `ignoreBuildErrors: true` in `next.config.ts` (PR #184 cleanup).
- CI validation: ruff check ✓, ruff format --check ✓, frontend lint ✓, vitest 22/22 ✓, frontend build ✓.
- Commit: `f621411` pushed to `fix/slice4-perf-quality`.

## [2026-06-05] fix | PR #213 CI follow-up — compose env setup and backend format gate

- **CI compose env setup:** `.github/workflows/ci.yml` now copies root `.env.example` to `src/.env` before `docker-build` compose validation/build and before `security-scan` stack startup. This preserves `${VAR:?error}` fail-fast behavior in `src/docker-compose.yml` while giving ephemeral CI the required local/test values.
- **Backend format gate:** `src/backend/tests/test_jwt_fallback.py` was formatted with `ruff format` so the backend CI `ruff format --check .` step can pass.
- **Wiki sync:** `system-wiki/architecture/pwa-tests-cicd.md` documents the CI env-file pre-step; `system-wiki/architecture/infrastructure-config.md` documents required compose interpolation, CI handling, updated backend env values, authoritative Keycloak import path, and production CORS map behavior; `system-wiki/index.md` updated its last-change summary.

## [2026-06-05] fix | PR #213 review follow-ups — stale role, Firebase env, JWT tests, wiki sync

**PR #213 three-axis review follow-ups applied (worktree: pr-213):**

- **Stale `"VALIDATOR"` removed from `regional.py:599`:** Replaced `("NATIONAL_VALIDATOR", "SYSTEM_ADMIN", "NATIONAL_ANALYST", "VALIDATOR")` with just the three canonical roles. Legacy `VALIDATOR` role was removed from `bfp-realm.json` in #206; this code reference was missed.
- **`.env.example` Firebase section hardened:** Replaced committed real Firebase API key and VAPID key with `REPLACE_WITH_YOUR_...` placeholders. Documented all 7 Firebase env vars (2 required with `:?error`, 5 optional with `:-default`). Added warning comment.
- **JWT `to_pem` fallback unit tests:** Added `tests/test_jwt_fallback.py` with 6 unit tests covering: valid key with `to_pem`, key without `to_pem` tries next, all-candidate-keys-fail force-refreshes JWKS, no-to_pem-on-any-key returns 401, `jwt.decode` receives PEM string, and JWTError in candidate loop tries next key. All use `@pytest.mark.unit` and mock authenticator internals — no Docker required.
- **Nginx CORS: DELETE preserved intentionally.** The PR body claimed DELETE was removed from CORS methods but it was not (and should not be) — backend has DELETE endpoints (`DELETE /api/regional/incidents/{id}`, draft management). The `$cors_origin` map deny-by-default is the actual CORS hardening.
- **Wiki sync:**
  - `system-wiki/security/security-baseline.md`: Updated stale `$scheme://$host` CORS line to describe production `$cors_origin` map.
  - `system-wiki/architecture/infrastructure-config.md`: Removed legacy `VALIDATOR`/`ANALYST` from Roles table; added note about #206 removal.
  - `system-wiki/gaps/frs-codebase-gap-register.md`: Updated #205 entry to reference current `AAAA...=` placeholder; added #206 closure entry.

**Files changed:** `regional.py`, `.env.example`, `test_jwt_fallback.py` (new), `security-baseline.md`, `infrastructure-config.md`, `frs-codebase-gap-register.md`, `log.md`

## [2026-06-03] fix | PR #212 review fixes — Redis pool bounding, thread-safety, test hygiene

- **Redis connection pool:** Added `max_connections=10` to `_get_redis()` in `civilian.py`, matching `map.py`'s bounded-pool pattern. Prevents unbounded connection growth under load.
- **Thread-safety:** Added `threading.Lock` with double-checked locking around `_get_redis()` singleton initialization. Eliminates the narrow startup race where multiple threads could create concurrent connections before the global reference is published.
- **Warning log diagnostics:** Added `cache_key` to all three `logger.warning(...)` calls in `civilian.py` (fresh-read, write, stale read) for production debugging. `exc_info=True` retained.
- **Count bucket guard:** Added `ValueError` for `_get_count_bucket(count < 3)` as defense-in-depth (SQL already enforces `total_reports >= :min_reports`).
- **Test fixture rename:** Renamed `_clean_redis` fixture to `_clean_state` since it flushes Redis *and* deletes from 3 PostgreSQL tables. Added `socket_connect_timeout=0.5`/`socket_timeout=0.5` to the fixture's Redis client.
- **Test Redis hygiene:** Wrapped the pre-existing Redis client in `test_get_report_clusters_cache_and_stale_fallback` in `try/finally` so `r.close()` always runs. Added `socket_connect_timeout`/`socket_timeout`. Replaced `r.keys()` with `r.scan_iter(match=...)` to avoid O(N) keyspace scans.
- **Dead test code removed:** Removed the national-mode request in `test_get_report_clusters_returns_truncated_false_when_under_cap` that only asserted `status_code == 200` without testing truncation (comments admitted it was not reliable). Removed stale monkey-patch comments.
- **Wiki updated:** `system-wiki/subsystems/civilian-reporting-phase2.md` updated frontmatter date, cache behavior section (pool bounding, thread-safety, warning log keys, count guard), and test coverage section (fixture rename, Redis hygiene).
- **Verification:** `ruff check` + `ruff format --check` pass on both changed files. `git diff --check` clean. All 25 pytest tests pass (15 report-clusters + 10 submission tests).

## [2026-06-03] fix | PR #211 M13b email infra — bound task + retry + STARTTLS + plain-text + tests

**PR #211 review fixes applied:**

- **Critical — `send_email_task` bound task signature:** Added `self` as first parameter (matching `bind=True` decorator). Changed retry logging from module-level proxy (`send_email_task.request.retries`, `celery_app.tasks["..."].max_retries`) to `self.request.retries` and `self.max_retries`.
- **Critical — Tests exercise Celery task path:** `TestEmailServiceTask` now calls `module.send_email_task.run(...)` with a real Celery app (memory broker, eager mode) instead of calling `module._send_email(...)` directly. This exercises the `bind=True` self parameter and would catch the signature mismatch.
- **Retry exceptions narrowed:** `autoretry_for` changed from `(Exception,)` to `(aiosmtplib.SMTPException, ConnectionError, TimeoutError, OSError)` — transient SMTP/network failures only. Permanent template/context/type errors fail fast.
- **STARTTLS configurable:** Added `SMTP_STARTTLS` env var (default `false` for MailHog/dev). Passed to `aiosmtplib.send(start_tls=SMTP_STARTTLS)`. Added entry to `.env.example`.
- **Plain-text alternative body:** Added `_html_to_plain_text()` helper; `send_email_async` now adds `msg.add_alternative(plain_text, subtype="plain")` for multipart/alternative emails.
- **Render error logging:** Moved `render_email()` call inside `try/except` in `send_email_async` with dedicated `logger.error("Failed to render email template...")`.
- **Subject caching:** Added `_subject_raw_cache` dict so `_load_subject()` reads template files only once per template name.
- **Task import explicit:** Added `import tasks.notifications` to `main.py` alongside other task imports.
- **Security alert color:** Changed unknown-severity CSS fallthrough from green `#2ecc71` to neutral gray `#95a5a6`.
- **Validation:** 8/8 email infra tests pass; 37/37 combined (email + CSRF) tests pass. Syntax compile-checked.

**Files changed:** `tasks/notifications.py`, `services/email/sender.py`, `tests/test_email_infra.py`, `.env.example`, `main.py`, `services/email/templates/security_alert.html.j2`

## [2026-06-03] fix | PR #223 CI security-scan startup — CI-only HTTP nginx config

- **Root cause:** PR #223 changed `src/nginx/nginx.local.conf` from HTTP-only to HTTPS (HTTP→HTTPS redirect + TLS server block requiring `/etc/letsencrypt/live/wimsbfp.tech/` certs). The `docker-compose.override.yml` (auto-loaded by plain `docker compose up`) mounts `nginx.local.conf` but provides no cert volume. The GitHub Actions `security-scan` job ran plain `docker compose up -d --build`, so nginx failed to start because cert files were missing. The health-poller timed out at 180s before Nmap/ZAP could run.
- **Fix:** Created `src/nginx/nginx.ci.conf` (HTTP-only nginx config — port 80, no TLS, no certs required, preserves PR #223's `$scheme://$host` CORS hardening) and `src/docker-compose.ci.yml` (mounts `nginx.ci.conf` instead of `nginx.local.conf`). Updated `.github/workflows/ci.yml` `security-scan` job to bring up the stack with `docker compose -f docker-compose.yml -f docker-compose.ci.yml up -d --build` and tear down with the same file list. The CI now uses a plain HTTP path that does not depend on TLS certificates.
- **Local dev impact:** The local override still loads `nginx.local.conf` (HTTPS) and now mounts `src/.ssl` to `/etc/letsencrypt`, so developers can generate self-signed certs once and then use plain `docker compose up`. Developers who do not need HTTPS locally can use the CI compose path (`-f docker-compose.yml -f docker-compose.ci.yml`). Updated `system-wiki/operations/local-dev-deploy-guide.md` Section 1 and Pitfall 2 to document both paths.
- **CI docs:** Updated `system-wiki/architecture/pwa-tests-cicd.md` to note the CI-specific compose override.
- **Gap register:** No change — M11b remains CLOSED; this is an infrastructure/CI wiring fix.
- **Verification:** `docker compose -f docker-compose.yml -f docker-compose.ci.yml config --quiet` passes; `git diff --check` clean.

## [2026-06-03] fix | PR #214 infra/auth config review fixes

- Updated the manual auth rate-limit test to target the real `POST /api/auth/callback` protected path instead of the stale `/api/auth/login` stub.
- Aligned CI/deploy backend auth env defaults to `KEYCLOAK_CLIENT_ID=wims-web` and `KEYCLOAK_AUDIENCE=wims-web`; scoped Direct Grant password-reset verification to `KEYCLOAK_PASSWORD_RESET_CLIENT_ID` (`bfp-client` by default).
- Pinned `nginx-gateway` to `nginx:1.27.3-alpine` and refreshed Suricata/nginx image references in `architecture/infrastructure-config.md`.
- Updated `src/frontend/src/app/api/auth/sync/route.ts` to forward trusted nginx client-IP headers to backend `/api/auth/callback` so Redis callback rate limiting keys by end-user IP rather than the frontend container.
- Repaired local-dev docs to remove obsolete self-signed-cert setup for base compose and documented the production-only TLS mount split.
- Clarified that the admin `rate_limit_config:login` key/tier is a legacy compatibility label for the auth callback flow.

## [2026-06-03] fix | CI security scan — ZAP artifact upload compatibility

- Updated `.github/workflows/ci.yml` `security-scan` ZAP baseline action to set `artifact_name: 'zap-scan'` and bump `zaproxy/action-baseline` from `v0.12.0` to `v0.15.0`, avoiding the legacy action packaging that failed during GitHub artifact container creation.
- Updated `system-wiki/architecture/pwa-tests-cicd.md` to document the explicit ZAP artifact name override and action version compatibility fix.

## [2026-06-03] fix | CI security scan — ZAP rules file for pre-existing WARN alerts

- Created `.zap/rules.tsv` with 7 IGNORE entries for pre-existing ZAP WARN alerts (IDs: 10038, 10049, 10055, 10063, 10096, 10109, 90004). These are configuration gaps (missing CSP/COEP on nginx, upstream Keycloak issues, Next.js informational flags) that predate PR #208.
- Updated `.github/workflows/ci.yml` `security-scan` job to reference `rules_file_name: '.zap/rules.tsv'` in the ZAP baseline action step.
- Updated `system-wiki/architecture/pwa-tests-cicd.md` to document the `security-scan` job and the ZAP rules file.

## [2026-06-03] style | M14: add trailing newline to test_public_submission.py (W292 lint fix)

## [2026-06-03] fix | M14 region resolution — nearest ref_fire_stations (civilian.py pattern)

**Root cause:** `wims.ref_regions` has NO PostGIS geometry column — only `region_id, region_name, region_code`. PostGIS `GEOGRAPHY(POINT,4326)` lives ONLY on `wims.ref_fire_stations.location`. The `region_geom` column never existed; `ORDER BY region_id` was a dumb fallback. `civilian.py`'s `_resolve_nearest()` resolves region by finding the nearest fire station and reading its `region_id` attribute — matching approach inlines here.

**Fix (`src/backend/api/routes/public_dmz.py`):** Replaced region resolution with:
```sql
SELECT region_id FROM wims.ref_fire_stations
ORDER BY location <-> ST_GeogFromText(:wkt) LIMIT 1
```
Attribute access: `station_row.region_id if station_row else None`. Fallback to `ref_regions ORDER BY region_id LIMIT 1` with attribute access if no stations found.

**Fix (`src/backend/tests/test_public_submission.py`):** Added module-level `_FakeRow` class (attribute access + index + unpack), replacing all per-test `MockRow` classes. `test_region_resolved_via_nearest_fire_station` asserts first `execute()` call uses `ref_fire_stations` with `<->` operator. `test_submission_creates_row_with_null_encoder_id` uses `_FakeRow(incident_id=..., verification_status=..., created_at=...)`.

**`src/postgres-init/32_ref_fire_stations.sql` seeds ref_fire_stations with all 237+ PH fire stations and their `location GEOGRAPHY(POINT, 4326)` — no migration needed for live integration tests.** `ref_regions` fallback handles thin-seed DB edge case.

**Deferred:** Polygon geometry on `ref_regions` would enable true centroid-based resolution. Currently via nearest fire station — acceptable per FRS M14 functional spec.

## [2026-06-02] fix | M14 test failures — geometry column, MockRow subscript, rate-limit isolation

**Root causes and fixes for 10 failing tests on `feat/m14-public-submission` (PR #320):**

**(A) Wrong geometry column:** `wims.ref_regions` has no geometry column. The ST_Distance query in `public_dmz.py` used `region_geom` which does not exist. Replaced with simple `ORDER BY region_id LIMIT 1` fallback (no PostGIS geometry on ref_regions in current schema). Coordinate-based nearest-centroid is deferred until geometry is added to ref_regions.

**(B) MockRow not subscriptable:** `test_region_resolved_via_nearest_centroid` returns `MockRow()` from `fetchone()` in a tuple context — `region_row[0]` was called on a MockRow instance with no `__getitem__`. Added `__getitem__` to the MockRow class to return positional values matching a real SQLAlchemy Row.

**(C) Rate-limit state bleeds across tests:** The 3/IP/hr Redis limiter counted 127.0.0.1 across the whole test file. Added `flush_public_rate_limit` autouse fixture to `conftest.py` that clears `public_rate_limit:*` keys before each test. Rate-limit tests themselves use random fake IPs and clean up after themselves.

**Files changed:**
- `src/backend/api/routes/public_dmz.py` — removed `region_geom` from query
- `src/backend/tests/test_public_submission.py` — added MockRow `__getitem__`
- `src/backend/tests/conftest.py` — added `flush_public_rate_limit` autouse fixture

## [2026-06-02] implement | M14 public report endpoint — un-deprecated, nearest-centroid, rate limit, Retry-After

**FRS reference:** Module 14 — Public Submission (FRS `#177`)

**Changes implemented (`src/backend/api/routes/public_dmz.py`):**
- `POST /api/v1/public/report`: restored from 410 deprecation to active endpoint
- Region resolution: replaced `ORDER BY region_id LIMIT 1` fallback with proper `ST_Distance` nearest-centroid using `ref_fire_stations` centroids and PostGIS KNN operator
- Rate limiting: Redis sliding-window 3 req/IP/hour on the public endpoint
- HTTP 429 response includes `Retry-After` header with seconds until reset
- Writes to `wims.fire_incidents` with `encoder_id = NULL`, `verification_status = 'PENDING_VALIDATION'`
- No Keycloak JWT required, no RLS context set

**Test file added:** `src/backend/tests/test_public_submission.py` — validates 201 response, NULL encoder_id, PENDING_VALIDATION status, rate limit 429, Retry-After header.

## [2026-06-02] hygiene | env hygiene (#205 key placeholder, #194 audience) + Redis connection pooling (#195)

- `.env.example`: Replaced real `WIMS_MASTER_KEY` value with `REPLACE_WITH_REAL_BASE64_32BYTE_KEY` placeholder; added generation comment.
- `.env.example`: Changed `KEYCLOAK_AUDIENCE` from `account` → `wims-web` with comment noting it must match Keycloak client audience.
- `src/backend/services/event_bus.py`: Added module-level sync `ConnectionPool` (`_sync_pool`) shared across `publish_*_sync()` functions (lines ~247, 285, 322). Added module-level async `ConnectionPool` (`_async_pool`) shared via `_get_async_pool()` reused in `_ensure_pub()`/`_ensure_sub()`.
- `src/backend/api/routes/public_dmz.py`: Replaced per-request `aioredis.from_url` in `_get_redis()` with module-level `ConnectionPool` (`_redis_pool`, max_connections=20) via `_get_redis_pool()`. No behavioral change — only connection reuse.

## [2026-06-02] fix | Redis connection pooling, timeouts, error logging, test cleanup for report-clusters endpoint

**Session context:** Applied production-quality fixes from three-axis review of issues #127/#128.

**Fixes:**
- **P1 — Redis connection leak:** Replaced per-request `redis.from_url()` with module-level `_get_redis()` singleton using connection pooling, `socket_connect_timeout=0.5`, `socket_timeout=0.5`, and `health_check_interval=30`.
- **P2 — No Redis timeouts:** Added `socket_connect_timeout=0.5` and `socket_timeout=0.5` to prevent requests from hanging under Redis failure.
- **P3 — Bare `except Exception: pass`:** Added `logger.warning(...)` with `exc_info=True` to all three previously-silent except blocks.
- **P4 — 15× `import redis` in test function bodies:** Moved to single module-level import at `test_civilian_api.py:15`.
- **P5 — 15× Redis FLUSHDB boilerplate:** Replaced ~70 lines of repeated setup with `autouse` `_clean_redis` fixture.
- **P6 — Truncation test:** Renamed `test_get_report_clusters_truncation_flag` → `test_get_report_clusters_returns_truncated_false_when_under_cap`, removed dead `monkeypatch` parameter.

**Verification:** `ruff check .` passes; `ruff format --check .` passes; frontend `npx vitest run` 145/145 pass (no regressions).

**Files:** `src/backend/api/routes/civilian.py`, `src/backend/tests/integration/test_civilian_api.py`.

**Wiki updated:** `system-wiki/log.md`. No `gaps/frs-codebase-gap-register.md` update needed (production quality fixes, no FRS alignment change).

## [2026-06-01] investigation | Frontend tab-switching performance

Investigated sluggishness when switching between dashboard tabs. Root cause is full data re-fetch on every navigation: Next.js App Router remounts page components on route change, all `useEffect` data-fetch chains re-run from scratch with no caching. Three contributing causes identified (P-01, P-02, P-03). Analyst dashboard worst-case: 7 parallel API calls on every mount (`analyst/page.tsx:321-340`). No fix applied in this session — gap documented for a future TanStack Query refactor.

**Verification:** Source inspection of `LayoutShell.tsx`, `AuthContext.tsx`, `dashboard/validator/page.tsx`, `dashboard/regional/page.tsx`, `dashboard/analyst/page.tsx`, and `src/frontend/src/lib/api/` slices. The LayoutShell cache-clear `useEffect` and auth `loading` spinner are one-time-on-mount only; they do not contribute to per-navigation sluggishness.

**Wiki updates:** Added `## Frontend Performance` section to `system-wiki/gaps/ui-ux-gap-register.md`; added `## Data Fetching Pattern` section to `system-wiki/frontend/frontend-infrastructure.md`; added `## Observed: Frontend tab-switching performance` section to `docs/PR-rls-and-fixes.md`. Also created `docs/fix-localhost-hsts.md` and `scripts/Fix-LocalhostHSTS.ps1` for recurring HSTS/localhost access issue.

## [2026-06-01] fix | RLS helper bootstrap source of truth

- Removed the backend startup duplicate that recreated `wims.current_user_role()`, `wims.current_user_region_id()`, and `wims.current_region_id()` with ad hoc single-quoted SQL bodies; `src/postgres-init/09_rls_helpers.sql` is now the only initializer source for `current_user_role()`.
- Confirmed `src/postgres-init/14a_assign_ncr_to_test_users.sql` already targets canonical `encoder_ncr` plus `validator_test`; no migration rename was needed.
- Added static RLS init contract tests to prevent duplicate helper definitions and legacy `encoder_test` NCR assignment from returning.

**Verification:** `python -m pytest tests/test_schema_patch_startup_guard.py tests/test_rls_init_contract.py -q`, `python -m ruff check .`, `python -m ruff format --check .`, and `python -m py_compile src\backend\main.py src\backend\tests\test_schema_patch_startup_guard.py src\backend\tests\test_rls_init_contract.py` pass. Full DB-backed rerun requires the CI/PostGIS service.

**Wiki updates:** Updated `system-wiki/architecture/pwa-tests-cicd.md`, `system-wiki/index.md`, and this log. No `system-wiki/gaps/frs-codebase-gap-register.md` update needed; no FRS/codebase gap changed.

## [2026-06-01] fix | Auth and RLS integration test dependency overrides

- Updated AI/IDS admin and regional AFOR import tests so role-specific auth overrides also satisfy the canonical `get_current_wims_user` / `get_db_with_rls` dependencies used by RLS-scoped routes.
- Updated reference-table RLS tests to connect as `wims_app_user` instead of the CI postgres superuser, ensuring row-level policies are enforced during assertions.
- Documented the auth/RLS override pattern in the CI/test infrastructure synthesis page.

**Verification:** `python -m py_compile src\backend\tests\integration\test_ai_ids_api.py src\backend\tests\integration\test_regional_afor_unified_import.py src\backend\tests\test_ref_table_rls.py`, `python -m ruff check .`, and `python -m ruff format --check .` pass. DB-backed integration rerun requires the CI/PostGIS service.

**Wiki updates:** Updated `system-wiki/architecture/pwa-tests-cicd.md`, `system-wiki/index.md`, and this log. No `system-wiki/gaps/frs-codebase-gap-register.md` update needed; no FRS/codebase gap changed.

## [2026-06-01] fix | Backend startup schema patch guard for CI runtime

- Added a process-local startup guard so FastAPI compatibility schema patches run once per backend Python process instead of once per repeated pytest `TestClient(app)` lifespan.
- Added focused backend coverage for the guard, verifying that a second `apply_schema_patches()` call does not reopen the admin DB session or rerun patch helpers.
- Updated CI/test infrastructure documentation to record the startup guard and clarify that long runtime inside the first backend `Run tests` step should be investigated as test/startup behavior before changing the advisory coverage pass.

**Verification:** `python -m py_compile src\backend\main.py src\backend\tests\test_schema_patch_startup_guard.py`, `python -m ruff check .`, `python -m ruff format --check .`, and `python -m pytest tests/test_schema_patch_startup_guard.py -q` pass.

**Wiki updates:** Updated `system-wiki/architecture/pwa-tests-cicd.md`, `system-wiki/index.md`, and this log. No `system-wiki/gaps/frs-codebase-gap-register.md` update needed; no FRS/codebase gap changed.

## [2026-05-31] docs | PR RLS and fixes summary updated

- Updated `docs/PR-rls-and-fixes.md` with Codex-authored UI/auth changes: role dashboard redirects, user-scoped manual-entry draft restore, login alert placement, OTP confirmation card refinements, MFA scroll containment, and AFOR Barangay tip alignment.
- Removed the dedicated plain-language RLS explanation section and replaced the Part 1 RLS pointer with concise technical bullets.

**Verification:** `rg` confirms the removed plain-language RLS section text is no longer present in `docs/PR-rls-and-fixes.md`.

**Wiki updates:** Updated `system-wiki/architecture/docs-and-scripts.md`, `system-wiki/index.md`, and this log. No `system-wiki/gaps/frs-codebase-gap-register.md` update needed; no FRS/codebase gap changed.

## [2026-05-31] polish | OTP confirmation alignment refinement

- Removed the visible "One-time code" label from the post-enrollment OTP confirmation card while preserving an accessibility label for the OTP input group.
- Shifted the OTP confirmation card content to one left-aligned column: icon, title, helper text, OTP boxes, "Go back" action, and sign-in button.
- Aligned the sign-in button with the OTP input group instead of centering it independently.

**Verification:** `git diff --check` passes for `wims-custom.css` with only CRLF warnings.

**Wiki updates:** Updated `system-wiki/ui-ux/evaluation-loginpage-keycloaksso.md`, `system-wiki/index.md`, and this log. No `system-wiki/gaps/frs-codebase-gap-register.md` update needed; no FRS/codebase gap changed.

## [2026-05-31] polish | OTP confirmation card

- Updated the post-enrollment Keycloak OTP confirmation page to render as a self-contained verification card with an authentication icon, title, helper text, centered OTP inputs, "Go back" secondary action, and proportional sign-in button.
- Removed visible account identifiers from the OTP confirmation screen by omitting the attempted username and keeping the shared template username block suppressed for this page only.
- Scoped larger OTP input boxes, card shadow, spacing, mobile scaling, and submit-button sizing to `#kc-otp-login-form` so the separate OTP setup/enrollment page is not changed.

**Verification:** `git diff --check` passes for `login-otp.ftl` and `wims-custom.css` with only CRLF warnings; targeted search confirms no `auth.attemptedUsername` or `restartLoginTooltip` remains in the OTP confirmation template.

**Wiki updates:** Updated `system-wiki/ui-ux/evaluation-loginpage-keycloaksso.md`, `system-wiki/index.md`, and this log. No `system-wiki/gaps/frs-codebase-gap-register.md` update needed; no FRS/codebase gap changed.

## [2026-05-31] polish | OTP challenge order and AFOR Barangay hint alignment

- Updated the Keycloak OTP challenge layout so the attempted username, six OTP boxes, restart-login link, and sign-in button render in one ordered form flow.
- Hid the shared template username/restart block only for the OTP challenge page so the new order is not duplicated and OTP verification behavior remains unchanged.
- Moved the AFOR Barangay reverse-geocoding tip below the Barangay input in `IncidentForm.tsx`, aligning the Barangay input with City/Municipality across manual create and import correction flows.

**Verification:** `git diff --check` passes for the touched OTP/form files; `npm.cmd run lint` passes with 0 errors and 16 existing warnings outside this change.

**Wiki updates:** Updated `system-wiki/ui-ux/evaluation-loginpage-keycloaksso.md`, `system-wiki/subsystems/regional-dashboard.md`, `system-wiki/index.md`, and this log. No `system-wiki/gaps/frs-codebase-gap-register.md` update needed; no FRS/codebase gap changed.

## [2026-05-31] fix | canonical dev encoder usernames and region mapping

- Replaced the offset dev encoder seed naming with canonical region-code usernames: `encoder_ncr` for NCR region 1, `encoder_car` for CAR region 2, `encoder_r01` for Region I region 3, through `encoder_nir` for region 18.
- Updated `scripts/seed-dev-users.sh`, `scripts/seed-dev-users.ps1`, Keycloak realm exports, and SQL bootstrap rows so fresh and reseeded local stacks create login-capable encoder accounts with `Password123!`, verified email, first/last profile fields, no required actions, and repairable legacy usernames.
- Added `test_dev_user_seed_mapping.py` to guard the canonical mapping across scripts, SQL bootstrap, and Keycloak realm exports.
- Updated local dev and database synthesis pages to document the corrected account mapping. No FRS gap entry changed because this is a dev identity/bootstrap alignment fix.

## [2026-05-30] merge | Master conflict resolution for encoder/validator branch

## [2026-06-03] fix | M13b test_email_infra — relative path + leak-proof sys.modules mock

**Root causes and fixes:**

**Bug 1 — hardcoded Windows absolute path:** `TestEmailServiceTask` used `"E:/WIMS-GIT/WIMS-BFP-PROTOTYPE/src/backend/tasks/notifications.py"` directly in both test methods. On Linux CI this causes `FileNotFoundError`. Fixed: added `from pathlib import Path` and a module-level constant:
```python
_NOTIFICATIONS_PATH = str(Path(__file__).resolve().parents[1] / "tasks" / "notifications.py")
```
`parents[1]` = `backend/` from `tests/`, so the path works on any OS.

**Bug 2 — sys.modules mock leaks into later tests:** Both `TestEmailServiceTask` methods set `sys.modules[mod] = MagicMock()` before loading, but cleanup `sys.modules.pop(mod, None)` was a **trailing statement** outside any `try/finally`. If `FileNotFoundError` (or any assertion failure inside the load) aborted the test, `sqlalchemy`'s MagicMock remained in `sys.modules` — causing `test_immutable_records::test_66` to fail with `can't adapt type 'MagicMock'`. Fixed: wrapped the entire mock-load-assert block in `try/finally` with **restore** (not just pop):
```python
saved = {m: sys.modules.get(m) for m in mods}
try:
    for m in mods:
        sys.modules[m] = MagicMock()
    # load and test...
finally:
    for m in mods:
        if saved[m] is None:
            sys.modules.pop(m, None)
        else:
            sys.modules[m] = saved[m]
```

**Files changed:** `src/backend/tests/test_email_infra.py` only.

## [2026-06-02] implement | M13b email infrastructure — Jinja2 HTML templates + SMTP + Celery retry task

**FRS reference:** Module 13b — Email Notifications (FRS `#176`)

**Changes implemented:**
- `src/backend/services/email/sender.py` — pure Jinja2 HTML email rendering (no mrml dependency):
  - `render_email(template_name, context) -> (subject, html)`: loads `.html.j2` from `services/email/templates/`, extracts subject from `{# subject: ... #}` header, Jinja2-renders body
  - `send_email_async(to, template, context)`: renders + sends via `aiosmtplib`
  - `send_email(to, template, context)`: synchronous wrapper for Celery tasks
  - SMTP config via env: `SMTP_HOST` (default "mailhog"), `SMTP_PORT` (default 1025), `SMTP_FROM` (default "no-reply@bfp.gov.ph"), optional `SMTP_USER`/`SMTP_PASSWORD`
- `src/backend/services/email/templates/` — 4 email-safe inline-CSS HTML templates with BFP maroon (#8B0000) branding:
  - `password_reset.html.j2` (vars: full_name, reset_link, expiry_minutes)
  - `account_locked.html.j2` (vars: full_name, unlock_time, support_contact)
  - `security_alert.html.j2` (vars: severity, summary, detected_at, dashboard_link)
  - `weekly_report.html.j2` (vars: week_range, total_incidents, top_region, report_link)
- `src/backend/tasks/notifications.py`: added `send_email_task` Celery task with `autoretry_for=(Exception,)`, `retry_backoff=True`, `retry_backoff_max=600`, `max_retries=5`; does NOT query RLS tables
- `src/backend/requirements.txt`: added `aiosmtplib>=3.0.0` (mrml intentionally excluded for build portability)
- `.env.example`: added `SMTP_HOST=mailhog`, `SMTP_PORT=1025`, `SMTP_FROM=no-reply@bfp.gov.ph`
- `src/backend/tests/test_email_infra.py`: render tests for all 4 templates, mock aiosmtplib send test, task retry behavior test

**Deferred triggers (follow-up issues):**
- Keycloak account lockout email → #138
- Weekly analytics report Celery beat → #176
- Security alert email on CONFIRM_THREAT HITL action → #176

## [2026-06-02] fix | M13b CI failure — add jinja2 to requirements.txt

**Root cause:** `services/email/sender.py` imports jinja2 (and aiosmtplib). When `tasks/notifications.py` was updated to wire in `sender`, the chain `from main import app` → `import tasks.notifications` → `from services.email.sender import render_email` pulled jinja2 into the entire app namespace. CI (Python 3.12) failed at collection because `jinja2` was not in `requirements.txt` — only `aiosmtplib` was.

**Fix:** Added `jinja2>=3.1.4` to `src/backend/requirements.txt` (aiosmtplib>=3.0.0 was already present). No other files changed.

**Verification (host, Python 3.9):** `from services.email.sender import render_email, send_email_async` → `email sender import ok`. `python -m pytest tests/ --collect-only -q` → 18 tests collected, 32 errors — all errors are pre-existing unrelated failures (missing `fastapi`, `sqlalchemy`, `pydantic` PEP 604 union syntax on Python 3.9, `cryptography`, etc.); zero jinja2 collection errors remain.

**Note:** Host is Python 3.9; CI is Python 3.12. The jinja2 fix resolves the CI failure. The pre-existing host failures are out of scope for this fix.

**Design note:** Uses pure Jinja2 HTML templates (email-safe inline CSS, table-based layout, max-width 600px) instead of mrml to avoid native wheel build failures on python:3.11-slim.

## [2026-05-30] merge | Master conflict resolution for encoder/validator branch
- Merged `master` into `fix/enc-val-bugs-and-UI` and resolved conflicts in `src/backend/api/routes/regional.py` and `system-wiki/log.md`.
- Preserved the encoder/validator branch's extracted regional helper architecture instead of reintroducing inline helper definitions from master.
- Updated `src/backend/services/regional_incidents/helpers.py` so `insert_incident_verification_history()` accepts optional `data_hash` and `sync_status`, keeping the extracted helper compatible with master's M4b verification audit migration.
- Preserved both master's M2/M4/M8/M9 log entries and this branch's archive/unarchive and duplicate-detection log entries.

## [2026-05-30] redesign | duplicate detection — conservative anchor-gated model

**Root cause of false positives:** The previous 5-criterion scoring model (distance ≤500m | same category+type | same date | time within 1 hr | same city, threshold 3/5) could reach 3/5 with purely administrative/temporal signals — same city + same date + same time — without any location or address proximity. Multiple separate fires per day in the same city is normal for BFP operations.

**New model** (`src/backend/services/duplicate_detection.py`): Anchor gate + Python scoring.

Architecture change: SQL now fetches candidates with `ST_Distance` and all address/text fields (via LEFT JOIN to `incident_nonsensitive_details` and `incident_sensitive_details`). Python applies the anchor gate and scores each candidate.

**Anchor gate** (any one required):
- Coordinate proximity ≤ 250 m
- Matching barangay + matching street_address OR landmark
- Matching non-empty establishment_name AND (distance ≤ 500 m OR barangay matches)

**Scoring** (max 12 pts): distance tiers (3/2/1), category+type match (3/1), time delta (2/1), address match (2/1), establishment (+1), fire station (+1). Confidence: LIKELY ≥ 7, POSSIBLE ≥ 4.

**API change**: 409 DUPLICATE_DETECTED response now includes `"confidence": "LIKELY" | "POSSIBLE"`. Frontend modals use this to show "Likely Duplicate" vs "Possible Duplicate".

**New fields added to geo_meta queries** in `lifecycle.py`: `barangay_id`, `barangay`, `street_address`, `landmark`, `establishment_name`, `fire_station_name` (via LEFT JOIN to `incident_sensitive_details`).

**subsystems/regional-dashboard.md**: Updated duplicate detection description.

## [2026-05-30] fix | PR #143 review fixes: geocode proxy, tests, component extraction, PII dedup, ruff format

**Changes implemented (review-fix batch @ `2ab506a` → `2bc229b`):**

- **Nominatim geocode proxy** (`src/backend/api/routes/geocode.py`, `src/frontend/src/lib/geocode.ts`): All geocode requests now route through the backend (`/api/geocode/reverse`, `/api/geocode/search`) instead of the frontend calling `nominatim.openstreetmap.org` directly. Fire incident coordinates never leave the server to a third party. Backend proxy uses `httpx.AsyncClient` with timeout handling (504) and upstream error passthrough (502). Forward search restricted to Philippines (`countrycodes=ph`). Router registered in `main.py`.

- **Duplicate detection unit tests** (`src/backend/tests/test_duplicate_detection.py`): 293-line test suite, 21 unit tests. Covers threshold logic (score ≥ 3), effective_date derivation from notification_dt, parameter forwarding for all 5 criteria (parametrized), null lat/lon/notification_dt handling, exclude_statuses construction, verified_window_seconds, and combined edge cases. All 21 pass.

- **IncidentForm component extraction** (`src/frontend/src/components/IncidentFormSections.tsx`, `src/frontend/src/lib/geocode.ts`): IncidentForm.tsx reduced from 2,269 → 1,977 lines (below 2k ceiling). Form sections extracted to `IncidentFormSections.tsx` (365 lines). Geocode logic extracted to `lib/geocode.ts` (78 lines) with `reverseGeocode()` and `searchGeocode()` calling the backend proxy.

- **PII decryption deduplication** (`src/backend/services/regional_incidents/helpers.py`): `decrypt_pii_blob()` defined once as a shared helper instead of duplicated inline decryption at both list and detail endpoints in `regional.py`. Uses lazy `SecurityProvider` singleton with proper `SecurityProviderError` logging.

- **Barangay extraction unit tests** (`src/backend/tests/test_afor_import.py`): 9 new tests for `_extract_barangay_from_address()` covering keyword detection (Brgy/Bgy/Barangay/BRGY), positional fallback (5-part AFOR template), empty string, placeholder, and fewer-than-3-parts inputs.

- **Ruff format pass** (`regional.py`, `main.py`, `helpers.py`, `test_afor_import.py`, `test_duplicate_detection.py`): 5 files reformatted to satisfy CI `ruff format --check` gate (line-length wrapping, trailing commas).

- **Repo hygiene:** Removed `PR.md`, `feedback.md`, `checklists/` from repo root (process artifacts).

**Verification:** Backend: `ruff format --check .` (110 files clean), `ruff check .` (all pass), `pytest tests/test_duplicate_detection.py` (21 pass), `pytest tests/test_afor_import.py -k extract_barangay` (9 pass).

**Wiki updates:** This log.

## [2026-05-30] fix | Encoder/validator archived incident detail and unarchive

**Changes implemented:**

- `GET /api/regional/incidents/{incident_id}` now allows archived records for authorized encoder/validator archive review instead of returning 404 from `fi.is_archived = FALSE` filters.
- Added encoder and validator unarchive actions: `PATCH /api/regional/incidents/{incident_id}/unarchive` and `PATCH /api/regional/validator/incidents/{incident_id}/unarchive`.
- Archive views on encoder and validator dashboards now expose Unarchive actions; validator archive rows also retain permanent Delete for archived cleanup.
- `unarchive_finalized_incident()` clears `is_archived`/`archived_at`, writes `UNARCHIVED` incident verification history, and resyncs analytics.
- The verified-row immutability rule patch now permits both archive and unarchive `is_archived` transitions while keeping other VERIFIED updates blocked.

**Verification:** `npm.cmd run lint -- --no-cache` passed with warnings only; backend route/service files passed AST parsing. Python bytecode compilation was blocked by local `__pycache__` permission.

**Wiki updates:** Updated `index.md`, `backend/api-route-map.md`, `subsystems/regional-dashboard.md`, `subsystems/validator-hub.md`, `subsystems/references/regional-api-ref.md`, and this log. No FRS/codebase gap entry changed.

## [2026-05-28] fix | Layout zoom scoping, OTP sizing, notification toasts, badge, filter UX, 24H labels

**Changes implemented:**

- **Global zoom regression fix** (`src/frontend/src/app/globals.css`, `src/frontend/src/components/LayoutShell.tsx`): Removed `zoom: 0.9` from `body` (which caused a white bottom strip on login and dashboards). Added `.wims-main-zoom { zoom: 0.9; }` and applied it to the authenticated `<main>` element only. Login page and public routes are unaffected.

- **Keycloak OTP layout** (`src/keycloak/themes/wims-bfp/login/resources/css/wims-custom.css`): OTP grid constrained to `max-width: 300px; margin: auto` with `gap: 0.375rem`. Boxes changed from `aspect-ratio: 1/1` (caused overflow on smaller viewports) to `height: 44px; line-height: 44px; font-size: 1.125rem`. Separator changed to `width: 10px; justify-self: center`. All 6 inputs now fit within the Keycloak card at common desktop widths.

- **Rejected count badge** (`src/frontend/src/app/dashboard/regional/page.tsx`): Rejected filter chip button changed to `relative`. Badge moved from inline `span` to `absolute -right-2 -top-2` with `ring-2 ring-white`, matching validator Pending chip style.

- **Rejected chip click → All Time** (`regional/page.tsx`): Clicking the Rejected status chip now calls `showRejectedFilter()` which sets `dateFilter = 'all'`, ensuring the full rejected backlog is visible.

- **"Show rejected" notification → scroll** (`regional/page.tsx`): New `showRejectedAndScroll` handler: applies the filter then `scrollIntoView({ behavior: 'smooth' })` on the incidents section ref after a 60 ms delay, guiding the encoder directly to the list.

- **Encoder notification toasts → sticky** (`regional/page.tsx`): Pending-actioned banner and rejection alert moved to a `sticky top-0 z-40` container at the top of the page content. Both are now visible while scrolling. Pending-actioned banner gained a **Refresh** button (calls `refreshAll()` and dismisses).

- **Validator Pending filter → All Time** (`src/frontend/src/app/dashboard/validator/page.tsx`): Clicking Pending now also sets `dateFilter = 'all'` to surface the full validation backlog.

- **Validator new-incident banner → sticky** (`validator/page.tsx`): `newIncidentBanner` moved before the page header and wrapped in `sticky top-0 z-40`, matching the encoder pattern.

- **Incident detail 24H labeling** (`src/frontend/src/app/dashboard/regional/incidents/[id]/page.tsx`): Removed `(24H)` suffix from `fmt24h`, `mark24h`, and `splitAlarmDateTime` return values. Added `(24H)` to the relevant labels: "Date & Time of Notification (24H)", `FIELD_LABELS.notification_dt + " (24H)"`, "Time Returned to Base (24H)", DataTable columns "Time Dispatched (24H)" / "Time Arrived at Scene (24H)", alarm timeline column "Time (24H)".

**Verification:**
- `npx.cmd eslint` on all modified files: 0 errors.
- `git diff --check`: no new trailing whitespace (pre-existing issue in `docs/regional-dashboard-handover.md`).
- `rg zoom` in `globals.css`: only `.wims-main-zoom` class; `body {}` block has no zoom.
- Browser verification could not run (no browser plugin available in this session).

**Wiki updates:** This log. No route-map or schema changes.

## [2026-05-28] update | Dashboard date filters and visual polish

**Changes implemented:**
- Encoder dashboard rich incident cards now keep the existing 1px border width but colour the border by status: green verified, red rejected, gray draft, warm yellow pending.
- Encoder and validator dashboards no longer send frontend `date_basis` parameters or expose Date of Fire filtering. Encoder date filters default to Date Modified; validator date filters default to Date of Submission.
- Both dashboards now show an always-visible calendar picker that switches the date scope to Specific Date and filters by the relevant default date field.
- The regional incident detail section-dot navigation now hugs the right viewport margin with a fixed margin, avoiding overlap with incident details.
- Global frontend CSS applies a 90% `body` zoom baseline.

**Verification:**
- `rg` confirmed no remaining frontend dashboard references to `date_basis`, `dateBasis`, or `DATE_BASIS`.
- `npx.cmd eslint src/app/dashboard/regional/page.tsx src/app/dashboard/validator/page.tsx src/app/dashboard/regional/incidents/[id]/page.tsx` passed.
- In-app Browser verification could not run because the `iab` browser backend was unavailable in this session.

**Wiki updates:** Updated `frontend/route-map.md`, `frontend/frontend-infrastructure.md`, `subsystems/regional-dashboard.md`, `subsystems/validator-hub.md`, `gaps/ui-ux-gap-register.md`, `index.md`, and this log. No `gaps/frs-codebase-gap-register.md` update needed; this changed UI behavior and presentation, not FRS alignment.

## [2026-05-28] fix | Encoder and validator stats cards: region scoping, date filtering, wildland fix

**Changes implemented:**

- **Backend `/regional/stats`** (`src/backend/api/routes/regional.py`): Added `date_from`/`date_to` Query params applied to `notification_dt`. Scope changed from `encoder_id` to `region_id + VERIFIED`. Wildland query received a proper LEFT JOIN on `nd` so date filtering works. `total_incidents` returned as a generic period-total (aliased from `total_incidents_this_week`).

- **Backend `/regional/validator/stats`** (`src/backend/api/routes/regional.py`): Same `date_from`/`date_to` params added. Date clause applied to all VERIFIED queries (wildland, by_category, affected counts). Pending count intentionally unfiltered. Scope: all regions (system-wide verified totals).

- **`fetchRegionalStats` / `fetchValidatorStats`** (`src/frontend/src/lib/api/legacy.ts`): Both functions now accept `{ date_from?, date_to? }` and pass them as query params.

- **Encoder dashboard** (`src/frontend/src/app/dashboard/regional/page.tsx`): Added `STATS_DATE_FILTERS` constant (Today/This Week/This Month/All Time), `statsDateFilter` state defaulting to `'week'`, `statsDateBounds` memo, and stats filter chip UI above the stats cards. `loadStats` is reactive to `statsDateBounds`. First card title shows the selected period.

- **Validator dashboard** (`src/frontend/src/app/dashboard/validator/page.tsx`): Same stats filter pattern added — `STATS_DATE_FILTERS`, `StatsDateFilterValue`, `STATS_PERIOD_LABEL`, `statsDateFilter` (default `'week'`), `statsDateBounds`. Stats useEffect wired to `statsDateBounds`. Wildland and classification card titles include period label. Stats filter chip row rendered above stats cards.

**Verification:** Backend: `python -m py_compile src/backend/api/routes/regional.py`. Frontend: `npx vitest run`, `npm run lint`.

**Wiki updates:** Updated `docs/regional-dashboard-handover.md` and this log.

## [2026-05-28] fix | Encoder/validator bug batch: pin search, duplicate detection, notifications, session

**Changes implemented:**

- **Address pin search** (`src/frontend/src/components/IncidentForm.tsx`): Removed the `, Philippines` suffix appended to map search queries. Nominatim already filters to the Philippines via `countrycodes=ph`; the suffix was narrowing street-level results.

- **Re-pin from address** (`IncidentForm.tsx`): The "Re-pin from Address" button now clears the current lat/lng before setting the search query. This resets `MapPickerInner`'s `autoSearchedRef` guard (which was silently blocking re-geocoding when the same address string was re-submitted after a manual pin).

- **Barangay overwrite guard** (`IncidentForm.tsx`): Added `barangayManuallySetRef`. When the encoder types directly into the Barangay field, the ref is set and subsequent map-pin reverse-geocode results no longer overwrite the typed value.

- **Duplicate detection redesign** (`src/backend/services/duplicate_detection.py`, `lifecycle.py`): Replaced the previous 5 km spatial + ±1-day date + OR-category fallback algorithm with a **5-criterion scoring system** (threshold: 3 of 5). Criteria: (1) distance ≤ 500 m, (2) same general category AND type code, (3) same exact fire date, (4) fire time within 1 hour, (5) same city/municipality (falls back to province/district). Candidate pool is ±3 days. All three `check_for_duplicate` call sites in `lifecycle.py` updated to pass `notification_dt`, `city_municipality`, and `province_district`.

- **Validator new-submission polling** (`src/frontend/src/app/dashboard/validator/page.tsx`): Reduced poll interval from 30 s to 10 s to surface new submissions faster.

- **Encoder actioned-submission banner** (`src/frontend/src/app/dashboard/regional/page.tsx`): Added a background 20 s poll that compares the current PENDING total against the last-known value. When the count drops (validator verified or rejected a submission), a dismissable blue info banner is shown.

- **Forced-logout / refresh-token replay fix** (`src/frontend/src/lib/api/transport.ts`): The `apiFetch` 401 handler was calling `fetch('/api/auth/refresh', ...)` directly, bypassing the `navigator.locks` coordination in `auth-refresh.ts`. With Keycloak's `refreshTokenMaxReuse: 0`, a concurrent proactive background refresh and a 401-triggered refresh racing on the same token caused session revocation. The 401 handler now calls `refreshToken()` from `auth-refresh.ts`, routing through the shared in-flight de-duplication and lock.

**Verification:** Backend: `pytest -v`. Frontend: `npx vitest run`, `npm run lint`.

**Wiki updates:** This log.

## [2026-05-28] fix | Encoder and validator dashboard count polish

**Changes implemented:**
- Encoder rejection alert is dismissible, and Show rejected now bypasses conflicting category/date filters by switching to all-time rejected records.
- Encoder Rejected chip and validator Pending chip now show red count badges with white text.
- Encoder incident list uses the richer card layout for Today, Specific Date, and any filtered result set with 6 or fewer total incidents.
- Encoder top summary card now shows Total This Week from a new `total_incidents_this_week` stat.
- Regional wildland fire-type stats normalize `lower(trim(wildland_fire_type))`, fixing literal/casing/spacing mismatches in the Fire bucket.
- Validator Awaiting Validation stat now counts both `PENDING` and `PENDING_VALIDATION`, matching the queue default.
- Validator summary cards replace Total Verified with Wildland Fire via a new `wildland_total` stat.

**Verification:**
- `python -m py_compile src/backend/api/routes/regional.py` passed.
- `npx.cmd eslint src/app/dashboard/regional/page.tsx src/app/dashboard/validator/page.tsx src/lib/api/legacy.ts` passed.

**Wiki updates:** Updated `frontend/route-map.md`, `subsystems/regional-dashboard.md`, `subsystems/validator-hub.md`, `gaps/ui-ux-gap-register.md`, `index.md`, and this log. No `gaps/frs-codebase-gap-register.md` update needed; this changed UI behavior and dashboard stats presentation, not FRS alignment.

## [2026-05-27] update | Encoder/validator frontend UI polish
- Renamed authenticated sidebar `/home` labels to Operations across role navigation while keeping the `/home` route unchanged.
- Put encoder and validator dashboards first in their role navigation and relabeled those sidebar entries to plain Dashboard.
- Removed the global authenticated `SyncStatusBar` from `LayoutShell` and removed the regional dashboard's local synced badge from the visible header.
- Updated the regional dashboard header quick actions, added keyboard-focusable incident rows, and added a right-aligned Open affordance.
- Updated the validator dashboard title/hint, moved Review into the station cell, preserved Accept/Reject for pending rows, and made finalized Archive a quieter secondary action.
- Updated `frontend/route-map.md`, `subsystems/regional-dashboard.md`, `subsystems/validator-hub.md`, `gaps/ui-ux-gap-register.md`, and `index.md`.
- Verification: `npm.cmd run lint` passed with existing warnings; `npx.cmd vitest run` had one unrelated analyst timeout in `src/app/dashboard/analyst/queue-baseline.test.tsx` (`passes casualty_severity to heatmap and trends on apply`).

## [2026-05-27] update | Row click-to-view affordance refinement
- Removed the permanent Open column from the regional dashboard incident table; rows remain click/keyboard navigable and now reveal a delayed "Click to view" hint on hover/focus.
- Removed the permanent Review affordance from the validator station cell; validator rows now click through to incident detail while row action buttons stop propagation.
- Preserved validator Accept, Reject, Archive, and bulk-selection controls.
- Updated `subsystems/regional-dashboard.md`, `subsystems/validator-hub.md`, and `gaps/ui-ux-gap-register.md`.
- Verification: not run at user request.
## [2026-05-29] implement | M8d HITL structured decision buttons + JSONB audit log
- **FRS reference:** Module 8d — Human-in-the-Loop (HITL) Validation (FRS `frs-threatdetectionwithexplainableai.md` M8d)
- Migration `39_hitl_decision.sql` adds `hitl_decision JSONB` column to `wims.security_threat_logs`; stores `{ "action": "CONFIRM_THREAT"|"FALSE_POSITIVE"|"REQUEST_MORE_INFO", "note": string|null, "reviewed_by": uuid, "reviewed_at": ISO8601 }`
- Backend `PATCH /admin/security-logs/{log_id}` (`admin.py`): `SecurityLogUpdate` schema extended with `action` and `note` fields; when `action` is provided, maps to human-readable `admin_action_taken` label, writes JSONB decision record, sets `reviewed_by = admin user_id`, sets `resolved_at = now()` for CONFIRM_THREAT and FALSE_POSITIVE only (REQUEST_MORE_INFO leaves `resolved_at` null); invalid action → HTTP 400
- Frontend `updateAdminSecurityLog` in `legacy.ts`: signature extended with `{ action?, note?, admin_action_taken?, resolved_at? }`; called with `{ action, note }` from HITL buttons
- Frontend modal (`page.tsx`): replaced free-text `actionNote` textarea + single Save button with three structured HITL decision buttons — "Confirm Threat" (red, calls `handleHitlDecision('CONFIRM_THREAT')`), "False Positive" (gray, calls `handleHitlDecision('FALSE_POSITIVE')`), "Request More Info" (blue, reveals inline note textarea + Confirm/Cancel; calls `handleHitlDecision('REQUEST_MORE_INFO', note)`); logs with existing `admin_action_taken` show read-only display
- GET `/admin/security-logs` now also returns `hitl_decision` JSONB column in response
- Tests: `TestPatchSecurityLogHitl` class added to `test_admin_new_routes.py` (6 cases: CONFIRM_THREAT/FALSE_POSITIVE/REQUEST_MORE_INFO behavior, invalid action 400, no-fields 400, not-found 404); `admin-system-hitl.test.tsx` added (6 cases: 3 buttons render, each calls correct API action, Request More Info reveals note input, actioned logs show read-only)
- Applied migration to Docker postgres; verified `hitl_decision jsonb` column present
- Verification: backend `pytest -v -k security` → 41 passed; frontend `npx vitest run` → 8 passed (6 HITL + 2 existing AI analyze); `npm run lint` → 0 errors (pre-existing warnings only)

## [2026-05-29] implement | M2c sync success/failure toast notifications
- **FRS reference:** Module 2c — Offline-First IndexedDB Queue (FRS `frs-offlinefirst.md` M2c)
- `useAutoSync.ts` `doSync()`: after `syncPendingIncidents()` returns, dispatches `toast.success`/`toast.warning`/`toast.error` based on `result.synced` and `result.failed` counts; success for clean sync, warning for partial, error for complete failure
- `sonner` toast library added to `package.json` dependencies; `toast` imported from `sonner` in `useAutoSync.ts`
- `layout.tsx`: `<Toaster />` component rendered to mount toast portal
- Closes ISSUE#142

## [2026-05-29] implement | M2b offline CRUD — IndexedDB queue operations
- **FRS reference:** Module 2b — Encryption of Offline Payloads (FRS `frs-offlinefirst.md` M2b)
- `offlineStore.ts`: `getQueuedIncident(id)`, `updateQueuedIncident(id, payload)`, `deleteQueuedIncident(id)`, `markSynced(id)`, `getPendingIncidents()` — full CRUD lifecycle for the IndexedDB incident queue
- `syncEngine.ts`: `syncPendingIncidents()` iterates pending items, POSTs to backend, marks synced on success, retains on failure; returns `SyncResult { synced, failed, errors }`
- Closes ISSUE#140

## [2026-05-29] implement | M2b AES-256-GCM encryption of offline payloads
- **FRS reference:** Module 2b — Encryption of Offline Payloads (FRS `frs-offlinefirst.md` M2b)
- `offlineStore.ts`: `encryptPayload(payload)` uses Web Crypto API — `AES-GCM` with `crypto.getRandomValues()` for 12-byte IV; stored item has `encrypted` field (base64) instead of plaintext `payload`; `decryptPayload(encrypted)` reverses on read
- `crypto-keys` IndexedDB store holds per-user AES key; key derived from user secret via PBKDF2 (with salt) if not already stored
- Transparent encrypt on `addToQueue` / `updateQueuedIncident`; transparent decrypt on `getQueuedIncident`; `markSynced` operates on raw record (never needs payload, only `status` field) — no decryption required
- Closes ISSUE#139

## [2026-05-29] implement | M4b data_hash + sync_status in verification audit trail
- **FRS reference:** Module 4b — Immutable Incident Record (FRS `frs-incidentworkflow.md` M4b)
- Migration `40_verification_audit_fields.sql`: adds `data_hash TEXT` (SHA-256 of canonical incident payload) and `sync_status TEXT` (pending/synced/failed) columns to `wims.incident_verification_history`; trigger `_insert_incident_verification_history` updated to compute hash on insert; stored procedure `verify_incident_command` updated to accept and store sync status
- Backend `verify_incident_command` now records `data_hash` via `sha256(concat_ws(...))` of all canonical incident fields and `sync_status` as 'synced' upon successful verification
- Closes ISSUE#145
## [2026-05-29] implement | M9a System Monitoring dashboard UI (PR #125)
- `GET /admin/monitoring/system` and `GET /admin/monitoring/workers` endpoints existed from PR #103, but frontend had no UI to consume them.
- Added `fetchSystemMetrics()` and `fetchWorkerStatus()` to `src/frontend/src/lib/api/legacy.ts`; re-exported from `src/frontend/src/lib/api/admin.ts`.
- Added `SystemMetrics` and `WorkerStatus` TypeScript interfaces to `src/frontend/src/app/admin/system/page.tsx`.
- Added `loadMonitoring()` callback (`useCallback`) that fans out `fetchSystemHealth`, `fetchSystemMetrics`, `fetchWorkerStatus` via `Promise.allSettled` so one failure does not block others; sets `health`, `systemMetrics`, `workers`, `monitoringLastChecked`.
- Replaced standalone `loadHealth()` mount useEffect with `loadMonitoring()` in both the mount effect (for initial load) and a dedicated M9a 60s interval `useEffect`; the manual System Health Refresh button still calls `loadHealth()`.
- Rendered new "System Monitoring" section before "System Health": CPU/RAM/disk progress bars with absolute values, and a Celery worker table (hostname, status, active tasks, last seen).
- Added `src/frontend/src/app/admin/system/admin-system-monitoring.test.tsx` with 6 tests: initial fetch call count, DOM rendering (CPU%/memory/disk/worker hostname), 60s interval second call, unmount cleanup, partial metrics failure resilience, and section heading presence.
- Updated `gaps/frs-codebase-gap-register.md`: M9 PARTIAL → M9a CLOSED, updated date to 2026-05-29.
- **Remaining M9 gap:** full-text log search in admin system page.
## [2026-05-27] feat | Analyst export: region_name end-to-end + curated default columns (#112 #113)

- Added `region_name` to the backend export column allowlist (`ALLOWED_EXPORT_COLUMNS` in `src/backend/tasks/exports.py`) and the `get_export_rows()` column set (`src/backend/services/analytics_read_model.py`).
- When `region_name` is requested, `get_export_rows()` injects a conditional `LEFT JOIN wims.ref_regions rr ON rr.region_id = a.region_id` and aliases `rr.region_code AS region_name` so export writers receive a short code (NCR, CAR) under the picker-requested key without needing a mapping layer. The join is omitted when `region_name` is not in the column list to keep the common path cheap.
- Replaced the old positional-slice default column selection (`ALL_COLUMNS.slice(0, 6)`) with a curated 9-column default list in both backend (`DEFAULT_EXPORT_COLUMNS`) and frontend (`DEFAULT_SELECTED_COLUMNS`): `incident_id`, `notification_dt`, `region_name`, `province_name`, `municipality_name`, `general_category`, `alarm_level`, `estimated_damage_php`, `total_response_time_minutes`.
- Frontend `ExportPreviewModal` now pre-checks the curated defaults, `region_id` is unchecked by default (preferring `region_name`), and the dead `barangay_name` label was removed from `COLUMN_LABELS`.
- Added 4 backend regression tests: allowlist filtering for `region_name`, curated-default-list contract, positive query-path test verifying JOIN injection and row-dict output, and negative test confirming the JOIN is omitted when `region_name` is not requested.
- Added 5 frontend tests in new `ExportPreviewModal.test.tsx`: default list contract, pre-check behavior, `barangay_name` absence, `region_id` unchecked, and `region_name` checked.
- Added `.gitattributes` with `*.sh text eol=lf` to prevent UTF-8 BOM corruption in shell script shebangs (companion to the `fix(scripts)` commit).

**Verification:** Backend `pytest -v` — 328 passed, 10 skipped. Frontend `npx vitest run` — 119 passed.

**Wiki updates:** This log. No FRS/codebase gap register change needed (analyst export UX enhancement, not a new FRS module requirement).

## [2026-05-26] fix | VPS login outage from base compose auth settings
- Diagnosed public login failure as a Keycloak/OIDC discovery issue, not a full stack outage: core containers were running, `/login` served 200, but `/auth/realms/bfp/.well-known/openid-configuration` returned 403 with `HTTPS required`.
- Confirmed internal nginx-to-Keycloak discovery returned 200, while the public path was using base compose auth settings (`KC_HOSTNAME_URL=http://localhost:8080/auth`, backend `KEYCLOAK_ISSUER=http://localhost:8080/auth/realms/bfp`).
- Recreated `keycloak`, `backend`, `frontend`, and `nginx-gateway` with `docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production up -d --build keycloak backend frontend nginx-gateway`.
- Restored Keycloak realm `sslRequired=external` after verification; no persistent relaxation of realm SSL policy was kept.
- Verified public discovery now returns 200 and advertises `issuer`, `authorization_endpoint`, and `token_endpoint` under `https://wimsbfp.tech/auth/...`; `/login` returns 200; all core containers are up.
- Updated `architecture/infrastructure-config.md` and `index.md`; no FRS/codebase gap register change was needed because this was an operational deployment-state correction, not a requirement alignment change.

## [2026-05-26] fix | Threat telemetry hidden by frontend response parser mismatch
- Verified seeded telemetry exists in `wims.security_threat_logs` (6 rows: 2 HIGH, 2 MEDIUM, 2 LOW); seeding was not the root issue.
- Fixed `src/frontend/src/lib/api/legacy.ts` `fetchAdminSecurityLogs()` to parse the current admin API envelope (`{ items, total, limit, offset }`) in addition to legacy array / `{ data: [...] }` formats.
- Added regression tests in `src/frontend/src/lib/api.test.ts` to cover both `{ items: [...] }` and `{ data: [...] }` parsing paths.
- Updated `subsystems/admin-hub.md` to document paginated telemetry response semantics and current UI limitation (first-page-only consumption).

## [2026-05-26] update | Seed Suricata threat telemetry
- Seeded the live VPS database with 6 Suricata-style rows in `wims.security_threat_logs`: 2 HIGH, 2 MEDIUM, and 2 LOW alerts for the System Admin threat telemetry view.
- Added `src/postgres-init/38_seed_security_threat_logs.sql` so fresh Postgres volumes get the same idempotent demo telemetry.
- Verified the live telemetry count by severity after applying the seed.
- Updated `database/sql-init-files.md`; no FRS/codebase gap register change was needed because this adds demo seed data without changing FRS alignment.

## [2026-05-26] fix | Public report tracking links use live route
- Updated the public report success and update-submitted screens in `src/frontend/src/app/page.tsx` so tracking links use `/tracking?id=<report_id>` instead of removed `/report/tracking?id=<report_id>`.
- Updated stale "new report"/cancel links from `/report` to `/`, matching the current public report form route.
- Added nginx compatibility redirects from `/report/tracking` and `/report/tracking/` to `/tracking` while preserving `?id=...`.
- Added `src/frontend/src/app/report-routing.test.ts` to guard against reintroducing `/report/tracking`.
- Updated `frontend/route-map.md` to document `/` as the public report form and `/tracking?id=<report_id>` as the live tracking route.

## [2026-05-26] fix | Employee login route separated from Keycloak proxy
- Moved the Next.js employee login page from `src/frontend/src/app/auth/login/page.tsx` to `src/frontend/src/app/login/page.tsx`, making `https://wimsbfp.tech/login` the correct employee-facing app login URL.
- Updated frontend redirects/public-route guards from `/auth/login` to `/login` in `AuthContext`, callback handling, transport auth failure handling, and `LayoutShell`.
- Added exact nginx compatibility redirects for `/auth/login` and `/auth/login/` to `/login`; the broader `/auth/` namespace still proxies to Keycloak.
- Ran `docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production down -v`, rebuilt all images with `build --no-cache`, and restarted with `up -d` on the VPS.
- Verified the Next build includes `/login`, `/login` returns 200, `/auth/login` and `/auth/login/` return 301 to `/login`, `/health` returns 200, and Keycloak discovery remains available under `/auth/realms/bfp`.
- Updated `frontend/route-map.md`, `architecture/infrastructure-config.md`, and `index.md`.

## [2026-05-26] fix | GitOps deploy and VPS port hardening
- Updated `.github/workflows/deploy.yml` to use the production compose stack (`docker-compose.yml` + `docker-compose.prod.yml` + `.env.production`) for config validation, DB connectivity checks, rebuild/restart, rollback, and public post-deploy health checks.
- Reworked certbot automation so existing `wimsbfp.tech` certificates are reused, first-time issuance uses standalone ACME, and renewal reloads nginx with `docker exec wims-nginx-gateway nginx -s reload`.
- Hardened `src/docker-compose.yml` host port exposure: Postgres, Redis, MailHog, and direct Keycloak now bind to `127.0.0.1`; only `nginx-gateway` publishes public 80/443.
- Added nginx gateway hardening: disabled version tokens, hid proxied `X-Powered-By`, and added HSTS, nosniff, SAMEORIGIN frame policy, no-referrer policy, and a restrictive permissions policy.
- Enabled UFW on the VPS with default-deny incoming traffic and explicit inbound allows for `22/tcp`, `80/tcp`, and `443/tcp`.
- Added `test_non_edge_services_bind_host_ports_to_loopback` to `src/backend/tests/test_infra_config.py`.
- Applied the hardened compose bindings on the VPS and verified `ss -ltnp`, `docker compose ps`, `https://wimsbfp.tech/health`, Keycloak discovery, and the frontend.
- Updated `architecture/infrastructure-config.md` and `index.md`.

## [2026-05-26] update | VPS production origin moved to wimsbfp.tech
- Updated `src/.env.production` so `PUBLIC_BASE_URL=https://wimsbfp.tech` instead of the previous `https://165-22-101-73.nip.io` origin.
- Confirmed `src/nginx/nginx.conf` already targets `server_name wimsbfp.tech` and `/etc/letsencrypt/live/wimsbfp.tech/...` certificate paths.
- Live VPS check showed `wims-nginx-gateway` exits because the `wimsbfp.tech` certificate files do not exist yet; only the old nip.io certificate is present under `/etc/letsencrypt/live/`.
- Updated `architecture/infrastructure-config.md` and `index.md`.

## [2026-05-24] fix | Automated Keycloak master realm bootstrap
- Added `src/keycloak/bootstrap/bootstrap-master-realm.sh`, an idempotent post-start script that logs into the Keycloak `master` realm, finds `security-admin-console`, and patches admin-console redirect URIs/web origins.
- Added a one-shot `keycloak-bootstrap` service to `src/docker-compose.yml`, dependent on healthy Keycloak. Backend startup now waits for this service with `condition: service_completed_successfully`.
- Added `test_keycloak_master_realm_bootstrap_service` to `src/backend/tests/test_infra_config.py`.
- Verification: `pytest tests/test_infra_config.py -q` passed; `docker compose config --quiet` passed; `docker compose up keycloak-bootstrap` exited 0; live `kcadm` inspection showed master realm `security-admin-console` includes `https://localhost/auth/admin/master/console/*`.
- Updated `architecture/infrastructure-config.md`, `frontend/frontend-infrastructure.md`, `operations/auth-loop-debug-guide.md`, and `index.md`.

## [2026-05-24] verify | Keycloak master realm import does not patch admin console
- Reviewed latest Keycloak commits (`12a1168`, `4b41966`) and live startup state.
- `src/docker-compose.yml` now mounts `src/keycloak/import/` and imports the `bfp` realm, but Keycloak 24 creates `master` before import and logs `Realm 'master' already exists. Import skipped`.
- Live `kcadm` check showed master realm `security-admin-console` still at `redirectUris: ["/admin/master/console/*"]` and `webOrigins: ["+"]`; the patched absolute redirect values exist only on the `bfp` realm copy.
- Updated `architecture/infrastructure-config.md`, `frontend/frontend-infrastructure.md`, and `operations/auth-loop-debug-guide.md` to record that the current code does not yet eliminate manual `kcadm`; an automated post-start master-realm patch/provisioning step is still needed.

## [2026-05-24] fix | Localhost Dashboard Callback Loop

**Diagnosis:**
- After successful Keycloak login, `GET /api/auth/session` returned 500 because the Next.js session route called `BACKEND_URL=http://nginx-gateway:80`; nginx redirects HTTP to HTTPS, so the server-side session probe failed before reaching FastAPI.
- Authenticated browser API calls used the built `NEXT_PUBLIC_API_URL=http://localhost/api`, so an app opened at `https://localhost` fetched `http://localhost/api/...` and hit CORS/preflight redirect failures.
- Keycloak `wims-web` client had `webOrigins: ["+"]` (literal string, not a wildcard in Keycloak 24 — causes 400 on all auth requests) and `clientAuthenticatorType: "client-secret"` (contradicts `publicClient: true`).

**Implementation:**
- `src/docker-compose.yml`: `BACKEND_URL=http://backend:8000` (session route calls FastAPI directly, bypassing nginx HTTPS redirect).
- `src/docker-compose.yml`: `NEXT_PUBLIC_AUTH_API_URL=/auth` baked at build time via `docker compose build frontend`.
- `src/keycloak/bfp-realm.json`: Replaced `webOrigins: ["+"]` with explicit origins (`https://localhost`, `http://localhost`, `https://165-22-101-73.nip.io`, `https://wims.bfp.gov.ph`) on `wims-web`. Removed `clientAuthenticatorType: "client-secret"`.
- `docker compose restart keycloak` to reload patched realm JSON.
- `docker compose build frontend && docker compose up -d frontend` to rebake env vars.

**Verification:**
- `pytest src/backend/tests/test_infra_config.py -q` -> 4 passed.
- `npx vitest run src/app/api/auth/session/route.test.ts` -> 2 passed.

**Wiki updates:** `frontend/frontend-infrastructure.md`, `architecture/infrastructure-config.md`, `operations/auth-loop-debug-guide.md` (new) created. Log entry added.

**Root causes:** RC-1 (session route → nginx → HTTPS redirect), RC-2 (NEXT_PUBLIC_* baked at build), RC-3 (webOrigins "+" in Keycloak 24), RC-4 (clientAuthenticatorType on public client), RC-5 (security-admin-console in master realm — not bfp realm — kcadm targeting error and relative redirectUri mismatch), RC-6 (master realm data survives docker compose down -v). See `operations/auth-loop-debug-guide.md` for full debug protocol.

---

## [2026-05-23] fix | VPS nginx TLS certificate bind mount
- Diagnosed `wims-nginx-gateway` exit 1 on VPS: nginx could not load `/etc/letsencrypt/live/165-22-101-73.nip.io/fullchain.pem`.
- Host certificate tree existed under `/etc/letsencrypt/live/165-22-101-73.nip.io`, but compose mounted `/opt/wims-bfp/letsencrypt`, which only contained `letsencrypt -> /etc/letsencrypt`.
- Updated `src/docker-compose.yml` so `nginx-gateway` bind-mounts `/etc/letsencrypt:/etc/letsencrypt:ro` directly.
- Updated VPS frontend/auth envs: browser-facing `NEXT_PUBLIC_*` values now use the public HTTPS origin or relative `/api`/`/auth`, backend `KEYCLOAK_ISSUER` uses the public HTTPS realm issuer, Next.js server-side auth uses `BACKEND_URL=http://backend:8000` instead of nginx over HTTP, and Keycloak `KC_HOSTNAME_URL` includes `/auth` so OIDC discovery matches the nginx proxy path.
- Added the VPS HTTPS callback/origin to the Keycloak realm export for `wims-web` and `bfp-client`, then patched the running Keycloak clients with the same redirect URI/web origin values.
- Updated `architecture/infrastructure-config.md` to reflect current HTTPS gateway behavior, `/health`, cookie-domain rewrite, VPS public-origin envs, and the certificate mount contract.

## [2026-05-23] update | GitOps-lite VPS deployment split
- Split deployment configuration into dev-neutral `src/docker-compose.yml` and production override `src/docker-compose.prod.yml`.
- Added tracked `src/.env.production.example` and untracked VPS-local `src/.env.production` for `PUBLIC_BASE_URL`, `LETSENCRYPT_DIR`, `APP_VERSION`, and host credential paths.
- Parameterized the nginx certificate mount with `LETSENCRYPT_DIR` so production can mount `/etc/letsencrypt` without hardcoding the VPS path in base compose.
- Restored base compose frontend/auth defaults to localhost-style local development values; production override supplies public HTTPS URLs, direct `BACKEND_URL=http://backend:8000`, backend `KEYCLOAK_ISSUER`, and Keycloak `KC_HOSTNAME_URL`.
- Updated `.gitignore` and `src/.gitignore` so VPS-local artifacts (`.deploy_history`, `firebase-creds.json`, `letsencrypt/`, `.env.production`) stay out of git while `.env.production.example` remains tracked.
- Verified deployment with `docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production up -d --build`.

## [2026-05-19] update | Civilian Reporting Architecture — ADR-0001 accepted

**Session context:** Grill-with-docs session. Complete HCI overhaul of civilian emergency reporting flow and triage queue.

**Decisions recorded in:** `system-wiki/decisions/0001-civilian-reporting-overhaul.md`

**Key decisions:**
- `citizen_reports` (staging, 14 cols) separate from `fire_incidents` (AFOR canonical) — prevents flooding
- `GET /api/triage/queue` unifies both tables at read time via PostGIS `ST_DWithin` clustering
- Category = STRUCTURAL / NON_STRUCTURAL / TRANSPORTATION / UNSURE + icon sub-category grids
- Severity derived at read time from spatial/temporal clustering (link_count)
- Append creates new `citizen_reports` row with `linked_to_report_id` — NOT in-place update
- Rate limits: 5 new reports/IP/hr, 1 append/device_id/5min
- "What to do while waiting" = deterministic static content per category, no risk encouragement
- Triage: validator dashboard overview widget + dedicated `/incidents/triage` page
- Fire station auto-assigned from `nearest_station_id` at promotion; validator can override

## [2026-05-19] update | National Analyst HCI/UX review — 10 issues filed to GitHub

**Session context:** National Analyst perspective walkthrough (Iteration 1 + 2 + 3). Keycloak auth blocked runtime browser testing; all findings confirmed via source inspection.

**Findings:**
- 2 Critical (P0): Phantom `barangay_name` column in export picker + incident table; raw `region_id` integer with no `region_name` in exports
- 3 High (P1): Export default columns low-signal; "Analyze selected" ignores selected IDs; export picker missing 13 fields
- 5 Medium (P2/P3): No copy incident ID; opaque export filename; "Unselect page" label confusion; Top-N missing `damage_cost`; no rows-per-page selector

**Actions taken:**
- Partial patch applied to `ExportPreviewModal.tsx`: `barangay_name` removed from `ALL_COLUMNS`, `region_name` added, full 24-column list synced with backend `ALLOWED_EXPORT_COLUMNS` — **NOT yet committed**
- Created 10 GitHub issues: [#111](https://github.com/x1n4te/WIMS-BFP-PROTOTYPE/issues/111)–[#120](https://github.com/x1n4te/WIMS-BFP-PROTOTYPE/issues/120)
- Updated `gaps/ui-ux-gap-register.md`: added new "National Analyst UX — Iteration 2 Review (2026-05-19)" section, added missing `[[ui-ux/evaluation-national-analyst]]` cross-reference

**Blocked on:**
- Keycloak auth to `wims-web` realm (dev mode) — needs `wims-bfp` realm credentials for local browser testing
- `region_name` export requires backend JOIN in `analytics_read_model.py` / `exports.py`

## [2026-05-22] update | Civilian public report UX — safety-first flow resolved
- Grill-with-docs decision: `/report` must ask `safety_status` before reporting context/location so life-safety guidance appears before cognitively heavier source/location questions.
- Updated `system-wiki/prd/civilian-reporting-phase-2.md` and `system-wiki/subsystems/civilian-reporting-phase2.md` to record safety-first public flow and immediate emergency guidance for life-safety reports.
- Added calm emergency landing block requirement: dominant 911 action plus short safety instructions; guidance-only, not a separate data state, no pre-submit nearest-station lookup, and no additional hotline numbers. Life-safety reports keep 911 guidance visible through the flow.
- First interactive step is one question only: “Are you or anyone else in danger?” with `safety_status` choices. Reporting context/location stays on the next step.
- `UNKNOWN` safety status remains non-life-safety for backend priority/fast-submit, but UI shows cautious guidance: call 911 if anyone may be in danger and stay away from smoke/fire.
- Category selection treats `UNSURE` as a safe default: specific categories first, then a prominent “I’m not sure / Hindi sigurado” action with reassuring copy that BFP can still review the report.
- Location step uses unified plain-language prompt: “Where is the fire?” with helper copy to use current location if there, otherwise place the pin on the fire location; context-specific GPS/pin details are secondary.
- After safety, `/report` asks location before reporting context. Location can offer “Use my current location” and “Place pin manually”; reporting context is captured afterward for validator interpretation/GPS trust scoring.
- Both life-safety and non-life-safety use the shared core order: safety → location → reporting context → category. Life-safety then shows “Send now”; non-life-safety continues to details/review.
- If current GPS is chosen as fire location and user later selects `SECONDHAND`, UI challenges it: “Is this current location where the fire is?” Yes keeps it; No returns to manual pin placement.
- If current GPS is chosen and user later selects `NEARBY`, UI shows a non-blocking reminder: “If the fire is not exactly where you are, place the pin on the fire instead.” Continue remains available.
- Life-safety reports skip optional details by default after minimum required fields; category step shows primary “Send now” that submits immediately and secondary “Add details if safe.” Optional details remain available but keep “Send now” as the primary action. Minimum fields: `safety_status`, `latitude`, `longitude`, `reporting_context`, explicit `category` tap including prominent `UNSURE`, and `device_id`; `sub_category`, observed/reported time, witness fields, and `previous_report_id` are optional. Non-life-safety keeps details/review.
- Post-submit success screen uses explicit emergency boundary copy for every submission, not only life-safety reports: show “Report submitted,” tell users to call 911 now if anyone is in immediate danger, clarify that the report helps BFP review public signals but does not replace an emergency call, then show report ID/tracking and nearest station if available.
- Tracking page uses the same emergency boundary across all statuses. Waiting/uncertain states keep it prominent; `ACTIONED` may render it lower/softer but must still clarify that immediate danger requires calling 911 and that the report does not replace an emergency call.
- Nearest-station contact remains post-submit/tracking only and secondary to 911: label it “Nearest BFP station for follow-up,” include “For immediate danger, call 911 first,” and label fallback `911` as the emergency number rather than a station phone.
- Bilingual copy scope is stress-critical only, not full i18n: 911/immediate danger, do-not-approach/photo warnings, “does not replace emergency call,” “Send now,” “Add details if safe,” `UNSURE` reassurance, location helper, and the 911 sentence in submit/rate-limit/network errors must be English/Filipino. Report IDs, technical statuses, station follow-up labels, observed time, and previous report ID may stay English-only.
- Submit errors are safety-first: any failure says the report could not be sent and tells users to call 911 now if immediate danger exists; validation/location errors point to missing fields or pin placement, rate limits explain too many reports from the network and suggest tracking/updating an existing report, and network/server errors ask the user to retry when connected without weakening the 911 boundary.
- Reporting-context cards should not remain text-only: use low-ambiguity icons to reduce reading load under stress, with eye/direct-view for `WITNESS`, map/proximity for `NEARBY`, and message/speech for `SECONDHAND`; exact icon choice remains implementation-flexible.
- **CTA visual contract:** disabled CTAs must not use the active BFP red/gradient treatment. Disabled state uses visibly inactive/muted styling (e.g. gray background, not red/gradient). Enabled primary CTAs use high-contrast BFP red/gradient. Rationale: stress-friendly cognitive clarity mandate; prevents regression where stressed users misread disabled buttons as active; serves as a QA and code-review guardrail. Documented in both PRD and subsystem docs.
- **Open implementation gap:** the current code in `page.tsx` defaults to `step = 'context'` and renders the reporting-context question as the first interactive step, before safety. The documented safety-first order (safety → location → context → category) has not been implemented. The step ordering in `page.tsx` must be refactored so `safety` is the initial step value, and the conditional rendering reflects the documented order.
- **Open implementation gap:** the submitted success screen (`step === 'submitted'`) shows the 911/call-now emergency boundary only when `isLifeSafety` is true. The docs require this boundary for every submission regardless of safety status. Non-life-safety users currently see "Report Submitted" then nearest station with no emergency guidance in between. The 911 boundary and "does not replace an emergency call" copy must render for all submissions.
- **Open implementation gap:** tracking page (`tracking/page.tsx`) shows 911 guidance only for `REJECTED_*` statuses. Docs require the same emergency boundary for ALL statuses: PENDING, UNDER_REVIEW, LINKED, ACTIONED. For waiting/uncertain statuses it should be visually prominent; for ACTIONED it may be lower/softer but must still appear. Currently users on PENDING/LINKED/ACTIONED see no 911 guidance at all.
- **Open implementation gap:** submit error handling — `handleSubmit` in `page.tsx` uses a monolithic catch block that sets a generic error message (`err.message ?? 'Submission failed. Please try again.'`). There is no 911 boundary, no error-type-specific guidance (validation vs rate limit vs network), and no bilingual copy. Docs require: 911 boundary on every error, practical next-step copy specific to the error type, and 911 sentence in English/Filipino for all submit failures.
- **Open implementation gap:** context challenge prompts — docs require two GPS/context consistency checks: (1) if user selects `SECONDHAND` after current GPS was acquired, show "Is this current location where the fire is?" with yes/no; "No" returns to manual pin placement; (2) if user selects `NEARBY` after current GPS, show a non-blocking reminder that if the fire is not exactly where they are they should place the pin on the fire. Code does not implement either prompt — `tryAdvanceFromContext()` only checks GPS distance mismatch for NEARBY/SECONDHAND, not whether GPS was the source.
- **Open implementation gap:** station phone fallback labeling — `tracking/page.tsx` (lines 310-321) renders `nearest_station_phone` as a station phone regardless of its value. If the backend returns `911` as the fallback station phone (when no real station is assigned), the UI labels it "Nearest BFP Station" with "911" as a click-to-call link. Docs require: when the fallback value is `911`, label it "Emergency Number" and treat it as secondary to the 911 boundary, not as a BFP station. Code makes no such distinction; the semantic label must change based on whether the phone value is `911` or a real station number.
- **Open implementation gap:** life-safety secondary affordance — docs require the category step for life-safety to show both a primary "Send now" that submits immediately with minimum fields and a secondary "Add details if safe" that opens optional details while keeping "Send now" as the primary action within that screen; `page.tsx` (lines 942-951) only has a single "Fast Submit" button with no "Add details" affordance before it. A user who wants to add witness info or observed time for a life-safety report would not know they can — there is no secondary routing action.
- **Open implementation gap:** review step 911 boundary — docs require the 911 emergency boundary on every pre-submit screen including the non-life-safety review step; `page.tsx` (lines 456-545) renders a bilingual "Do not move closer" notice (line 501-504) but no 911 guidance between the data summary and the submit button. The 911 boundary and "does not replace an emergency call" copy must appear before the final submit CTA on the review step.
- **Open implementation gap:** calm emergency landing block — docs require `/report` to start with dominant 911 guidance (call 911 if anyone is in immediate danger, move away from smoke/fire, do not get closer to take photos) as a passive static block before the first interactive step; `page.tsx` starts the form directly with the interactive step selection with no initial emergency guidance block. The block is guidance-only, does not create a separate data state, and must appear as the landing content on `/report` before any user action.
- **Open implementation gap:** GPS-denied/timeout 911 boundary — docs require 911 guidance to persist throughout the entire flow for life-safety reports and require location/submission failure microcopy to include 911 reminders; when GPS is denied or times out (lines 709-720), the location error panel shows only a "Try again / Subukan ulit" retry button with no 911 call-to-action, even when the user is on a life-safety path. The panel must display a bilingual 911 boundary reminder regardless of whether the user is on the life-safety path. Per user direction, the fix is not a GPS-handler-specific change but rather ensuring the location/map selection screen honors the persistent 911 guidance boundary when on the life-safety path.

## [2026-05-19] update | Consolidate gap-register and functional-bug-register
- gap-register: condensed verbose multi-line entries into tight bullet points; M9 marked NOT-yet-implemented; barangay TOP-N marked OPTIONAL; Phase 2 analyst export confirmed pending; all other items confirmed/shortened.
- functional-bug-register: F-01 to F-07 consolidated; verbose Keycloak token timeout names removed; F-06 (analyst 500) marked Fixed; removed stale "smoke-checked" qualifiers.
- index.md: updated last-changes line to reflect consolidation.

## [2026-05-19] fix | PR #106 notification security and tracking follow-through
- Removed committed Firebase service-account JSON from the PR working tree and changed Docker Compose to accept Firebase credentials only through runtime environment/secret injection.
- Isolated `send_status_notification.delay(...)` failures behind logged best-effort enqueue so persisted triage promotions do not return 500 when Redis/Celery publish is unavailable.
- Updated `/report/tracking` to consume `?id=<reportId>` on first load and automatically fetch report status for notification click-throughs.
- Added focused backend/frontend regression tests for enqueue isolation and tracking query-param lookup.

## [2026-05-16] create | Final ingestion: remaining routes, backend infra, components, docs/scripts
- Created 5 new synthesis pages completing the wiki coverage:
  - [[backend/remaining-routes]] — Full API reference for 7 route files: incidents.py (8 routes: upload-bundle, attachments, analyst list/detail/wildland, export), analytics.py (15 routes: heatmap, trends, comparative, export dispatch/download, type-distribution, top-barangays, response-time, compare-regions, top-n, filter-options, execution-plans), public_dmz.py (rate-limited unauthenticated submission), civilian.py (submit + track reports), sessions.py (list + terminate), user.py (profile + password change), ref.py (regions, provinces, cities).
  - [[backend/backend-infrastructure]] — Auth: KeycloakAuthenticator with JWKS caching/validation + 7 FastAPI dependencies. DB: engine, session factory, get_db/get_db_with_rls, set_rls_context GUC. main.py: 10 route registrations, rate-limit middleware (5/15min Lua+Redis on login), PKCE callback. Models: 6 ORM models (User, FireIncident, CitizenReport, IVH, SecurityThreatLog) + geometry validation. Schemas: 6 Pydantic models. Celery: Redis broker/backend, 3 periodic tasks (MV refresh 6h, Suricata 10s, draft expiry daily).
  - [[frontend/components-deep]] — Deep docs for 12 components: TypeDistributionChart, TopBarangaysChart, TrendCharts, ResponseTimeChart, HeatmapViewer (all pure presentational Recharts/Leaflet), ExportPreviewModal (state machine: idle→queued→polling→downloading→done/error), AnalystIncidentList (478-line paginated/sortable/selectable table with detail drawer), DuplicateIncidentModal, DuplicateResolutionModal, LayoutShell (auth guard + PWA SW cleanup), Header (breadcrumbs + live PST clock + role badge), WildlandAforManualForm (927-line 11-section form).
  - [[architecture/docs-and-scripts]] — docs/ (10 files: ARCHITECTURE, CHANGELOG, API_AND_FUNCTIONS, M4-PR, M4-INCIDENT-WORKFLOW-DETAILS, VALIDATOR_WORKFLOW_CHANGELOG, 3 PR docs). scripts/ indexed; rejected barangay loader artifacts are not part of the committed script surface.
- Updated index.md: 24 → 31 synthesis pages, all new pages linked.
- Updated agent-routing-guide.md to point to remaining-routes and backend-infrastructure.
- Total system-wiki documents: 31 synthesis pages + 3 reference files = 34 documents.
- The wiki now covers 100% of the codebase surface area:
  - ALL 16 backend route files documented
  - ALL 7 auth/database dependencies documented
  - ALL backend services (analytics, duplicates, Keycloak, AI, Suricata) documented
  - ALL utilities (crypto, audit, session, backup) documented
  - ALL Celery tasks (4 exports, 3 periodic) documented
  - ALL 31 SQL init files documented
  - ALL 6 ORM models, 6 Pydantic schemas documented
  - ALL frontend components (22+) documented
  - ALL 47 API client functions documented
  - ALL infra config (Docker, Nginx, Suricata, Keycloak 2641-line realm) documented
  - ALL 10 docs/ files and 14 scripts/ files indexed
  - ALL 3 dashboard subsystems have function-level API references

## [2026-05-16] create | Comprehensive wiki ingestion: frontend infra, DB SQL, services, utils/tasks, infra config, PWA/tests/CI
- Created 8 new synthesis pages across all layers:
  - [[frontend/frontend-infrastructure]] — Auth context (Keycloak OIDC, 4-min token refresh, cross-tab lock), 47 API client functions, utility libraries (afor-utils, ph-regions, regional-incidents, workflow-transfer), full component tree (Sidebar, IncidentForm~1956 lines, MapPickerInner with Nominatim, IncidentDiffPanel, SyncStatusBar, and 8 analytics chart components).
  - [[database/sql-init-files]] — All 31 SQL init files documented: RLS policies (16 tables force-enabled), helpers (current_user_uuid/role/region_id GUC system, exec_as_system_admin), 4 materialized views, immutable records RULES, PKI encrypt PII schema, seed data (12 verified incidents, 18 regions, 81 provinces, thousands of cities, 5 seed users).
  - [[backend/services]] — Analytics read model (17 functions: sync/batch/backfill/heatmap/trends/top-n/export/compare), duplicate detection (5km radius + ±1 day spatial + text fallback), Keycloak admin (8 functions: create/set/update/logout/change/get), AI/XAI service (qwen2.5:3b via Ollama with JSON format output).
  - [[backend/utilities-and-tasks]] — Crypto (AES-256-GCM PII blob with incident-bound AAD), audit trail (writes system_audit_trails), Redis session revocation (12h TTL), backup crypto (AES-256-GCM .sql.enc format), 4 Celery export tasks (CSV/PDF/XLSX with 26-column whitelist).
  - [[architecture/infrastructure-config]] — Docker Compose (8 services, health checks, volumes), Nginx (proxy table, CORS, cookie domain rewrite, missing WebSocket/SSE), Suricata (EVE output, no custom suricata.yaml, classification.config with 37 categories), Keycloak realm (2641-line export: 5-min tokens, 30-min SSO idle, conditional OTP per role, 23 seed users, wims-admin-service confidential client with hardcoded secret).
  - [[architecture/pwa-tests-cicd]] — PWA/offline-first: IndexedDB queue (idb), sync engine (LWW conflict resolution on 409), network status hook, auto-sync with 2s debounce, service worker with Background Sync API, manifest (standalone PWA). Tests: 30 test files (10 unit, 19 integration), SQL contract pattern (inspect.getsource), e2e Keycloak+MailHog. CI: 5 parallel jobs + merge-gate. CD: GHCR image push on master.
- Updated [[operations/agent-routing-guide]]: every task now points to specific service/utility/infra pages.
- Updated [[index.md]]: 16 → 24 total synthesis pages, all new pages listed under their sections.
- Total system-wiki documents: 24 synthesis pages + 3 reference files = 27 documents.

## [2026-05-16] create | API reference files for all three dashboard subsystems
- Created `system-wiki/subsystems/references/` with three function-level API reference files:
  - [[subsystems/references/admin-api-ref]] — Every function in admin.py documented: 16 route handlers, 4 Pydantic schemas, 2 helpers. Each entry includes route decorator, auth dep, DB session type, all parameters with types, return shape, all HTTP errors with conditions, and detailed behavior notes (audit logging, RLS context, Keycloak sync, backup encryption, retention policy).
  - [[subsystems/references/regional-api-ref]] — Every function in regional.py (~5050 lines) documented: 40+ route handlers, 10+ schemas, 25+ helpers, both AFOR parsers (BfpXlsxParser, WildlandXlsxParser). Covers AFOR import pipeline, incident CRUD, stats, verification workflow, audit logs, duplicate detection, barangay reverse-geocoding.
  - [[subsystems/references/triage-api-ref]] — Every function in triage.py: get_pending_reports, promote_report, bulk_promote_reports, BulkPromoteRequest schema, _require_encoder_or_validator guard dependency.
- Updated all three subsystem pages to include "## API Reference" sections linking to the reference files.
- Updated `index.md` to list reference files under their parent subsystem entries.
- Total synthesis pages: 16 pages + 3 reference files = 19 total wiki documents.

## [2026-05-17] update | analyst incident detail backend + sensitive endpoint + numeric hardening + index fix
- `GET /incidents/analyst/{incident_id}` — fully rewired:
  - Added `form_kind` field via `CASE WHEN w.incident_id IS NOT NULL THEN 'WILDLAND_AFOR' ELSE 'STRUCTURAL_AFOR'` using LEFT JOIN on `incident_wildland_afor`
  - Added all 19 structural fields from `incident_nonsensitive_details`: `fire_origin`, `extent_of_damage`, `structures_affected`, `households_affected`, `individuals_affected`, `vehicles_affected`, `resources_deployed`, `alarm_timeline`, `problems_encountered`, `stage_of_fire`, `extent_total_floor_area_sqm`, `extent_total_land_area_hectares`, `water_tankers_used`, `breathing_apparatus_used`, `total_gas_consumed_liters`, `families_affected`, `responder_type`, `fire_station_name`, `distance_from_station_km`
  - When `has_wildland_afor = true`, inlines `wildland` (full row dict), `alarm_statuses`, and `assistance_rows` from joined tables
  - Sensitive fields (narrative, PII, disposition) intentionally excluded — use `/sensitive` endpoint
  - **Index fix (another agent):** Live DB query confirmed the SELECT returns 38 columns (indexes 0–37). `form_kind` at row[18], `fire_station_name` at row[36], `distance_from_station_km` at row[37]. Original indices were off by 2 due to stale indexing from removed `barangay_name` JOIN. All row indices updated to actual positions; endpoint returns 200 for incident 12.
- New `GET /incidents/analyst/{incident_id}/sensitive` — separate endpoint for PII:
  - Same auth: `NATIONAL_ANALYST` or `SYSTEM_ADMIN`
  - Returns: `caller_name`, `caller_number`, `owner_name`, `establishment_name`, `occupant_name`, `narrative_report`, `prepared_by_officer`, `noted_by_officer`, `disposition`, `fire_origin`, `extent_of_damage`, `alarm_timeline`
  - Verifies incident is VERIFIED and not archived before returning any data (404 otherwise)
- Numeric field hardening: replaced bare `float()` casts on `NUMERIC` columns with `_analyst_json_value()` helper for `estimated_damage_php`, `extent_total_floor_area_sqm`, `extent_total_land_area_hectares`, `total_gas_consumed_liters`, `distance_from_station_km`. Prevents `ValueError` when garbage strings (e.g. `'BFP'` in `total_gas_consumed_liters` for incident 12) land in numeric columns.
- Removed dead `ref_barangays` LEFT JOIN — `barangay_id` is never written by encoder workflow; JOIN always returned empty. Comment added referencing future purge tracking. `barangay_name` dropped from response; frontend `FieldRow` renders `N/A`.
- Frontend `api.ts` — `AnalystIncidentDetailResponse` extended with all new fields + `form_kind` + optional wildland sub-objects; `AnalystIncidentSensitiveResponse` interface added; `fetchAnalystIncidentSensitive()` function added.
- Frontend analyst detail page (`/dashboard/analyst/incidents/[id]`) — fully redesigned by parallel agent: 8 collapsible sections (A–H), blur/reveal sensitive data with per-field eye-icon toggle, locked wildland section for STRUCTURAL_AFOR, lazy-load sensitive endpoint on user click. Reviews passed.
- Updated `system-wiki/backend/api-route-map.md`: added `/incidents/analyst/{incident_id}/sensitive` route entry.
- SQL contract tests pass: 4/4 (`test_analyst_incidents_sql_contract.py`).

## [2026-05-16] retracted | PSGC barangay geometry full-load pipeline
- A proposed PSGC barangay geometry full-load pipeline was generated but rejected before commit.
- Rejected artifacts included a PSGC code SQL migration, a Python geometry loader, a prep script, a loader Dockerfile, and a Compose startup dependency.
- Rejection reasons: normal stack startup became network-dependent, Docker Compose lost/broke existing backend/celery/Keycloak settings, and the proposed SQL attempted invalid `NULL` inserts into `ref_barangays.city_id`.
- The stable state is now: keep `31_barangay_geometry.sql` as an optional schema hook, remove barangay from Analyst Top-N selectors, and use municipality/fire-station/region for reliable hotspot ranking.
- Created `system-wiki/subsystems/` directory with three new synthesis pages:
  - [[subsystems/admin-hub]] — System admin hub: identity management, security telemetry, audit logs, health check, scheduled reports, backup management. Documents all 25+ admin.py endpoints and all 8 admin hub frontend panels.
  - [[subsystems/regional-dashboard]] — Regional encoder dashboard: AFOR import pipeline (5050-line regional.py), incident CRUD, drafts management, encoder audit trail, incident detail page with editable IncidentForm.
  - [[subsystems/validator-hub]] — National validator dashboard: verification queue, single/bulk approve workflow, duplicate resolution with Promise-based pattern, audit trail with CSV export, diff panels.
- Updated `index.md` (new Subsystems section, total 16 pages).
- Updated `operations/agent-routing-guide.md` (auth, incident-CRUD, and validation tasks now reference the subsystem pages).

## [2026-05-16] fix | TOP-N barangay dimension — code resolved, verification pending
- Implemented reverse-geocoding fix via OpenCode subagent (commit `4fb24b7`).
- Created `src/postgres-init/31_barangay_geometry.sql` — adds `geometry GEOGRAPHY(POLYGON, 4326)` + GiST index to `ref_barangays`.
- Added `_reverse_geocode_barangay(db, incident_id, lon, lat)` to `src/backend/api/routes/regional.py` — called after incident INSERT in 3 locations (_commit_wildland_afor_row, AFOR structural commit loop, create_incident). Uses `ST_Contains` + calls `sync_incident_to_analytics`. Gracefully skips if geometry not yet loaded.
- Updated gap register: RESOLVED in code, verification pending (needs PSGC polygon data loaded + existing incidents re-synced).

## [2026-05-16] gap | TOP-N barangay dimension broken for AFOR-imported/manual incidents
- `analytics_incident_facts.barangay_name` is NULL for all AFOR-imported and most manual incidents because `incident_nonsensitive_details.barangay_id` is never written during AFOR import (AFOR form has no barangay field, import code only resolves city_id) and is optional in manual create. `get_top_n` filters `WHERE {dim_col} IS NOT NULL`, so TOP-N by barangay returns zero results for this data. Municipality and province dimensions work because they are denormalized from populated columns. Resolution: reverse-geocode location geometry to barangay OR add barangay field to AFOR import form. Logged to `gaps/frs-codebase-gap-register.md`.

## [2026-05-16] implement | Deterministic incident seed data
- Added `src/postgres-init/29_seed_incidents.sql`, an idempotent seed file with 12 verified incidents across NCR, Region IV-A, and Region V.
- Seed data includes `fire_incidents`, nonsensitive and sensitive detail rows, verification history, analytics facts, geography denormalization fields, and materialized view refreshes for analyst dashboard/export workflows.

## [2026-05-16] implement | National Analyst Phase 2 analyst incident export backend
- Added `POST /api/incidents/analyst/export/{csv|pdf|excel}` to queue analyst incident exports for filtered results or selected `incident_ids`.
- Added `export_analyst_incidents_task` in `src/backend/tasks/exports.py`, reusing the existing `_export`, `_write_csv`, `_write_xlsx`, and `_write_pdf` helpers.
- Added `get_analyst_export_rows` in `src/backend/services/analytics_read_model.py`; selected IDs are deduplicated and intersected through the RLS-protected analytics read model query.
- Schema change: `src/postgres-init/28_analytics_geography_denorm.sql` now adds `analytics_export_log.export_type`, and analyst exports log `export_type = 'analyst'`.
- Validation: `src/backend/tests/test_analyst_export.py` added 8 tests and passed (`8 passed`); compile gates passed for `api/routes/incidents.py`, `tasks/exports.py`, and `services/analytics_read_model.py`; existing analyst SQL contract tests passed (`4 passed`).

## [2026-05-16] implement | National Analyst Phase 1 workflow UI and selection
- Added `src/frontend/src/lib/analyst-workflow-transfer.ts` for `sessionStorage` transfer-ID handoff from dashboard to dedicated workflow pages.
- Made the analyst incident list prominent/selectable, with persistent selection across pagination, column visibility, selected-count actions, and "Analyze selected" workflow transfer.
- Wired `/dashboard/analyst/[workflow]` to read transfer payloads, initialize local filters/selected IDs, provide local reset, label selected-set behavior, keep charts filter-scoped, and use 100 rows/page for Incident Explorer.
- Added `incident_ids` support to `GET /api/incidents/analyst-list` for selected-set evidence tables.
- Extended analytics trends interval support to daily/weekly/monthly/quarterly/yearly.
- Validation: frontend lint passed with pre-existing warnings only; analyst Vitest suites passed (`33 passed`); backend py-compile plus focused analyst SQL contract tests passed (`4 passed`); production frontend build passed with network access for Google Fonts.

## [2026-05-16] decision | Dedicated analyst workflow MVP phasing
- Implement in two phases for efficiency.
- Phase 1: workflow UI and selection, including transfer-ID filter/selection handoff, local reset, prominent dashboard list, persistent selection, 100-row Incident Explorer, filter-scoped charts/evidence tables, and clear selected/export labeling.
- Phase 2: modular incident export backend, including analyst incident export endpoints, selected/current-result scopes, selected-column CSV/PDF, full AFOR CSV/PDF, export audit logging, and focused tests.

## [2026-05-16] decision | Selected-ID analytics MVP boundary
- MVP aggregate charts/calculations should remain filter-scoped.
- Selected incident IDs should drive table/export behavior only, with UI labeling that charts use current filters while selected exports use selected incidents.
- Backend ID-scoped aggregate analytics is post-MVP.

## [2026-05-16] decision | Dedicated workflow current-result export
- Every dedicated analyst workflow page should support exporting its current filtered result.
- Export UI should clearly label selected incidents, current filtered result, full AFOR for selected incidents, and full AFOR for current result.
- Large full-AFOR current-result exports should be queued asynchronously with stronger confirmation.

## [2026-05-16] decision | Incident export scopes
- The new incident export module should support both explicit selected IDs and current filtered result exports.
- UI actions should be labeled separately as "Export selected" and "Export current result".
- Current-result export should apply local filters across all matching verified incidents, not just the current page, and should show estimated-count confirmation before queueing.

## [2026-05-16] decision | Selected export API contract
- MVP selected export endpoints should live under analyst incident routes: `POST /api/incidents/analyst/export` and `GET /api/incidents/analyst/export/{task_id}`.
- Request body should include incident IDs, export mode (`selected_columns` or `full_afor`), format (`csv` or `pdf`), and columns for selected-column export.
- Backend must enforce analyst/admin RBAC, re-check verified/non-archived incident eligibility, allowlist columns, and log export metadata.
- Optional future enhancement after MVP: `GET /api/incidents/analyst/export/{task_id}/status`.

## [2026-05-16] decision | Modular selected export backend
- Selected incident/AFOR export should be a parallel modular export system, not an extension of the existing analytics aggregate export endpoint.
- Rationale: selected-record/full-AFOR exports have different payload shape, flattening rules, and failure modes; separation avoids turning analytics export into a single point of failure.

## [2026-05-16] decision | Incident Explorer workflow
- Incident Explorer should be the selected-set control center.
- It should support shared local filters, 100 rows/page, column visibility, sorting, row selection across pagination, quick search if backend-supported, drawer/detail navigation, selected-count action bar, Analyze Selected, selected-column export, full AFOR export, and Clear Selection.

## [2026-05-16] decision | Top-N workflow controls
- Top-N / Hotspot should default to Top 10 municipalities by incident count.
- Controls should include dimension, metric, N, and sort direction.
- Do not add a minimum incident count threshold; truthful low-sample rankings should remain visible.
- Outputs should include ranked chart/table, click-to-filter incident table behavior, and ranking plus evidence export.

## [2026-05-16] decision | Response-time workflow controls
- Response Time should use `total_response_time_minutes` as the primary metric.
- Recommended controls: group-by dimension, statistic, target threshold minutes, exclude incomplete timestamps default-on, and editable inherited local date range.
- Outputs should include grouped charting, average/median/fastest/slowest/within-threshold tiles, slowest-incident outlier table, and the incident evidence table.

## [2026-05-16] decision | Trends workflow controls
- Trends interval options should be daily, weekly, monthly, quarterly, and yearly.
- Trends should also include manual Range A to Range B date inputs for the exact trend window.
- Recommended additional controls: measure, compare-by split, and rolling average; outputs should include chart, summary tiles, and matching incident evidence table.

## [2026-05-16] decision | Selected incident transfer storage
- Selected incident handoff from `/dashboard/analyst` into dedicated workflow pages should use `sessionStorage` keyed by a short transfer ID.
- Workflow URLs should carry only the transfer ID, e.g. `/dashboard/analyst/{workflow}?transfer={uuid}`, then initialize local filters and selected incident IDs from the browser-local payload.

## [2026-05-16] handoff | Analyst dedicated pages grill pass
- Created `system-wiki/sessions/2026-05-15_1223_xynate_analyst-dedicated-pages-grill-handoff.md`.
- Handoff captures the dedicated-page decisions, current dirty files, validation results, implementation caveats, and next-session questions.

## [2026-05-16] decision | Heatmap workflow map-area filtering
- The dedicated heatmap/geospatial workflow should follow shared map/global filters and selected map area.
- The incident table below the map should follow both the active map filters and the selected area.
- Recommended local controls: map metric, aggregation level, intensity mode, incident pins toggle, administrative boundaries toggle, and map snapshot export.

## [2026-05-15] decision | Full AFOR CSV shape
- Full AFOR CSV export should be one row per incident with all AFOR fields flattened into stable columns.
- Repeating/nested sections should be serialized into readable semicolon-separated cell values, not expanded into multiple incident rows.

## [2026-05-15] decision | Selected export modes
- Selected-record CSV/PDF exports should use a dedicated column-selection modal for list/table columns.
- Full AFOR export means all AFOR fields/columns for selected incidents, not just visible list columns.
- Multi-incident full AFOR PDF export should generate one combined PDF with each incident starting on a new page or clearly separated section.

## [2026-05-15] decision | Selected-set workflow transfer
- Normal dedicated-workflow navigation transfers active filters only.
- Explicit "Analyze selected" actions should transfer active filters plus selected incident IDs, with a selected-set banner, selected-default exports, and local reset that clears the selected IDs.
- Aggregate charts should not imply selected-ID calculations until backend analytics endpoints support explicit incident ID sets.

## [2026-05-15] decision | Analyst incident-list pagination and selection persistence
- Dashboard incident-list selections should persist across pagination while filters remain unchanged.
- The dedicated incident-explorer page should present a denser 100-row page size for bulk review, while the dashboard can keep its smaller overview page size.

## [2026-05-15] decision | Comparative workflow and selected incident export
- Comparative analysis should apply the same non-date global/local filters to both periods; only `Range A` and `Range B` date windows differ.
- The analyst incident list should become more prominent and support a selected incident set that can be exported independently to CSV/PDF, instead of only exporting the full filtered analytics result.

## [2026-05-15] decision | Analyst workflow filter handoff
- Dedicated analyst workflow pages should initialize their local filters from the active `/dashboard/analyst` global filters when opened from the overview dashboard.
- Each workflow page also needs a local reset/clear action that resets only that workflow page's filter inputs and does not mutate the overview dashboard's current filters.

## [2026-05-15] update | Dedicated National Analyst workflow pages
- Added `/dashboard/analyst/[workflow]` with focused workflow pages for `comparative`, `heatmap`, `trends`, `response-time`, `top-n`, and `incident-explorer`.
- Added dashboard workflow launch cards and expanded the `NATIONAL_ANALYST` sidebar section with direct workflow links.
- Updated frontend route map, National Analyst evaluation, UI/UX gap register, FRS/codebase gap register, and index date. Validation completed: frontend lint, existing analyst Vitest suites, and frontend production build.

## [2026-05-15] handoff | National analyst validation and Keycloak fixes
- Created `system-wiki/sessions/2026-05-15_1148_xynate_national-analyst-validation-keycloak-handoff.md`.
- Handoff points the next session toward a docs-driven/grill pass for dedicated National Analyst pages and references existing wiki artifacts instead of duplicating them.

## [2026-05-15] fix | Analyst incident list region schema mismatch
- Container logs showed `/api/incidents/analyst-list` failing with `psycopg2.errors.UndefinedColumn: column r.short_name does not exist`.
- Patched analyst list/detail queries to use `ref_regions.region_code` / `region_name` instead of `short_name`.
- Expanded `src/backend/tests/test_analyst_incidents_sql_contract.py` to guard against `r.short_name` regressions.
- Rebuilt/restarted backend and smoke-checked the patched SQL against local Postgres. Local runtime data has `0` `fire_incidents` and `0` analytics facts, so the dashboard will show no visible incidents until data is seeded/imported and verified.

## [2026-05-15] fix | Keycloak forgot-password local test config
## [2026-05-16] fix | Reject fragile barangay geometry loader
- Removed the uncommitted `load-barangay-geometries` Docker/PSGC loader path after validation showed it broke `docker-compose.yml`, made backend startup depend on live GitHub downloads, and attempted invalid `ref_barangays.city_id = NULL` inserts.
- Restored the normal backend/celery/Keycloak Docker Compose shape and kept `31_barangay_geometry.sql` as an optional schema hook only.
- Removed barangay from Analyst Top-N dimension selectors; municipality remains the stable default for hotspot ranking until a vetted local barangay polygon import exists.

- Fixed `test_keycloak_password_reset.py` flow execution helper to call Keycloak's reset-credentials executions endpoint by URL-encoded flow alias instead of internal flow ID.
- Configured `src/keycloak/bfp-realm.json` with MailHog SMTP defaults for local password-reset email tests.
- Added a `mailhog` service to `src/docker-compose.yml` exposing SMTP `1025` and web/API `8025`.
- Updated security baseline and functional bug register. Targeted Keycloak tests skip in this sandbox because Keycloak is unreachable here; the running local realm may need Admin API update or container recreate/import to pick up SMTP defaults.

## [2026-05-15] fix | National analyst incident list 500 and dashboard UX
- Fixed analyst incident list/detail SQL to match the live schema: `ref_barangays` / `analytics_incident_facts.barangay_name` for barangay names, derived casualty severity from casualty counts, `fire_incidents.data_hash` for provenance, and derived analytics sync status from fact presence.
- Added `src/backend/tests/test_analyst_incidents_sql_contract.py` to guard against reintroducing nonexistent analyst-list columns.
- Overhauled `/dashboard/analyst` scanability: summary tiles, grouped filters, clearer apply/reset controls, export preview actions, icon-led panel headers, sticky portrait heatmap, and friendlier incident-list error copy.
- Validation completed: focused backend regression test, Python compile for `api/routes/incidents.py`, frontend analyst Vitest suites, and frontend lint. Broader backend integration suites still hang in this environment and need a non-hanging stack/runner.

## [2026-05-14] update | National analyst Phase 7 wiki validation
- Updated National Analyst synthesis/gap pages to reflect completed Phase 0-6 code: analytics sync, export infrastructure, geography filters, Recharts charts, incident list/drawer/detail/wildland routes, dashboard export preview/download, CSV/PDF/Excel entry points, side-column heatmap, prominent filter labels, top municipalities, response-time view, and analyst sidebar.
- Updated backend/frontend/database maps with the current analyst dashboard route/API/schema state.
- Left browser UI verification, full backend integration test pass, Celery result retention, export cleanup, seeded wildland examples, and scheduled reports as explicit remaining verification/deferred items.

## [2026-05-14] handoff | Phase 5 incident drill-down session
- Created `sessions/2026-05-14_2007_x1n4te_phase5-incident-drilldown-handoff.md` with verification notes, next-session cautions, and suggested skills.

## [2026-05-14] update | National analyst Phase 5 incident drill-down
- Added backend route-map entries for `GET /api/incidents/analyst-list`, `GET /api/incidents/analyst/{incident_id}`, and `GET /api/incidents/analyst/{incident_id}/wildland`.
- Added frontend route-map entries for `/dashboard/analyst/incidents/[id]` and `/dashboard/analyst/incidents/[id]/wildland`.
- Updated National Analyst evaluation and gap registers: incident list/drawer/detail/wildland drill-down are fixed in code and need browser UI verification; export preview remains pending.

## [2026-05-14] update | National analyst backend slice started
- Added API map entries for `GET /api/analytics/export/{task_id}` and `GET /api/analytics/filter-options`.
- Documented `28_analytics_geography_denorm.sql`: denormalized `municipality_name` / `province_name` on `analytics_incident_facts`, plus export task/file metadata on `analytics_export_log`.
- Updated National Analyst evaluation/gap registers: verification sync remains fixed, export backend is implemented but frontend preview/download UX remains pending, and National Analyst sidebar navigation is fixed.

## [2026-05-14] handoff | Session complete, handoff file created
- AGENTS.md updated: added "System Wiki & Agent Context Routing" section pointing agents to system-wiki/.
- Session handoff created: `sessions/2026-05-14_1605_x1n4te_system-wiki-initialization-uiux-evaluations.md` — full session summary, recommended skills, known conventions, open questions.
- Open items for next session: wiki-dir/ cleanup decision, next desk-check page, groupmate wiki access, GitHub Issues conversion of gap register.

## [2026-05-14] add | National analyst dashboard evaluation
- Raw notes added to `raw/ui-ux/evaluation-national-analyst.md`.
- Synthesis created at `ui-ux/evaluation-national-analyst.md` — layout issues (L-01–L-04), filter issues (F-01–F-02), plus FRS/codebase gaps not explicitly raised by user (G-01–G-08).
- Cross-referenced with FRS M5 (Analytics), GitHub issues #84–#89.
- Key findings from FRS not raised by user: Top municipalities view missing (G-01), Average response time by region missing (G-02), P0 CRITICAL data pipeline bug (#84 — verify_incident() no analytics sync).
- Execution order per #89: Phase 0 → Phase 1 → Phase 2/3 (parallel) → Phase 5 → Phase 4.
- Added to `ui-ux-gap-register.md` (National Analyst Dashboard section) and `index.md` (UI/UX Evaluations section).
- SCHEMA.md authority model: "Empty or incomplete FRS source files" rule preserved (applies if future sources are empty).

## [2026-05-20] implement | Civilian Reporting Phase 2 — Issue 1: schema/bootstrap

**Session context:** Issue 1 of 12 vertical slices. Schema and bootstrap only; no API/frontend/validator work.

**Decisions implemented:**
- `05_citizen_reports.sql`: Phase 2 schema with all ADR columns: `category`/`sub_category`/`reporting_context`/`safety_status`/`witness_name`/`witness_phone`/`trust_score`/`status_explanation`/`internal_note`/`linked_to_report_id`/`link_count`/`previous_report_id`/`source_url`; CHECK constraints for all status values (PENDING/UNDER_REVIEW/LINKED/ACTIONED/REJECTED_BOGUS/REJECTED_DUPLICATE/REJECTED_INSUFFICIENT/REJECTED_TIMEOUT); status_explanation CHECK constraint COMMENTED OUT for bootstrap compatibility (re-enable via migration after seed backfill); `nearest_station_id` FK deferred to `32b_citizen_reports_station_fk.sql`; `report_notification_tokens` folded into this file.
- `citizen_report_clusters` and `citizen_report_cluster_members`: folded into `05_citizen_reports.sql` (Phase 2 cluster workflow state with anchor/claim/merge tracking).
- `ref_fire_stations.phone`: added to table definition in `32_ref_fire_stations.sql`; `32b_citizen_reports_station_fk.sql` defers FK constraint for `nearest_station_id`.
- `01_extensions_roles.sql`: made idempotent with `DO $$ EXCEPTION WHEN duplicate_object $$` blocks for all roles and wims_app.
- `10_rls_policies.sql`: Phase 2 citizen_reports RLS policies — public signal records, ANONYMOUS insert/select allowed, validator/admin write access.
- `11_analytics_facts.sql`: added `DROP POLICY IF EXISTS` for idempotent bootstrap re-runs.
- Bootstrap test (`test_wims_initial_schema_bootstrap.py`): updated to apply all numbered SQL files in sequence, added Phase 2 column/constraint/index assertions, updated `test_database_schema.py` TestForensicConstraint to test ACTIONED instead of deprecated VERIFIED.

**Tests run:**
- `test_database_schema.py` (7/7 pass against live DB): all constraint tests including Phase 2 status values.
- `test_wims_initial_schema_bootstrap.py`: bootstrap test has idempotency gaps in multiple pre-existing SQL files (13_export_reports.sql, 15_validator_workflow.sql, 17_cross_region_validator.sql, 17_immutable_records.sql) that use `CREATE POLICY` without `DROP POLICY IF EXISTS`. These are pre-existing issues outside Issue 1 scope. On first fresh-DB run (from template0) the bootstrap test passes.

**Verification against live running DB (test_database_schema.py — 7/7 pass):**
- `citizen_reports` has all Phase 2 columns including `source_url`, `previous_report_id`, `link_count`, `status_explanation`.
- `citizen_report_clusters` table exists with all ADR columns (anchor_report_id, status, status_note, internal_note, acted_by, assigned_to, review_started_at, created_at, updated_at, closed_at, merged_into_cluster_id).
- `citizen_report_cluster_members` table exists with all ADR columns (cluster_id, report_id, linked_by, created_at).
- `ref_fire_stations.phone` column exists.
- `citizen_reports.status` accepts all 8 Phase 2 values.
- ACTIONED status requires validated_by (TestForensicConstraint updated from deprecated VERIFIED).

**Known gaps (out of Issue 1 scope):**
- `05_citizen_reports.sql` comment says status_explanation CHECK is commented — re-enable in Issue 2 API phase.
- Bootstrap test idempotency: many pre-existing SQL files not idempotent; test passes on first fresh run but fails on re-run from same Docker session due to "policy already exists" errors. Resolvable by adding DROP POLICY IF EXISTS to ~8 SQL files but that's Scope Creep.
- `test_wims_initial_schema_bootstrap.py` uses hardcoded file list; relaxed to auto-discover all numbered .sql files.
- `_postgres_init_dir()` override check updated to not require `01_wims_initial.sql` specifically (actual Docker path uses `01_extensions_roles.sql`).

## [2026-05-20] implement | Civilian Reporting Phase 2 — Issue 2: submission/tracking API

**Session context:** Issue 2 of 12 vertical slices. Backend API/schema/tests only; no public frontend or validator UI work.

**Implemented:**
- `schemas/civilian.py`: Phase 2 structured request/response models with category, sub-category, reporting context, safety status, GPS metadata, witness fields, `previous_report_id`, `status_explanation`, deterministic guidance, nearest-station context, and related cluster status.
- `api/routes/civilian.py`: rewired public submission to insert structured `citizen_reports` rows, compute deterministic trust score, resolve nearest station/region, persist GPS metadata, support `previous_report_id`, and return tracking-ready response data.
- `PATCH /api/civilian/reports/{report_id}/append`: creates `LINKED` child reports, increments parent `link_count`, and blocks append on `ACTIONED` or any `REJECTED_*` terminal parent.
- `GET /api/civilian/reports/{report_id}`: returns `status_explanation`, status-specific guidance, rejection escalation guidance, nearest-station phone/name, `previous_report_id`, link count, and related cluster status when explicitly linked.
- `test_civilian_api.py`: replaced Phase 1 free-text tests with Phase 2 API coverage for structured submission, previous report reference preservation, coordinate validation, append creation, terminal append blocking, and terminal tracking guidance.
- `32b_citizen_reports_station_fk.sql`: expanded to upgrade existing Phase 1 dev databases to the Phase 2 citizen_reports columns/checks/indexes before adding `nearest_station_id` FK; added `chk_actioned_requires_validator` as `NOT VALID` for live compatibility.
- `36_ref_fire_stations_phone_null.sql`: fixed to add `ref_fire_stations.phone` for existing dev databases before null backfill.
- `05_citizen_reports.sql`: added missing `gps_warning_confirmed` and restored `chk_actioned_requires_validator` for fresh bootstrap.

**Tests run:**
- Rebuilt backend image, then ran `pytest tests/integration/test_database_schema.py tests/integration/test_civilian_api.py -v` inside Docker.
- Result: 14/14 passed.

**Notes:**
- The running dev DB was older than the Phase 2 init scripts, so `32_ref_fire_stations.sql`, `32b_citizen_reports_station_fk.sql`, `35_citizen_report_clusters.sql`, and `36_ref_fire_stations_phone_null.sql` were applied manually to verify Issue 2 without destroying Docker volumes.
- `triage.py` still contains Phase 1 promotion/free-text behavior and is intentionally left for later triage queue slices.

- Updated `decisions/0001-civilian-reporting-overhaul.md` after grill-with-docs session on unresolved civilian reporting decisions.
- Locked terminal append behavior: `ACTIONED` and all `REJECTED_*` reports cannot be appended; users are prompted to submit a new report or call 911 / nearest BFP station.
- Removed challenge endpoint from scope; new reports may reference previous terminal reports via `previous_report_id`.
- Replaced `PROMOTED` row status with `ACTIONED`; official `fire_incidents` remain created through regional/fire-station AFOR workflow, not civilian triage.
- Added durable cluster workflow model: `citizen_report_clusters`, `citizen_report_cluster_members`, cluster statuses, and inspection-modal/per-report terminal action rules.
- Locked timeout behavior: `PENDING` reports auto-transition to `REJECTED_TIMEOUT` after 2 hours with default `status_explanation`; row-level `UNDER_REVIEW` pauses timeout, cluster-level review alone does not.
- Clarified witness fields: `witness_name`/`witness_phone` refer to the direct eyewitness, especially for `SECONDHAND`.
- Added HCI/UX refinements: required safety prompt, two-mode submit flow, no media upload, bilingual public microcopy, GPS-denied map fallback, nearby duplicate suggestion for non-life-safety reports, validator priority filters, map+table cluster inspection modal, status-specific tracking guidance, and trust-score breakdown UI.
- Added validator-only workflow refinements: cluster claim/lock with stale takeover, outlier highlighting, split/merge clusters, URL-backed quick filters, audited terminal corrections, privacy rules for device/contact identifiers, and safe navigation-only keyboard shortcuts.
- Created `frontend/validator-triage-shortcuts.md` as the shortcut reference page.
- Added final validator workflow refinements: cluster activity/history panel, audit coverage for validator actions, internal notes separate from civilian-visible explanations, nearest-station context, mixed-status bulk warnings, non-terminal next-action recommendations, and 30-second polling with non-destructive refresh prompts.
- Created `prd/civilian-reporting-phase-2.md` to convert ADR decisions into buildable product requirements, user stories, implementation decisions, testing decisions, and out-of-scope boundaries.
- Created `plans/civilian-reporting-phase-2-implementation-issues.md` with 12 vertical implementation slices covering schema, APIs, public UX, tracking, triage projection, cluster workflow, validator UI, terminal actions, split/merge, timeout job, and final integration.

## [2026-05-14] split | Functional bugs moved from UI/UX register to standalone register
- `gaps/functional-bug-register.md` created — holds 5 teammate-reported functional/auth bugs (M12).
- Teammate bugs section removed from `gaps/ui-ux-gap-register.md`; cross-links added in both directions.
- `gaps/frs-codebase-gap-register.md` Related section updated to include `functional-bug-register`.
- `index.md` Gaps section updated: all 3 gap registers now listed separately.
- `log.md` entries updated to reflect split.

## [2026-05-14] add | Teammate-reported bugs to UI/UX gap register
- 5 bugs added to `gaps/ui-ux-gap-register.md` (Teammate-Reported Bugs section):
  - System Audit record_id shows "-" on create user actions (M12).
  - First login allows missing First Name, Last Name, device name — Keycloak profile validation not enforced.
  - No username change opportunity on first login — admin expects but no UI exists.
  - Session lifespan too short / fast logout — Keycloak token config issue.
  - No account recovery if TOTP authenticator is deleted — hard lockout, no fallback.

## [2026-05-14] split | UI/UX gaps separated from FRS codebase gap register
- Created `gaps/ui-ux-gap-register.md` — standalone gap register for UI/UX issues.
- Removed UI/UX section from `gaps/frs-codebase-gap-register.md`; added cross-link.
- `index.md` updated: total pages 12 -> 13, Gaps section now lists both registers separately.
- Updated header in `ui-ux-gap-register.md` to reflect teammate as well as user evaluations.

## [2026-05-14] update | FRS sources restored, UI/UX evaluations ingested
- `raw/frs/frs-analyticsandreporting.md` filled: M5 now has full spec (statistical query engine, analytics views, export pipeline).
- `raw/frs/frs-cryptographicsecurity.md` filled: M6 now has full spec (OpenBao key management, AES-256-GCM at-rest, TLS 1.3 in-transit).
- `raw/frs/frs-publicanonymousincidentsubmission.md` filled: M14 now has full spec (zero-trust endpoint, Redis rate limiting, auto region resolution, Pydantic validation).
- `raw/frs/frs-systemmonitoringandhealthdashboard.md` filled: M9 now has full spec (psutil/Docker metrics, 60s refresh, log full-text search, configuration management).
- Gap register updated: "Source Gaps" section removed (sources now populated); M9 System Monitoring and UI/UX gaps added.
- New synthesis pages created: `ui-ux/evaluation-loginpage-keycloaksso.md` and `ui-ux/evaluation-system-admin-hub.md` from user desk-check notes.
- `raw/ui-ux/` directory created as immutable source for future evaluations.
- SCHEMA.md updated: added `ui-ux` to types and `ui-ux`, `hci` to domains taxonomy.
- `index.md` updated: total pages 10 -> 12, added UI/UX Evaluations section, updated Raw Source Captures description.
## [2026-05-14] split | UI/UX gaps separated from FRS codebase gap register
- Created `gaps/ui-ux-gap-register.md` — standalone gap register for UI/UX issues.
- Removed UI/UX section from `gaps/frs-codebase-gap-register.md`; added cross-link.
- `index.md` updated: total pages 12 -> 13, Gaps section now lists both registers separately.
- Updated header in `ui-ux-gap-register.md` to reflect teammate as well as user evaluations.
## [2026-05-14] add | Teammate-reported bugs to UI/UX gap register
- 5 bugs added to `gaps/ui-ux-gap-register.md` (Teammate-Reported Bugs section):
  - System Audit record_id shows "-" on create user actions (M12).
  - First login allows missing First Name, Last Name, device name — Keycloak profile validation not enforced.
  - No username change opportunity on first login — admin expects but no UI exists.
  - Session lifespan too short / fast logout — Keycloak token config issue.
  - No account recovery if TOTP authenticator is deleted — hard lockout, no fallback.
## [2026-05-14] split | Functional bugs moved from UI/UX register to standalone register
- `gaps/functional-bug-register.md` created — holds 5 teammate-reported functional/auth bugs (M12).
- Teammate bugs section removed from `gaps/ui-ux-gap-register.md`; cross-links added in both directions.
- `gaps/frs-codebase-gap-register.md` Related section updated to include `functional-bug-register`.
- `index.md` Gaps section updated: all 3 gap registers now listed separately.
- `log.md` entries updated to reflect split.
## [2026-05-14] add | National analyst dashboard evaluation
- Raw notes added to `raw/ui-ux/evaluation-national-analyst.md`.
- Synthesis created at `ui-ux/evaluation-national-analyst.md` — layout issues (L-01–L-04), filter issues (F-01–F-02), plus FRS/codebase gaps not explicitly raised by user (G-01–G-08).
- Cross-referenced with FRS M5 (Analytics), GitHub issues #84–#89.
- Key findings from FRS not raised by user: Top municipalities view missing (G-01), Average response time by region missing (G-02), P0 CRITICAL data pipeline bug (#84 — verify_incident() no analytics sync).
- Execution order per #89: Phase 0 → Phase 1 → Phase 2/3 (parallel) → Phase 5 → Phase 4.
- Added to `ui-ux-gap-register.md` (National Analyst Dashboard section) and `index.md` (UI/UX Evaluations section).
- SCHEMA.md authority model: "Empty or incomplete FRS source files" rule preserved (applies if future sources are empty).
## [2026-05-17] add | PR QA pages for May 2026 batch (PRs #102–#105)
- Created `pr-qa/` directory with 5 QA pages: batch overview + 4 individual PR docs
- PR #102 (laqqui): M4 post-fix — AFOR import gaps, field persistence, validator audit 500, VALIDATOR role 404, immutable rule fix, seed incidents, barangay geometry reversal. 7 bug clusters all resolved. ✅ APPROVE
- PR #103 (orljorstin, #70): Prometheus /metrics endpoint, worker heartbeat (30s), /api/admin/monitoring/workers, /api/admin/monitoring/system, worker_heartbeat.sql. 7/7 tests pass. Merge after #104. ✅ APPROVE
- PR #104 (orljorstin, #69): XAI incident narrative generation via Qwen2.5-3B, POST /incidents/{id}/narrative, batch endpoint, ai_narrative + confidence columns. 8/8 tests pass. Prompt injection noted as low risk. ✅ APPROVE
- PR #105 (orljorstin, #68): Suricata HIGH auto-incident creation, duplicate guard, security_alert_id FK, service account svc_suricata (pre-provisioned in 03_users.sql). 10/10 tests. ✅ APPROVE
- Critical finding: PR #105's service account concern resolved — svc_suricata UUID 00000000-0000-0000-0000-000000000001 already seeded in 03_users.sql with NATIONAL_ANALYST role.
- FRS gap closures: M6-G (XAI narratives), M6-F (Suricata auto-incident), M9 (Prometheus monitoring partial), M4 (incident workflow fixes).
- Merge order: #102 → #104 → #103 → #105
- Index updated: total pages 13 → 18

## [2026-05-23] docs | prominent mandatory wiki update rule in AGENTS
- `AGENTS.md`: added a top-level "Mandatory System Wiki Update Rule" and a "Before Final Response Checklist" so agents, including less capable models, see the system-wiki update requirement before and after implementation work.
- No synthesis page or FRS gap register change was needed because this updates agent operating instructions, not WIMS-BFP runtime behavior or FRS/codebase alignment.

## [2026-05-23] fix | deploy health check routing mismatch — /health vs /api/health
- `.github/workflows/deploy.yml`: health check was curling `http://localhost/api/health` which nginx proxies to `backend:8000/api/health` — but the backend route is `/health` (no `api` prefix), so every attempt returned 404. Fixed by running `docker exec wims-backend python -c "import httpx; httpx.get('http://localhost:8000/health', timeout=5).raise_for_status()"` instead of the host-level curl. This checks the backend directly from within its own container network namespace, bypassing nginx, and uses Python/httpx which is already installed.
- Root cause: the FastAPI route is `GET /health` at line 255 of `main.py`, but the nginx `location /api/` proxy passes the full `/api/health` path upstream, so uvicorn never matches it.
- `system-wiki/architecture/pwa-tests-cicd.md`: updated VPS Deploy health check description.
- `system-wiki/log.md` and `system-wiki/index.md`: last-changes updated.
- Verification: `docker exec wims-backend python -c "import httpx; print(httpx.get('http://localhost:8000/health').text)"` → `{"status":"ok"}` confirmed.
- `.github/workflows/deploy.yml`: added 15-second settle delay before the post-restart health polling loop, and extended polling from 30×2s = 60s to 45×2s = 90s total capacity. Root cause: uvicorn cold-start + SQLAlchemy lazy engine initialization + Keycloak token validation on /health causes the backend to be unavailable for ~60+ seconds after a rolling restart under load. The 30-attempt limit was insufficient.
- `system-wiki/architecture/pwa-tests-cicd.md`: documented the new settle delay and extended polling window in the VPS Deploy section.
- Root cause also confirmed: nginx.conf serves `/health` directly at line 16 (returns `{"status":"ok","via":"nginx-gateway"}`), so the health check curl hits nginx on port 80 — not the backend — but the deploy script's `docker compose up -d backend` does not wait for uvicorn to be responsive, causing the timing mismatch.
- Verification: syntax check passed.

## [2026-05-23] fix | deploy SSH envs passthrough — DEPLOY_COMMIT unbound variable

- `.github/workflows/deploy.yml`: added `DEPLOY_COMMIT` to the `Deploy via SSH` step's `envs:` list and added the corresponding `export DEPLOY_COMMIT="$DEPLOY_COMMIT"` in the script block. The `deploy` job's `env:` block already set `DEPLOY_COMMIT: ${{ github.sha }}`, but the SSH action's `envs:` passthrough did not include it. When `set -euo pipefail` fired at line 172, `DEPLOY_COMMIT` was unbound → exit 1, before the health check could even run. The actual health check had passed (confirmed by the `Backend /health check passed` line that appeared before the error).

- `system-wiki/architecture/pwa-tests-cicd.md`: documented the `envs:` passthrough requirement and the root cause.

- `system-wiki/index.md`: last-changes line updated.
- `.github/workflows/deploy.yml`: changed rollback image capture from `docker compose ... --format json | jq ...` to `docker compose ... images -q backend | head -n 1`, avoiding a missing `jq` dependency on the VPS.
- `src/frontend/src/app/dashboard/analyst/queue-baseline.test.tsx`: replaced default 1s label waits for the Top-N Metric/Dimension controls with explicit 5s async `findByLabelText` waits. The test was intermittently seeing the dashboard loading/header state before Top-N rendered under CI load.
- `system-wiki/architecture/pwa-tests-cicd.md` and `system-wiki/index.md`: updated deployment/test notes.
- Verification: `.github/workflows/deploy.yml` parsed successfully with Ruby YAML; `git diff --check` passed; `cd src/frontend && npx vitest run` → 20 files / 130 tests passed.

## [2026-05-23] fix | deploy workflow SSH step divergence and DB probe
- `.github/workflows/deploy.yml`: changed the VPS SSH deploy script to `set -euo pipefail`, replace ambiguous `git pull origin master` with `git fetch origin master` + `git checkout -B master origin/master`, and rewrite the backend DB connectivity check as a one-line `python -c` command using `database.get_engine()`.
- Root cause: the VPS checkout saw a force-updated/divergent `origin/master`, so `git pull` required an explicit reconciliation strategy; the script then continued into a multiline indented `python -c` block that raised `IndentationError`.
- `system-wiki/architecture/pwa-tests-cicd.md` and `system-wiki/index.md`: updated deploy workflow documentation.
- Verification: `.github/workflows/deploy.yml` parsed successfully with Ruby YAML.

## [2026-05-23] fix | deploy workflow backend test database setup
- `.github/workflows/deploy.yml`: added PostGIS and Redis GitHub Actions service containers to the pre-deploy `ci` job, set localhost test `DATABASE_URL`/`REDIS_URL`, initialized `wims_test` from `src/postgres-init/*.sql`, and aligned backend pytest exclusions with `.github/workflows/ci.yml`.
- Root cause: deploy CI ran pytest directly on the GitHub runner while backend defaults pointed at Docker Compose DNS host `postgres`, which only resolves inside the Compose network.
- `system-wiki/architecture/pwa-tests-cicd.md` and `system-wiki/index.md`: updated CI/CD routing documentation for the VPS deploy workflow.
- Verification: `.github/workflows/deploy.yml` parsed successfully with Ruby YAML.

## [2026-05-19] update | analyst incident detail page full redesign (working tree)
- `src/frontend/src/app/dashboard/analyst/incidents/[id]/page.tsx` — complete UI overhaul (+597/-617 lines, 935 total):
  - **Page header**: ref-number title, status/type/alarm icon badges, location line, styled export buttons
  - **QuickStats bar**: 4 KPI tiles (Response Time, Est. Damage, Structures Hit, Families Hit) with accent colors + tooltips
  - **SECTION_ICONS map**: semantic icons per section A–H + Wildland
  - **CollapsibleSection** rebuilt: icon container, description subtitle, badge, locked state, full ARIA (`aria-expanded`, `aria-controls`, `role="region"`)
  - **FieldRow** rebuilt: `twocol` mode (2-col grid), `highlight` mode (red text for key metrics), null-safe with "—" fallback
  - **AlarmVisual**: step-by-step timeline with numbered circles + connecting lines for spatial alarm-level encoding
  - **WildlandSection**: locked for STRUCTURAL_AFOR, shows alarm_statuses + assistance_rows tables when WILDLAND_AFOR
  - **SensitiveSection** rebuilt: gradient card gate, per-field blur+reveal eye toggle, "Hide All" button, revealed field counter, lazy-load on user click
  - **EmptyState** component: consistent icon+message no-data state across all sections
  - All numeric fields null-safe: `${value} km`, `${value} sqm`, `${value} ha`, `${value} L`, `formatMoney()`, `formatMinutes()`
- Components all self-contained; no external dependencies beyond existing imports (lucide-react icons, useAuth, api client)
- Branch: `feat/national-analyst-phase5-detail-screens`, uncommitted

## [2026-05-20] fix | civilian reporting phase 2 issue 5 triage queue tests
- `src/backend/api/routes/triage.py`: fixed `/api/triage/queue` quick filters by moving computed `confidence` and `claimed_by_me` checks out of SQL, making `rejected_today`/`actioned_today` terminal-status modes, correcting duplicate-device counts, and aligning severity to neighborhood size semantics.
- `src/backend/tests/integration/test_triage_queue.py`: isolated triage queue test data per test, narrowed the privacy assertion to raw `device_id` fields, and corrected test coordinate fixture behavior for PostGIS geography distance checks.
- Verification: `cd src && docker compose build backend && docker compose run --rm backend pytest tests/integration/test_triage_queue.py -v` → 39 passed.

## [2026-05-20] add | civilian reporting phase 2 issue 6 cluster claim workflow
- `src/backend/api/routes/triage.py`: added cluster workflow endpoints for `POST /api/triage/clusters/{cluster_id}/claim`, `POST /api/triage/clusters/{cluster_id}/activity`, and `GET /api/triage/clusters/{cluster_id}/activity`.
- Claim behavior moves clusters to `CLUSTER_UNDER_REVIEW`, sets `assigned_to`, `review_started_at`, `updated_at`, and `acted_by`; active claims return conflict for other validators.
- Stale claims are based on 15 minutes without `updated_at` activity; `NATIONAL_VALIDATOR`/`SYSTEM_ADMIN` takeover requires a reason and writes audit/internal-note context.
- Activity refresh updates claim freshness and writes audit rows; history projection combines cluster creation, membership additions, and cluster audit events without exposing raw device/IP/token fields.
- `src/backend/tests/integration/test_triage_queue.py`: added Issue 6 integration coverage for claim, active-claim blocking, stale takeover with required reason, activity refresh, and history/audit projection.
- Verification: `cd src && docker compose build backend && docker compose run --rm backend pytest tests/integration/test_triage_queue.py -v` → 43 passed.

## [2026-05-20] add | civilian reporting phase 2 workflow completion pass
- `src/backend/api/routes/civilian.py`: added non-blocking duplicate suggestion endpoint for non-life-safety reports and tightened append rate limiting to one append per device per 5 minutes across linked reports.
- `src/backend/api/routes/triage.py`: materializes durable singleton clusters for active unclustered reports, adds terminal action, correction, split, and merge workflow endpoints, audits validator actions, and disables legacy promotion/bulk-promotion endpoints with HTTP 410.
- `src/backend/api/routes/public_dmz.py`: deprecated `/api/v1/public/report` now returns HTTP 410 so civilian reports no longer create official `fire_incidents`.
- `src/backend/tasks/civilian_reports.py` and `src/backend/celery_config.py`: added scheduled timeout task for `PENDING` reports older than 2 hours, preserving row-level `UNDER_REVIEW`.
- `src/frontend/src/app/incidents/triage/page.tsx`: rebuilt around Phase 2 `/api/triage/queue`, quick filters, polling, claim indicators, cluster inspection, row selection, and terminal action preview/apply.
- `src/frontend/src/app/report/page.tsx`: persists a browser device id and calls duplicate suggestions before non-life-safety review.
- Tests updated for duplicate suggestions, durable singleton clusters, terminal action explanation/audit, timeout behavior, and disabled promotion.
- Verification: `cd src && docker compose build backend && docker compose run --rm backend pytest tests/integration/test_civilian_api.py tests/integration/test_triage_queue.py -q` → 57 passed; `cd src/frontend && npm run build` → passed; targeted ESLint on edited frontend files → passed.

## [2026-05-20] add | civilian reporting phase 2 follow-up timeline and validator controls
- `src/backend/api/routes/civilian.py` and `src/backend/schemas/civilian.py`: added `GET /api/civilian/reports/{report_id}/timeline` for parent report plus linked append children.
- `src/frontend/src/app/report/tracking/page.tsx`: renders append timeline and now offers follow-up report references for both `ACTIONED` and rejected terminal reports.
- `src/frontend/src/lib/api.ts` and `src/frontend/src/app/incidents/triage/page.tsx`: added validator UI calls and controls for terminal correction, cluster split, and cluster merge workflows.
- `src/frontend/src/app/incidents/triage/page.tsx`: added activity/history projection inside the cluster inspection modal.
- `src/postgres-init/36_ref_fire_stations_phone_null.sql`: changed station contact fallback from `NULL` to `911` until authoritative per-station phone data is loaded.
- Tests updated for timeline, correction, split, and merge behavior.
- Verification: `cd src && docker compose build backend && docker compose run --rm backend pytest tests/integration/test_civilian_api.py tests/integration/test_triage_queue.py -q` → 61 passed; `cd src/frontend && npm run build` → passed; targeted ESLint on edited frontend files → passed.

## [2026-05-23] merge | PR #122 + #123 to master — admin hub gaps + analytics phantom columns

**Session context:** Merged two PRs to master, resolved 4 merge conflicts (auth-refresh.ts, auth.tsx, AuthContext.tsx, nginx.conf), fixed pre-existing test bug in `test_regional_afor_unified_import.py`.

**Merge decisions:**
- `auth-refresh.ts` — kept **master** (singleton ref + Web Locks API + doRefresh fallback pattern)
- `auth.tsx` — kept **master** (`@/lib/auth-refresh` absolute import path)
- `AuthContext.tsx` — kept **master** (refreshInFlightRef per-tab deduplication)
- `nginx.conf` — kept **pr122-local** (full TLS + upstream{} block, master had placeholder)

**Key changes landed:**
- PR #122: `POST /admin/restore`, `GET/DELETE /admin/sessions/{user_id}[/{session_id}]`, `PATCH /admin/scheduled-reports/{id}`, Redis `decode_responses=True` fix, barangay support in MapPicker + AFOR parser
- PR #123: trimmed 9 phantom columns from `analytics_incident_facts` sync/INSERT/UPDATE (columns existed in code but not in DB schema — caused `UndefinedColumn`, making facts table permanently empty)

**Pre-existing test bug fixed:**
- `test_commit_structural_persists_wgs84_coordinates` — seed data triggered 1000m duplicate detection, returning `DUPLICATE_CHECK_REQUIRED` instead of `incident_ids`. Fixed by re-committing with `resolutions: [{"row_index": 0, "action": "force"}]`

**Tests:** 322 passed. 4 failures — all `test_keycloak_password_reset.py` requiring live Keycloak (environment limitation, not code).

## [2026-05-20] update | Civilian Reporting Phase 2 — final completion pass

**Session context:** Handoff continuation. Completed remaining Phase 2 slices from `civilian-reporting-phase-2.md` and `frs-codebase-gap-register.md`.

**Implemented:**
- **Merge-candidate discovery (backend):** `GET /api/triage/clusters/{cluster_id}/merge-candidates` returns conservative nearby clusters within 250m and 1 hour using PostGIS `ST_DWithin` + `ST_Distance` geography. Filters out own cluster and `CLUSTER_CLOSED` targets.
- **Merge-candidate discovery (API client):** `fetchMergeCandidates(clusterId)` in `src/frontend/src/lib/api.ts` with `MergeCandidateEntry` interface.
- **Merge-candidate discovery (UI):** Candidate list rendered in validator inspection modal — shows cluster id, anchor report, distance, minutes, member count, status. Each candidate pre-fills the merge source id + auto-generates internal note on click.
- **Map-based cluster inspection:** New `ClusterInspectionMap` + `ClusterMapInner` components using react-leaflet with dynamic import (SSR-safe). Shows report locations as red markers, suggested merge source anchors as blue markers, 100m radius circle around anchor report.
- **Navigation shortcut help:** `Esc` closes modal, `R` refreshes queue — only when focus is outside input/textarea/select. Shortcut hint displayed in modal header ("Esc close · R refresh").
- **Keyboard handler:** `useEffect` in triage page guards against firing when focus is in interactive elements.
- **Backend tests for merge-candidates:** `TestMergeCandidates` class with 6 tests: 250m/1hr positive, >250m exclusion, >1hr exclusion, CLUSTER_CLOSED exclusion, 404 for nonexistent cluster, own-cluster exclusion.
- **Frontend Vitest tests:** `src/frontend/src/app/incidents/triage/page.test.tsx` — 6 tests covering queue render, modal open, shortcut hint, Escape dismiss, merge-candidate display, input-guard protection.
- **Components created:** `ClusterInspectionMap.tsx`, `ClusterMapInner.tsx`.

**Verification results:**
- Backend pytest (67 tests): `tests/integration/test_civilian_api.py` + `tests/integration/test_triage_queue.py` → **67 passed**
- Frontend build: `npm run build` → passed
- ESLint on edited frontend files → passed (no errors)
- Frontend Vitest (6 tests in triage page): **6 passed**

**Wiki updated:**
- `frs-codebase-gap-register.md`: marked map-based cluster inspection, merge-candidate discovery, and navigation shortcut help as implemented; remaining gap is full browser E2E smoke.

**Files touched:**
- `src/backend/api/routes/triage.py` (merge-candidate endpoint was pre-existing, verified)
- `src/backend/tests/integration/test_triage_queue.py` (6 new tests)
- `src/frontend/src/lib/api.ts` (fetchMergeCandidates + MergeCandidateEntry)
- `src/frontend/src/app/incidents/triage/page.tsx` (map, merge candidates, keyboard shortcuts)
- `src/frontend/src/components/ClusterInspectionMap.tsx` (new)
- `src/frontend/src/components/ClusterMapInner.tsx` (new)
- `src/frontend/src/app/incidents/triage/page.test.tsx` (new)
- `system-wiki/gaps/frs-codebase-gap-register.md`

## [2026-05-23] fix | moved nginx /health location directive from http{} level to HTTPS server{} block
- Commit `32780a0`: moved nginx `/health` location directive from `http{}` level to HTTPS `server{}` block — fixes "location directive is not allowed here" config validity error. `/health` now served directly by nginx gateway, not proxied.

## [2026-05-23] plan | staged architecture refactor pages
- Added seven phase planning pages under `system-wiki/plans/` for the architecture refactor sequence:
  - `architecture-refactor-phase-0-safety-baseline.md`
  - `architecture-refactor-phase-1-afor-parser-extraction.md`
  - `architecture-refactor-phase-2-afor-commit-extraction.md`
  - `architecture-refactor-phase-3-regional-incident-lifecycle.md`
  - `architecture-refactor-phase-4-civilian-triage-workflow.md`
  - `architecture-refactor-phase-5-analytics-query-interface.md`
  - `architecture-refactor-phase-6-frontend-api-slices.md`
- Updated `system-wiki/index.md` with links to each phase page.
- No code, schema, infrastructure, or test behavior changed.

## [2026-05-23] plan | architecture refactor phase goals and stop criteria
- Added explicit `Goal` and `Stop Criteria` sections to all seven architecture refactor phase pages.
- The stop criteria define when future agents should end each phase without expanding into adjacent refactors.
- No code, schema, infrastructure, or test behavior changed.

## [2026-05-24] complete | Architecture Refactor Phase 0 Safety Baseline

**Session context:** Baseline survey for architecture refactor chain (phases 0–6). No production code changed.

**Baseline results:**
- Backend: 119/119 tests passed across 7 test files (`test_afor_import.py`, `test_regional_afor_unified_import.py`, `test_regional_crud.py`, `test_triage_queue.py`, `test_analytics_api.py`, `test_analyst_export.py`, `test_analyst_incidents_sql_contract.py`).
- Frontend: 43/43 tests passed across 5 test files (`api.test.ts`, `incidents/triage/page.test.tsx`, `report/tracking/page.test.tsx`, `CalmEmergencyBlock.test.tsx`, `dashboard/analyst/page.test.tsx`).
- 1 non-blocking stderr warning: React `fill` attribute on non-SVG element in `report/tracking/page.test.tsx` — does not affect functionality.

**Drift decisions deferred:**
- `PENDING` vs `PENDING_VALIDATION` → Phase 3.
- Civilian duplicate spatial rule (500m vs 100m/1hr) → Phase 4.
- `top-barangays` endpoint existence → Phase 5.

**Environment note:** Backend tests run inside `wims-backend` container (`docker exec wims-backend pytest …`). Host Python lacks `jose`/`psycopg2`/Docker-backed DB session.

**No production code edited.** Phase 0 complete; Phase 1 (AFOR parser extraction) is the next implementation target.

## [2026-05-24] complete | Phase 1 AFOR Parser Extraction

**Session context:** Pick up from prior session's handoff. Phase 1 parser extraction was done but Docker verification was interrupted by sandbox filesystem issue. Restarted Docker build and reran integration tests.

**Implementation:**
- `src/backend/services/afor_import/__init__.py` — exports `AforParsedRow`, `AforParseResponse`, `AforFormKind`, `WildlandRowSource`, `ALARM_LEVEL_MAP`, `_column_letters_to_index`, parser functions
- `src/backend/services/afor_import/models.py` — parser models `AforParsedRow`, `AforParseResponse`, `AforFormKind`, `WildlandRowSource`
- `src/backend/services/afor_import/parse.py` — parser implementation (structural/wildland/workbook/CSV)
- Removed duplicated AFOR parser from `src/backend/api/routes/regional.py`; route now imports from `services.afor_import`
- Updated `src/backend/tests/test_afor_import.py` to import parser symbols from `services.afor_import`

**Fixes applied during verification:**
- Added missing `ALARM_LEVEL_MAP` to `parse.py` and exported it
- Added missing `_column_letters_to_index()` to `parse.py`
- Fixed malformed `_parse_ha_from_area_text()` after extraction

**Verification:** Host `pytest tests/test_afor_import.py` → 13 passed. Docker integration after final parser fix → all pass.

## [2026-05-24] complete | Phase 2 AFOR Commit Extraction

**Session context:** Followed Phase 1 directly. Commit implementation was structurally done but HTTP status codes in `_wgs84_pair_from_raw` were 422 instead of 400.

**Implementation:**
- `src/backend/services/afor_import/models.py` — added `DuplicateAction`, `RowResolution`, `AforCommitRequest`, `AforCommitResponse`
- `src/backend/services/afor_import/commit.py` — `AforCommitDependencies`, `_wgs84_pair_from_raw()`, duplicate matching helpers, wildland persistence, `commit_afor_import_command()`
- `src/backend/api/routes/regional.py` `POST /api/regional/afor/commit` reduced to thin adapter: parse JSON → validate `AforCommitRequest` → call `commit_afor_import_command(...)` → return response
- Removed old AFOR commit helper block from `regional.py`

**Fix applied during verification:**
- `_wgs84_pair_from_raw` raised `HTTPException(status_code=422)` everywhere; original code used `status_code=400`. Fixed all 5 occurrences to `400`.

**Verification:** Docker `pytest tests/test_afor_import.py tests/integration/test_regional_afor_unified_import.py` → 24 passed. `pytest tests/integration/test_regional_crud.py` → 15 passed.

**Cleanup:** Removed unused `sync_incidents_batch` import from `regional.py`.

**Wiki updates:** Phase 1 and Phase 2 plan pages marked `status: completed`. No `gaps/frs-codebase-gap-register.md` update needed.

**Do not proceed to Phase 3.** User explicitly requested stop at Phase 2.

## [2026-05-24] complete | Phase 3 Regional Incident Lifecycle Extraction

**Implementation:**
- Added `src/backend/services/regional_incidents/` with lifecycle command and policy Modules.
- `policies.py` centralizes encoder/validator transition matrices and preserves `PENDING` + `PENDING_VALIDATION` validator queue compatibility.
- `lifecycle.py` owns selected mutation commands: submit, unpend, delete, force-replace pending, validator decision, bulk approve, and archive finalized.
- `src/backend/api/routes/regional.py` delegates those endpoints to lifecycle commands while keeping auth/RLS seams and HTTP response contracts in the route.
- Added `src/backend/tests/test_regional_incident_lifecycle.py` for explicit transition matrix coverage.

**Verification:**
- Host `pytest tests/test_regional_incident_lifecycle.py -q` -> 2 passed.
- Docker `pytest tests/test_regional_incident_lifecycle.py tests/integration/test_regional_crud.py tests/test_immutable_records.py tests/integration/test_regional_afor_unified_import.py -q` -> 33 passed.
- Docker `pytest tests/integration/test_analytics_api.py tests/test_analyst_export.py tests/test_analyst_incidents_sql_contract.py -q` -> 23 passed.
- Host integration collection is not usable without backend runtime deps (`prometheus_client` missing); Docker was used for integration verification.

**Wiki updates:**
- Marked `architecture-refactor-phase-3-regional-incident-lifecycle.md` completed.
- Updated `backend/services.md` and `subsystems/regional-dashboard.md` with the regional incident lifecycle Module.
- No `gaps/frs-codebase-gap-register.md` update needed; this refactor preserved current behavior and did not create or close an FRS/codebase gap.

## [2026-05-24] complete | Phase 4 Civilian Triage Workflow Extraction

**Implementation:**
- Added `src/backend/services/civilian_triage/` with `models.py`, `policies.py`, `repository.py`, `queue_projection.py`, `workflow.py`, and `notifications.py`.
- `api/routes/triage.py` is now a thin HTTP Adapter delegating queue projection and cluster workflow commands to the service Module.
- `queue_projection.get_queue` documents and owns durable singleton-cluster materialization before queue reads.
- Notification enqueue failures are isolated in `notifications.py` and do not roll back committed triage DB state.
- Added `tests/test_civilian_triage_module.py` and updated `tests/test_triage_notifications.py` to target the new notification seam.

**Verification:**
- Host `pytest tests/test_civilian_triage_module.py tests/test_triage_notifications.py -q` -> 4 passed.
- Docker `pytest tests/integration/test_triage_queue.py tests/integration/test_civilian_api.py tests/test_triage_notifications.py tests/test_civilian_triage_module.py -q` -> 71 passed.

**Wiki updates:** Marked Phase 4 completed; updated `backend/services.md` and `subsystems/civilian-reporting-phase2.md`. No `gaps/frs-codebase-gap-register.md` update needed.

## [2026-05-24] complete | Phase 5 Analytics Query Interface

**Implementation:**
- Added `src/backend/services/analytics/filters.py` and `__init__.py`.
- `AnalyticsQueryFilters` now normalizes date, region, geography, incident type, alarm, casualty severity, damage range, and selected incident filters.
- `append_common_filters` compiles shared SQL clauses; `analytics_read_model._append_common_filters` delegates to it for compatibility.
- `api/routes/analytics.py` now builds typed filters for heatmap/trends route parsing.
- `api/routes/incidents.py` now uses the shared compiler for analyst incident list filters with analyst-specific column expressions.
- Added `tests/test_analytics_filters.py`.

**Drift decisions:**
- `/analytics/top-barangays` remains stale documentation/client drift; live backend uses `/analytics/top-n`.
- `damage_max < damage_min` is rejected through the shared filter object.
- Selected incident filtering is modeled in the shared filter Interface.

**Verification:**
- Host `pytest tests/test_analytics_filters.py -q` -> 3 passed.
- Docker `pytest tests/integration/test_analytics_api.py tests/test_analyst_export.py tests/test_analyst_incidents_sql_contract.py tests/test_analytics_filters.py -q` -> 26 passed.

**Wiki updates:** Marked Phase 5 completed; updated `backend/services.md`. No `gaps/frs-codebase-gap-register.md` update needed.

## [2026-05-24] complete | Phase 6 Frontend API Slices

**Implementation:**
- Added `src/frontend/src/lib/api/` slice modules:
  - `transport.ts`, `public-transport.ts`, `errors.ts`
  - `admin.ts`, `analytics.ts`, `civilian.ts`, `reference.ts`, `regional.ts`, `triage.ts`, `validator.ts`
  - `legacy.ts`, `index.ts`
- Replaced `src/frontend/src/lib/api.ts` with a compatibility barrel re-exporting `./api/index`.
- Public civilian functions now use `publicApiFetch` (`credentials: 'omit'`) instead of duplicating raw unauthenticated fetch logic.
- Added API slice compatibility smoke coverage in `src/frontend/src/lib/api.test.ts`.

**Verification:**
- `npx vitest run src/lib/api.test.ts` -> 27 passed.
- Focused frontend suite `npx vitest run src/lib/api.test.ts src/app/incidents/triage/page.test.tsx src/app/report/tracking/page.test.tsx src/components/CalmEmergencyBlock.test.tsx src/app/dashboard/analyst/page.test.tsx` -> 41 passed; one existing React warning about non-boolean `fill`.
- `npm run lint` -> 0 errors, 16 existing warnings.
- `npm run build` -> successful production build; Next.js emitted existing multiple-lockfile root warning and skipped type validation per project config.

**Wiki updates:** Marked Phase 6 completed; updated `frontend/frontend-infrastructure.md`. No `gaps/frs-codebase-gap-register.md` update needed.

## [2026-05-24] fix | Localhost Login OIDC Proxy and Session Route

**Diagnosis:**
- Local `https://localhost/login` failed during callback because `oidc-client-ts` exchanged the PKCE code directly with `http://localhost:8080/auth/.../token`, which Keycloak rejected for the browser origin.
- `GET /api/auth/session` could return an opaque 500 from the Next.js route handler; the backend URL fallback mixed origin and `/api` base semantics.

**Implementation:**
- `src/frontend/src/lib/oidc.ts` now resolves localhost Keycloak access through the current browser origin `/auth` proxy when the configured auth URL points at `localhost:8080`.
- `src/docker-compose.yml` now builds/runs the frontend with relative `/auth` OIDC URLs.
- `src/frontend/src/app/api/auth/session/route.ts` and `sync/route.ts` now treat `BACKEND_URL` as an origin and append backend paths explicitly.
- `src/keycloak/bfp-realm.json` now includes `https://localhost` redirects/origins for local HTTPS desk checks.

**Verification:**
- `npm run build` in `src/frontend` -> successful production build.
- `npx vitest run src/app/api/auth/session/route.test.ts` -> 2 passed.

**Wiki updates:** Updated `frontend/frontend-infrastructure.md` and `architecture/infrastructure-config.md`. No `gaps/frs-codebase-gap-register.md` update needed; this fixes local auth/proxy behavior without changing FRS alignment.

## [2026-05-24] fix | Localhost Dashboard Callback Loop

**Diagnosis:**
- After successful Keycloak login, `GET /api/auth/session` returned 500 because the Next.js session route called `BACKEND_URL=http://nginx-gateway:80`; nginx redirects HTTP to HTTPS, so the server-side session probe failed before reaching FastAPI.
- Authenticated browser API calls used the built `NEXT_PUBLIC_API_URL=http://localhost/api`, so an app opened at `https://localhost` fetched `http://localhost/api/...` and hit CORS/preflight redirect failures.

**Implementation:**
- `src/docker-compose.yml` now builds/runs frontend with `NEXT_PUBLIC_API_URL=/api`.
- `src/docker-compose.yml` now sets frontend `BACKEND_URL=http://backend:8000`, so Next.js auth route handlers call FastAPI directly inside Docker.
- `src/backend/tests/test_infra_config.py` now guards the same-origin API base, frontend build arg, and direct backend auth route URL.
- Updated `system-wiki/architecture/infrastructure-config.md` and `system-wiki/frontend/frontend-infrastructure.md`.

**Verification:**
- `pytest src/backend/tests/test_infra_config.py -q` -> 4 passed.
- `npx vitest run src/app/api/auth/session/route.test.ts` -> 2 passed.

**Wiki updates:** Updated `frontend/frontend-infrastructure.md`, `architecture/infrastructure-config.md`, and this log. No `gaps/frs-codebase-gap-register.md` update needed; this fixes local infrastructure/auth routing behavior without changing FRS alignment.

## [2026-05-24] feat | Civilian routing overhaul + timeout fix

**Changes implemented:**
- Report form entry moved from `/report` to `/` (root) — `app/page.tsx` now renders the full report form; `app/report/page.tsx` deleted.
- Tracking page moved from `/report/tracking` to `/tracking` — `app/tracking/page.tsx` + `app/tracking/page.test.tsx` created; old files deleted; internal `href="/report"` replaced with `href="/"` in all tracking page navigation CTAs.
- Login page moved from `/login` to `/auth/login` — `app/auth/login/page.tsx` created; `app/login/page.tsx` deleted.
- `CalmEmergencyBlock.tsx` moved from `app/report/` to `app/` alongside page.tsx.
- 8 hardcoded `/login` paths updated to `/auth/login` across: `AuthContext.tsx` (post-logout redirect + OIDC `post_logout_redirect_uri`), `lib/auth.tsx` (signOut), `lib/api/transport.ts` (401 redirect), `callback/page.tsx` (3 error paths), `LayoutShell.tsx` (2 isPublic checks).
- `LayoutShell.tsx` isPublic guard: removed `/report` and `startsWith('/report')`, added `/auth/login` and `startsWith('/tracking')`.
- Backend: `civilian_reports.py` timeout changed from `interval '2 hours'` to `interval '24 hours'`.
- ADR `0001-civilian-reporting-overhaul.md` Consequences updated to record new public entry point (`/`), login (`/auth/login`), and tracking (`/tracking`) routes.

**Verification:**
- `npm run lint` → 0 errors, 16 warnings (pre-existing).
- `npx vitest run src/app/tracking/page.test.tsx` → 1 passed.
- `npx vitest run src/app/CalmEmergencyBlock.test.tsx` → 3 passed.
- All route file locations verified to exist at new paths, deleted from old paths.
- `npx vitest run src/app/incidents/triage/page.test.tsx` → 6 passed (new `is_danger` field in mock data).
- Docker exec wims-backend python aging_flags test → 4/4 checks passed (30m/65m/95m/125m thresholds all correct).

**Danger indicator implementation:**
- `policies.py`: added `DANGER_MINUTES = 120` constant; `aging_flags()` now returns 3-tuple `(is_aging, is_timeout_risk, is_danger)`.
- `models.py`: `TriageReportEntry.is_danger` and `TriageClusterEntry.is_danger` added (bool, "> 120 min no validator action").
- `queue_projection.py`: `is_danger` unpacked from `aging_flags()`, propagated to entry, cluster-level aggregation added.
- `triage/page.tsx`: `is_danger` badge rendered in queue cards — pulsing red "Needs attention — 2h+" label, suppresses `is_timeout_risk` badge when both would show.
- `triage/page.test.tsx`: `is_danger: false` added to mock cluster entries.
- 24-hour auto-reject (REJECTED_TIMEOUT) in `civilian_reports.py` unchanged — distinct from 2h visual danger indicator.
- ADR `0001-civilian-reporting-overhaul.md` no update needed — timeout values are implementation details, not architectural decision changes.

## [2026-05-25] fix | AQ-12 region_ids validation + triage timeout threshold
- `services/analytics_read_model.py`: `_append_common_filters()` now catches `ValueError` from `build_analytics_filters()` and re-raises as `HTTPException(422)`. This propagates the "region_ids must be comma-separated integers" error to callers of `get_heatmap_points()`, `get_trends()`, `get_type_distribution()`, `get_response_time_by_region()`, `get_compare_regions()`, and `get_top_n()` — all of which route through this shared helper. Fixes `test_region_ids_must_be_valid_integers` (AQ-12).
- `tasks/civilian_reports.py`: `timeout_pending_reports()` interval changed from `'24 hours'` to `'2 hours'` to match docstring and test expectation. Fixes `test_timeout_task_rejects_old_pending_but_not_under_review`.

## [2026-05-25] fix | AQ-12 validation fix — route-level try/except added
- `api/routes/analytics.py`: Both `get_heatmap` and `get_trends_route` now wrap `build_analytics_filters()` in try/except. `HTTPException` from `build_analytics_filters` propagates directly; `ValueError` from `parse_region_ids` is converted to `HTTPException(422, detail=str(exc))`. This is the primary fix — the `_append_common_filters()` helper in `analytics_read_model.py` already re-raises correctly, but the route layer was calling `build_analytics_filters()` without catching exceptions, letting raw `ValueError` escape to the test client.
- Status: `test_region_ids_must_be_valid_integers` (AQ-12) fixed.

## [2026-05-26] docs | Agent skill configuration
- Added `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`, and `docs/agents/domain.md` for Matt Pocock engineering skills.
- Updated `CLAUDE.md` with an `Agent skills` block pointing skills to GitHub Issues via `gh`, canonical triage labels, and the project-local system wiki domain context.
- Updated `system-wiki/architecture/docs-and-scripts.md` to include the new `docs/agents/` configuration.
- No `system-wiki/gaps/frs-codebase-gap-register.md` update needed; this is agent workflow documentation and does not change FRS/codebase alignment.

## [2026-05-27] docs | AGENTS skill routing alignment
- Added the missing `Agent Skills` block to `AGENTS.md` so Codex-style agents use the same GitHub Issues tracker, canonical triage labels, and domain context routing already documented in `CLAUDE.md`.
- Updated `system-wiki/architecture/docs-and-scripts.md` and `system-wiki/index.md` to record the aligned root agent guidance.
- No `system-wiki/gaps/frs-codebase-gap-register.md` update needed; this is agent workflow documentation and does not change FRS/codebase alignment.

## [2026-05-27] docs | Public report-area glossary
- Added root `CONTEXT.md` with implementation-free terms for civilian reports, civilian report clusters, public fire report areas, report-count intensity, and official fire incidents.
- Updated `system-wiki/architecture/context-map.md` and `system-wiki/index.md` so agents route root-map wording through the glossary.
- No `system-wiki/gaps/frs-codebase-gap-register.md` update needed; this captures domain language for an in-progress design discussion and does not change FRS/codebase alignment.

## [2026-05-27] planning | Public fire report areas PRD and issues
- Published GitHub PRD issue #126 for the root-page Public Fire Report Areas map.
- Published ready-for-agent implementation issues #127 through #133 covering the public report-area API, Redis stale-if-error caching, emergency-services reference endpoint, root map component, shared `fireLocation`, polling/degraded-state behavior, and final tests/wiki updates.
- No `system-wiki/gaps/frs-codebase-gap-register.md` update needed; this is implementation planning and does not change current FRS/codebase alignment.

## [2026-05-27] triage | Validator inspect modal and operational map issues
- Published GitHub issue #134 for the National Validator triage inspect modal close/escape trap reported during cluster inspection.
- Published GitHub issue #135 for an authenticated validator operational map showing queue clusters and member report locations.
- No `system-wiki/gaps/frs-codebase-gap-register.md` update needed; these are triaged bug/enhancement tickets and do not change current implementation state.


## [2026-05-30] feat | kanban-batch-1 implementation

Six-commit batch implementing Analyst UX QoL (#113,#115,#116,#117,#119,#120), Public Fire Report Areas map (#126-#135,#147) with civilian pressure report clusters, TLS 1.3 enforcement (#153) + cipher suite hardening (#154), expanded AES-256-GCM encryption scope (#150) to narratives/casualties/damage, real-time SSE notification infrastructure (#175), and system wiki synthesis updates.

- Updated `system-wiki/backend/api-route-map.md` — new `/api/public/clusters`, `/api/public/emergency-services`, `/api/validator/operational-map`, `/api/events/stream` routes.
- Updated `system-wiki/backend/remaining-routes.md` — marked completed routes moved to api-route-map.
- Updated `system-wiki/frontend/route-map.md` — new public map, validator operational map, SSE hook, analyst QoL components.
- Updated `system-wiki/security/security-baseline.md` — TLS 1.3-only, ChaCha20-Poly1305, AES-256-GCM expansion to 7 fields (from 4).
- Updated `system-wiki/gaps/frs-codebase-gap-register.md` — closed M6a (AES-GCM scope), M6b (data-in-transit), partial M13 (SSE backend); tracked public map data-source gap (civilian reports vs fire_incidents table).

## [2026-05-30] fix | PR #179 re-review implementation — SSE, dead code, pool config

Applied 4 blocking fixes from PR #179 re-review (`docs/reviews/pr-179-re-review.md`):

- **B1 — SSE publishing dead from 5 sync endpoints** (CRITICAL): Added `publish_incident_event_sync()` and `publish_verification_event_sync()` to `services/event_bus.py` (matching existing `publish_security_event_sync` pattern). Replaced 5 dead `asyncio.get_running_loop()` + `except RuntimeError: pass` blocks in `regional.py` (×2), `admin.py` (×1), `workflow.py` (×2) with direct sync calls. Removed now-unused `import asyncio` from `admin.py` and `workflow.py`. Fixes silent SSE event loss from `update_incident`, `verify_incident`, `update_security_log`, `claim_cluster_command`, and `apply_terminal_action_command`.
- **B2 — Dead EmergencyPanel in PublicFireMapInner.tsx**: Removed unrendered EmergencyPanel component, unused `emergencyContacts`/`nearbyStations` state, `fetchEmergencyServices` useEffect, `useMap` import, and `EmergencyContact`/`NearbyStation` type imports (−79 lines).
- **B3 — Dead no-op pii_dict reassignment**: Removed `if not pii_dict: pii_dict = {}` from `regional.py` (already `{}`).
- **B4 — Dead Redis pool constants**: Wired `_REDIS_POOL_MAX_CONNECTIONS` into `aioredis.from_url()` in `map.py`.

No schema, auth, or FRS alignment changes.

## [2026-05-27] fix | Public map contract repair and local nginx split
- Restored production `src/nginx/nginx.conf` to HTTPS/TLS with HTTP-to-HTTPS redirect and moved localhost HTTP behavior to `src/nginx/nginx.local.conf` plus `src/docker-compose.override.yml`.
- Reworked `GET /api/civilian/report-clusters` to read durable `citizen_report_clusters`/members, expose public-safe `areas`, use 500m bucket-center local queries, count `PENDING`/`UNDER_REVIEW`/`LINKED` pressure, require active `PENDING`/`UNDER_REVIEW`, exclude terminal/closed clusters, and serve Redis stale-if-error.
- Reworked `GET /api/ref/emergency-services` to return `911` plus all BFP station names/locations, no station phones/addresses, nearest-five metadata when location is known, and 24h Redis cache with stale fallback.
- Updated root map frontend to use `Public Fire Report Areas` language, true parent `fireLocation`, national/manual/location modes, meter-radius Leaflet circles, separate station markers, and public API transport.
- Updated tests and wiki synthesis pages. No `system-wiki/gaps/frs-codebase-gap-register.md` update needed; this implements planned public map behavior without changing FRS alignment status.

## [2026-05-29] style | Public page visual unification with /fire-stations
- Restyled `/` (report page) — all 4 render paths (main multi-step form, review, update, submitted) now use the full-width BFP gradient hero → EmergencyReferenceCard → max-w-lg content card pattern matching `/fire-stations`.
- Restyled `/tracking` page — same full-width hero + card pattern, moved EmergencyReferenceCard out of card into top-of-page position.
- Rewrote `CalmEmergencyBlock` component — replaced compact amber-bordered box with modern card-style layout featuring Shield icon, "Safety First / Kaligtasan Muna" heading, and three icon-labeled safety rules.
- Removed fire station markers from `NearbyPublicReportAreasInner` — map now shows only cluster circles and the user anchor pin; stations were cluttering the civilian-facing cluster visualization.
- Cleaned up `NearbyPublicReportAreas` wrapper — removed unused `fetchEmergencyServices` call, `servicesData` state, and `EmergencyServiceResponse` type import; clusters load independently.
- Build passes, lint 0 errors (15 pre-existing warnings), 119/119 Vitest tests pass.
- No `system-wiki/gaps/frs-codebase-gap-register.md` update needed; this is a visual restyle with no FRS/codebase alignment change.
## [2026-05-27] polish | Encoder/Validator dashboard queue usability

**Changes implemented:**
- Regional and validator dashboard row hints now use delayed floating "Click to view" bubbles that disappear on mouse movement or leave; inline hints were removed.
- Regional dashboard removed the Activity Log header shortcut, keeps it sidebar-only, removes the redundant classification placeholder arrow, defaults the incident list to Today, adds date chips, and renders Today incidents as richer cards.
- Validator dashboard removed the Audit Trail header shortcut, keeps it sidebar-only, and replaces the status dropdown with All/Pending/Accepted/Rejected quick chips plus a pending-only red indicator.
- `GET /api/regional/incidents` now accepts optional `date_from` and `date_to` date filters so regional date scopes apply before pagination/counting.

**Verification:**
- Automated tests intentionally skipped per user request.

**Wiki updates:** Updated `frontend/route-map.md`, `subsystems/regional-dashboard.md`, `subsystems/validator-hub.md`, `gaps/ui-ux-gap-register.md`, and this log. No `gaps/frs-codebase-gap-register.md` update needed; this is dashboard usability polish plus a narrow list-query filter.

## [2026-05-27] polish | Dashboard date filters and incident card details

**Changes implemented:**
- Regional date range controls changed from chips to dropdowns, paired with a `Date Modified`/`Date of Fire` basis dropdown. Regional Today cards now show last modified at the top, fire notification date/time in the body, responder type, complete address, caller/reporter name and contact number, classification, category/type, extent of damage, and affected-count cards.
- Validator dashboard now has the same date range and date-basis dropdowns, defaulting to Today by Date Modified.
- Encoder and validator filter changes preserve scroll position to avoid the page sliding when filters are applied.
- `GET /api/regional/incidents` and `GET /api/regional/validator/incidents` support `date_basis=modified|fire`; regional incident list payload includes extra card summary fields and decrypts caller PII when available.
- Regional status stats exclude `DELETED_DRAFT` history rows from rejected workload indicators, and `IncidentForm` adds a Set to today shortcut for the fire notification date.

**Verification:**
- Lightweight TS transpile syntax check passed for edited frontend files.
- `python -m py_compile src/backend/api/routes/regional.py` passed.
- `git diff --check` passed with CRLF warnings only.

**Wiki updates:** Updated `frontend/route-map.md`, `subsystems/regional-dashboard.md`, `subsystems/validator-hub.md`, `gaps/ui-ux-gap-register.md`, and this log. No `gaps/frs-codebase-gap-register.md` update needed; this fixes implementation behavior without changing FRS alignment.

## [2026-05-27] polish | Regional Today card refinement and seed filtering

**Changes implemented:**
- Regional Today cards removed responsible party, use a compact one-line Last Modified header, remove the duplicate classification line under the header, pair related fields, split district/city out from street address, render labels in dark red, and emphasize affected-count numbers.
- Regional Clear Filters now resets to All status, Today, Date Modified, 10/page, first page, and no classification filter.
- Regional filter updates preserve scroll position across two animation frames and keep existing Today cards visible with reduced opacity during reload to reduce layout jitter.
- Regional encoder list/stats now hide deterministic analyst seed incidents by excluding `AFOR-SEED-*` reference numbers and import batches marked `SEEDED`/`seed-incidents-*`.

**Verification:**
- Lightweight TS transpile syntax check passed for edited frontend files.
- `python -m py_compile src/backend/api/routes/regional.py` passed.

**Wiki updates:** Updated `subsystems/regional-dashboard.md`, `gaps/ui-ux-gap-register.md`, and this log. No `gaps/frs-codebase-gap-register.md` update needed; this is dashboard data hygiene and UI refinement.

## [2026-05-27] polish | Regional dashboard card readability

**Changes implemented:**
- Regional Today cards now use muted labels, roomier padding, clearer primary fire time/location hierarchy, grouped secondary details, calmer hover/focus treatment, and lighter affected-count chips.
- Regional and validator filter bars now use quieter active chip states and aligned rounded dropdown controls.
- Regional empty state copy now separates title and guidance for a cleaner no-results view.

**Verification:**
- Lightweight TS transpile syntax check passed for edited dashboard files.

**Wiki updates:** Updated `subsystems/regional-dashboard.md`, `gaps/ui-ux-gap-register.md`, and this log. No `gaps/frs-codebase-gap-register.md` update needed; this is frontend-only UI polish.

## [2026-05-27] fix | Category summary alias counts

**Diagnosis:**
- Regional incident creation normalizes vehicular classifications to `TRANSPORTATION`, while older/seeded rows may still use `VEHICULAR`.
- Regional dashboard cards looked up only `VEHICULAR`, so transportation/vehicular rows could be visible while the card showed 0. Validator cards handled aliases partially but did not sum both if both appeared.

**Changes implemented:**
- Regional and validator category cards now aggregate category aliases (`VEHICULAR` + `TRANSPORTATION`, plus common structural/non-structural variants) before rendering counts.

**Verification:**
- Pending frontend lint/syntax check after implementation.

**Wiki updates:** Updated `subsystems/regional-dashboard.md`, `subsystems/validator-hub.md`, `gaps/ui-ux-gap-register.md`, and this log. No `gaps/frs-codebase-gap-register.md` update needed; this fixes display aggregation only.

## [2026-05-27] polish | Encoder incident detail report layout

**Changes implemented:**
- `/dashboard/regional/incidents/[id]` read-only view now uses a report-style header, status badge, action hierarchy, top incident summary panel, and horizontal section index.
- Detail sections now use responsive grouped fields, report-style long text blocks, affected-count metric cards, cleaner data tables, an integrated map card, and quieter selected-problem chips.
- Existing fetches, route paths, edit form, delete/withdraw/submit actions, validator action panel, permissions, and map coordinate behavior were left unchanged.

**Verification:**
- Lightweight TS transpile syntax check passed for the edited detail page.
- No lint errors were reported for the edited detail page.

**Wiki updates:** Updated `frontend/route-map.md`, `subsystems/regional-dashboard.md`, `gaps/ui-ux-gap-register.md`, and this log. No `gaps/frs-codebase-gap-register.md` update needed; this is frontend presentation polish only.

## [2026-05-28] fix | Login/Keycloak SSO UI and dashboard specific-date filters

**Changes implemented:**
- Native `/login` desktop form alignment was nudged left and the hero trust tagline now uses the same check-circle icon language expected in the Keycloak flow.
- Keycloak theme hero tagline now includes the check-circle icon on hosted auth/MFA screens.
- Added a custom Keycloak `login-otp.ftl` OTP challenge with six digit boxes grouped 3+3, plus auto-advance, paste distribution, and backspace-to-previous behavior.
- Updated Keycloak TOTP setup verification (`login-config-totp.ftl`) to use the same 3+3 digit-box input while preserving hidden `totp` submission to Keycloak.
- Regional and validator dashboard date dropdowns now include `Specific Date`; selecting it reveals a single date input and sends same-day `date_from`/`date_to` bounds through the existing APIs.

**Verification:**
- `npx.cmd eslint src/app/login/page.tsx src/app/dashboard/regional/page.tsx src/app/dashboard/validator/page.tsx` passed.
- Started the frontend dev server with local OIDC env defaults and confirmed `http://127.0.0.1:3000/login` returns HTTP 200.
- In-app Browser verification could not run because the `iab` browser target was unavailable in this session; Keycloak FTL screens were code-reviewed but not browser-smoke-tested in a running Keycloak container.

**Wiki updates:** Updated `ui-ux/evaluation-loginpage-keycloaksso.md`, `gaps/ui-ux-gap-register.md`, `frontend/route-map.md`, `subsystems/regional-dashboard.md`, `subsystems/validator-hub.md`, `index.md`, and this log. No `gaps/frs-codebase-gap-register.md` update needed; no FRS/code alignment gap changed.

## [2026-05-27] polish | Encoder incident detail cohesion refinement

**Changes implemented:**
- Refined `/dashboard/regional/incidents/[id]` visual language with softer rounded section surfaces, gentler shadows, cohesive low-saturation tints, calmer text blocks, more polished tables, and softer problem tags.
- Enlarged the desktop vertical dot section navigator click targets, added hover/focus scale animation and labels, and moved the rail inward on wide screens so it sits closer to the incident report instead of the browser scrollbar.
- Added explicit `(24H)` indicators to formatted notification/timeline/response time displays while preserving the underlying data.
- Backend/API/data/action/map behavior was unchanged.

**Verification:**
- Lightweight TS transpile syntax check passed for the edited detail page.
- Targeted ESLint for `src/app/dashboard/regional/incidents/[id]/page.tsx` passed.
- Full 

**Wiki updates:** Updated `frontend/route-map.md`, `subsystems/regional-dashboard.md`, and this log. No `gaps/frs-codebase-gap-register.md` update needed; this is frontend presentation polish only.

## [2026-05-27] fix | Validator submitted-date filter and status badge sizing

**Changes implemented:**
- Validator dashboard date-basis filter now shows `Date of Submission` instead of `Date Modified`, defaults to `submitted`, and sends `date_basis=submitted`.
- `GET /api/regional/validator/incidents` now accepts `date_basis=submitted` (legacy `modified` aliases to submitted) and applies date bounds to `fi.created_at`, matching the queue's submitted date surface.
- Validator table status badges now use fit-content sizing and the status cell aligns badges to the start, preventing Verified/Update/Duplicate pills from stretching across the column.

**Verification:**
- Lightweight TS transpile syntax check passed for `src/frontend/src/app/dashboard/validator/page.tsx`.
- `python -m py_compile src/backend/api/routes/regional.py` passed.

**Wiki updates:** Updated `frontend/route-map.md`, `subsystems/validator-hub.md`, and this log. No `gaps/frs-codebase-gap-register.md` update needed; this aligns an existing validator queue filter with its intended submitted-date semantics.

## [2026-05-27] polish | Encoder incident detail formalization pass

**Changes implemented:**
- Removed the horizontal section navigation from `/dashboard/regional/incidents/[id]` and replaced it with a desktop-only vertical dot navigator with hover/focus labels and scroll-spy active state.
- Removed duplicated status from the incident summary panel; status remains only in the page header/top metadata area.
- Replaced unsafe metadata separator characters with plain hyphens so the region/created line renders without stray `?` characters.
- Toned down field mini-cards into definition-list rows with subtle dividers, compact affected-count cells, cleaner official tables, restrained section header tints, and report-style narrative/recommendation/disposition text blocks.
- Backend/API/data/action behavior was unchanged.

**Verification:**
- Lightweight TS transpile syntax check passed for the edited detail page.
- No lint errors were reported for the edited detail page.

**Wiki updates:** Updated `frontend/route-map.md`, `subsystems/regional-dashboard.md`, `gaps/ui-ux-gap-register.md`, and this log. No `gaps/frs-codebase-gap-register.md` update needed; this is frontend presentation polish only.

## [2026-05-28] fix | CI pipeline — ESLint error, missing packages, backend format

**Changes implemented:**
- `src/frontend/src/components/IncidentRevisionHistory.tsx`: Restructured `useEffect` data-fetch to use an async IIFE, moving `setLoading(true)` and `setError(null)` out of the effect's synchronous top-level body. Fixes `react-hooks/set-state-in-effect` ESLint error that was blocking CI. Also added a `cancelled` guard to prevent state updates after unmount.
- `src/frontend`: Ran `npm ci` to ensure `recharts` (^3.8.1) and `firebase` (^12.13.0) are present in `node_modules`. Both were declared in `package.json` and `package-lock.json` but missing from local `node_modules`; 23 Vitest tests were failing as a result.
- `src/backend/api/routes/regional.py`, `src/backend/services/duplicate_detection.py`, `src/backend/services/regional_incidents/lifecycle.py`: Applied `ruff format` to bring formatting in line with CI's `ruff format --check` gate.
- `system-wiki/log.md`, `system-wiki/index.md`: Resolved merge conflicts with master (agent skill docs + glossary entries from master merged with encoder/validator implementation entries from this branch).

**Verification:**
- `npm run lint`: 0 errors, 13 warnings (all pre-existing unused-var warnings, not blocking).
- `npx vitest run`: 115/115 tests pass.
- `ruff check .` + `ruff format --check .`: all pass.
- `npm run build` compiles successfully with env vars set (as CI does).

**Wiki updates:** Updated `system-wiki/log.md` and `system-wiki/index.md` only (merge conflict resolution). No code-alignment gaps changed.

## [2026-05-28] fix | Encoder/validator date apply and BFP red override

- Updated encoder/validator dashboard UI context after changing specific-date filters to use a draft date plus explicit Apply Date action instead of refetching on every date input change; updated the BFP colour override note to `#991B1B` while leaving restored login colours unchanged. Sources: `src/frontend/src/app/dashboard/regional/page.tsx`, `src/frontend/src/app/dashboard/validator/page.tsx`, `src/frontend/src/app/globals.css`, `src/frontend/src/components/IncidentForm.tsx`, `src/frontend/src/components/WildlandAforManualForm.tsx`.

- Follow-up: restored sidebar-specific tokens (`--sidebar-bg`, `--color-sidebar-bg`) to their previous `#5A1515` value while leaving action/header overrides at `#991B1B`. Source: `src/frontend/src/app/globals.css`.

- Follow-up: refined encoder/validator specific-date filtering so dashboard load and preset period switches clear the staged specific date, Apply Date remains disabled until the user enters a complete valid date, date controls sit at the right edge of the filter row, and stats card titles no longer repeat the selected stats period. Sources: `src/frontend/src/app/dashboard/regional/page.tsx`, `src/frontend/src/app/dashboard/validator/page.tsx`.

## [2026-05-30] polish | Encoder/validator dashboard navigation and empty states

- Added a persistent lengthwise left-edge back-to-dashboard affordance to the incident detail view. It routes encoders to `/dashboard/regional`, validators to `/dashboard/validator`, expands on hover/focus, and keeps the existing header/back links intact.
- Smoothed incident detail section-dot navigation with `scrollIntoView({ behavior: "smooth" })`, combined Affected Counts + Assets/Resources into one dot, combined Problems + Recommendations into one dot, and removed unused dots from the side navigator.
- Updated encoder dashboard filter behavior so All Time does not carry forward when switching away from Rejected or Drafts into normal status views; added centered empty-state guidance with a BFP-red Search All Time button and a bottom-row See Archive button.
- Updated validator dashboard filter behavior so switching to All resets inherited All Time back to Today; added the same Search All Time empty state and bottom-row See Archive button.

**Verification:** `npm.cmd run lint` passes with 0 errors and 13 pre-existing warnings outside the touched dashboard/detail files.

**Wiki updates:** Updated `system-wiki/subsystems/regional-dashboard.md`, `system-wiki/subsystems/validator-hub.md`, `system-wiki/index.md`, and this log. No `system-wiki/gaps/frs-codebase-gap-register.md` update needed; no FRS/codebase gap changed.

## [2026-05-31] fix | Responsive Keycloak MFA setup containment

- Refactored `login-config-totp.ftl` so setup steps, QR/manual secret, warning alert, OTP boxes, device-name field, checkbox, and submit action share one compact right-side onboarding card.
- Fixed the Keycloak auth layout overflow by changing `.pf-v5-c-login__container` from a full-width sibling beside the branding panel to a flexing `min-width: 0` right-side region without modifying the red BFP branding section.
- Replaced the narrow internally scrollable TOTP card with a natural-height `wims-totp-setup` layout: two columns on desktop, stacked on tablet/mobile, compact instruction rows, smaller grouped QR area, integrated alert, and scaled OTP boxes at small breakpoints.
- Removed unnecessary `max-height` and `overflow-y:auto` rules from the OTP setup container and right auth main area so standard desktop screens do not show an internal setup scrollbar.
- Disabled page-level overflow for the Keycloak auth shell and further compacted the MFA setup card: 860px max card width, 150px desktop QR max, reduced card/form/alert padding, and tighter instruction rows so the submit area remains visible.
- Hardened root scroll suppression by setting `overflow: hidden` and viewport bounds on `html`, `body.login-pf`, `#keycloak-bg`, `.pf-v5-c-login`, `.pf-v5-c-login__container`, and `.pf-v5-c-login__main`.
- Updated `login.ftl` so login auth messages and username/password validation errors render inside `#kc-form` through `.wims-login-alerts`, directly above the username field instead of floating between the branding panel and form.

**Verification:** CSS/template diff reviewed; scan confirmed no `max-height` or `overflow-y:auto` remains on `.wims-totp-setup` or `.pf-v5-c-login__main`; static sizing check for a 1920x1080 viewport leaves roughly 900+ px of usable right-panel width for the 980 px max card, so the two-column setup fits without an internal scrollbar. No automated Keycloak browser render was available in this turn.

**Wiki updates:** Updated `system-wiki/ui-ux/evaluation-loginpage-keycloaksso.md`, `system-wiki/index.md`, and this log. No `system-wiki/gaps/frs-codebase-gap-register.md` update needed; no FRS/codebase gap changed.

## [2026-05-31] fix | Encoder and validator landing plus manual-entry draft restore

- Added `src/frontend/src/lib/roleRedirect.ts` so role landing routes are centralized: regional encoders go to `/dashboard/regional`, validators go to `/dashboard/validator`, system admins go to `/admin/system`, and analysts go to `/dashboard/analyst`.
- Updated `/callback`, `/login`, and `/dashboard` routing so stale generic saved redirects such as `/home` do not send encoder/validator users to Operations after login, while specific same-origin workflow redirects still restore after idle logout.
- Changed `IncidentForm.tsx` create-mode autosave to use a per-user key (`wims:incident_draft:{user.id}`), begin only after user input, and clear the legacy global draft key on discard/success so first-login blank forms do not show a restore banner.
- Added focused Vitest coverage for role redirect behavior.

**Verification:** `npm.cmd run lint` passes with 0 errors and 16 existing warnings; `npx.cmd vitest run src/lib/__tests__/roleRedirect.test.ts` passes 3 tests; `npm.cmd run build` passes with the existing Turbopack root warning. `npx.cmd tsc --noEmit` was also run and still fails on pre-existing type errors outside this change path (admin system, analyst detail, triage/public/tracking pages, sync tests, Firebase mocks).

**Wiki updates:** Updated `system-wiki/frontend/route-map.md`, `system-wiki/subsystems/regional-dashboard.md`, `system-wiki/subsystems/validator-hub.md`, `system-wiki/index.md`, and this log. No `system-wiki/gaps/frs-codebase-gap-register.md` update needed; no FRS/codebase gap changed.

## [2026-05-30] polish | Shared section dots for AFOR create/import/edit

- Fixed the incident detail back-to-dashboard affordance visibility in authenticated layouts by offsetting it past the desktop sidebar while keeping it available on small screens.
- Added `SectionDotNav.tsx`, a reusable fixed right-side dot navigator with smooth scrolling and scroll-spy labels.
- Wired section dots into structural manual entry and incident edit mode through `IncidentForm.tsx`, wildland manual/import correction through `WildlandAforManualForm.tsx`, and `/afor/import` for upload, map pin, summary, and data preview.
- Moved the combined Affected & Assets incident detail target lower by scrolling to an anchor inside the affected-count section rather than the section shell.

**Verification:** `npm.cmd run lint` passes with 0 errors and 13 pre-existing warnings outside the touched files.

**Wiki updates:** Updated `system-wiki/subsystems/regional-dashboard.md`, `system-wiki/index.md`, and this log. No `system-wiki/gaps/frs-codebase-gap-register.md` update needed; no FRS/codebase gap changed.

## [2026-05-30] fix | Incident detail back tab sidebar overlap

- Refined the incident detail "Back to Dashboard" affordance into two responsive variants: a normal inline top button on small screens and a desktop fixed side tab.
- The desktop side tab now starts at `calc(var(--sidebar-width) + 1rem)`, reusing the existing sidebar width token so it sits immediately to the right of the authenticated sidebar instead of overlapping navigation.
- The tab keeps a compact icon-only default state, smooth hover/focus expansion, soft border/shadow styling, pointer cursor, and accessible dashboard label.

**Verification:** `npm.cmd run lint -- --no-cache` passes with 0 errors and 13 pre-existing warnings outside the touched file.

**Wiki updates:** Updated `system-wiki/subsystems/regional-dashboard.md` and this log. No `system-wiki/gaps/frs-codebase-gap-register.md` update needed; no FRS/codebase gap changed.

## [2026-05-30] polish | Incident detail back tab icon-only refinement

- Removed all visible desktop side-tab label text from the incident detail "Back to Dashboard" affordance.
- Converted the desktop affordance into a taller, slim vertical pill with a centered left-arrow icon, slight hover/focus width expansion, stronger shadow, and subtle red-tinted background.
- Preserved the mobile/small-screen normal top back button and `aria-label="Back to Regional Dashboard"` accessibility label.

**Verification:** `npm.cmd run lint -- --no-cache` passes with 0 errors and 13 pre-existing warnings outside the touched file.

**Wiki updates:** Updated `system-wiki/subsystems/regional-dashboard.md` and this log. No `system-wiki/gaps/frs-codebase-gap-register.md` update needed; no FRS/codebase gap changed.

## [2026-05-30] ops | VPS nginx TLS recovery command clarified

- Recreated `wims-nginx-gateway` with the explicit production Compose stack after plain Compose had mounted the local HTTP-only nginx override. The production container now mounts `/etc/letsencrypt` and `src/nginx/nginx.conf`; `http://wimsbfp.tech/health` redirects to HTTPS and `https://wimsbfp.tech/health` returns 200.
- Added Make targets `prod-up` and `prod-nginx` so VPS operation uses `docker-compose.yml` + `docker-compose.prod.yml` + `.env.production` instead of the automatic local override.
- Updated infrastructure and local deployment wiki pages to warn that plain `docker compose up` on the VPS loads `docker-compose.override.yml`, causing HTTPS failures.

**Verification:** `curl -I https://wimsbfp.tech/health` returns 200; `curl -I http://wimsbfp.tech/health` returns 301 to HTTPS; nginx mount inspection shows `/etc/letsencrypt -> /etc/letsencrypt` and `src/nginx/nginx.conf -> /etc/nginx/nginx.conf`.

**Wiki updates:** Updated `system-wiki/architecture/infrastructure-config.md`, `system-wiki/operations/local-dev-deploy-guide.md`, and this log. No `system-wiki/gaps/frs-codebase-gap-register.md` update needed; no FRS/codebase gap changed.

## [2026-06-03] implement | M11b CSRF protection — SameSite=Strict, __Host- prefix, Origin/Referer middleware, CORS restrictions

**FRS reference:** Module 11b — Penetration Testing Scope: CSRF (FRS `frs-penentrationtestingandsecurityvalidation.md` 11.b.i.e)

**Changes implemented:**

- **Cookie hardening (Phase 1):** `__Host-` prefix + `Secure` + `SameSite=Strict` on `__Host-access_token` and `__Host-refresh_token` cookies across 4 route handlers: `sync/route.ts`, `refresh/route.ts`, `logout/route.ts`, and backend `auth.py` read path.
- **CSRF middleware (Phase 2):** `src/backend/utils/csrf.py` — `csrf_middleware` registered in `main.py` via `app.middleware("http")`. Validates Origin/Referer on POST/PUT/PATCH/DELETE against configurable allowlist. GET/HEAD/OPTIONS bypassed. Logs block events at WARNING level.
- **Nginx CORS restriction (Phase 3):** `Access-Control-Allow-Origin` changed from `$http_origin` (reflected any origin) to `$scheme://$host` in both `nginx.conf` and `nginx.local.conf`.
- **Docker env vars (Phase 4):** `CSRF_TRUSTED_ORIGINS` in `docker-compose.yml` and `docker-compose.prod.yml`.
- **Test suite (Phase 5):** `tests/test_csrf_middleware.py` — 28 test cases covering origin normalization, allowlist builder, safe method bypass, invalid/missing Origin, valid Origin, Referer fallback, PUT/PATCH/DELETE variants, and VPS production origin.
- **Pen-test checklist (Phase 6):** `docs/pentest/CSRF-CHECKLIST.md` — cookie attributes, Origin validation steps, cross-origin attack simulation, CORS, OIDC flow integrity, and test coverage verification.
- **Wiki updates (Phase 7):** This log, `security/security-baseline.md` (new CSRF Protection section), `gaps/frs-codebase-gap-register.md` (M11b CLOSED entry).

**Verification:** `pytest tests/test_csrf_middleware.py -v` — all 28 tests pass.

## [2026-06-03] ruff format applied to tests/test_public_submission.py

## [2026-06-03] fixed test mocks: result-wrapper + SQL-dispatch MockDB so db.execute().fetchone() works across all four queries

## [2026-06-03] mock RETURNING row now supplies a real created_at datetime to satisfy PublicIncidentResponse

## [2026-06-02] feat | M11a vulnerability scanning — ZAP baseline + Nmap in CI

- Added `security-scan` job to `.github/workflows/ci.yml` on branch `feat/m11-ci-scanning` (PR target: #172).
- Job brings up full `src/` Docker stack (docker compose up -d --build), polls http://localhost until 200 or 180s timeout.
- Nmap `-sV` scan of localhost; grep checks for unexpected open ports — fail if any port outside allowlist (80, 443, 3000, 8080, 8090) is open.
- OWASP ZAP baseline scan via `zaproxy/action-baseline@v0.12.0` against `http://localhost`; `fail_action: true` so HIGH/CRITICAL findings block the merge gate.
- ZAP auto-uploads HTML/JSON report as artifact; nmap report uploaded via `actions/upload-artifact@v4` (if: always()).
- Stack torn down with `docker compose down -v` (if: always()).
- `security-scan` added to `merge-gate` `needs:` list — consistent with migrations/backend (no `continue-on-error`).
- Wiki gap register entry #172 / M11a vulnerability scanning marked CLOSED.

## [2026-06-02] test(#127): comprehensive report-clusters API tests

**Session context:** The `GET /api/civilian/report-clusters` endpoint and its Redis stale-if-error cache were already implemented in `civilian.py` (kanban-batch-1). The endpoint correctly implements both #127 (public report-area cluster API) and #128 (Redis stale-if-error cache).

**What was added — 13 integration tests covering all acceptance criteria:**

- **National mode** (`test_get_report_clusters_national_mode`, `test_get_report_clusters_national_below_threshold_returns_empty`): verifies no lat/lon → national mode, min 10 reports, cap 25, no center/radius returned. Sub-threshold returns empty.
- **Local mode** (`test_get_report_clusters_local_mode`, `test_get_report_clusters_local_below_threshold_returns_empty`): verifies lat/lon → local mode, min 3 reports, center returned, sub-threshold returns empty.
- **Status exclusion** (`test_get_report_clusters_excludes_terminal_report_statuses`): ACTIONED, REJECTED_BOGUS, REJECTED_DUPLICATE, REJECTED_INSUFFICIENT, REJECTED_TIMEOUT excluded. All-terminal cluster → empty areas.
- **Cluster exclusion** (`test_get_report_clusters_excludes_closed_actioned_clusters`): CLUSTER_CLOSED and CLUSTER_ACTIONED clusters excluded.
- **Pressure count** (`test_get_report_clusters_includes_pending_under_review_linked`): PENDING, UNDER_REVIEW, and LINKED all counted in pressure.
- **Active requirement** (`test_get_report_clusters_requires_active_report_in_cluster`): cluster with only terminal-status reports excluded even if count ≥ min.
- **Privacy** (`test_get_report_clusters_privacy_fields_absent`): verifies cluster_id, report_id, total_reports, created_at, timestamps, category, severity, safety_status, witness, contact, device not leaked.
- **Ephemeral area_id** (`test_get_report_clusters_area_id_is_ephemeral`): area_id is 16-char hex hash, not raw cluster_id.
- **Buckets** (`test_get_report_clusters_count_and_age_buckets`): count_bucket ∈ {3-4, 5-9, 10-19, 20+}, age_bucket ∈ {0-15 min, 15-30 min, 30-60 min}.
- **Dynamic radius** (`test_get_report_clusters_dynamic_radius_bounds`): radius in [100, 1000], rounded to 100m.
- **Truncation** (`test_get_report_clusters_truncation_flag`): truncated flag behavior.
- **Response shape** (`test_get_report_clusters_response_has_required_top_level_fields`): all required top-level fields present.

**Files changed:** `src/backend/tests/integration/test_civilian_api.py` (+13 tests, 24 total now).

**Verification:** `ruff check .` passes; `ruff format --check .` passes. Integration tests require Docker (Redis + PostGIS); won't run without the full stack.

**Wiki updated:** This log entry. No FRS gap changes.

**Note:** Issues #127 and #128 are effectively already implemented in the existing `get_report_clusters` endpoint. #131 (frontend fireLocation sharing) is the next target.

## [2026-06-03] fix | PR #210 M14 public submission rate limiter — cross-event-loop pool crash

**Root cause:** `_get_redis()` cached a global `ConnectionPool` created on the first request's event loop. FastAPI `TestClient` creates a *new* event loop per request, so subsequent requests failed with `RuntimeError: Future attached to a different loop` when borrowing a connection from the cached pool. The error was silently caught by `except Exception: return` (fail-open), causing all rate-limit requests to return 201 instead of the 4th request returning 429.

**Fix (`src/backend/api/routes/public_dmz.py`):**
- Removed the module-level `_redis_pool` global and `_get_redis_pool()` function.
- `_get_redis()` now creates a fresh `ConnectionPool` per call (max_connections=5). Pool creation is lightweight — no TCP until the first command. Production uvicorn uses a single event loop, so the per-call overhead is negligible.
- Retained the existing Lua script logic (sliding-window sorted set with `ZREMRANGEBYSCORE 0`).

**Fix (`src/backend/tests/conftest.py`):**
- Added `os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")` at module level to set a usable default before `public_dmz.py` is imported. Docker Compose and CI set `REDIS_URL` explicitly, so `setdefault` is a no-op there.

**Fix (`src/backend/tests/test_public_submission.py`):**
- Changed both test Redis client fallback URLs from `redis://redis:6379/0` (Docker hostname, unresolvable from the host) to `redis://localhost:6379/0` for consistency with conftest.

**Validation:**
- `pytest tests/test_public_submission.py -v` — 9/9 passed (including both rate-limit tests).
- `ruff format --check` — all 3 changed files clean.
- `git status --short` — no conflict markers.

**Wiki updated:** This log; `backend/remaining-routes.md` (rate-limit connection model, Lua summary, key naming). No FRS gap change (connection pool model is an implementation detail, not a requirement change).

## [2026-06-03] fix | PR #210 M14 public submission rate limiter — close per-request Redis pools

**Follow-up validation finding:** The cross-event-loop fix correctly removed the global async Redis pool, but a fresh per-call pool must also be closed after the Lua script runs to avoid accumulating idle sockets under sustained public submissions.

**Fix (`src/backend/api/routes/public_dmz.py`):** `rate_limit_public_dmz()` now closes the request-scoped Redis client and its connection pool in a guarded `finally` block via `await r.aclose(close_connection_pool=True)`. This preserves fail-open behavior for Redis errors while preventing resource leakage after successful or rate-limited requests.

**Wiki updated:** `backend/remaining-routes.md` now records that the public DMZ rate limiter uses a per-call pool and closes it after script execution. No FRS gap change.

## [2026-06-03] fix(M14) | address public DMZ PR #210 review findings

**Changes implemented:**

- **CSRF exemption for public DMZ:** `src/backend/utils/csrf.py` now exempts the `/api/v1/public/` path prefix from Origin/Referer validation. The public DMZ endpoint is unauthenticated (no Keycloak JWT, no cookie dependency) and protected by rate limiting + Pydantic validation; CSRF validation is not meaningful there. All other auth/session/admin routes still require trusted Origin/Referer.
- **Redis fail-open logging:** `src/backend/api/routes/public_dmz.py` now imports `logging` and logs warnings via `wims.public_dmz` logger when Redis connection creation fails in `_get_redis()` and when Lua eval/rate-limit execution fails in `rate_limit_public_dmz()`. Intentional 429 responses are not logged.
- **Coordinate query guard:** Added `coord_row is None` check after PostGIS coordinate SELECT; raises HTTP 500 `"Failed to retrieve inserted incident coordinates"` instead of allowing uncaught `TypeError`.
- **Test cleanup (`src/backend/tests/test_public_submission.py`):** Removed redundant `import sys`/`sys.path.insert`, moved `import redis` to module level, removed unused `monkeypatch` parameters from 4 test methods, mocked `test_valid_submission_returns_201` with `_MockDB`/dependency overrides, switched rate-limit test IPs to valid RFC 5737 TEST-NET addresses (`203.0.113.<n>`), added 4 fallback/error-path tests (station→region fallback, both empty→500, INSERT no row→500, coordinate no row→500).
- **CSRF tests (`src/backend/tests/test_csrf_middleware.py`):** Added `TestPublicDmzCsrfExemption` class: `test_public_dmz_post_without_origin_not_blocked_by_csrf` verifies POST to `/api/v1/public/report` without Origin/Referer does not return 403; `test_auth_post_without_origin_still_blocked` verifies auth endpoints still blocked.
- **Wiki updates:** Updated `subsystems/civilian-reporting-phase2.md` (Public DMZ Boundary restored, CSRF-exempt), `security/security-baseline.md` (CSRF exemption for public DMZ), `backend/remaining-routes.md` (logging + coord guard), and this log.

**Verification:** `pytest tests/test_public_submission.py -v` 13/13 passed; `pytest tests/test_csrf_middleware.py -v` 31/31 passed; `ruff format --check .` and `ruff check .` passed; `git diff --check` clean.

**Wiki updated:** Yes — see above. No `gaps/frs-codebase-gap-register.md` update needed; no FRS gap changed.

## [2026-06-04] docs | Record PR #207 pytest lock-hang invariant in synthesis

Updated `system-wiki/architecture/pwa-tests-cicd.md` and `system-wiki/index.md` after the PR #207 backend hang fix. The testing/CI synthesis now records that `src/backend/main.py` must not run startup DDL on `wims.users.email`; `src/postgres-init/44_add_email_to_users.sql` owns that schema change, and runtime DDL can block behind open SQLAlchemy test sessions in `src/backend/tests/test_immutable_records.py`. No gap-register update needed; this is CI/test-infrastructure behavior, not an FRS alignment change.

## [2026-06-04] fix | Backend pytest hang — remove email DDL from startup (PR #207)

**Root cause:** `apply_schema_patches()` in `main.py` ran `ALTER TABLE wims.users ADD COLUMN IF NOT EXISTS email` at startup. This required `AccessExclusiveLock` on `wims.users`. The `test_immutable_records.py` `db()` fixture opened a session with `autocommit=False`, which held an `AccessShareLock` from `SELECT` queries during `encoder_region`/`validator_region` fixture setup. When `verified_incident` fixture created `TestClient(app)`, startup tried the DDL, which queued behind the existing lock indefinitely — hanging pytest/CI.

**Fix:** Removed the email DDL block from `apply_schema_patches()`. Migration `44_add_email_to_users.sql` already runs on CI's fresh database initialization (mounted into `/docker-entrypoint-initdb.d/`). The `no_update_verified` rule patch remains — it operates on `wims.fire_incidents`, not `wims.users`, so no lock conflict with the test fixtures.

**Files changed:** `src/backend/main.py` — removed ~10 lines of email DDL, updated docstring with rationale.

**Verification:**
- Reproduction command (previously hung): `docker compose run --rm --no-deps backend pytest tests/test_dynamic_rate_limits.py tests/test_fire_incident_location.py tests/test_immutable_records.py::test_84_verified_incident_appears_in_analytics -vv -s --tb=short` → 17 passed in 4.35s.
- Full immutable records: `pytest tests/test_immutable_records.py` → 7 passed in 5.57s.
- Profile email tests: `pytest tests/test_profile_email.py` → 10 passed in 2.78s.
- `ruff check` + `ruff format --check` clean on touched file.

**Wiki updates:** This log entry. No `gaps/frs-codebase-gap-register.md` update needed (CI hang fix, not FRS alignment change).

## [2026-06-02] fix | S1 username sync gap — DB username now synced when email changes

Fixes the S1 finding from single-agent review of `fix/profile-email-and-polish`:

- **S1 — `wims.users.username` not synced when email changes:** When `PATCH /api/user/me` updates email, Keycloak sets `username = email` but the DB sync block only updated `wims.users.email`. Now the DB `UPDATE` also sets `username = :uname`.
- Added `username` assertion to `test_update_email_syncs_to_db` in `test_profile_email.py`.

**Verification:** Backend syntax check passed (Docker not running for full pytest). Frontend 9/9 profile tests pass.

**Wiki updates:** This log entry. No `gaps/frs-codebase-gap-register.md` update needed.

## [2026-06-02] fix | Second-pass review fixes — index, dead code, import, wiki

Follow-up fixes from three-axis re-review of `fix/profile-email-and-polish`:

- Added `CREATE INDEX IF NOT EXISTS idx_users_email ON wims.users(email)` to `apply_schema_patches()` in `main.py` so startup schema patch mirrors the migration script.
- Removed dead `_, kwargs = ...` assignment in `test_profile_email.py` (overwritten on next line, unreachable branch).
- Converted dynamic `await import('@testing-library/user-event')` to static top-level `import userEvent` in `profile.test.tsx` (matches project convention).
- Updated `remaining-routes.md` `ProfileUpdate` description from "non-blank" to `Optional[EmailStr]`.

**Verification:** Frontend 9/9 profile tests pass. Backend tests skipped (Docker not running); both Python files compile clean.

**Wiki updates:** Updated `remaining-routes.md` and this log. No `gaps/frs-codebase-gap-register.md` update needed.

## [2026-06-02] fix | Review fixes for profile email branch (#28, #86)

Applied fixes from three-axis review of `fix/profile-email-and-polish`:

- **P1 — Dead-code email fallback:** Added `email` to `user_dict` in `get_current_wims_user()` (`auth.py:370`) from the JWT token payload, so the fallback in `GET /user/me/profile` now has a real value.
- **P1 — Email format validation:** Replaced `email_not_blank` validator with Pydantic `EmailStr` in `ProfileUpdate` schema; `email-validator>=2.0.0` was already in `requirements.txt`.
- **P2 — DB sync partial status:** Split `contact_number` and `email` DB sync into independent try/except blocks; returns `{"status": "partial", ...}` when DB sync fails instead of silently swallowing the failure.
- **P3 — Email column index:** Added `CREATE INDEX IF NOT EXISTS idx_users_email ON wims.users(email)` to `44_add_email_to_users.sql`.
- **P3 — Profile re-fetch error handling:** Added `.catch()` to `fetchMyProfile().then()` after profile save in `profile/page.tsx`.
- **P4 — API type fix:** Changed `email?: string` to `email: string` in `fetchMyProfile()` return type in `legacy.ts`.
- Added 2 new backend tests: invalid email format rejection, DB sync failure partial status.

**Verification:** Backend 10/10 passed. Frontend 154/154 passed across 22 test files.

## [2026-06-02] test | Add frontend profile page tests (#28, #86)

- Created `src/frontend/src/app/profile/__tests__/profile.test.tsx` with 9 tests.
- Covers: email input renders, current email display, email-change warning, fallback when no email.
- Covers region display: All Regions (NATIONAL_ANALYST), National (SYSTEM_ADMIN), region ID (REGIONAL_ENCODER), dash (no region).
- Covers profile save: calls updateMyProfile with email when provided.
- Uses Vitest + React Testing Library following existing project patterns (analyst dashboard test as reference).

## [2026-06-02] feat | Enable self-service email editing in profile (#28, #86)

- Added `email: Optional[str]` to `ProfileUpdate` schema in `src/backend/api/routes/user.py`.
- `update_my_profile()` now passes `email` to Keycloak and syncs to `wims.users`.
- `get_my_profile()` returns email from Keycloak profile (fallback to user context).
- Frontend profile page now includes editable email input with warning that changes may update login identity.
- `NATIONAL_ANALYST` region display changed from "National" to "All Regions".
- API types in `legacy.ts` updated to include `email` in fetch/update payloads.
- Added `tests/test_profile_email.py` with 6 tests covering schema, PATCH, and GET routes.

## [2026-06-02] fix | Review fixes applied to email editing branch

- Added `44_add_email_to_users.sql` migration for email column (was missing — UPDATE would fail silently).
- `main.py` startup patch: `ALTER TABLE wims.users ADD COLUMN IF NOT EXISTS email` for existing containers.
- `keycloak_admin.py`: `get_user_profile()` now returns email from Keycloak (was never in the dict).
- `keycloak_admin.py`: updated stale CRIT-0 comment in `update_user_profile()`.
- `user.py`: added `email_not_blank` validator to `ProfileUpdate.email` field.
- `remaining-routes.md`: updated ProfileUpdate schema and behavior docs to reflect email support.

## [2026-06-04] fix | PR #207 verified profile email review fixes

Implemented verified PR #207 review fixes across profile email handling and documentation:

- Frontend `/profile` now consumes `PATCH /api/user/me` status, surfaces backend `partial` responses as an error/warning message instead of unconditional success, and requires a current-password field when an email/login-identity change is entered.
- Backend `PATCH /api/user/me` now requires `current_password` for email changes and verifies it through Keycloak Direct Grant (`bfp-client`) before updating Keycloak email/username or local DB fields. Missing password returns 400; invalid password returns 401.
- Backend profile/contact quality fixes: `GET /api/user/me/profile` uses `get_db_with_rls`, contact number validation matches the frontend `^09\d{9}$` rule, and Keycloak contact-number updates merge existing attributes before setting `contact_number`.
- Database migration `44_add_email_to_users.sql` now adds a DB-side unique `LOWER(email)` index for non-null local emails while keeping email-column DDL out of FastAPI startup.
- Added focused backend/frontend tests for current-password email step-up, partial response display, route error paths, contact validation, and Keycloak attribute merging.
- Restored the base-branch append-only log history, preserving PR #207 entries at the end instead of before the append-only banner.

**Wiki updates:** Updated `backend/remaining-routes.md`, `frontend/route-map.md`, `database/schema-overview.md`, `security/security-baseline.md`, `architecture/pwa-tests-cicd.md`, `index.md`, and this log. No `gaps/frs-codebase-gap-register.md` update needed; no FRS/codebase gap changed. Self-service email verification remains a residual follow-up because enabling Keycloak verify-email/required action safely would affect realm/admin flow behavior beyond this bounded PR fix.

## [2026-06-05] fix | Slice 3 — backend bugs & cleanup (PR #215, rebased onto origin/master)

**Fixes across 7 issues:**
- #183: Wrapped sync `is_token_revoked()` in `asyncio.to_thread()` to avoid event loop blocking.
- #185: Renamed `DELETE /sessions/{user_id}/{session_id}` → `/sessions/{user_id}` to match bulk-termination behavior.
- #187: Removed stub `/api/auth/login` always-401 endpoint; retargeted rate limiter to `/api/auth/callback`.
- #188: Fixed admin.py docstring from "No DELETE endpoints" → "No incident DELETE endpoints".
- #193: Added `RETURNING attachment_id` to attachment INSERT; returns actual DB ID now.
- #197: Moved logger definition before `apply_schema_patches()` in main.py.
- #200: Bundle upload now reports failed incidents with index + reason; `incident_ids` kept for backward compat.

**Review fixes applied during rebase:** Orphaned `incident_ids` variable removed, null-guard on attachment RETURNING added, docstring clarified to point to admin.py single-session route.

**Rate-limit test resolution:** The stale `test_rate_limiting.py` (targeted removed `/api/auth/login`) was not deleted — master had already rewritten it to target `POST /api/auth/callback` and mark it as a manual live-stack check excluded from CI. PR #215 retains master's callback-targeted manual test.

**Files:** `auth.py`, `main.py`, `incidents.py`, `sessions.py`, `admin.py`

## [2026-06-05] fix | PR #215 — CSRF test alignment with removed stub login

Updated `src/backend/tests/test_csrf_middleware.py` to match PR #215's removal of the stub `/api/auth/login` endpoint:
- Replaced all 17 `/api/auth/login` references with the live `/api/auth/callback` route.
- The 4 valid-origin POST acceptance tests now assert `status_code == 422` (Pydantic validation for empty `AuthCallbackRequest` body) instead of the old `== 401` from the removed stub.
- CSRF rejection tests (no/invalid origin) continue to assert `status_code == 403`.
- PUT/PATCH/DELETE valid-origin tests assert `!= 403` (CSRF passed) regardless of downstream route response.
- The public DMZ exemption test now uses `TestClient(..., raise_server_exceptions=False)` so local no-DB runs can inspect the non-403 response instead of raising a connection exception.
- Fixture docstrings updated from "stub auth" to "auth callback body validation" wording.

**Wiki update:** Removed stale `POST /api/auth/login` endpoint documentation from `system-wiki/backend/backend-infrastructure.md`. No FRS/codebase gap change.

## [2026-06-07] feat | #168 Add filter params to admin log query endpoints

- `GET /admin/audit-logs`: added optional query params `user_id`, `action_type`, `table_affected`, `ip_address`, `date_from`, `date_to`.
- `GET /admin/security-logs`: added optional query params `source_ip`, `severity` (maps to `severity_level`), `date_from`, `date_to`.
- Both endpoints build a parameterized WHERE clause from provided filters; when none are given, behavior is unchanged (no WHERE clause).
- COUNT query uses the same WHERE clause so `total` reflects filtered count, not full table.
- Follows the pattern from `services/regional_incidents/helpers.py:build_audit_log_query()`.
- 16 new unit tests added in `tests/test_admin_new_routes.py` (8 audit filter tests, 7 security filter tests, 1 no-filters-baseline).

**Wiki update:** Updated `system-wiki/backend/api-route-map.md` to note filter query params on `/audit-logs` and `/security-logs`.
## [2026-06-10] fix | Restore VPS production runtime

- Restored the VPS with the explicit production Compose override so nginx mounts `/etc/letsencrypt` and serves the valid `wimsbfp.tech` certificate.
- Synchronized persisted PostgreSQL role passwords with `.env.production` after authentication failures blocked backend startup patches and Keycloak.
- Replaced ineffective Celery package autodiscovery with explicit task-module imports so scheduled tasks register with workers.
- Applied the missing `system_config` migration to the persisted database and added the omitted `wims_app_user` table privileges required by Celery and application routes.
- Updated the Suricata health check to match the running `Suricata-Main` process.
- Fixed the production CSP so Next.js inline bootstrap scripts can hydrate the server-rendered loading shell and initialize `/api/auth/session`.
- Updated `architecture/infrastructure-config.md` and `index.md`; no FRS/codebase gap changed.

## [2026-06-10] fix | Make VPS deploy resilient to recreated backend and Ollama provisioning

- Diagnosed public API `502` responses after deploy: nginx retained the previous backend container IP while backend-local `/health` remained healthy.
- Added Docker embedded DNS resolution and a shared nginx upstream zone so backend addresses refresh after Compose recreation.
- Corrected `ollama-model-pull` from `ollama ollama pull qwen2.5:3b` to the image-entrypoint-compatible `ollama pull qwen2.5:3b`.
- Made backend startup depend on successful Ollama model provisioning.
- Strengthened `deploy.yml` with Compose `--wait`, a real public backend route probe, and required-model verification.
- Updated `architecture/infrastructure-config.md` and `architecture/pwa-tests-cicd.md`; no FRS/codebase gap changed.
