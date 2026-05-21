---
title: Functional Bug Register
created: 2026-05-14
updated: 2026-05-19
type: bug
tags: [wims-bfp, bug, functional, m12, needs-fix]
sources: []
status: open
---

# Functional Bug Register

Functional bugs reported by teammates during evaluation. All map to M12 User Management unless noted.

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

---

## Related
- [[gaps/ui-ux-gap-register]] — UI/UX improvement gaps
- [[gaps/frs-codebase-gap-register]] — FRS/codebase verification targets
- [[concepts/frs-module-map]] — M12 User Management module routing
