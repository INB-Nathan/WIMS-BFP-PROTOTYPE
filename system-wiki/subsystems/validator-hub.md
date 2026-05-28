---
title: National Validator Dashboard
created: 2026-05-16
updated: 2026-05-28
type: operation
tags: [wims-bfp, validator, national-validator, dashboard, incident-workflow, audit]
sources: [src/frontend/src/app/dashboard/validator/page.tsx, src/frontend/src/app/dashboard/validator/audit/page.tsx, src/backend/api/routes/regional.py, src/backend/api/routes/incidents.py]
status: draft
---

# National Validator Dashboard

The national validator dashboard (`/dashboard/validator`) serves the `NATIONAL_VALIDATOR` role. It is the cross-region incident verification queue, duplicate-resolution workspace, and audit trail hub. Validators review encoder-submitted incidents, approve/reject them, manage duplicates, and audit the entire verification workflow.

## Role Gates

- Accessible to: `NATIONAL_VALIDATOR` (and legacy `VALIDATOR`)
- Backend endpoints use `Depends(get_national_validator)` for write operations and `Depends(get_regional_encoder)` (or combined) for read-only access
- All queries use `get_db_with_rls()` for region-scoped data visibility

## Frontend UI Surface

### Incident Queue — `/dashboard/validator`

**Source:** `src/frontend/src/app/dashboard/validator/page.tsx`

The validator's primary workspace. A large, feature-rich page with:

- The page title now displays "Dashboard" in the role workspace, while the sidebar places this dashboard before the shared `/home` Operations tab.
- The queue includes an inline hint explaining row click-to-view behavior, bulk selection, and finalized-record archive behavior.

**Filters:**
- Status quick filters: All, Pending, Accepted (`VERIFIED`), Rejected; All is the default and Pending shows a red count badge when `pending_validation > 0`
- Date dropdown filters are right-aligned with the calendar and Apply Date action: Today/This Week/This Month/This Year/Specific Date/All Time, paired with an always-visible calendar date picker for a specific submission date. Apply Date stays disabled until a complete valid date is entered. Specific-date state starts empty on dashboard load and is cleared whenever a preset date period is selected. The frontend no longer exposes the Date of Fire date-basis toggle; validator filtering defaults to Date of Submission and the calendar draft no longer refetches until applied.
- Region dropdown filter
- Per-status labels and colour badges (gray=DRAFT, yellow=PENDING, blue=PENDING_VALIDATION, green=VERIFIED, red=REJECTED, purple=REPLACED)

**Incident Table** — 50 rows/page:

| Column | Detail |
|---|---|
| ID | Incident ID (clickable for diff) |
| Region | Short region name via `getShortRegionName()` |
| Encoder | Encoder user ID (masked) |
| Station | Fire station name |
| Call Received | Formatted in Asia/Manila timezone |
| Category | Classification via `formatClassification()` |
| Status | Colour-coded badge |
| Actions | Row click-to-view with delayed floating hover bubble, Accept/Reject for pending rows, quiet Archive action for finalized rows, checkbox for bulk operations |

**Diff Panel** — `IncidentDiffPanel` component loads via `GET /api/regional/validator/incidents/{incident_id}/diff` and shows a before/after comparison for incidents under review

**Update Request Diff Panel** — `UpdateRequestDiffPanel` component for incidents that have update requests pending

**Action Modal** — Single-incident verification modal:
- Action: Accept / Accept & Replace Existing / Reject
- Notes text field
- Loading/error states
- Calls `PATCH /api/regional/incidents/{incident_id}/verification`

**Bulk Approve** — Phase 1.4 feature:
- Checkbox per incident (only PENDING_VALIDATION), Select All toggle
- Selected-count action bar with "Approve Selected" button
- Bulk confirmation modal with notes field
- Per-incident in-memory duplicate check during batch processing (same region + category + date)
- When duplicate found during bulk: pauses for user decision (Accept as New / Accept & Replace / Skip / Reject) via inline modal + Promise-based resolve pattern
- Progress display during bulk operations
- Calls `POST /api/regional/validator/incidents/bulk-approve`

**Duplicate Resolution Modal** — Phased duplicate handling:
- Single: ValidatorDupTarget modal with matched incident ID for accept-replace or accept-as-new decision
- Bulk: BulkDupTarget modal using `waitForBulkDupDecision()` Promise pattern

**Stats Bar** — header stats from `fetchValidatorStats()`:
- Awaiting validation, wildland fire, and by-category breakdown cards. The former Total Verified card is no longer shown.
- The selected stats period is controlled by the Stats period chip row and is not repeated in individual card titles.
- Awaiting validation counts both `PENDING` and `PENDING_VALIDATION` because the validator queue defaults include both statuses.
- Category cards aggregate legacy/current category aliases, including `VEHICULAR` + `TRANSPORTATION`, to keep totals aligned with normalized incident rows.

### Audit Trail — `/dashboard/validator/audit`

**Source:** `src/frontend/src/app/dashboard/validator/audit/page.tsx` (~285 lines)

**Filters (5-field grid):**
- From date, To date, Region ID (text), Validator UUID (text), Action type dropdown (Any, Approved, Rejected, Bulk Approved, Replaced Existing, Accepted as New, Archived)

**Audit Table** — 50 rows/page:

| Column | Detail |
|---|---|
| Date & Time | Asia/Manila timezone |
| Incident # | Linked to regional incident detail |
| Region | Short region name |
| Validator | Actor username |
| Previous Status → New Status | Status transition |
| Action | Human-readable action label |
| Notes | Free-text notes |

**Export:** "Export CSV" button opens `GET /api/regional/validator/audit-logs/export` with same filters in a new window (browser-native download via Content-Disposition)

**Empty state:** "No audit records match the current filters."

## Backend API Routes

The validator backend routes are shared in `src/backend/api/routes/regional.py` (the large regional route file, ~5050 lines). Key validator-specific endpoints:

### Incident Queue

| Method | Path | Function | Behavior |
|---|---|---|---|
| `GET` | `/api/regional/validator/incidents` | `get_validator_incident_queue` | Paginated; supports status, encoder_id, region, `date_from`, `date_to`, and `date_basis` filters (`submitted` default, `fire`; legacy `modified` aliases to `submitted`); returns full incident data with duplicate awareness fields (duplicate_of, is_duplicate, parent_incident_id) |
| `GET` | `/api/regional/validator/incidents/{incident_id}/diff` | `get_incident_diff` | Returns structured before/after comparison for verification review |

### Verification Actions

| Method | Path | Function | Behavior |
|---|---|---|---|
| `PATCH` | `/api/regional/incidents/{incident_id}/verification` | `verify_incident` | Single-incident: changes status to VERIFIED/REJECTED; writes `incident_verification_history`; syncs analytics facts; handles `REPLACED` duplicate edge cases |
| `POST` | `/api/regional/validator/incidents/bulk-approve` | `bulk_approve_incidents` | Multi-incident: accepts array of `{id, action, notes, replace_existing_id}`; commits in DB transaction; partial failure handling |
| `PATCH` | `/api/regional/validator/incidents/{incident_id}/archive` | `archive_incident` | Sets `verification_status = 'ARCHIVED'`; immutable audit trail preserved |

### Update Requests (M4 correction flow)

| Method | Path | Function | Behavior |
|---|---|---|---|
| `PATCH` | `/api/regional/incidents/{incident_id}/submit` | `submit_incident_for_review` | Encoder submits a correction/update request; changes status flow back through validation |
| `POST` | `/api/regional/incidents/{incident_id}/force-replace` | `force_replace_incident` | Complete replacement of a verified incident; marks old as REPLACED; creates new incident with cross-reference |

### Audit Logs

| Method | Path | Function | Behavior |
|---|---|---|---|
| `GET` | `/api/regional/validator/audit-logs` | `get_validator_audit_logs` | Cross-region audit; filters: date_from, date_to, region_id, validator_id, action; paginated; returns actor username via JOIN on `wims.users` |
| `GET` | `/api/regional/validator/audit-logs/export` | `export_validator_audit_logs` | Same filter set + CSV download via FastAPI `StreamingResponse` with `Content-Disposition: attachment` |

### Validator Stats

| Method | Path | Function | Behavior |
|---|---|---|---|
| `GET` | `/api/regional/validator/stats` | `get_validator_stats` | Returns total_verified, pending_validation (`PENDING` + `PENDING_VALIDATION`), wildland_total, by_category counts, and affected counts for the validator's scope |

## Key Implementation Details

- **Bulk approve uses in-memory duplicate detection** (same region_id + general_category + notification_dt date) rather than SQL-based checks — this prevents double-striking the same incident in one batch
- **The `waitForBulkDupDecision()` Promise-based pattern** pauses bulk processing to prompt the user for each duplicate, then resolves with the chosen action — implemented via React `useRef` for the resolve callback and `useState` for the modal target
- **`IncidentDiffPanel` and `UpdateRequestDiffPanel`** are reusable components in `src/frontend/src/components/`; they fetch diff data on mount
- **No pagination on incident diff endpoint** — returns full diff payload
- **Audit export** is a browser-native download via `window.open()`; no XLSX/PDF option, only CSV

## Known Gaps / Status

- The validator incident queue has **no quick-search or full-text filter** beyond encoder_id
- Bulk approve's **in-memory duplicate check** is a lightweight heuristic (same region + category + date) — no 1km radius check like the backend `check_incident_duplicate` uses
- **No scheduled report review** or validator-facing report scheduling
- The audit trail page uses **text inputs for region_id and validator_id** instead of dropdown selectors populated from `ref_regions` and user lists

## Related

- [[subsystems/regional-dashboard]] — encoder's view of the same incident workflow
- [[backend/api-route-map]] — route ownership
- [[frontend/route-map]] — validator routes
- [[database/schema-overview]] — `wims.incident_verification_history`, `wims.fire_incidents.verification_status`
- [[concepts/frs-module-map]] — M3 (Conflict Detection), M4 (Immutable Storage, Correction Flow)
- [[security/security-baseline]] — RBAC, validator authentication
- [[gaps/frs-codebase-gap-register]] — barangay reverse-geocoding verification, analytics sync on verification

## API Reference

Validator-specific endpoints live in `src/backend/api/routes/regional.py`. Every function is documented at:
- [[subsystems/references/regional-api-ref]] — complete function-level docs for verification workflow (verify_incident, bulk_approve_incidents, archive_incident, get_incident_diff, get_validator_incident_queue, get_validator_audit_logs, export_validator_audit_logs) and all supporting helpers
