# Operations Board Linked Civilian Reports Design

Date: 2026-06-24
Status: Revision pending user review
Owner: WIMS-BFP Operations Board

## Problem

The authenticated Operations Board at `/home` currently exposes linked-report management too broadly in the frontend. Regional Encoder, National Analyst, and System Administrator users can reach linked-report UI, but only National Validator should add or remove linked civilian reports. The board also represents linked reports as bare integer IDs, which is not enough operational context for validators or read-only staff.

## Goals

- Restrict add/remove linked-report functionality to `NATIONAL_VALIDATOR`.
- Keep linked-report details visible read-only to Regional Encoder, National Analyst, and System Administrator.
- Let validators optionally link civilian reports while creating a new operation.
- Let validators add/remove civilian reports while an operation is ongoing.
- Replace the table/map toggle with a responsive 70/30 operations console: 70% map, 30% operations/report panel on desktop/tablet; stacked map-first layout on mobile.
- Show operational details for linked civilian reports instead of only report ID integers.
- Keep civilian PII out of the Operations Board.
- Update civilian tracking with a neutral linked-to-operation message that does not expose operation details.

## Non-goals

- No witness name, witness phone, device ID, IP hash, or other civilian PII on the Operations Board.
- No report transfer workflow in this increment.
- No multi-operation linking for one civilian report.
- No rewrite of the broader triage workflow.

## Roles and Permissions

| Role | Operations | Linked report details | Link/unlink controls |
|---|---|---|---|
| `NATIONAL_VALIDATOR` | Create, update, delete, status update | Read | Add/remove |
| `REGIONAL_ENCODER` | Read | Read | Hidden |
| `NATIONAL_ANALYST` | Read | Read | Hidden |
| `SYSTEM_ADMIN` | Read | Read | Hidden |

Backend RBAC remains the source of truth. Frontend role checks only hide or show UI affordances.

## Backend Design

### Operation response shape

`GET /api/operations` should continue returning existing operation fields and `linked_report_ids`, and should add `linked_reports` for display and map use.

Each linked report detail should include only operational fields:

- `report_id`
- `status`
- `category`
- `sub_category`
- `reported_at`
- `latitude`
- `longitude`
- `trust_score`
- `safety_status`
- `reporting_context`
- `linked_operation_id`
- `linked_operation_label` or enough non-sensitive information to display disabled already-linked cards
- optional computed `distance_meters` when an operation coordinate is available

### Citizen report spatial/time mapping

`wims.citizen_reports` stores the incident location as `location GEOGRAPHY(POINT, 4326)`, not as plain latitude/longitude columns. API response fields named `latitude` and `longitude` must be derived from the pinned incident location with PostGIS (`ST_Y(location::geometry)` and `ST_X(location::geometry)`). Do not use `phone_latitude` / `phone_longitude` for the operational map marker; those are device GPS comparison fields.

Use `reported_at` as the civilian-observed/report time field. If `reported_at` is null, the UI may fall back to `created_at` for display only and should label it as submission time if surfaced.

Distance sorting/display must be computed in SQL with the existing GIST index on `citizen_reports.location`, using PostGIS distance functions such as `ST_DistanceSphere`/`ST_DistanceSpheroid` rather than pulling all coordinates into FastAPI for application-layer math.

### Linkable report search

Add a validator-only report search endpoint under the operations API namespace, for example:

`GET /api/operations/linkable-reports`

Supported filters:

- keyword/location search
- status
- category
- time range
- selected operation ID, candidate operation pin, or coordinates for near-operation sorting/distance display

The endpoint includes reports with statuses:

- `PENDING`
- `UNDER_REVIEW`
- `LINKED`
- `ACTIONED`

It excludes rejected reports.

Reports already linked to another operation should still appear as disabled cards with “Already linked to Operation #X”. They must not expose a link action.

This endpoint should use `get_national_validator`, not `get_incident_viewer`. Non-validator staff get linked-report details through `GET /api/operations`; they do not need a search surface over unlinked civilian reports.

### Mutation rules

Only `NATIONAL_VALIDATOR` can create/update/delete operations or link/unlink reports.

A civilian report can belong to only one operation at a time. This is a new invariant: the current junction table primary key is `(operation_id, report_id)`, which permits one report to be linked to multiple operations. Implementation must add a `UNIQUE(report_id)` constraint or equivalent unique index to `wims.operation_citizen_reports` after checking/remediating existing duplicate data in dev/test seed state.

When linking a report:

- `PENDING`, `UNDER_REVIEW`, or `LINKED` becomes `LINKED`.
- `ACTIONED` remains `ACTIONED`.
- rejected reports cannot be linked.
- if already linked to another operation, return a conflict response and enough safe metadata for the UI to refresh.

The existing `INSERT ... ON CONFLICT DO NOTHING` behavior must be replaced with explicit conflict detection so the API returns a meaningful conflict instead of silently succeeding.

The junction write and any `wims.citizen_reports.status` update must happen in one transaction. Before implementation, verify the `citizen_reports` RLS UPDATE policy allows `NATIONAL_VALIDATOR` under the `get_db_with_rls` transaction context; if not, add the narrowest policy change needed and cover it with a failing test first.

When unlinking a report:

- `LINKED` becomes `UNDER_REVIEW`.
- `ACTIONED` remains `ACTIONED`.

Audit logging should use one combined audit event per link/unlink mutation that includes the previous and new report status in `old_values` / `new_values` when the status changes. Avoid double-logging a separate status event unless the existing audit convention requires it.

## Frontend Design

### Operations console layout

Replace the table/map toggle with a persistent split console:

- Desktop/tablet: map canvas takes about 70% width; operations/report panel takes about 30%.
- Mobile: map renders first, then operations/report panel below.

### Map behavior

The map shows:

- operation markers/radius for filtered operations
- linked civilian report markers for the selected operation only

Clicking an operation row/card in the 30% panel centers the map on that operation.

### Operations/report panel

The panel includes:

- operation status tabs/filters
- location/notes search
- operation list or cards
- selected operation detail summary
- linked report detail cards
- validator-only add/remove controls
- read-only linked report details for non-validator roles

If an operation has no linked reports:

- National Validator sees an empty state with an “Add civilian reports” call to action.
- Other roles see a read-only empty state: “No civilian reports linked.”

### Validator report linking UI

Validators manage ongoing linked reports directly in the selected-operation panel, not in a separate modal.

The report search/filter area supports:

- keyword/location
- status
- category
- time range
- near-selected-operation sort

Report cards show operational context only. Already-linked reports are disabled and show “Already linked to Operation #X”.

### Create operation flow

The create-operation modal includes a linked report selector. Linked reports are optional, but the modal should strongly surface the empty state when none are selected.

When the validator selects the first report, the UI should suggest operation fields from it:

- location
- map pin coordinates from `ST_Y/ST_X(location)`
- start time from `reported_at`, falling back to submission time only for display if needed
- notes summary

The first selected report locks the initial suggestions unless the validator explicitly chooses a different source report. If multiple reports are selected, the map should expand its bounds to include all selected report pins so spatial variance is visible before saving the final operation center point.

If the first selected report has no usable pinned coordinates, the form should not auto-place the map pin. It should keep the linked report selected, show a “No coordinates” hint, and require a manual operation pin or location entry if those fields are required.

During create, `distance_meters` is omitted until there is a candidate operation pin. Once the validator places or accepts a pin, distance can be computed against that candidate pin.

The validator can edit all suggested values before saving.

## Civilian Tracking Impact

When a civilian report is linked to an active BFP operation, the civilian tracking page should show neutral copy such as:

> Your report has been linked to an active BFP operation.

The tracking page must not expose operation location, operation ID beyond what is already public, staff names, linked operation details, or internal notes.

## Error Handling

- Concurrent link conflict: refresh the selected operation and report search results; show an inline message that the report is already linked elsewhere.
- Link/unlink API failure: keep the selected operation open and show a recoverable inline error.
- Missing coordinates: report cards remain visible; map marker is omitted with a subtle “No coordinates” label. Create-flow auto-suggestion must not invent coordinates from non-operational GPS fields.
- Empty search results: explain which filters are active and offer to clear filters.
- Offline/unavailable state: preserve read-only operation details if cached; disable validator mutations until reconnect.

## TDD and Verification Strategy

Implementation must follow TDD:

1. Write one failing behavior test.
2. Run it and verify it fails for the expected reason.
3. Write the smallest production change to pass it.
4. Run it and verify it passes.
5. Repeat for the next behavior.
6. Refactor only after tests are green.

Prioritized backend behavior tests:

- non-validator roles cannot link or unlink reports
- validator can link eligible reports
- rejected reports cannot be linked
- migration/preflight detects duplicate `operation_citizen_reports.report_id` rows before adding uniqueness
- one report cannot be linked to multiple operations
- linking sets `PENDING` / `UNDER_REVIEW` / `LINKED` to `LINKED`
- linking preserves `ACTIONED`
- unlinking changes `LINKED` to `UNDER_REVIEW`
- unlinking preserves `ACTIONED`
- link/status update happen transactionally, including rollback on failure
- `citizen_reports` RLS permits the validator status update path and denies non-validator mutation
- operation list returns `linked_reports` details without PII
- linkable-report search is validator-only, excludes rejected reports, and marks already-linked reports disabled
- `latitude`/`longitude` are derived from `citizen_reports.location`, not `phone_latitude`/`phone_longitude`

Prioritized frontend behavior tests:

- table/map toggle is replaced by a split operations console
- clicking an operation row/card centers the map on that operation
- National Validator sees add/remove linked-report controls
- Regional Encoder, National Analyst, and System Administrator see read-only linked report details
- linked reports render details, not just integer IDs
- create operation modal can select reports and suggest fields from the first selected report
- selected operation map shows linked report markers
- multiple selected reports expand the create-flow map bounds while first-report suggestions remain stable
- already-linked reports render as disabled cards
- mobile layout stacks map first and preserves usable map height/aspect ratio

Run verification with the relevant frontend and backend test commands from subsystem guidance, then run broader CI pre-flight before PR/merge.

## Documentation Updates

Update project-local documentation after implementation:

- `system-wiki/frontend/route-map.md` for `/home` Operations Board behavior
- backend API route map or operations workflow documentation for new/changed operations endpoints
- `log.md` if required by the project’s wiki/update convention

## Open Implementation Notes

- Prefer extending the existing `operations` API/client layer rather than adding direct component fetch calls.
- Keep data fetching in `src/frontend/src/lib/api/` or hooks; components stay presentational where practical.
- Preserve backend RLS and RBAC guarantees; frontend checks are not security boundaries.
- Keep changes surgical and avoid unrelated Operations Board refactors.
