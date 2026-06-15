# Manual Smoke Tests — Admin, Validator, Analyst

Use this runbook for manual smoke checks before filing bugs. Each tester should record **pass/fail**, evidence, and one issue per independent failure.

## Safety and evidence rules

- Use test accounts and test data whenever possible.
- Do not perform destructive production actions unless the tester confirms the data and impact are safe.
- Redact passwords, tokens, cookies, Authorization headers, names, phone numbers, exact coordinates, and unnecessary PII from screenshots/logs.
- Keep DevTools open on **Console** and **Network** during each smoke pass.
- For failures, capture: screenshot, full URL, role/account type, timestamp/timezone, browser/device, console error, failed network request/status/response, and backend/nginx logs if available.

Optional local log capture:

```bash
cd src
docker compose logs --since 15m backend nginx-gateway
```

## Result format for teammates

```md
### Smoke result
Step ID:
Role:
Environment: local | VPS production | staging | other
URL/route:
Browser/device:
Time observed:
Result: PASS | FAIL | BLOCKED | NOT TESTED

Expected:
Actual:
Evidence:
- screenshot:
- console error:
- network request/status:
- backend/nginx logs:
Notes:
```

## Issue template for failures

```md
## Manual smoke-test failure
Role: Admin | Validator | Analyst
Environment: VPS production | local | other
URL/route:
Time observed:
Browser/device:
User/test account type:

## Steps to reproduce
1.
2.
3.

## Expected

## Actual

## Evidence
- screenshot:
- console error:
- network request/status:
- backend/nginx logs if available:

## Initial triage notes
- suspected area:
- likely regression from PR/commit if known:
- severity:

## Acceptance criteria
- [ ] behavior fixed
- [ ] regression test added where practical
- [ ] manual smoke step passes
```

Suggested labels after triage: `bug`, `needs-triage`, role label if available, `frontend`/`backend`/`security` if available, and priority by impact.

---

# System Admin smoke test

Assumptions:
- Tester has a `SYSTEM_ADMIN` account.
- For create/edit/delete actions, use a safe test environment or explicitly confirmed test data.
- If seeded data is missing, mark the step `BLOCKED` and record what data is needed.

| Step ID | Route/page | Manual action | Expected result | Failure evidence to capture |
|---|---|---|---|---|
| ADM-01 | `/login` | Log in as system admin. | Redirects to `/admin/system` or admin dashboard; no auth loop. | Screenshot, final URL, console/network auth errors. |
| ADM-02 | `/admin` | Visit `/admin` directly. | Redirects to `/admin/system` cleanly. | Screenshot, redirect URL, console errors. |
| ADM-03 | `/admin/system` | Wait for hub cards, monitoring, health, users, sessions, telemetry, audit, scheduled reports. | Hub loads with clear loading/empty/error states; no stuck spinners. | Screenshot, failed `/api/admin/*` requests. |
| ADM-04 | `/admin/system` System Monitoring/Health | Click Refresh for monitoring and health. | Metrics and component health refresh; status is understandable for quiet/no-data services. | Screenshot before/after, health API response. |
| ADM-05 | `/admin/system` Celery Workers | Inspect worker table. | Worker status, active tasks, last seen are understandable; stale/offline rows do not overwhelm UI. | Screenshot, worker count, failed worker API. |
| ADM-06 | `/admin/system` Identity Governance | Search/list users; inspect username, role, region, active state. | User list is usable; deprecated roles are not offered in create/edit paths. | Screenshot, user row with PII redacted. |
| ADM-07 | `/admin/system` Identity Governance | Create a test user if environment is safe. | User is created; temporary credential handling is clear; no secret is logged or exposed beyond intended one-time display. | Username only, screenshot with password redacted, network status. |
| ADM-08 | `/admin/system` Identity Governance | Edit a test user role/region/active status if safe. | Valid roles/regions are enforced; save gives clear success/failure feedback. | Before/after screenshots, failed PATCH request. |
| ADM-09 | `/admin/system` Active Sessions | Open sessions for a test user; terminate/revoke only if safe. | Sessions are listed and action result is clear; failures show visible errors. | Username, session count, failed request. |
| ADM-10 | `/admin/system#telemetry` | Search/load Threat Telemetry, open a Suricata alert. | Alert list and detail modal load; raw payload, XAI, action state are understandable. | Alert ID, screenshot, failed security-log API. |
| ADM-11 | `/admin/system#telemetry` | On a test alert, run Confirm Threat / False Positive / Find Related Logs when available. | Action persists, UI refreshes, and audit/log evidence is created. Confirm Threat creates or links an incident if implemented. | Alert ID, action, before/after screenshot, network request. |
| ADM-12 | `/admin/system#telemetry` | Create Incident from a test alert if available. | Created incident appears in the expected alert-created incident location and System Audit. | Alert ID, incident ID, audit row screenshot. |
| ADM-13 | `/admin/monitoring` | Open Security Monitoring and wait for summary, threat feed, XAI narratives, audit highlights. | Page has clear loading/empty/error states; feed pagination/filtering works where implemented. | Screenshot, console errors, failed summary/feed APIs. |
| ADM-14 | `/admin/anomalies` | Load anomalies; filter by status/type; ACK/RESOLVE a seeded test anomaly if present. | Counts/filters/actions are understandable; no anomalies empty state is clear. | Anomaly ID, screenshots, failed request. |
| ADM-15 | `/admin/breach` | Open breach records; inspect NPC deadline, status, related threat log. | Deadlines/statuses are clear; overdue records are highlighted; related log link is useful. | Breach ID, screenshot. |
| ADM-16 | `/admin/breach` | Advance a test breach status only if safe. | Confirmation/feedback is clear; status persists and is audit logged. | Before/after status, note/evidence, failed request. |
| ADM-17 | `/admin/system#audit` or dedicated audit page | Search audit logs for recent admin actions and `CREATE_INCIDENT`. | Rows show timestamp, user/actor, action, table/resource, record, real client IP where available. | Audit row screenshot, IP expectation, failed audit API. |
| ADM-18 | `/admin/system#scheduled-reports` | Create/toggle/delete a test scheduled report if safe. | Form is understandable; schedule appears, toggles, deletes, and errors are visible. | Report name, screenshots, failed request. |
| ADM-19 | `/admin/system/config` | Review and safely update a non-sensitive test config value if available. | Config loads, validation is clear, save is audit logged; no secrets are exposed. | Config key, before/after, failed request. |
| ADM-20 | Sidebar/admin navigation | Click all admin navigation items. | Routes load without 404/500; active nav is understandable. | Route, screenshot, console/network errors. |

---

# National Validator smoke test

Assumptions:
- Tester has a `NATIONAL_VALIDATOR` account.
- Approval/rejection actions must use test incidents only.
- If MFA skip behavior is being tested, use seeded validator accounts configured for that scenario.

| Step ID | Route/page | Manual action | Expected result | Failure evidence to capture |
|---|---|---|---|---|
| VAL-01 | `/login` | Log in as national validator. | Redirects to `/dashboard/validator`; no admin pages exposed. | Screenshot, final URL, auth console/network errors. |
| VAL-02 | `/dashboard/validator` | Wait for dashboard, queue, counts, badges. | Dashboard loads; pending/verified/rejected indicators render. | Screenshot, failed validator queue API. |
| VAL-03 | `/dashboard/validator` | Change status/date/region/search filters. | Queue and counts update consistently; no stuck spinner. | Filters used, before/after screenshots. |
| VAL-04 | `/dashboard/validator` | Open an incident from the queue. | Incident detail or drawer loads with validation context. | Incident ID, screenshot, failed detail API. |
| VAL-05 | Incident detail/queue | Approve/verify a test pending incident. | Status changes, queue updates, success feedback appears, audit row exists if visible. | Incident ID, before/after status, network request. |
| VAL-06 | Incident detail/queue | Reject or request resubmission for a test incident with reason. | Reason validation works; status/reason persist; feedback is clear. | Reason used, incident ID, failed request. |
| VAL-07 | `/dashboard/validator` | Use bulk approve/action if enabled on test incidents. | Confirmation appears; selected rows update correctly. | Selected IDs, before/after screenshot. |
| VAL-08 | `/dashboard/validator/audit` | Search/filter validator audit trail for recent action. | Validator action appears with correct user, time, action, incident. | Audit row screenshot, failed API. |
| VAL-09 | `/dashboard/validator/map` | Toggle status filters and click marker/cluster. | Map loads; filters affect markers; popup/detail works. | Screenshot, failed map/cluster API. |
| VAL-10 | `/dashboard/validator` | Navigate away/back and refresh page. | State reloads cleanly; no hydration/auth error. | Screenshot, console errors. |
| VAL-11 | Offline mode | In DevTools set Network Offline, then navigate dashboard or perform a supported safe action. | UI shows offline/cached/queued state instead of crashing. | Screenshot, console errors, queued op ID if shown. |
| VAL-12 | Offline sync | Return Network Online and wait for sync. | Queued operation syncs once; no duplicate status update. | Before/after screenshots, replayed network requests. |
| VAL-13 | Conflict UI | If a sync conflict appears, open and resolve it. | Conflict message is clear; chosen resolution persists. | Screenshot, conflict details with PII redacted. |
| VAL-14 | Dashboard widgets | Add/reorder/remove widgets if available. | Widget layout persists after refresh. | Before/after screenshot, console errors. |
| VAL-15 | Access control | Try `/admin/system` and `/dashboard/analyst`. | Validator is denied or redirected cleanly; no data leak. | Final URL, HTTP status, screenshot. |

---

# National Analyst smoke test

Assumptions:
- Tester has a `NATIONAL_ANALYST` account.
- Analyst actions are expected to be read-only unless the UI explicitly states otherwise.
- Use a dataset with at least a few verified incidents for meaningful analytics checks.

| Step ID | Route/page | Manual action | Expected result | Failure evidence to capture |
|---|---|---|---|---|
| ANA-01 | `/login` | Log in as national analyst. | Redirects to `/dashboard/analyst`. | Screenshot, final URL, auth console/network errors. |
| ANA-02 | `/dashboard/analyst` | Wait for dashboard cards/charts/maps/list. | No stuck loading states; charts/cards/heatmap render. | Screenshot, failed analytics APIs. |
| ANA-03 | `/dashboard/analyst` | Apply date/province/municipality/type filters. | Charts, maps, and incident list update consistently; active filters are visible. | Filters used, before/after screenshots. |
| ANA-04 | `/dashboard/analyst` | Open export preview for CSV/PDF/Excel if available. | Preview opens; download starts or clear unavailable/offline message appears. | Format, screenshot, failed export request. |
| ANA-05 | `/dashboard/analyst/comparative` | Open Comparative workflow. | Route loads with filters/table/chart; no 404/500. | Screenshot, failed API. |
| ANA-06 | `/dashboard/analyst/heatmap` | Open Heatmap workflow and inspect map. | Heatmap loads with correct aspect/coverage; filters work. | Screenshot, map console errors. |
| ANA-07 | `/dashboard/analyst/trends` | Open Trends workflow. | Trend chart/table loads; filters work. | Screenshot, failed API. |
| ANA-08 | `/dashboard/analyst/response-time` | Open Response Time workflow. | Response-time analytics load; empty states are clear. | Screenshot, failed API. |
| ANA-09 | `/dashboard/analyst/top-n` | Open Top-N workflow. | Ranking/table loads; filters and pagination work. | Screenshot, failed API. |
| ANA-10 | `/dashboard/analyst/incident-explorer` | Select rows, paginate, check selected count. | Selection persists as designed; labels are clear. | Selected count, screenshots. |
| ANA-11 | Analyst incident list/detail | Open an incident from analyst list. | `/dashboard/analyst/incidents/{id}` loads as read-only detail; copy incident ID works. | Incident ID, screenshot, failed request. |
| ANA-12 | Wildland detail | Open `/dashboard/analyst/incidents/{id}/wildland` for applicable incident. | Wildland view loads or shows clean not-applicable message. | Incident ID, screenshot. |
| ANA-13 | Integrity/hash status | Inspect incident detail integrity/hash-chain display if present. | Integrity status renders without crash or misleading blank state. | Screenshot, console/network errors. |
| ANA-14 | Dashboard widgets | Add/reorder/remove widgets if enabled. | Layout persists after refresh. | Before/after screenshots. |
| ANA-15 | Offline/read cache | In DevTools set Network Offline and revisit dashboard/workflow. | Cached read-only data or clear offline state appears; no crash. | Screenshot, console errors, failed network request. |
| ANA-16 | Access control | Try `/admin/system` and validator-only routes. | Analyst is denied or redirected cleanly; no admin/validator data leak. | Final URL, screenshot, HTTP status. |
| ANA-17 | Security pages if product allows | Try `/admin/monitoring` and `/admin/anomalies` only if analyst access is expected. | Either authorized view loads or access is cleanly denied. | Screenshot, final URL, failed API. |
