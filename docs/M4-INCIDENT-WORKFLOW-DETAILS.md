# M4: Incident Workflow (REGIONAL_ENCODER + NATIONAL_VALIDATOR)

**Status:** Complete — all 9 original issues closed or explicitly deferred; 3 systems added beyond spec
**Open Issues:** 1 deferred (M4-D per-row duplicate decision UI)
**Created:** 2026-04-27
**Updated:** 2026-05-10

---

## Milestone Overview

End-to-end incident lifecycle from encoding through verification. This milestone covers the complete workflow for Regional Encoders to create and edit incidents, and National Validators to review and approve them.

**Key Stakeholders:**
- **REGIONAL_ENCODER**: Creates, imports, and edits incidents
- **NATIONAL_VALIDATOR**: Reviews, approves, rejects, archives, and audits incidents

---

## Implementation Status

| Issue | Title | Status |
|-------|-------|--------|
| M4-A | Incident Creation with PostGIS Location | ✅ Complete |
| M4-B | Incident Edit (Own, Non-Verified Only) | ✅ Complete |
| M4-C | AFOR Spreadsheet Import | ✅ Complete |
| M4-D | Duplicate Detection on Import — per-row UI | ⏸ Deferred |
| M4-E | Draft Save + Auto-expiry | ✅ Complete |
| M4-F | National Validator Verification Queue | ✅ Complete + Enhanced |
| M4-G | Side-by-Side Diff View | ✅ Complete + Enhanced |
| M4-H | Bulk Approve | ✅ Complete |
| M4-I | Validator Audit Trail Viewer | ✅ Complete |
| — | Encoder Audit Trail | ✅ Added (beyond spec) |
| — | Duplicate Detection System (Encoder + Validator) | ✅ Added (beyond spec) |
| — | Incident Archive & REPLACED Status | ✅ Added (beyond spec) |
| — | Reference Number Generation | ✅ Added (beyond spec) |
| — | Regional RBAC (18 encoder accounts + region enforcement) | ✅ Added (beyond spec) |

---

## Issues Detail

### M4-A: Incident Creation with PostGIS Location
**Priority:** High | **Status:** ✅ Complete

#### Implemented
- `POST /api/regional/incidents` — creates incident with full AFOR form data
- `fi.location` stored as `ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography`
- MapPickerInner component with pin-drop, search bar, and read-only view mode
- Full AFOR form covering all required sections (A–L): alarm timeline, personnel, damage, narrative
- Draft → Submit → PENDING → VERIFIED lifecycle fully wired
- Reference number generated on first VERIFIED transition (format: `AFOR-RGN-{region}-{station}-{type}-{month/year}-{seq}`)
- All timestamps stored UTC, displayed in Asia/Manila (PHT) via `toLocaleString('en-PH', { timeZone: 'Asia/Manila' })`

#### Required Field Validation
- Backend: `PATCH /incidents/{id}/submit` validates `province_district` and `city_municipality` before allowing PENDING status (HTTP 422 if missing)
- Frontend: Province/District, City/Municipality, Prepared by, Noted by are required in IncidentForm
- Draft-submit modal: clicking "Submit for Review" on the detail page checks required fields from `detail` data and shows a modal listing missing fields with "Continue Editing" / "Dismiss" buttons

#### Exit Criteria
- [x] Encoder can create incident with map-picked coordinates
- [x] Incident appears in regional incident list
- [x] Required fields enforced in both frontend and backend

---

### M4-B: Incident Edit (Own, Non-Verified Only)
**Priority:** High | **Status:** ✅ Complete

#### Implemented
- `PATCH /api/regional/incidents/{id}` with full AFOR field updates
- Edit mode on `/dashboard/regional/incidents/[id]` — edit icon visible only to encoder for non-VERIFIED incidents
- IncidentForm component with `initialData` hydration; time fields loaded from `alarm_timeline._response` JSONB
- Audit trail: `action_label='EDITED'` written after each draft edit

#### Exit Criteria
- [x] Encoder can edit their own non-VERIFIED incidents
- [x] Encoder cannot edit VERIFIED incidents (UI guard)
- [x] Edit creates audit trail entry

---

### M4-C: AFOR Spreadsheet Import
**Priority:** High | **Status:** ✅ Complete

#### Implemented
- `POST /api/regional/incidents/import` — multipart/form-data xlsx upload
- Parser: `parse_wildland_afor_report_data` and structural AFOR formats
- Response: `{created, updated, duplicates, errors: [{row, message}]}`
- `/afor/import` page with drag-and-drop upload → redirects to manual form for correction
- `POST /api/regional/incidents/upload-bundle` — region enforcement (403 REGION_MISMATCH if encoder submits for wrong region)

#### Exit Criteria
- [x] Encoder can import AFOR xlsx and see summary
- [x] Import errors shown per row
- [x] Region enforcement on upload-bundle

---

### M4-D: Duplicate Detection on Import — Per-Row UI
**Priority:** High | **Status:** ⏸ Deferred

#### Implemented (automatic detection only)
- Import pipeline calls `check_for_duplicate()` before committing each row
- Duplicate rows are counted in the summary response under `duplicates`
- Skip behavior is the default (duplicate rows are not imported)

#### Deferred
- **Per-row UI decision** — encoder cannot currently choose skip / merge / force-create on a per-row basis. All duplicates are silently skipped. The spec calls for a confirmation modal before commit.

#### Exit Criteria
- [x] Import detects duplicates
- [x] Duplicate rows reported in summary
- [ ] Encoder chooses skip / merge / force per duplicate before commit *(deferred)*

---

### M4-E: Draft Save + Auto-Expiry
**Priority:** Medium | **Status:** ✅ Complete

#### Implemented
- `POST /api/regional/incidents` with `verification_status = DRAFT` on initial save
- `GET /api/regional/incidents/drafts` — encoder's own drafts only
- `PATCH /api/regional/incidents/{id}` — update draft fields; writes `action_label='DELETED_DRAFT'` on delete
- `POST /api/regional/incidents/{id}/submit` — transition DRAFT → PENDING
- `/dashboard/regional/drafts` list page
- Drafts excluded from validator queue (`status != DRAFT` filter)
- `tasks/drafts.py` Celery periodic task: `expire-stale-drafts-daily` — expires DRAFT incidents older than 30 days
- `celery_config.py` beat schedule entry

#### Exit Criteria
- [x] Encoder can save and resume drafts
- [x] Drafts do not appear in validator queue
- [x] Drafts auto-expire after 30 days

---

### M4-F: National Validator Verification Queue
**Priority:** High | **Status:** ✅ Complete + Enhanced

#### Implemented (original spec)
- `GET /api/regional/validator/incidents` — **cross-region** (all regions, not just assigned)
- `PATCH /api/regional/incidents/{id}/verification` — accept / reject / pending actions
- Audit trail entry per action via `incident_verification_history`
- `/dashboard/validator` queue page with filters, pagination, status badges

#### Implemented (enhancements beyond spec)
- **Status values extended:** `REPLACED` added alongside `DRAFT`, `PENDING`, `PENDING_VALIDATION`, `VERIFIED`, `REJECTED`
- **action_label column** on `incident_verification_history` — human-readable label per action (`APPROVED`, `REJECTED`, `BULK_APPROVED`, `REPLACED_EXISTING`, `ACCEPTED_AS_NEW`, `ARCHIVED`, `EDITED`, `CREATED_DRAFT`, `DELETED_DRAFT`)
- **Archive endpoint:** `PATCH /api/regional/validator/incidents/{id}/archive` — archives VERIFIED / REJECTED / REPLACED incidents
- **Archived tab:** filter `?archived=true` shows only archived incidents; no action buttons
- **Conditional action buttons:** finalized incidents (VERIFIED / REJECTED / REPLACED) show Archive only; pending incidents show Accept + Reject
- **DUPLICATE badge** — shown on PENDING incidents with `is_duplicate = TRUE`
- **Newest-first sort** on queue
- **Submitted column** — leftmost data column showing `created_at` in PHT
- **Direct Accept flow** — clicking Accept immediately calls the backend (no intermediate Confirm step). If backend returns 409 DUPLICATE\_DETECTED, the side-by-side resolution modal appears automatically
- **Bulk confirm modal** — replaced `window.confirm()` with an in-app modal
- **Refresh notification** — background poll every 30s; blue banner "New incidents have been submitted — Refresh now" when count increases

#### Exit Criteria
- [x] Validator sees cross-region queue
- [x] Validator can approve or reject with reason
- [x] Each action creates audit trail entry with action_label
- [x] VERIFIED / REJECTED incidents can be archived
- [x] Archived incidents visible in separate tab
- [x] Validator notified when new incidents are submitted

---

### M4-G: Side-by-Side Diff View
**Priority:** Medium | **Status:** ✅ Complete + Enhanced

#### Implemented (original spec)
- `GET /api/regional/validator/incidents/{id}/diff` — returns original snapshot vs current field values
- `UpdateRequestDiffPanel` component — renders two-column field-by-field comparison with changed fields highlighted
- Used in validator queue action modal for update requests (`parent_incident_id` set)

#### Implemented (enhancements beyond spec)
- **Duplicate resolution modal** — when the validator clicks Accept on any incident, the backend runs `check_for_duplicate()`. If a match is found (409), a full side-by-side modal appears showing the PENDING incident vs the matched VERIFIED incident
- **4 resolution options in modal:**
  - **Replace Existing** — verifies the new incident with the original's reference number; marks the old incident as `REPLACED` + `is_archived = TRUE`
  - **Verify as New** — verifies with a brand-new reference number; `force = true` bypasses the duplicate check
  - **Reject** — opens the rejection notes flow
  - **Cancel** — keeps incident as PENDING for further review
- **Auto-show on detail page** — when a validator opens a duplicate-flagged incident (`is_duplicate = TRUE, duplicate_of` set), the side-by-side modal appears automatically

#### Exit Criteria
- [x] Validator sees what changed before approving (update requests)
- [x] Validator sees side-by-side comparison for duplicate incidents before accepting
- [x] Validator has 4 resolution options for duplicates

---

### M4-H: Bulk Approve
**Priority:** Medium | **Status:** ✅ Complete

#### Implemented
- Checkbox selection on all PENDING incidents in the queue
- Select-all for PENDING checkbox in table header
- `POST /api/regional/validator/incidents/bulk-approve` with `{incident_ids: [int]}`
- Processes incidents in chronological order (`created_at ASC`) to preserve temporal integrity
- Per-incident `check_for_duplicate()` call during bulk with `verified_window_seconds=60` guard
- `held_for_review: [{id, matching_incident_id}]` in response for mid-batch duplicates
- **Bulk confirm modal** (in-app, not `window.confirm`) showing count before execution
- Response shape: `{approved: N, incident_ids: [...], held_for_review: [...]}`
- `action_label = 'BULK_APPROVED'` in audit trail

#### Exit Criteria
- [x] Validator can select multiple incidents and approve in one click
- [x] In-app confirmation modal (not browser dialog)
- [x] Chronological processing order
- [x] Mid-batch duplicates held for review, not silently approved

---

### M4-I: Validator Audit Trail Viewer
**Priority:** Medium | **Status:** ✅ Complete

#### Implemented
- `GET /api/regional/validator/audit-logs` with filters: `date_from`, `date_to`, `region_id`, `encoder_id`, `action`
- `GET /api/regional/validator/audit-logs/export` — CSV download with date-stamped filename
- Response fields: `incident_id`, `previous_status`, `new_status`, `action_by_user_id`, `actor_username` (resolved), `region_display` (resolved region name), `action_label`, `notes`, `action_timestamp`
- `/dashboard/validator/audit` page with filter form, paginated table, and Export CSV button
- Table columns: **Date & Time** | **Incident** | **Region** | **By** | **Action**
- Action filter dropdown: APPROVED / REJECTED / BULK_APPROVED / REPLACED_EXISTING / ACCEPTED_AS_NEW / ARCHIVED

#### Exit Criteria
- [x] Validator can search audit trail by date, region, encoder
- [x] Validator can filter by action type
- [x] Validator can export as CSV
- [x] Action labels are human-readable (not raw status codes)
- [x] Actor shown as username, not UUID

---

## Enhancements Added Beyond Original Spec

### EXT-1: Encoder Audit Trail
**Status:** ✅ Complete

- **Backend:** `GET /api/regional/audit-log` — encoder's own action history, paginated; filtered by `action_by_user_id = encoder.user_id`
- **Backend:** `POST /incidents` (create) now writes `action_label='CREATED_DRAFT'`; draft edit writes `EDITED`; draft delete writes `DELETED_DRAFT`
- **Frontend:** `/dashboard/regional/audit` — "My Activity Log" page with date range filter, paginated table
- Link added to regional dashboard nav

---

### EXT-2: Duplicate Detection System
**Status:** ✅ Complete

A dedicated `services/duplicate_detection.py` service implements spatial + temporal duplicate matching used across multiple call sites.

#### Detection Logic
- **Primary check:** `ST_DWithin(fi.location::geography, point, 5000)` (5 km radius) + same `region_id` + not archived + `verification_status NOT IN (DRAFT, REJECTED, REPLACED)`
- **Date filter (optional):** When `notification_dt` is available, match within ±1 day in Asia/Manila timezone. When absent, date filter is skipped (spatial-only match)
- **Fallback:** When no lat/lon available, match on `region_id` + `general_category` OR `incident_type_code` with same optional date window
- **Update request exclusion:** Incidents with `parent_incident_id` set are excluded from the validator-side duplicate check

#### Encoder-side (submission)
- `POST /api/regional/incidents/{id}/submit` calls `check_for_duplicate()` before transitioning to PENDING
- Returns `HTTP 409 {code: "DUPLICATE_DETECTED", matched_incident_id, matched_status}`
- Frontend modal: **Submit Anyway** (force) | **View Existing** | **Edit Incident** | **Cancel**

#### Validator-side (accept)
- `PATCH /api/regional/incidents/{id}/verification?action=accept` triggers `check_for_duplicate()`
- Returns `HTTP 409 {code: "DUPLICATE_DETECTED", matched_incident_id}` when match found
- Frontend: clicking **Accept** immediately calls the backend. On 409, the side-by-side modal auto-opens with 4 resolution options

---

### EXT-3: Incident Archive & REPLACED Status
**Status:** ✅ Complete

- `PATCH /api/regional/validator/incidents/{id}/archive` — archives VERIFIED / REJECTED / REPLACED incidents
- `archived_at TIMESTAMPTZ` column; `verification_status` CHECK expanded to include `REPLACED`
- Archived tab in validator queue (`?archived=true`)

---

### EXT-4: Reference Number Generation
**Status:** ✅ Complete

Reference numbers are generated on first `VERIFIED` transition.

#### Format
```
AFOR-RGN-{REGION}-{STATION_CODE}-{TYPE_CODE}-{MON}-{YEAR}-{SEQ:04d}
```
Examples:
- `AFOR-RGN-NCR-TBA-APT-MAY-2026-0001`
- `AFOR-RGN-1-TBA-INF-MAY-2026-0004`
- `AFOR-RGN-4A-TBA-SFD-MAY-2026-0007`

Region codes: RGN-NCR, RGN-CAR, RGN-NIR, RGN-BARMM, RGN-1 through RGN-13

Sequence is **global** (increments monotonically across all incidents, not per region/type/month).

---

### EXT-5: Regional RBAC
**Status:** ✅ Complete

- 18 Keycloak encoder accounts, one per PH region, using canonical region-code usernames
- `encoder_ncr` is the Region 1 (NCR) encoder for development; Region I begins at `encoder_r01`
- `seed-dev-users.sh` and `.ps1` updated with all 18 encoders and their region assignments
- Backend `POST /incidents` enforces `region_id == assigned_region_id` (raises 403 REGION_MISMATCH)
- Backend `POST /incidents/upload-bundle` also enforces region assignment (raises 403 REGION_MISMATCH)
- Frontend: region dropdown disabled for encoders; 403 from backend shows a clean message with region field highlighted

---

## Database Schema Summary

### Status Values (current)
| Status | Description |
|--------|-------------|
| `DRAFT` | Encoder working on incident, not yet submitted |
| `PENDING` | Submitted for validation |
| `PENDING_VALIDATION` | Public DMZ / system-submitted, awaiting triage |
| `VERIFIED` | Approved by validator; reference number assigned |
| `REJECTED` | Rejected with reason |
| `REPLACED` | Superseded by a newer verified incident |

### Key Columns (wims.fire_incidents)
| Column | Type | Description |
|--------|------|-------------|
| `verification_status` | VARCHAR | One of the 6 statuses above |
| `is_archived` | BOOLEAN | Soft-delete flag |
| `archived_at` | TIMESTAMPTZ | When archived |
| `is_duplicate` | BOOLEAN | Set by ack_duplicate path |
| `duplicate_of` | INTEGER FK | Points to matched incident |
| `parent_incident_id` | INTEGER FK | Set for update requests |
| `reference_number` | VARCHAR | AFOR format, assigned on VERIFIED |
| `location` | GEOGRAPHY(Point,4326) | PostGIS coordinates |

### Key Audit Events (action_label values)
| Label | Trigger |
|-------|---------|
| `CREATED_DRAFT` | Encoder creates new incident (DRAFT) |
| `SUBMITTED` | Encoder submits DRAFT → PENDING |
| `EDITED` | Encoder edits draft fields |
| `DELETED_DRAFT` | Encoder or system deletes draft |
| `APPROVED` | Validator accepts → VERIFIED |
| `REJECTED` | Validator rejects |
| `BULK_APPROVED` | Validated via bulk approve |
| `REPLACED_EXISTING` | accept_replace — new supersedes old |
| `ACCEPTED_AS_NEW` | force accept bypassing duplicate |
| `ARCHIVED` | Validator archives finalized incident |

---

## Frontend Routes (current)

| Route | Role | Purpose |
|-------|------|---------|
| `/dashboard/regional` | REGIONAL_ENCODER | Incident list with stats |
| `/dashboard/regional/audit` | REGIONAL_ENCODER | Encoder activity log |
| `/dashboard/regional/drafts` | REGIONAL_ENCODER | Draft list |
| `/dashboard/regional/incidents/[id]` | REGIONAL_ENCODER / NATIONAL_VALIDATOR | View, edit, submit, validate |
| `/afor/create` | REGIONAL_ENCODER | Manual AFOR entry (structural + wildland) |
| `/afor/import` | REGIONAL_ENCODER | AFOR xlsx bulk import |
| `/dashboard/validator` | NATIONAL_VALIDATOR | Verification queue + archive tab |
| `/dashboard/validator/audit` | NATIONAL_VALIDATOR | Audit trail with CSV export + action filter |

---

## API Endpoints Reference

| Method | Path | Role | Description |
|--------|------|------|-------------|
| POST | `/regional/incidents` | ENCODER | Create incident (DRAFT); writes CREATED_DRAFT audit |
| GET | `/regional/incidents` | ENCODER | List own incidents |
| PATCH | `/regional/incidents/{id}` | ENCODER | Edit incident fields; writes EDITED audit |
| DELETE | `/regional/incidents/draft/{id}` | ENCODER | Delete draft; writes DELETED_DRAFT audit |
| POST | `/regional/incidents/{id}/submit` | ENCODER | Submit DRAFT → PENDING |
| POST | `/regional/incidents/upload-bundle` | ENCODER | Bulk AFOR xlsx import (region-enforced) |
| GET | `/regional/incidents/drafts` | ENCODER | List own drafts |
| GET | `/regional/audit-log` | ENCODER | Encoder's own action history |
| GET | `/regional/validator/incidents` | VALIDATOR | Cross-region queue |
| PATCH | `/regional/incidents/{id}/verification` | VALIDATOR | Accept / reject / pending |
| POST | `/regional/validator/incidents/bulk-approve` | VALIDATOR | Bulk accept |
| PATCH | `/regional/validator/incidents/{id}/archive` | VALIDATOR | Archive finalized incident |
| GET | `/regional/validator/incidents/{id}/diff` | VALIDATOR | Side-by-side diff |
| GET | `/regional/validator/audit-logs` | VALIDATOR | Audit trail (filterable by action) |
| GET | `/regional/validator/audit-logs/export` | VALIDATOR | CSV export |

---

## Remaining Gaps

| Gap | Priority | Notes |
|-----|----------|-------|
| M4-D: AFOR import per-row duplicate decision UI | Medium | Encoders see a count; cannot choose skip/merge/force per row. Backend already accepts `per_row_decisions` param |
| Bulk approve atomicity | Low | Mid-batch failure leaves earlier incidents approved; no rollback |
| Incident edit version history | Low | Field-level snapshots not stored; only action_label EDITED is recorded |
