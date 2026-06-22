# Civilian Reporting Overhaul — Separate Staging Table, Unified Triage

The public civilian emergency reporting flow now uses `wims.citizen_reports` as a lightweight staging table separate from `wims.fire_incidents`. All submissions route through `POST /api/civilian/reports`, are clustered at triage read-time via PostGIS `ST_DWithin`, and remain public signal records unless later referenced by the official AFOR workflow. The two-table design prevents civilian submissions from flooding the AFOR canonical table, preserves clean analytics on `fire_incidents`, and allows append/linking without schema mutation.

## Status: accepted

## Context

The original `/report` flow accepted free-text descriptions and had no geolocation guidance, sub-categorization, or escalation model. The triage queue (`/incidents/triage`) was a flat list with no clustering, grouping, or severity signal. Two parallel submission paths existed (`civilian.py` → `citizen_reports` and `public_dmz.py` → `fire_incidents`) with no unified triage surface.

## Decision

**Option D — Separate storage with unified query surface.**

`citizen_reports` handles all public submissions. `fire_incidents` remains the AFOR canonical table and is not created directly by civilian triage. A new `GET /api/triage/queue` endpoint queries civilian reports and their cluster workflow state, performs spatial clustering via `ST_DWithin`, and returns a normalized schema to the validator UI. Dedicated `/incidents/triage` page plus an overview widget in `/dashboard/validator`.

### Schema: `citizen_reports`

| Column | Type | Notes |
|---|---|---|
| `report_id` | SERIAL PK | |
| `location` | GEOGRAPHY(POINT,4326) | PostGIS, required |
| `category` | citizen_category | ENUM: STRUCTURAL, NON_STRUCTURAL, TRANSPORTATION, UNSURE |
| `sub_category` | TEXT | Free-form hint from icon grid, nullable |
| `reported_via` | reported_via | ENUM: WEB, MOBILE_APP, API |
| `reported_at` | TIMESTAMPTZ | Civilian's observed time, not system time |
| `device_id` | UUID | Client-generated, anonymous deduplication signal |
| `ip_hash` | TEXT | SHA256 of IP, rate limiting only |
| `trust_score` | INT DEFAULT 0 | Deterministic weighted signal (0–100) |
| `region_id` | FK → ref_regions | Resolved via PostGIS at insert |
| `nearest_station_id` | FK → ref_fire_stations | Resolved via ST_DWithin at insert |
| `status` | citizen_status | ENUM: PENDING, UNDER_REVIEW, LINKED, ACTIONED, REJECTED_BOGUS, REJECTED_DUPLICATE, REJECTED_INSUFFICIENT, REJECTED_TIMEOUT |
| `status_explanation` | TEXT | Required for `ACTIONED` and `REJECTED_*`; shown to civilians |
| `safety_status` | citizen_safety_status | ENUM: I_AM_SAFE, I_NEED_HELP, SOMEONE_ELSE_NEEDS_HELP, UNKNOWN |
| `linked_to_report_id` | FK → citizen_reports | For append chain |
| `previous_report_id` | FK → citizen_reports | Historical reference for a new report that follows a rejected report; does not reopen or mutate the previous report |
| `link_count` | INT DEFAULT 0 | Incremented when child reports append |
| `source_url` | TEXT | Analytics only |

Indexes: GiST on `location`, B-tree on `status`, `linked_to_report_id`, `device_id`.

### Schema: citizen report clusters

Read-time PostGIS clustering remains the discovery mechanism for suggested related reports. Human workflow state is stored separately so validator actions are durable and auditable.

`citizen_report_clusters`:

| Column | Type | Notes |
|---|---|---|
| `cluster_id` | SERIAL PK | |
| `anchor_report_id` | FK → citizen_reports.report_id | Initial/highest-priority report anchoring the cluster |
| `status` | citizen_cluster_status | `CLUSTER_MONITORING`, `CLUSTER_UNDER_REVIEW`, `CLUSTER_ACTIONED`, `CLUSTER_CLOSED` |
| `status_note` | TEXT | Optional validator/station operator note |
| `internal_note` | TEXT | Validator-only operational note; never shown to civilians |
| `acted_by` | UUID FK → users.user_id | Last user who changed workflow state |
| `assigned_to` | UUID FK → users.user_id | Validator currently claiming the cluster for review |
| `review_started_at` | TIMESTAMPTZ | When current claim/review started |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |
| `closed_at` | TIMESTAMPTZ | Nullable |
| `merged_into_cluster_id` | FK → citizen_report_clusters.cluster_id | Nullable; set when this cluster is merged into another |

`citizen_report_cluster_members`:

| Column | Type | Notes |
|---|---|---|
| `cluster_id` | FK → citizen_report_clusters.cluster_id | |
| `report_id` | FK → citizen_reports.report_id | |
| `linked_by` | UUID FK → users.user_id | User who explicitly included the report |
| `created_at` | TIMESTAMPTZ | |

The triage UI can suggest nearby reports that are not yet explicit members. Terminal actions require the validator to select the member reports that receive row-level outcomes.

### Sub-categories (icon grids)

```
STRUCTURAL       → 🏠 Residential  🏢 Commercial  🏭 Industrial  🏥 Institutional  🌾 Agricultural
NON_STRUCTURAL   → 🌲 Brush/Forest Fire  🌾 Grass/Dump Fire
TRANSPORTATION   → 🏍 Motorcycle  🚲 Tricycle  🚗 Private Vehicle  🚌 PUV/Bus  🚛 Truck
UNSURE           → (skip sub-category step)
```

### Severity — derived at triage read time (NOT stored)

```python
related = [r for r in all_reports
           if ST_DWithin(r.location, report.location, 100)  # 100m
           and (r.created_at - report.created_at).total_seconds() <= 3600]  # 1hr
if len(related) >= 5: return 'HIGH'
if len(related) >= 2: return 'MEDIUM'
return 'LOW'
```

### Trust score — computed at insert (deterministic, no AI)

| Signal | Points |
|---|---|
| Category set | +20 |
| Sub-category set | +15 |
| `reported_at` provided | +10 |
| `device_id` present | +10 |
| Nearest station < 500m | +15 |
| Nearest station < 2km | +10 |
| Nearest station < 5km | +5 |
| No duplicate device submission in 30 min | +15 |
| **Cap** | **100** |

### Rate limiting

| Action | Limit | Key | Response |
|---|---|---|---|
| New initial report | 3 | IP hash per hour | 429 + `Retry-After` |
| Append to existing report | 1 | device_id per 5 min | 429 + `Retry-After` |

Append: `PATCH /api/civilian/reports/{report_id}/append` creates a new `citizen_reports` row with `linked_to_report_id` pointing to parent. Increments parent's `link_count`.

Append is blocked when the parent report status is `ACTIONED` or any `REJECTED_*` sub-state. These are terminal decisions for that report chain. The civilian tracking page prompts the user to submit a new report or call 911; if they submit a new report, it may reference the previous terminal report for validator context, but it does not reopen or mutate the terminal parent.

There is no civilian challenge endpoint in Phase 2. Rejected reports remain terminal. The recovery path is emergency guidance on the tracking page: call 911, call the nearest BFP station resolved from `nearest_station_id`, or submit a new report that references the previous rejected report ID.

A new report that references a previous rejected report uses `previous_report_id`, not `linked_to_report_id`. This keeps append chains distinct from historical references. `previous_report_id` does not increment the previous report's `link_count`, does not change the previous report's status, and appears in triage as context such as "Submitted with previous rejected report #123."

`PENDING` reports older than 2 hours are auto-transitioned by a scheduled system task to `REJECTED_TIMEOUT` with this default `status_explanation`: "This report was not verified within the 2-hour emergency review window. No validator action was recorded before timeout." Tracking guidance then tells the civilian to submit a new report or call 911 / nearest BFP station. This timeout must be a scheduled/auditable state transition, not a side effect of reading the tracking page or triage queue. Validators may later add or update a follow-up explanation for transparency after the timeout has been applied, but this follow-up does not revive the timed-out report or change its status.

Row-level `UNDER_REVIEW` pauses the 2-hour auto-timeout because a human has explicitly accepted that report into active review. Cluster-level `CLUSTER_UNDER_REVIEW` alone does not pause timeout for every nearby report; only reports explicitly selected into row-level `UNDER_REVIEW` are exempt from the 2-hour `REJECTED_TIMEOUT` transition.

Validator triage surfaces should warn on aging fire reports before timeout. A `PENDING` report older than 1 hour remains triageable, but is highlighted/notified in the validator queue because fire incidents are time-sensitive.

`witness_name` and `witness_phone` identify the direct eyewitness, not necessarily the device holder. For `WITNESS` and `NEARBY`, the reporter may provide their own details if they directly witnessed the incident. For `SECONDHAND`, the UI labels these fields as the eyewitness name/contact for the person who directly saw the incident; separate reporter contact fields are out of scope for Phase 2.

The civilian flow includes a required safety prompt after reporting context: `I_AM_SAFE`, `I_NEED_HELP`, `SOMEONE_ELSE_NEEDS_HELP`, or `UNKNOWN`. This is a triage/life-safety signal, not a fire-confidence severity input. If the user selects `I_NEED_HELP` or `SOMEONE_ELSE_NEEDS_HELP`, the UI immediately shows "Call 911 now" and nearest BFP station contact while still allowing the report to be submitted.

Submission uses a two-mode flow. Life-safety reports (`I_NEED_HELP` or `SOMEONE_ELSE_NEEDS_HELP`) show a sticky emergency contact panel and allow fast submit as soon as required fields are present. Other reports go through a compact review screen showing location, category, reporting context, safety status, and optional witness fields before final submit.

Geolocation denial or timeout does not block reporting. The UI falls back to manual map pin placement with clear copy: "Location access is off. Place the pin where the fire is." For `WITNESS`, GPS-unavailable submissions keep the `WITNESS` context but receive no GPS match bonus; validator triage must show that GPS was unavailable.

For non-life-safety submissions, the flow checks for nearby active reports before final submit. If similar reports exist, the UI shows a non-blocking suggestion: "A similar report may already exist nearby." The user can choose to add their report to the existing incident/cluster or submit as a new report. Life-safety fast submit skips this duplicate-suggestion modal.

### HCI flow

```
Page load → Browser Geolocation (auto, 10s timeout)
  → Reporting context + safety prompt
  → MapPicker fallback if denied/timeout
  → Category grid (4 tap targets)
  → Sub-category icon grid
  → "Still burning?" binary + "When did you see it?"
  → Fast submit for life-safety reports OR compact review + confirm
  → Tracking center: ID + nearest station + "what to do" + notify opt-in
```

"No risk encouragement" — "what to do while waiting" is deterministic per category, static content only.

Phase 2 does not include photo/media upload. The civilian UI should include concise safety copy near optional details: "Do not move closer or take photos if unsafe." This avoids storage, privacy, moderation, and unsafe-behavior risks while keeping reporting fast.

Public reporting and tracking screens support bilingual English/Filipino microcopy for critical prompts, button labels, and emergency guidance. Validator UI and stored enum values remain English-only in Phase 2. This is implemented with local static copy constants for the public flow, not a full app-wide i18n framework.

### Triage queue behavior

- **Overview widget** in `/dashboard/validator`
- **Dedicated page** `/incidents/triage`
- Clusters computed at read time: 500m + 1-hour window via `ST_DWithin`
- Cluster status is separate from individual `citizen_reports.status`. Each report keeps its own row status, while the tracking page can also show a related-incident/cluster-level status update for reports in the same computed or linked cluster.
- Cluster-level statuses are workflow states, not truth/outcome states: `CLUSTER_MONITORING` (system-detected related reports, no human action), `CLUSTER_UNDER_REVIEW` (validator/station operator inspecting), `CLUSTER_ACTIONED` (some selected reports received terminal row-level action), and `CLUSTER_CLOSED` (validator explicitly closed the cluster after selected row outcomes).
- Validator review uses a lightweight cluster claim/lock. Clicking "Start review" moves the cluster to `CLUSTER_UNDER_REVIEW`, stores `assigned_to` and `review_started_at`, and leaves the cluster visible to other validators with action controls disabled or marked "Being reviewed by [name]". Higher-privilege validators/admins may override or reassign stale claims.
- Cluster claims become stale after 15 minutes with no validator activity. Activity includes opening the inspection modal, changing selection, saving a note, applying a status, or refreshing the claim. UI shows claim age/countdown. Takeover after staleness requires an audit reason such as "stale claim" and is audit-logged.
- Terminal cluster actions must open an inspection modal showing both a compact map and a table. The map shows member/suggested report pins colored by row status/trust, highlights the anchor report, and draws the 100m cluster radius. The table shows report ID, distance from anchor, safety status, reporting context, category/sub-category, trust score, age, row status, and previous report reference. The validator must select which reports receive the terminal row-level action (`ACTIONED` or `REJECTED_*`) instead of blindly updating every nearby report.
- The cluster modal table supports sorting by distance, trust score, age, and safety status. It highlights possible outliers: distance greater than 100m from anchor, time gap greater than 1 hour from anchor, category mismatch, GPS mismatch/unavailable, and duplicate-device indicators. A "select all likely related" control selects non-outlier reports only.
- Validators may split a cluster when suggested reports describe separate incidents. The validator selects outlier rows, clicks "Split into new cluster," and the system creates a new `citizen_report_clusters` row with those selected reports as explicit members while preserving the original cluster for remaining members. Split actions require an audit note.
- Validators may conservatively merge clusters when separate suggested clusters clearly describe the same incident. The queue may suggest merge candidates within 250m and 1 hour. Merge flow shows both clusters' maps/tables side by side, requires confirmation plus audit note, keeps the surviving cluster active, and marks the merged cluster `CLUSTER_CLOSED` with `merged_into_cluster_id`.
- Cluster inspection modal includes an activity/history panel showing cluster detection/creation, claim/reassignment, reports added, split/merge events, status changes, civilian-visible explanations, corrections, and timeout events.
- Moving a cluster to `CLUSTER_UNDER_REVIEW` does not automatically change every nearby report row to `UNDER_REVIEW`. Row-level `UNDER_REVIEW` is applied only to reports explicitly selected by the validator as part of the review set.
- Cluster actions: mark under review, link/merge related reports, reject with a `REJECTED_*` sub-state and explanation, or add/update follow-up explanations.
- Terminal row actions require a non-empty `status_explanation`. Validator UI should provide quick-action templates for `ACTIONED`, `REJECTED_BOGUS`, `REJECTED_DUPLICATE`, and `REJECTED_INSUFFICIENT`; validators may edit the template before submission. The bulk action modal previews the exact message that will be shown to civilians and blocks submission if the explanation is blank.
- `ACTIONED` quick-action templates include: "Your report was reviewed and forwarded to your local fire station." and "Your report was reviewed and included in an operational follow-up."
- Bulk terminal actions warn on mixed current statuses and show a count by status before confirmation. Terminal rows (`ACTIONED` or `REJECTED_*`) are excluded from "select all likely related" by default. If a validator manually selects terminal rows, normal bulk apply is blocked and the correction flow is required.
- Terminal decisions can be corrected, but never silently undone. Higher-privilege validators/admins may correct terminal row statuses with a required correction reason and replacement `status_explanation`. Tracking shows the latest status while audit history preserves previous status, explanation, actor, and timestamp.
- Validator actions are audit logged, including claim, stale takeover, report selection changes, terminal status apply, explanation edits, corrections, split, merge, cluster close, and privacy-sensitive contact reveal/copy where implemented.
- Validator-only `internal_note` is separate from civilian-visible `status_explanation`. `internal_note` is optional during ordinary review and required for stale takeover, split, merge, correction, and cluster close. Internal notes appear in validator activity/history and audit logs, never on the civilian tracking page.
- Default triage queue ordering is operational priority: life-safety reports first (`I_NEED_HELP`, then `SOMEONE_ELSE_NEEDS_HELP`), reports older than 1 hour / 90 minutes, confidence severity (`HIGH`, `MEDIUM`, `LOW`), cluster size, cluster average trust score, then oldest report time.
- Validator queue includes quick filter buttons for the priority slices: needs help, someone else needs help, aging over 1 hour, timeout risk over 90 minutes, high confidence, medium confidence, low confidence, and unreviewed.
- Phase 2 uses quick filters plus URL query parameters for shareable/bookmarkable queue views. Saved custom validator views are deferred unless the civilian reporting workflow becomes a national deployment feature.
- Queue cards may show non-binding recommended next actions, but never terminal outcome recommendations. Allowed examples: "Start review" for high-confidence unclaimed clusters, "Review before timeout" for reports older than 90 minutes, "Inspect cluster" when outliers are detected, and "Check duplicate signals" for duplicate-device patterns. Recommendations must not say "Reject" or "Action."
- Validator queue uses lightweight polling, not full realtime/SSE, in Phase 2. Poll every 30 seconds while the page is visible and show freshness text such as "Updated just now" or "Updated 30s ago." If a cluster changes while its modal is open, show a non-blocking banner prompting the validator to refresh details; do not overwrite local selections without confirmation.
- Validator UI includes a trust score breakdown drawer/popover per report. It shows the total score, included signals and point values, missing/neutral signals, GPS mismatch/confirmation state, and duplicate-device indicators so deterministic confidence is auditable.
- Validator queue cards show nearest station name, distance, and phone-availability indicator. Cluster inspection modal shows station name, phone, and distance, plus a quick insert for station context in `status_explanation`.
- Validator UI privacy rules: show `witness_phone` only when supplied and only in report details/inspection modal, not queue cards. Do not show raw `device_id`, `ip_hash`, or notification tokens; expose only derived signals such as "same device reported 2 times in 30m." If witness phone reveal/copy is implemented, it must be auditable.
- Validator keyboard shortcuts are allowed only for navigation and filtering, never for terminal actions. Allowed shortcuts include `/` focus search, `j`/`k` move between queue items, `f` open filters, `m` open map/table modal, and `Esc` close modal. `ACTIONED`, `REJECTED_*`, and bulk apply actions require deliberate UI clicks plus explanation preview. Implementation must include a validator-facing shortcuts reference page.
- Track page: latest aggregated state visible + expandable timeline of all appends.
- Tracking page includes deterministic status-specific guidance. `PENDING`: "Your report is waiting for review. Call 911 if there is immediate danger." `UNDER_REVIEW`: "Your report is being reviewed. Stay safe and keep your phone available." `ACTIONED`: show `status_explanation` plus "For urgent updates, call 911 or your nearest BFP station." `REJECTED_*`: show `status_explanation`, rejection-specific guidance, nearest station phone, and option to submit a new report referencing this ID. `REJECTED_TIMEOUT`: show timeout explanation plus "Submit a new report if the emergency is ongoing."

### Official incident boundary

Civilian triage does not casually create official `fire_incidents` records. In the current WIMS-BFP scope, official `fire_incidents` are created through the regional/fire-station AFOR workflow after fire-out, then proceed through regional → national validation. Civilian reporting is a public signal and triage aid, not the authoritative incident creation path. If this module were deployed nationwide, the validator model would need more nuanced per-station RBAC and station-owned validation before any official linkage.

## Considered Options

- **Option A (single pipeline):** Direct insert to `fire_incidents`. Rejected — AFOR schema has 28+ mandatory columns; civilian reports have 3 fields. Pollutes `fire_incidents` with NULL-heavy rows and breaks analytics.
- **Option B (keep separate, no unified triage):** Two separate review surfaces. Rejected — validator should not manage two queues; HCI fragmentation.
- **Option C (clustering at insert time):** Pre-group reports on insert. Rejected — you cannot know at insert time what will arrive in the next 30 minutes. Must be computed at read time.

## Consequences

- `public_dmz.py` route (`POST /api/v1/public/report`) is deprecated. All public submissions route through `civilian.py`. Redis rate limiters updated to new limits (3/hr initial — lowered from 5/hr per PR #446 gap #14 anchor change, 1/5min append). The per-IP rate-limit key is `$realip_remote_addr` (TCP socket IP, not X-Forwarded-For) and the threshold is centralised in `src/backend/utils/rate_limit.py`.
- `citizen_reports.description` column removed — free-text description replaced by category/sub-category + binary questions. Backward-compatible migration drops column.
- Triage queue rebuild requires frontend rewrite of `/incidents/triage` page and new API endpoint `GET /api/triage/queue`.
- Public entry point changed from `/report` to `/` — login moved to `/auth/login`. Tracking page moved from `/report/tracking` to `/tracking`. OIDC callback remains at `/callback`.
