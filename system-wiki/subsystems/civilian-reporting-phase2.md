---
title: Civilian Reporting Phase 2 — Subsystem Deep-Dive
created: 2026-05-20
updated: 2026-06-17
type: subsystem
tags: [wims-bfp, subsystem, civilian-reporting, triage, validation, public-dmz, cluster, merge, map]
sources: [system-wiki/prd/civilian-reporting-phase-2.md, system-wiki/decisions/0001-civilian-reporting-overhaul.md, src/backend/api/routes/triage.py, src/backend/api/routes/civilian.py, src/backend/api/routes/ref.py, src/backend/api/routes/public_dmz.py, src/backend/tasks/civilian_reports.py, src/frontend/src/app/incidents/triage/page.tsx, src/frontend/src/app/page.tsx, src/frontend/src/app/tracking/page.tsx]
status: current
related: [prd/civilian-reporting-phase-2, decisions/0001-civilian-reporting-overhaul, subsystems/references/triage-api-ref, frontend/validator-triage-shortcuts, gaps/frs-codebase-gap-register]
---

# Civilian Reporting Phase 2 — Subsystem Deep-Dive

Civilian Reporting Phase 2 replaced the thin public DMZ with a structured `citizen_reports` staging layer and a dedicated validator triage workflow. This page is the authoritative implementation record for agents.

## Architecture

```
Public civilians
    │
    ▼
POST /api/civilian/reports          ← structured submission (rate-limited)
GET  /api/civilian/reports/{id}     ← public tracking
GET  /api/civilian/reports/{id}/timeline  ← append chain
    │
    ▼
   citizen_reports  (public signal, NOT fire_incidents)
    │
    ▼
Validator triage: GET /api/triage/queue
  - clusters via PostGIS ST_DWithin (100m / 1hr)
  - claim / terminal-action / split / merge / correct
  - merge-candidate discovery (250m / 1hr)
  - cluster map (react-leaflet)
    │
    ▼
Official fire_incidents
  (created by REGIONAL_ENCODER via AFOR workflow only)
```

Backend triage implementation is split under `src/backend/services/civilian_triage/`. `api/routes/triage.py` is the HTTP Adapter; queue projection, workflow commands, policies, repository helpers, and notification enqueue behavior live in the service Module.

## Public API — Civilian Routes

All civilian routes are unauthenticated. `device_id` is required and generated/stored in browser `localStorage`.

### `POST /api/civilian/reports`
Submit a structured civilian report.

**Request body** (`SubmitReportSchema`):
| Field | Type | Required | Notes |
|---|---|---|---|
| category | string | Yes | STRUCTURAL / NON_STRUCTURAL / TRANSPORTATION / UNSURE |
| sub_category | string | No | Optional subtype/icon key when known; may be omitted for `UNSURE` or emergency fast submit |
| latitude | float | Yes | GPS or manual pin |
| longitude | float | Yes | GPS or manual pin |
| safety_status | string | Yes | I_AM_SAFE / I_NEED_HELP / SOMEONE_ELSE_NEEDS_HELP / UNKNOWN |
| reporting_context | string | Yes | WITNESS / NEARBY / SECONDHAND |
| observed_time | datetime | No | Optional ISO 8601 observed time; backend should tolerate omission/default for emergency fast submit |
| description | string | No | Free text |
| eyewitness_name | string | No | Optional follow-up contact |
| eyewitness_contact | string | No | Optional follow-up contact |
| previous_report_id | int | No | References a terminal report without reopening it |
| device_id | string | Yes | Browser-generated UUID, stored in localStorage |

**Rate limits**: 5 new reports per IP per hour; 1 append per device per 5 minutes.

**Safety-first public flow**: `/report` asks `safety_status` before reporting context/location so life-safety guidance appears before cognitively heavier source/location questions.

**Calm emergency landing block**: `/report` starts with dominant emergency contact guidance: call 911 now if anyone is in immediate danger; move away from smoke/fire; do not get closer to take photos. This block is guidance only, does not create a separate data state, and does not require pre-submit nearest-station lookup or additional hotline numbers.

**First interactive step**: after the emergency landing block, ask only one question — “Are you or anyone else in danger?” — with the four `safety_status` choices. Do not combine safety and reporting context on the same screen; reporting context/location belongs to the next step.

**Life-safety path** (`I_NEED_HELP` / `SOMEONE_ELSE_NEEDS_HELP`): keeps 911 guidance visible through the flow, skips duplicate-suggestion review step, and uses fast submit. Life-safety order is safety → location → reporting context → explicit category tap → primary “Send now.” From the category step, “Send now” submits immediately once minimum required fields are present; optional fields are only behind a secondary “Add details if safe” path, and that optional details page still keeps “Send now” as the primary action. The category step must make `UNSURE` prominent rather than silently defaulting it. Minimum life-safety fields are `safety_status`, `latitude`, `longitude`, `reporting_context`, explicit `category` (including `UNSURE`), and `device_id`. Optional fields are `sub_category`, observed/reported time, witness name/contact, and `previous_report_id`. Non-life-safety shows details/review and duplicate suggestions before submit. Nearest-station escalation remains post-submit/tracking via the existing backend response.

**Unknown safety status**: `UNKNOWN` remains non-life-safety for backend priority and fast-submit behavior, but the UI shows cautious guidance: if anyone may be in danger, call 911 now and stay away from smoke/fire.

**Uncertain category UX**: category selection treats `UNSURE` as a safe default, not a failure. The UI shows specific fire categories first, then a prominent “I’m not sure / Hindi sigurado” action with reassuring copy that BFP can still review the report.

**Location prompt UX**: after safety, `/report` asks location before reporting context. Location selection leads with one plain-language question: “Where is the fire?” The screen can offer “Use my current location” and “Place pin manually” without needing `reporting_context` first. Helper copy says to use current location if the reporter is there, otherwise place the pin on the fire location. Reporting context is captured afterward for validator interpretation and GPS trust scoring.

**Reporting-context iconography**: reporting-context choices should use low-ambiguity visual icons to reduce reading load under stress: eye/direct-view icon for `WITNESS`, map/proximity icon for `NEARBY`, and message/speech icon for `SECONDHAND`. Exact icons are implementation-flexible, but context choices should not remain text-only.

**Shared report order**: both life-safety and non-life-safety reports use the same core order: safety → location → reporting context → category. Life-safety then shows primary “Send now”; non-life-safety continues to details/review.

**Secondhand/current-location challenge**: if a user chooses current GPS as the fire location and later selects `SECONDHAND`, the UI must challenge the combination: “Is this current location where the fire is?” with “Yes, the fire is here” and “No, let me place the pin.” A “No” answer returns to manual pin placement.

**Nearby/current-location reminder**: if a user chooses current GPS as the fire location and later selects `NEARBY`, the UI shows a non-blocking reminder: “If the fire is not exactly where you are, place the pin on the fire instead.” Continue remains available.

**Success screen emergency boundary**: after every submission, `/report` must show “Report submitted,” then explicitly say that if anyone is in immediate danger, call 911 now; the report helps BFP review public signals but does not replace an emergency call. This boundary appears for all `safety_status` paths, not only life-safety reports. Then show report ID, tracking, and nearest station if available.

**Tracking page emergency boundary**: `/report/tracking` must show the same immediate-danger boundary across all statuses: if anyone is in immediate danger, call 911 now; the report helps BFP review public signals but does not replace an emergency call. Waiting/uncertain statuses should keep the boundary visually prominent. `ACTIONED` may place it lower or render it less urgently, but must not remove it.

**Nearest-station presentation**: post-submit and tracking screens may show nearest-station details, but only as secondary follow-up/context after the 911 emergency boundary. Label it “Nearest BFP station for follow-up,” include “For immediate danger, call 911 first,” and if `nearest_station_phone` is the fallback `911`, label it as the emergency number rather than a station phone.

**Bilingual stress-critical copy**: public reporting/tracking uses local English/Filipino static copy constants, not full app-wide i18n. Bilingual copy is required for stress-critical prompts only: 911/immediate danger, do not move closer or take photos, “does not replace an emergency call,” “Send now,” “Add details if safe,” `UNSURE` reassurance, location helper telling users to use current location only if they are there and otherwise pin the fire, and the 911 sentence in submit/rate-limit/network errors. English-only labels are acceptable for report IDs, technical status labels, station follow-up labels, observed time, and previous report ID.

**Safety-first submit errors**: any `/report` submit failure says the report could not be sent and tells users to call 911 now if anyone is in immediate danger. Then show the practical next step: validation/location errors ask the user to check the missing field or place the pin again; rate limits say too many reports came from this network and suggest tracking/updating an existing report if they have its ID; network/server failures ask the user to retry when connected while preserving the 911 boundary.

**Errors**: 429 on rate limit hit, 400 on validation failure.

### `POST /api/civilian/reports/duplicate-suggestions`
Non-life-safety pre-submit duplicate check.

**Request body**: `{ latitude, longitude, device_id }`

**Returns**: `{ suggestions: [{ report_id, distance_m, category, created_at }] }`

Uses `ST_DWithin(geography(location), geography(ST_MakePoint(lon,lat)), 500)` — returns reports within 500m that are not terminal and not own device.

### `GET /api/civilian/reports/{report_id}`
Public tracking — no auth required.

**Returns**: `{ report_id, status, status_explanation, nearest_station_id, nearest_station_phone, updated_at, created_at, append_count }`

- `status_explanation`: human-readable guidance per status
- `nearest_station_phone`: from `ref_fire_stations.phone`, falls back to `911`
- `append_count`: number of linked appends (severity signal)

### `GET /api/civilian/reports/{report_id}/timeline`
Chronological append chain for a report.

**Returns**: `[{ report_id, category, sub_category, status, safety_status, created_at, linked_to_report_id }]`

Ordered oldest-first. Follows `linked_to_report_id` chain.

### `PATCH /api/civilian/reports/{report_id}/append`
Append new signal to an existing report (new row with `linked_to_report_id`). Requires device_id match and non-terminal status.

**Request body**: `{ device_id, category, sub_category, latitude, longitude, safety_status, reporting_context, observed_time, description?, eyewitness_name?, eyewitness_contact? }`

**Rate limit**: 1 append per device per 5 minutes across all linked reports.

### `POST /api/civilian/reports/{report_id}/notify`
Register FCM notification token for tracking page push.

**Request body**: `{ fcm_token }`

### `GET /api/civilian/report-clusters`
Public root-map projection for **Public Fire Report Areas**. This is unauthenticated but privacy-minimized and is not an official incident feed.

**Local mode**: when `lat` and `lon` are supplied, the backend maps the coordinates to a 500m bucket center, queries durable civilian report clusters within 10km for the last 60 minutes, requires at least 3 pressure reports, caps to 50 areas, and sorts by internal exact report count descending.

**National mode**: when no location is supplied, the endpoint returns high-signal areas nationwide for the last 60 minutes, requires at least 10 pressure reports, caps to 25 areas, and sorts by internal exact report count descending.

**Cluster rules**:
- Source is `citizen_report_clusters` plus `citizen_report_cluster_members`, not raw ad hoc grid grouping.
- Visible areas require at least one `PENDING` or `UNDER_REVIEW` report.
- Count pressure includes `PENDING`, `UNDER_REVIEW`, and `LINKED`.
- Excludes `ACTIONED`, all `REJECTED_*`, `CLUSTER_ACTIONED`, `CLUSTER_CLOSED`, and merged clusters.

**Public response privacy contract**:
- Includes mode metadata, query center, radius/window/minimums, `truncated`, `stale`, `degraded`, and `areas`.
- Each area exposes only ephemeral `area_id`, exact centroid, dynamic meter radius, report count bucket, and age bucket.
- It never exposes raw `cluster_id`, `report_id`, exact report count, exact timestamps, category breakdown, validator severity, life-safety status, witness/contact/device/IP data, or station-per-cluster context.

**Cache behavior**: Redis cache-aside with bounded connection pool (`max_connections=10`, double-checked locking for thread-safe singleton init). Fresh responses live for 60 seconds; stale fallback lives for 10 minutes. If DB query fails and stale cache exists, response returns `stale: true`; otherwise it returns an empty degraded response. Warning logs include the cache key for diagnostics. `_get_count_bucket()` raises `ValueError` for counts below 3 as defense-in-depth (SQL `WHERE total_reports >= :min_reports` already prevents this in normal operation).

## Public Reference API

### `GET /api/ref/emergency-services`
Public reference endpoint for root-map station markers and emergency call guidance.

Returns `emergency_number: "911"` and all BFP station names/coordinates. It does not return station phone numbers or addresses. When `lat`/`lon` are supplied, the backend computes distances and returns `nearest_station_ids` for the nearest five stations while still returning all stations for map display.

**Cache behavior**: Redis cache-aside with 24-hour fresh TTL and 7-day stale fallback. If DB query fails and no cache exists, it returns `911`, empty stations, and `degraded: true`.

## Public DMZ Boundary

`src/backend/api/routes/public_dmz.py`:

- `POST /api/v1/public/report` → **201 Created** (restored by PR #210 — see below)
- `PATCH /api/v1/public/report/{report_id}` → **410 Gone** (legacy deprecated)
- Legacy triage promotion: `POST /api/triage/{report_id}/promote` → **410 Gone**
- Legacy bulk promotion: `POST /api/triage/bulk-promote` → **410 Gone**

### Restored Public Report Endpoint (PR #210 / FRS M14)

`POST /api/v1/public/report` was restored as the zero-trust unauthenticated public DMZ incident submission endpoint:

- **No auth required** — no Keycloak JWT, no cookie dependency.
- **Redis sliding-window rate limit** — 3 requests per IP per hour, enforced via atomic Lua script (sorted-set `ZREMRANGEBYSCORE` + `ZCARD` + `ZADD`). Returns HTTP 429 with `Retry-After` header when exceeded.
- **Fail-open** — Redis connection or eval failures let the request through (logged at WARNING).
- **Region resolution** — nearest `ref_fire_stations` via PostGIS `<->` KNN (same pattern as `civilian.py`); falls back to `ref_regions ORDER BY region_id LIMIT 1` when no stations match. Returns HTTP 500 if both fail.
- **PENDING_VALIDATION insert** — `INSERT INTO wims.fire_incidents` with `encoder_id=NULL`, `import_batch_id=NULL`, `verification_status='PENDING_VALIDATION'`.
- **CSRF exempt** — the public DMZ path prefix (`/api/v1/public/`) is explicitly excluded from CSRF Origin/Referer validation since the endpoint is unauthenticated and protected by rate limiting + Pydantic validation.

The civilian staging layer (`citizen_reports`) and the public DMZ (`fire_incidents`) are now parallel intake paths: public reporters can submit directly to `fire_incidents` via the DMZ, or use the structured `citizen_reports` flow via `/api/civilian/reports`.

## Triage Queue — Phase 2 API

### `GET /api/triage/queue`
Returns clustered `citizen_reports` with cluster metadata.

**Auth**: REGIONAL_ENCODER or NATIONAL_VALIDATOR

**Query params**:
| Param | Notes |
|---|---|
| `status` | PENDING / UNDER_REVIEW / LINKED / ACTIONED / REJECTED_* |
| `needs_help` | true → safety_status IN (I_NEED_HELP, SOMEONE_ELSE_NEEDS_HELP) |
| `aging` | true → created_at < now() - 30 min |
| `timeout_risk` | true → PENDING, aging, no UNDER_REVIEW cluster |
| `confidence` | min threshold |
| `unreviewed` | no cluster membership |

**Cluster discovery / related counts**: triage queue related-count/severity uses PostGIS `ST_DWithin(geography, geography, 100)` and a 1-hour window. Queue reads materialize durable clusters only for reports that have at least one related report within 100m/1hr (the `groupable` CTE filters `unclustered` reports with a correlated `EXISTS (SELECT 1 FROM ... WHERE ST_DWithin(...) AND ...)` subquery). Truly isolated reports remain unclustered (`cluster_id` is null) and appear in the Individual Reports table; related reports each get their own cluster and appear in the Clusters table for validator review, claim, and manual merge.

**RLS context note**: the queue projection uses `get_db_with_rls()` and materializes singleton clusters during the read. Because SQLAlchemy/PostgreSQL `SET LOCAL wims.current_user_id` is cleared by `db.commit()`, `src/backend/services/civilian_triage/queue_projection.py` re-establishes RLS context immediately after the materialization commit and before `_table_exists()` plus the main queue SELECT. Without this reset, production app-user sessions can see PENDING rows in lightweight widgets but receive an empty triage queue.

**Returns per cluster**:
```
{
  cluster_id, status, member_count, link_count, severity,
  avg_trust_score, cluster_created_at, cluster_updated_at,
  assigned_to, review_started_at,
  reports: [{ report_id, latitude, longitude, category, ... }],
  nearest_station_id, nearest_station_phone
}
```

`link_count` is the primary severity signal — derived at read time from the number of 100m/1hr related reports (including appends).

### `POST /api/triage/clusters/{cluster_id}/claim`
Claim a cluster before review. Claims older than 15 minutes without activity are considered stale.

### `POST /api/triage/clusters/{cluster_id}/activity`
Heartbeat to keep a claim alive. Resets the 15-minute stale clock.

### `GET /api/triage/clusters/{cluster_id}/activity`
Returns the audit/history of a cluster: claims, takeovers, terminal actions, splits, merges, corrections, and status transitions.

### `POST /api/triage/clusters/{cluster_id}/terminal-action`
Apply a terminal action to all non-terminal rows in a cluster.

**Request body**:
| Field | Type | Notes |
|---|---|---|
| action | string | ACTIONED / REJECTED_BOGUS / REJECTED_DUPLICATE / REJECTED_INSUFFICIENT |
| status_explanation | string | Required, civilian-visible |
| internal_note | string | Optional, validator-only |

- All non-terminal rows in the cluster receive the same `status` and `status_explanation`.
- Terminal rows (already ACTIONED or REJECTED_*) are skipped with a warning in the response.
- Row-level `UNDER_REVIEW` status is cleared by this action.

### `POST /api/triage/clusters/{cluster_id}/split`
Create a new explicit cluster from selected outlier reports. Moves selected `citizen_report_ids` from the current cluster into a new `CLUSTER_MONITORING` cluster. The original cluster is updated to remove those rows.

**Request body**: `{ citizen_report_ids: [int], internal_note: string }`

### `POST /api/triage/clusters/{target_cluster_id}/merge`
Conservative merge — closes the source cluster and moves all its members into the target.

**Request body**: `{ source_cluster_id: int, internal_note: string }`

The source cluster's `merged_into_cluster_id` is set. The target cluster's member count and severity are recomputed.

**Constraint**: only `CLUSTER_MONITORING` and `CLUSTER_UNDER_REVIEW` clusters can be merge targets. `CLUSTER_ACTIONED` and `CLUSTER_CLOSED` return 409.

### `GET /api/triage/clusters/{cluster_id}/merge-candidates`
**Phase 2 feature** — returns nearby cluster IDs that are candidates for conservative merge.

**Discovery logic** (PostGIS):
```sql
ST_DWithin(geography, geography, 250)  -- within 250 meters
AND ABS(EXTRACT(EPOCH FROM time_offset)) < 3600  -- within 1 hour
AND status NOT IN ('CLUSTER_CLOSED')   -- exclude closed
AND cluster_id != :own_cluster_id      -- exclude self
```

**Returns**:
```
[{ cluster_id, anchor_report_id, distance_m, minutes_apart, status, member_count }]
```

`anchor_report_id` is the oldest report in the candidate cluster (used as the merge reference). The frontend displays this list so validators can click-to-select a source cluster instead of manually typing an ID.

### `POST /api/triage/reports/{report_id}/correct`
Provenance-only correction for already-terminal rows. Does not change status, only `data_hash`.

**Auth**: NATIONAL_VALIDATOR or SYSTEM_ADMIN

**Request body**: `{ data_hash: string, internal_note: string }`

## Timeout Job

`src/backend/tasks/civilian_reports.py` → `timeout_pending_reports`

Registered in Celery beat: runs every 5 minutes.

**Logic**: Transitions `PENDING` rows older than 2 hours to `REJECTED_TIMEOUT` using the locked default explanation. Row-level `UNDER_REVIEW` status pauses the timeout clock — the row must also be `PENDING` to time out.

Does NOT touch rows with status `UNDER_REVIEW` at the row level, even if they are in an active cluster.

## Frontend Components

### `/report` — Public Submission (`src/frontend/src/app/report/page.tsx`)
- Persists `device_id` in browser `localStorage`
- GPS prompt on mount; manual pin fallback if denied
- Safety status → life-safety fast-submit bypass
- Category → sub-category grid (4 + icons)
- Duplicate suggestions (`POST /api/civilian/reports/duplicate-suggestions`) shown non-blocking before non-life-safety submit
- Previous report reference field (shown after ACTIONED/REJECTED terminal guidance)
- Submit calls `POST /api/civilian/reports`
- **CTA visual contract**: disabled CTAs must not use the active BFP red/gradient treatment. Disabled state uses visibly inactive/muted styling (e.g. gray background, not red/gradient). Enabled primary CTAs use high-contrast BFP red/gradient. This prevents stressed users from misreading a disabled button as active — a direct application of the stress-friendly cognitive-clarity mandate.

### `/report/tracking` — Public Tracking (`src/frontend/src/app/report/tracking/page.tsx`)
- Reads `?id=<reportId>` from URL on first load
- Status badge + deterministic guidance per status
- Nearest station contact (phone, falls back to 911)
- Notification opt-in (FCM token registration)
- Append timeline (chronological chain)
- After terminal status: CTA to submit new report referencing old ID

### `/incidents/triage` — Validator Triage (`src/frontend/src/app/incidents/triage/page.tsx`)
Phase 2 validator UI:

- **Queue list**: Cluster cards sorted by priority (life-safety > aging > severity > member_count > age). Quick filter chips. 30-second polling.
- **Filters in URL**: `?status=PENDING&aging=true&timeout_risk=true` — shareable and bookmarkable.
- **Claim indicator**: shows assigned validator + time; stale claims highlighted.
- **Inspection modal**:
  - `<ClusterInspectionMap>` — react-leaflet map with red markers for cluster members, blue markers for suggested merge-anchor reports, 100m radius circle around anchor
  - Report table (coordinates, category, safety, trust score, age)
  - Merge-candidate suggestion list — click to auto-fill source cluster ID + pre-generated internal note
  - Activity/history panel (fetched in parallel with merge candidates on modal open)
  - Terminal action card: action selector, required `status_explanation` textarea, optional `internal_note`, preview
  - Correction card: `NATIONAL_VALIDATOR` or `SYSTEM_ADMIN` only
  - Split card: select outlier reports, confirm
  - Merge card: source cluster ID (manual or from candidate list)
  - Modal UX stability: background 30-second queue polling is paused while the dialog is open, body scroll is locked, the header is sticky, backdrop click closes only when the actual backdrop is targeted, and an explicit Close button is available.
- **Keyboard shortcuts**:
  - `Esc` → close modal, including when focus is inside a modal `INPUT`, `TEXTAREA`, or `SELECT`.
  - Non-close shortcuts are suppressed inside editable controls to avoid accidental actions while typing.
  - Shortcut hint shown in modal header: "Esc close".

### Map Components

**`ClusterInspectionMap.tsx`** (`src/frontend/src/components/ClusterInspectionMap.tsx`):
- SSR-safe wrapper using `dynamic(() => import(...), { ssr: false })`
- Accepts `reports: TriageReportEntry[]` and `suggestedReportIds: number[]`
- Passes through to `ClusterMapInner`

**`ClusterMapInner.tsx`** (`src/frontend/src/components/ClusterMapInner.tsx`):
- `MapContainer` centered on cluster centroid
- OpenStreetMap tile layer (`https://tile.openstreetmap.org/{z}/{x}/{y}.png`)
- Red circle markers (`#ef4444`) for cluster reports
- Blue circle markers (`#3b82f6`) for suggested merge-anchor reports
- `Circle` component showing 100m radius around anchor

## API Client

`src/frontend/src/lib/api.ts` exposes:

| Function | Method | Endpoint |
|---|---|---|
| `fetchTriageQueue(params?)` | GET | `/api/triage/queue` |
| `claimCluster(clusterId)` | POST | `/api/triage/clusters/{id}/claim` |
| `refreshClusterActivity(clusterId)` | POST | `/api/triage/clusters/{id}/activity` |
| `getClusterActivity(clusterId)` | GET | `/api/triage/clusters/{id}/activity` |
| `applyClusterTerminalAction(clusterId, body)` | POST | `/api/triage/clusters/{id}/terminal-action` |
| `correctTerminalReport(reportId, body)` | POST | `/api/triage/reports/{id}/correct` |
| `splitCluster(clusterId, body)` | POST | `/api/triage/clusters/{id}/split` |
| `mergeClusters(targetClusterId, body)` | POST | `/api/triage/clusters/{id}/merge` |
| `fetchMergeCandidates(clusterId)` | GET | `/api/triage/clusters/{id}/merge-candidates` |

`MergeCandidateEntry` interface:
```typescript
interface MergeCandidateEntry {
  cluster_id: number;
  anchor_report_id: number;
  distance_m: number;
  minutes_apart: number;
  status: string;
  member_count: number;
}
```

## Test Coverage

**Backend** (`src/backend/tests/integration/test_civilian_api.py`, `test_triage_queue.py`):

All tests use an `autouse=True` `_clean_state` fixture that flushes Redis and deletes from `citizen_report_cluster_members`, `citizen_report_clusters`, and `citizen_reports` in FK-safe order before each test. Redis clients created in tests use `socket_connect_timeout=0.5`/`socket_timeout=0.5` and are closed with `try/finally`. The cache test uses `scan_iter` instead of `KEYS` to avoid O(N) keyspace scans.

| Test class | Coverage |
|---|---|
| `TestSubmitReport` | submission, GPS mismatch, duplicate device, rate limit |
| `TestDuplicateSuggestions` | within-500m alive non-own, empty on terminal/own |
| `TestAppendReport` | append chain, rate limit, terminal block |
| `TestGetReport` | tracking fields, station phone fallback |
| `TestReportTimeline` | chronological append chain |
| `TestNotify` | FCM token registration |
| `TestMergeCandidates` | positive 250m/1hr, >250m exclusion, >1hr exclusion, CLUSTER_CLOSED exclusion, 404 nonexistent, own-cluster exclusion |
| `TestTriageQueue`, `TestClusterClaim`, `TestTerminalAction`, `TestClusterSplit`, `TestClusterMerge`, `TestCorrectReport` | Phase 2 queue, claim/activity/terminal/split/merge/correct |

**Frontend** (`src/frontend/src/app/incidents/triage/page.test.tsx`):

| Test | Coverage |
|---|---|
| renders queue | queue page loads with cluster list |
| opens inspection modal | modal opens on cluster click |
| shows keyboard shortcut hint | "Esc close · R refresh" text in modal |
| closes on Escape | modal closes on Esc when no input focused |
| displays merge candidate list | candidate cluster shown when modal open |
| does not fire shortcuts when focus inside input | keyboard guard protects inputs |

## Files

**Backend**:
- `src/backend/api/routes/civilian.py` — public report API
- `src/backend/api/routes/public_dmz.py` — 410 for legacy endpoints
- `src/backend/api/routes/triage.py` — Phase 2 triage queue + merge-candidates
- `src/backend/schemas/civilian.py` — Pydantic schemas for civilian routes
- `src/backend/models/citizen_report.py` — ORM models
- `src/backend/tasks/civilian_reports.py` — Celery timeout task
- `src/backend/celery_config.py` — beat registration
- `src/backend/main.py` — task registration

**Frontend**:
- `src/frontend/src/app/report/page.tsx` — public submission
- `src/frontend/src/app/report/tracking/page.tsx` — public tracking
- `src/frontend/src/app/incidents/triage/page.tsx` — validator triage UI
- `src/frontend/src/components/ClusterInspectionMap.tsx` — SSR-safe map wrapper
- `src/frontend/src/components/ClusterMapInner.tsx` — Leaflet map
- `src/frontend/src/lib/api.ts` — API client (all Phase 2 methods)
- `src/frontend/src/app/incidents/triage/page.test.tsx` — Vitest tests

**Database**:
- `src/postgres-init/36_ref_fire_stations_phone_null.sql` — phone default 911
