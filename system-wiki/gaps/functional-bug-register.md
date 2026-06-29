---
title: Functional Bug Register
created: 2026-05-14
updated: 2026-06-10
type: bug
tags: [wims-bfp, bug, functional, m12, needs-fix]
sources: []
status: open
---

# Functional Bug Register

Functional bugs reported by teammates during evaluation. All map to M12 User Management unless noted.

---

## M1 Auth / Keycloak Theme Bugs

| # | Bug | Detail | Reported By | Status |
|---|---|---|---|---|
| F-10 | TOTP setup page left-edge clipping | `.pf-v5-c-login__main` base `overflow: hidden` with min horizontal padding 0.75rem (12px) clips the `.wims-totp-setup` card's box-shadow and step-number circles on desktop. Fix: raised panel min padding to 1.5rem (24px) on TOTP pages via `:has(.wims-totp-setup)` override; raised card left/right padding to `clamp(1.25rem,2vw,1.5rem)`; raised step-item left padding `0.5rem` → `0.9rem`. CSS-only. #231. | Issue triage | Fixed in code; pending visual verify |
| F-13 | RP-19: Self-service LOGOUT not recorded in audit trail | `logout()` in `AuthContext.tsx` called `/api/auth/logout` (session teardown) and `signoutRedirect` without first recording the event in `wims.system_audit_trails`. Keycloak owns the credential check and backend session revocation, but the non-repudiation record was missing — a user could deny initiating the logout. Fix: `logout()` now POSTs `{ event_type: "LOGOUT", username }` to `POST /api/auth/security-event` (auth.py, added in prior PR batch) with 1500ms AbortController timeout, `.catch(()=>{})` fail-safe; session teardown always continues regardless of outcome. Backend endpoint already existed (RP-08+RP-18+RP-19 handler). AuditGapsPlan-v2.md WS-A. | Audit gap review | Fixed in fix/rp19-logout-audit |

---

## M1 Auth Non-Repudiation Gaps (Keycloak SPI)

| # | Gap | Detail | Source | Status |
|---|---|---|---|---|
| F-13 | RP-08: No FAILED_LOGIN audit for true credential rejections | `src/frontend/src/app/callback/page.tsx:43-46` fires `FAILED_LOGIN` to `/api/auth/security-event` only when the OIDC callback succeeds but `/api/auth/sync` fails — a rare post-auth sync error. True Keycloak credential rejections (wrong password, disabled account, brute-force lockout) happen entirely inside Keycloak and never reach WIMS. No `FAILED_LOGIN` row is written for the most common attack vector. Root cause: no Keycloak EventListener SPI. **Fix (WS-B):** New `wims-audit-event-listener` Keycloak SPI (`src/keycloak/wims-audit-event-listener/`) pushes `LOGIN_ERROR` and `USER_DISABLED_BY_BRUTE_FORCE` events to `POST /api/auth/keycloak-event`. Backend maps both → `FAILED_LOGIN`/`failure` in `wims.system_audit_trails`. Env: `WIMS_KEYCLOAK_EVENT_SECRET` (shared Bearer token). | RP-08 Repudiation Pentest 2026-06-22 | Fixed in code; PR feat/rp08-rp18-keycloak-event-spi pending merge |
| F-14 | RP-18: No PASSWORD_RESET audit — Keycloak-native flow | The WIMS login page has no forgot-password link; it calls `signinRedirect()` to Keycloak directly. The entire password-reset flow (reset-credentials form, email dispatch, token validation) runs on Keycloak-hosted pages. `POST /api/auth/security-event` with `event_type=PASSWORD_RESET` exists in the backend but has **zero frontend callers** — no WIMS code ever triggers the flow. Root cause: same as RP-08 — no Keycloak EventListener SPI. **Fix (WS-B):** Same `wims-audit-event-listener` SPI captures `UPDATE_PASSWORD` (user completes reset) and `RESET_PASSWORD_EMAIL` (email dispatched) events and maps both → `PASSWORD_RESET`/`success` in `wims.system_audit_trails`. | RP-18 Repudiation Pentest 2026-06-22 | Fixed in code; PR feat/rp08-rp18-keycloak-event-spi pending merge |
| F-15 | RP-06: NSD direct-edit not detected by verify_incident_hash_chain | `verify_incident_hash_chain()` returned `"unverified"` (not `"tampered"`) for incidents with no IVH correction chain and never recomputed `data_hash` from current NSD — a direct `UPDATE wims.incident_nonsensitive_details` bypassing the correction flow was fully undetectable. Root cause: scalar `data_hash` fetch happened only after the early-return, so the recompute path was never reached for no-chain incidents. **Fix (WS-D):** Provenance join runs before the early return; `compute_incident_data_hash()` called on every read; mismatch → `"tampered"` + `INTEGRITY_VIOLATION` audit row. `_backfill_verified_data_hash()` startup patch covers seeded VERIFIED incidents with NULL hash. Integration test: `tests/integration/test_rp06_nsd_tamper.py`. | Audit gap review 2026-06-28 | Fixed in fix/ws-d-rp06-rp14-audit; PR pending |
| F-16 | RP-14: Analytics bulk exports invisible to anomaly detectors | `POST /api/admin/privacy/export` correctly wrote `PII_EXPORT` to `system_audit_trails`, but CSV/PDF/Excel Celery exports via `/api/analytics/export/{csv,pdf,excel}` wrote only to `analytics_export_log` — a separate table not scanned by `OFF_HOURS` or `SUSPICIOUS_QUERY_PATTERN` detectors. Exfiltration via repeated bulk exports would not trigger any anomaly alert. **Fix (WS-D):** `_insert_export_log()` in `tasks/exports.py` now also calls `log_system_audit(..., "BULK_EXPORT", ...)` in the same DB transaction; non-fatal if audit write fails (analytics_export_log row still commits). | Audit gap review 2026-06-28 | Fixed in fix/ws-d-rp06-rp14-audit; PR pending |

---

## M12 User Management Bugs

| # | Bug | Detail | Reported By | Status |
|---|---|---|---|---|
| F-01 | System Audit record_id shows "-" on create user | Admin system audit log shows `"-"` for `record_id` when the action is create user, instead of the actual newly created user ID. Indicates the audit logger is not capturing the returned ID from the user creation flow. | Teammate | Needs investigation |
| F-02 | First login allows empty First Name, Last Name, device name | Users can complete login without providing First Name, Last Name, and device name on first login. Keycloak user profile required-attribute validation is not being enforced on the frontend or is being bypassed. | Teammate | Needs fix |
| F-03 | No username change screen on first login | Admin expects new users to change their username on first login (e.g., from a temporary/department default to their real username). No UI screen or prompt exists for this — the incorrect username persists indefinitely. | Teammate | Needs implementation |
| F-04 | Session lifespan too short / aggressive logout | Users are logged out too quickly during normal workflow. Likely Keycloak token timeout set too aggressively in the realm or client config. | Teammate | Needs config review |
| F-05 | No account recovery if TOTP authenticator is deleted | If a user deletes their TOTP authenticator device, there is no fallback or admin-assisted recovery path — the account is permanently inaccessible. Requires admin Keycloak intervention or a backup codes flow. | Teammate | Needs recovery flow |
| F-07 | Forgot-password tests fail on reset flow executions and SMTP preflight | Keycloak password-reset integration tests failed because the test helper called the reset-flow executions endpoint by internal flow ID instead of alias. Fixed test helper to URL-encode/use flow alias and configured dev realm SMTP defaults for MailHog. | Local pytest | Fixed in code |

---

## M5 National Analyst Bugs

| # | Bug | Detail | Reported By | Status |
|---|---|---|---|---|
| F-06 | Analyst incident list returns HTTP 500 | `/api/incidents/analyst-list` selected schema fields that do not exist in the current database contract (`nd.barangay`, `r.short_name`, `aif.casualty_severity`, `aif.data_hash`, `aif.sync_status`). Fixed by using `ref_barangays` / `analytics_incident_facts.barangay_name`, `ref_regions.region_code` / `region_name`, deriving casualty severity from casualty counts, and reading `data_hash` from `fire_incidents`. Regression coverage added in `src/backend/tests/test_analyst_incidents_sql_contract.py`. | User manual test | Fixed in code; smoke-checked against local Postgres; browser should now show an empty list when no incidents exist |
| F-08 | Export PDF/CSV/Excel returns 409 Conflict on analyst incident detail page | Celery task failed with `PermissionError: [Errno 13] Permission denied: '/app/storage/exports'` because the Docker named volume `incident_attachments_data` was mounted at `/app/storage` and the Celery worker's `appuser` could not create the `exports` subdirectory (volume owned by `root:root`). Also, the bulk export task used a writer expecting 3 args `(path, rows, columns)` but the internal API passed only 2. Fixed by: (1) adding `mkdir -p /app/storage/exports` in Dockerfile before image build; (2) creating `_write_csv_bulk / _write_xlsx_bulk / _write_pdf_bulk` adapter wrappers; (3) implementing AFOR-template-based writers `_write_afor_excel`, `_write_afor_pdf`, `_write_afor_csv` for single-incident exports. | User on localhost/dashboard/analyst/incidents/12 | Fixed in code; rebuild complete; testing pending |
| F-09 | All 8 map components show blank tiles / 403 in prod | nginx prod HTTPS block sent `Referrer-Policy: no-referrer`, suppressing the Referer header required by OSM tile servers. Affected: PublicFireMapInner, MapPickerInner, ClusterMapInner, NearbyPublicReportAreasInner, NearbyStationsMapInner, ValidatorMapInner, FireStationsMapInner, HeatmapViewer. Fix: `src/nginx/nginx.conf` HTTPS block — `Referrer-Policy: strict-origin-when-cross-origin`. #233. Regression test added in `test_nginx_referrer_policy_production` (`tests/test_infra_config.py`). | Issue triage | Fixed in code; regression test added (#253); pending VPS deploy |


---

---

## M3 Triage UI Enhancements

| # | Enhancement | Detail | Status |
|---|---|---|---|
| F-11 | Triage queue HCI polish | Split clusters/singletons into separate tables, mode-aware inspection modal, metrics bar, empty states, Unreviewed filter chip. #219. | Implemented |

---

## M4 Operations

| # | Enhancement | Detail | Status |
|---|---|---|---|
| F-12 | Validator-maintained Operations Board | Replaced auto-derived ON-GOING/FIRE-OUT cards with editable board. wims.operations + junction table (migration 51). RLS-gated writes (NATIONAL_VALIDATOR only), global reads. CRUD + audit log. /home UI: tabs, status badge, validator-only forms. #232. | Implemented |

---

---

## Security / Audit Integrity

| # | Bug | Detail | Reported By | Status |
|---|---|---|---|---|
| F-13 | RP-20: Direct DB INSERT into `wims.fire_incidents` not detected | An INSERT executed directly via psql/admin tool (bypassing the application session) was not detected or recorded in `wims.system_audit_trails`. Any user with direct database access could insert incidents without leaving an audit trail, breaking non-repudiation for the official incident record. Fix: `63_fire_incidents_insert_audit_trigger.sql` — AFTER INSERT SECURITY DEFINER trigger that fires when `app.audit_source` GUC is absent/not `'app'` and writes `DIRECT_DB_INSERT` to `system_audit_trails`; `get_db()` and `get_db_with_rls()` now execute `SET LOCAL app.audit_source = 'app'` to suppress the trigger for all legitimate application paths. Branch `fix/rp20-direct-insert-audit`. | Security audit (WS-C) | Fixed in code; PR pending |
| F-15 | RP-07: Non-encoder logins not logged as USER_LOGIN | Only `REGIONAL_ENCODER` logins produced a `USER_LOGIN` audit row (frontend-only `POST /api/regional/login-event` in `callback/page.tsx`). Validators, analysts, and admins left no login audit trail. Fix: Added `EventType.LOGIN` to `WimsAuditEventListenerProvider.CAPTURED_EVENTS` so the Keycloak SPI captures all successful logins; added `"LOGIN"` mapping to `_KEYCLOAK_EVENT_MAP` in `security_events.py`; removed the role-gated frontend `login-event` call. Branch `AuditMoreGapsFix`. | RP-07 Repudiation Pentest | Fixed in code; PR pending |
| F-16 | RP-09: Regional encoder create not in system_audit_trails | `encoder_crud.create_incident` wrote to `incident_verification_history` (`CREATED_DRAFT`) but never called `log_system_audit`, so `system_audit_trails` had no record of regional encoder incident creation. Fix: Added `log_system_audit('CREATE_INCIDENT')` after the IVH insert, mirroring the national create path. Branch `AuditMoreGapsFix`. | RP-09 Repudiation Pentest | Fixed in code; PR pending |
| F-17 | RP-23: Audit-log export action not itself audited | The audit-log CSV export endpoints streamed CSV but never called `log_system_audit`. A SYSTEM_ADMIN or NATIONAL_VALIDATOR could deny exporting sensitive audit data. Fix: Added `log_system_audit('AUDIT_EXPORT')` to both `admin/audit.py:export_audit_logs` and `validator.py:export_validator_audit_logs`; added `AUDIT_EXPORT` to OFF_HOURS high-sensitivity actions. Branch `AuditMoreGapsFix`. | RP-23 Repudiation Pentest | Fixed in code; PR pending |
| F-18 | RP-26: No password-reset abuse anomaly detector | No app-level anomaly detector for `PASSWORD_RESET` bursts (nginx rate-limits at network level, Keycloak SPI logs each event, but no anomaly was created). Fix: New `_detect_password_reset_abuse` detector — >5 `PASSWORD_RESET` actions per user in 15-min window → MEDIUM anomaly. Added to `_DETECTORS` (now 6). Branch `AuditMoreGapsFix`. | RP-26 Repudiation Pentest | Fixed in code; PR pending |

---

## Related
- [[gaps/ui-ux-gap-register]] — UI/UX improvement gaps
- [[gaps/frs-codebase-gap-register]] — FRS/codebase verification targets
- [[concepts/frs-module-map]] — M12 User Management module routing
