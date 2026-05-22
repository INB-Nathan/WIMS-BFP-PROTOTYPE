---
title: Admin Hub — 3-Iteration HCI/UI/UX Gap Register
created: 2026-05-19
updated: 2026-05-19
type: gap
tags: [wims-bfp, gap, ui-ux, hci, admin-hub, system-admin, iteration-audit]
sources: [system-wiki/subsystems/admin-hub.md, system-wiki/ui-ux/evaluation-system-admin-hub.md, system-wiki/gaps/ui-ux-gap-register.md, system-wiki/gaps/frs-codebase-gap-register.md]
status: open
iteration: 3
scope: /admin/system (System Admin Hub)
---

# Admin Hub — 3-Iteration HCI/UI/UX Gap Register

Three-pass audit of the System Administrator Hub (`/admin/system`) from a system admin perspective — covering architectural gaps, HCI failures, missing features, and micro-interaction issues. Findings are ordered by severity within category.

**Scope:** `src/frontend/src/app/admin/system/page.tsx` (986 lines) + `src/backend/api/routes/admin.py` (1085 lines)
**Method:** Systematic code traversal, backend API surface cross-reference, FRS M9 alignment check.

---

## CRITICAL — Must Fix Before Production

### GAP-A01: Backup Panel Entirely Absent from Frontend

**Severity:** CRITICAL
**Category:** Missing Feature — Backend exists, frontend not wired
**Files:** `src/frontend/src/lib/api.ts`, `src/frontend/src/app/admin/system/page.tsx`

The backend has full backup infrastructure implemented across 3 endpoints:
- `POST /api/admin/backup` — trigger `pg_dump` piped through AES-256-CBC encryption
- `GET /api/admin/backups` — list files with size + creation timestamp
- `GET /api/admin/backup/{filename}` — download via `FileResponse`

The frontend has **zero API calls** (`src/frontend/src/lib/api.ts` has no `triggerBackup`, `listBackups`, or `downloadBackup` functions) and **no backup section in the JSX** at all. The admin has no UI to trigger, list, or download backups — the entire capability is invisible.

**Impact:** Admins must `docker exec` into the container to trigger backups. No restore capability exists at all (see GAP-A02).

**Verification:**
```bash
grep -n "triggerBackup\|listBackups\|downloadBackup\|Backup" src/frontend/src/lib/api.ts   # returns nothing
grep -n "backup\|Backup" src/frontend/src/app/admin/system/page.tsx                       # returns nothing
```

**Source:** Backend admin.py lines 810–957; not referenced in frontend.

---

### GAP-A02: Backup Restore Functionality Not Implemented

**Severity:** CRITICAL
**Category:** Missing Feature
**FRS alignment:** Implied by backup management requirement (FRS M9 context)

The admin can trigger a backup and download the `.sql.enc` file, but there is **no restore capability whatsoever**. This is the single most dangerous gap — a system without restore is a system with no backup.

**What's missing:**
- Upload `.sql.enc` file back to the server (via multipart form)
- Decrypt with AES key (requires `OPENSSL_KEY` env var access)
- Run `psql` restore against the live database
- Danger-zone confirmation UX: admin must type the backup filename to confirm restore intent
- Pre-restore integrity verification (test decrypt before attempting restore)
- Audit log entry for restore actions

**Impact:** If the database fails, the admin has no path to recovery despite having backup files.

---

### GAP-A03: Scheduled Reports, Rate Limits, Worker Status, System Metrics — All Unwired

**Severity:** CRITICAL
**Category:** Missing Feature — Backend exists, frontend not wired

The backend has **16 route handlers**. The frontend surfaces only 6 panels (Users, Sessions, Threat Telemetry, System Audit, System Health, Create User modal). **10 backend route handlers are completely unwired:**

| Endpoint | Handler Function | Status |
|---|---|---|
| `GET /admin/rate-limits` | `get_rate_limits` | Not called from api.ts |
| `PATCH /admin/rate-limits` | `update_rate_limits` | Not called from api.ts |
| `GET /admin/scheduled-reports` | `list_scheduled_reports` | Not called from api.ts |
| `POST /admin/scheduled-reports` | `create_scheduled_report` | Not called from api.ts |
| `POST /admin/backup` | `trigger_backup` | Not called from api.ts |
| `GET /admin/backups` | `list_backups` | Not called from api.ts |
| `GET /admin/backup/{filename}` | `download_backup` | Not called from api.ts |
| `GET /admin/monitoring/workers` | `get_worker_status` | Not called from api.ts |
| `GET /admin/monitoring/system` | `get_system_metrics` | Not called from api.ts |
| `POST /admin/analytics/backfill` | `backfill_analytics` | Not called from api.ts |

**Impact:** The admin cannot configure rate limits, manage scheduled reports, view Celery worker health, see CPU/RAM/disk metrics, trigger analytics backfill, or manage backups via the UI. These are core administrative functions.

**Verification:**
```bash
grep -n "rate.limit\|scheduledReport\|worker\|monitoring\|backup" src/frontend/src/lib/api.ts   # returns nothing for these features
```

---

## HIGH — Fix Before Production

### GAP-A04: UserRow Inline Edit Uses Numeric Input for Region Instead of Named Dropdown

**Severity:** HIGH
**Category:** HCI / UX Inconsistency
**Files:** `src/frontend/src/app/admin/system/page.tsx` lines 970–973
**FRS alignment:** UI/UX gap register issue #A-05, evaluation-system-admin-hub

The `Create User` modal correctly uses a **dropdown `<select>`** populated from `fetchRegions()` (line 862–876). The inline `UserRow` edit (line 970–973) uses:
```tsx
<input type="number" value={editRegion} onChange={(e) => setEditRegion(e.target.value)} placeholder="—" className="border border-gray-300 rounded px-3 py-1.5 text-sm w-24" />
```

**Problem:** An admin editing a user sees "Region ID" with a numeric input. They must know that `region_id = 3` maps to "Cordillera Administrative Region (CAR)" without any reference. The Create User modal already loads `ref_regions` — the same dropdown should be used in the inline edit.

**Impact:** Easy mis-selection of wrong region. Admin has no context about what a numeric region ID represents.

---

### GAP-A05: Audit Log Shows Keycloak UUIDs Instead of Resolved Usernames

**Severity:** HIGH
**Category:** Readability / Data Presentation
**Files:** `src/frontend/src/app/admin/system/page.tsx` line 634

The System Audit table renders:
```tsx
<td className="... font-mono text-gray-600">{a.user_id ?? '—'}</td>
```

The `user_id` is a Keycloak UUID like `a3f82c1b-4d91-...`. The admin sees machine identifiers with no way to resolve them to human-readable names without cross-referencing the user list.

**Impact:** The most critical column in an audit log ("who did this") is unreadable at a glance. In a security incident, every second spent resolving a UUID is lost time.

**Fix:** Build a lookup map `user_id → username` from the already-loaded `users` array. Display `{username} ({masked uuid})` in the audit log, with the full UUID on hover.

---

## MEDIUM — Fix Within Current Sprint

### GAP-A06: Session Table Lacks Browser/OS Context

**Severity:** MEDIUM
**Category:** Data Not Surfaced
**Files:** `src/backend/api/routes/admin.py` line 461; `src/frontend/src/app/admin/system/page.tsx` line 532

The backend `get_active_sessions` returns `"clients": s.get("clients", {})` — Keycloak's per-session client metadata includes browser name, OS, and device information. This is not rendered in the Active Sessions table (Username, Role, IP Address, Last Access columns only).

**Impact:** Admin investigating a compromised account cannot identify which device was used. They see IP address but not whether the session came from Chrome on Windows or Safari on iPhone.

**Backend note:** The `clients` field in Keycloak session data does include user agent information. Verify by checking `adm.get_sessions(keycloak_id)` response shape — client metadata includes `clientName`, `ipAddress`, and session metadata.

---

### GAP-A07: Audit Log Has No Filter Controls (Date, User, Severity, Event Type)

**Severity:** MEDIUM
**Category:** Missing Feature
**FRS alignment:** FRS M9.b.i–iii — full filter suite required (date/time range, user ID, log severity, event type, full-text search, pagination 50/page)

The `get_audit_logs` endpoint accepts only `limit` and `offset` query params. The frontend renders the full paginated list with zero filter controls.

**What's missing:**
- Date range picker (start date / end date)
- User ID / username filter
- Action type filter (CREATE_USER, UPDATE_INCIDENT, etc.)
- Table affected filter
- Full-text search across action descriptions
- Sort controls per column

**Impact:** Admin investigating historical incidents must manually scroll through all audit entries. No way to find "all actions by user X in the last 24 hours."

---

### GAP-A08: Security Logs Have No Pagination — Returns All Rows

**Severity:** MEDIUM
**Category:** Missing Feature
**Files:** `src/frontend/src/app/admin/system/page.tsx` line 574; `src/backend/api/routes/admin.py` line 586

`fetchAdminSecurityLogs()` returns **all rows** from `wims.security_threat_logs` with no limit. In a production system with thousands of Suricata alerts, this freezes the browser.

**Also missing:** Severity column filter (CRITICAL/HIGH/MEDIUM/LOW), sort controls, date range filter.

---

### GAP-A09: "Action" Column Label in Threat Telemetry Is Ambiguous

**Severity:** MEDIUM
**Category:** Label Ambiguity
**Files:** `src/frontend/src/app/admin/system/page.tsx` line 569

The column header says "Action" and renders `admin_action_taken` — the admin's own disposition (e.g., "RESOLVED", "FALSE_POSITIVE", "Unreviewed"). An admin unfamiliar with the data model would interpret this as the Suricata rule action (alert, drop, reject).

**Fix:** Rename column to "Admin Review" or "Review Status" to clearly distinguish from IDS engine action.

---

### GAP-A10: No Scheduled Report Enable/Disable Toggle

**Severity:** MEDIUM
**Category:** Missing Feature
**Files:** `src/backend/api/routes/admin.py` line 789

The `wims.scheduled_reports` table has an `enabled` boolean column. The `list_scheduled_reports` query returns it. The frontend has no scheduled reports panel at all (GAP-A03), but even the raw data has no UI toggle.

**Impact:** If a scheduled report is malfunctioning (wrong recipients, corrupted output), the admin must delete and re-create it rather than simply disabling it.

---

### GAP-A11: "Total API Requests" Stat Hardcoded to "—"

**Severity:** MEDIUM
**Category:** Missing Feature
**Files:** `src/frontend/src/app/admin/system/page.tsx` line 379

```tsx
{ label: 'Total API Requests', value: '—', icon: BarChart3 },
```

This stat is scaffolded but never wired. No backend endpoint returns total API request count for the admin. The analytics materialized views exist (`wims.analytics_incident_facts`) and `backfill_analytics_facts` exists, but a direct API request-count metric is not available.

**Impact:** The System Analytics card is incomplete. For a system monitoring dashboard, total API request load is a fundamental metric.

---

## LOW — Fix Within Current or Next Sprint

### GAP-A12: Audit Timestamps Ignore Philippine Locale

**Severity:** LOW-MEDIUM
**Category:** Locale / Consistency
**Files:** `src/frontend/src/app/admin/system/page.tsx` line 633

```tsx
<a.timestamp ? new Date(a.timestamp).toLocaleString() : '—'</a>
```

The Sessions modal correctly uses `toLocaleString('en-PH', { timeZone: 'Asia/Manila' })` (line 731) but the audit table uses `toLocaleString()` with no arguments, defaulting to server locale. Audit timestamps may appear in the wrong timezone.

**Impact:** Admin sees timestamps without timezone context, making audit investigation error-prone when server and client locales differ.

---

### GAP-A13: Cannot Terminate Individual Sessions — Only "Terminate All" Per User

**Severity:** LOW-MEDIUM
**Category:** Missing Feature
**Files:** `src/frontend/src/app/admin/system/page.tsx` lines 535–541, 741–748; `src/backend/api/routes/admin.py` line 474

The Active Sessions table's "Force Logout" button revokes **all sessions** for that user. The per-user session modal also has only "Terminate All" — no per-session termination option.

The backend `force_logout_user` endpoint calls `adm.user_logout(user_id)` which is Keycloak's global logout per user, not per session.

**Impact:** If a user has 3 sessions and only one is suspicious, the admin must terminate all 3, logging out legitimate sessions unnecessarily.

---

### GAP-A14: UserRow Inline Edit Has No Escape Key Handler

**Severity:** LOW
**Category:** Accessibility
**Files:** `src/frontend/src/app/admin/system/page.tsx` lines 916–986

Pressing Escape while editing a UserRow does nothing. The only cancel path is clicking the Cancel button or toggling Edit again. Standard UX expectation is Escape = cancel.

---

### GAP-A15: Role Dropdown Shows Raw Keycloak Enum Values, Not Friendly Labels

**Severity:** LOW
**Category:** Label Clarity
**Files:** `src/frontend/src/app/admin/system/page.tsx` lines 932, 967

Role options display `REGIONAL_ENCODER`, `NATIONAL_VALIDATOR`, etc. — raw Keycloak role names. While technically accurate, they should display as "Regional Encoder", "National Validator", "National Analyst", "System Administrator" for readability.

---

### GAP-A16: "Actions" Column Header Has Only One Action — Should Be More Specific

**Severity:** LOW
**Category:** Label Clarity
**Files:** `src/frontend/src/app/admin/system/page.tsx` line 524

The Active Sessions table has one action ("Force Logout") but the column header says generic "Actions". Should be "Revoke" or "Terminate" to match the action button text.

---

### GAP-A17: "Terminate All" Button Has No Confirmation Step

**Severity:** LOW
**Category:** Confirmation UX
**Files:** `src/frontend/src/app/admin/system/page.tsx` lines 741–748

The "Terminate All" button executes immediately. Production admin consoles (AWS, GitHub, GCP) require a confirmation dialog for destructive user actions. No confirmation = risk of accidental termination.

---

### GAP-A18: Create User Success Modal: No Username Copy Button

**Severity:** LOW
**Category:** Asymmetry / UX
**Files:** `src/frontend/src/app/admin/system/page.tsx` lines 780–795

The success state shows username as plain static text and password with show/hide + copy buttons. Username has no copy button — asymmetric with password UX. Admin's next step after copying password is typically sharing the username via the same channel.

---

### GAP-A19: Audit Log and Active Sessions Have No Column Sorting

**Severity:** LOW
**Category:** Sorting / Usability
**Files:** `src/frontend/src/app/admin/system/page.tsx`

No sortable columns on any table. The audit log shows insertion order; sessions show last_access desc from backend. Admin cannot sort by timestamp, action type, or username.

---

### GAP-A20: Inconsistent Empty State Wording and No Initial-Load Skeleton

**Severity:** LOW
**Category:** Loading/Empty State
**Files:** `src/frontend/src/app/admin/system/page.tsx` lines 502, 547, 604, 643

Empty states use inconsistent phrasing:
- "No users found." (sentence case)
- "No active sessions found." (sentence case)
- "No Suricata alerts." (title case)
- "No audit entries." (sentence case)

Also: no skeleton or loading indicator on initial mount — just a blank white screen before data arrives.

---

### GAP-A21: Security Log Raw Payload Not Copyable or Searchable in Modal

**Severity:** LOW
**Category:** Tool / Usability
**Files:** `src/frontend/src/app/admin/system/page.tsx` lines 686–690

The raw payload is rendered as a `<pre>` block in a bounded-height scrollable div. It's not selectable as text, not copyable, and not searchable via Ctrl+F within the modal. The admin cannot easily copy the Suricata EVE JSON payload for external analysis (VirusTotal, abuse databases).

**Missing:** "Copy raw payload" button in the modal.

---

### GAP-A22: Tables Have No Keyboard Navigation Support

**Severity:** LOW
**Category:** Accessibility (WCAG 2.1 AA)
**Files:** `src/frontend/src/app/admin/system/page.tsx`

All tables require mouse interaction. Keyboard navigation (Tab, Arrow keys, Enter to open detail, Escape to close) is not implemented. Critical for audit log navigation (hundreds of rows) via keyboard.

---

### GAP-A23: Health Check Component Has No "Last Checked" Timestamp

**Severity:** LOW
**Category:** Transparency
**Files:** `src/frontend/src/app/admin/system/page.tsx` lines 409–456

System Health shows DB/Redis/Keycloak status with no "Last checked" indicator. FRS M9.a.ii requires 60-second auto-refresh (not implemented). Without auto-refresh, the admin has no way to know if displayed health is current or stale.

**Missing:** "Checked X seconds ago" timestamp on each health card.

---

### GAP-A24: Stat Cards Look Clickable But Are Not — False Affordance

**Severity:** LOW
**Category:** Affordance / UX
**Files:** `src/frontend/src/app/admin/system/page.tsx` lines 394–406

The three System Analytics cards (Total Users, Active Sessions, Total API Requests) look like interactive dashboard elements. They are static — not clickable, no hover state, no drill-down. Modern dashboards treat stat cards as clickable for detail views.

**Impact:** Admin may try clicking and find nothing happens, creating confusion about what the cards are for.

---

## Severity Summary

| Severity | Count | Gaps |
|---|---|---|
| CRITICAL | 3 | GAP-A01, GAP-A02, GAP-A03 |
| HIGH | 2 | GAP-A04, GAP-A05 |
| MEDIUM | 8 | GAP-A06 through GAP-A11 |
| LOW | 11 | GAP-A12 through GAP-A24 |

---

## Category Summary

| Category | Count |
|---|---|
| Missing Feature — Backend exists, frontend not wired | 2 (A01, A03 — partial) |
| Missing Feature — Not implemented at all | 5 (A02, A06, A07, A08, A10, A13) |
| HCI / UX Inconsistency | 1 (A04) |
| Readability / Data Presentation | 2 (A05, A15) |
| Label Ambiguity | 2 (A09, A16) |
| Locale / Transparency | 2 (A12, A23) |
| Accessibility | 2 (A14, A22) |
| Confirmation UX | 1 (A17) |
| Asymmetry / Micro-UX | 2 (A18, A20, A21) |
| Sorting / Pagination | 2 (A08, A19) |
| Missing Feature — Stat/not-wired | 2 (A11, A24) |
| Missing Feature — No enable/disable toggle | 1 (A10) |
| Affordance | 1 (A24) |

---

## Cross-Reference: Already Logged in Existing Gap Registers

| Gap | Existing Registration | Alignment |
|---|---|---|
| GAP-A04 | `ui-ux-gap-register.md` issue #A-05 — "Region selector UX uses increment/decrement" | Confirmed same issue |
| GAP-A07 | `ui-ux-gap-register.md` issue #A-07 — "No full-text filter/search" | Confirmed; expanded to full filter suite |
| GAP-A07 | `frs-codebase-gap-register.md` — M9.b full-text search (tsvector Gin Index) | FRS gap confirmed |
| GAP-A08 | `ui-ux-gap-register.md` issue #A-06 — "No pagination" | Confirmed for security logs |
| GAP-A10 | `ui-ux-gap-register.md` issue #A-05 — "No scheduled report toggle" | Confirmed |

**Existing gap register coverage:** 5 of 24 gaps are already logged. 19 gaps are new to this document.

---

## Recommended Priority Order

1. **GAP-A01 + GAP-A03** — Unwire the backup panel and 4 missing panels (Scheduled Reports, Rate Limits, Worker Status, System Metrics) as one coherent batch
2. **GAP-A02** — Implement backup restore with danger-zone UX — separate task due to risk
3. **GAP-A04** — Fix UserRow region dropdown (quick win, high impact)
4. **GAP-A05** — Resolve audit log UUID readability (quick win, high impact)
5. **GAP-A07** — Audit log filter controls (medium effort, FRS compliance)
6. **GAP-A08** — Security log pagination (medium effort, performance fix)
7. **GAP-A06, A09, A10, A11** — Session device context, label fixes, toggle, stat wiring
8. **GAP-A12 through A24** — Micro-interaction fixes, can be batched by category

---

## Related

- [[subsystems/admin-hub]] — full system admin hub documentation
- [[subsystems/references/admin-api-ref]] — all 16 route handlers documented
- [[ui-ux/evaluation-system-admin-hub]] — prior desk-check evaluation
- [[gaps/ui-ux-gap-register]] — existing UI/UX gap register (partial overlap)
- [[gaps/frs-codebase-gap-register]] — FRS gap register (partial overlap)
- [[security/security-baseline]] — auth and audit baseline