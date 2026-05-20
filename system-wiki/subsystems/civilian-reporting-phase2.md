---
title: Civilian Reporting Phase 2 — Subsystem Deep-Dive
created: 2026-05-20
updated: 2026-05-20
type: subsystem
tags: [wims-bfp, subsystem, civilian-reporting, triage, validation, public-dmz, cluster, merge, map]
sources: [system-wiki/prd/civilian-reporting-phase-2.md, system-wiki/decisions/0001-civilian-reporting-overhaul.md, src/backend/api/routes/triage.py, src/backend/api/routes/civilian.py, src/backend/api/routes/public_dmz.py, src/backend/tasks/civilian_reports.py, src/frontend/src/app/incidents/triage/page.tsx, src/frontend/src/app/report/page.tsx, src/frontend/src/app/report/tracking/page.tsx]
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

## Public API — Civilian Routes

All civilian routes are unauthenticated. `device_id` is required and generated/stored in browser `localStorage`.

### `POST /api/civilian/reports`
Submit a structured civilian report.

**Request body** (`SubmitReportSchema`):
| Field | Type | Required | Notes |
|---|---|---|---|
| category | string | Yes | STRUCTURAL / NON_STRUCTURAL / TRANSPORTATION / UNSURE |
| sub_category | string | Yes | Icon key, e.g. STRUCTURAL_ESTABLISHMENT |
| latitude | float | Yes | GPS or manual pin |
| longitude | float | Yes | GPS or manual pin |
| safety_status | string | Yes | I_AM_SAFE / I_NEED_HELP / SOMEONE_ELSE_NEEDS_HELP / UNKNOWN |
| reporting_context | string | Yes | WITNESS / NEARBY / SECONDHAND |
| observed_time | datetime | Yes | ISO 8601 |
| description | string | No | Free text |
| eyewitness_name | string | No | Optional follow-up contact |
| eyewitness_contact | string | No | Optional follow-up contact |
| previous_report_id | int | No | References a terminal report without reopening it |
| device_id | string | Yes | Browser-generated UUID, stored in localStorage |

**Rate limits**: 5 new reports per IP per hour; 1 append per device per 5 minutes.

**Life-safety path** (`I_NEED_HELP` / `SOMEONE_ELSE_NEEDS_HELP`): skips duplicate-suggestion review step. Non-life-safety shows duplicate suggestions before submit.

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

## Public DMZ Boundary

`src/backend/api/routes/public_dmz.py`:

- `POST /api/v1/public/report` → **410 Gone** (legacy deprecated)
- `PATCH /api/v1/public/report/{report_id}` → **410 Gone** (legacy deprecated)
- Legacy triage promotion: `POST /api/triage/{report_id}/promote` → **410 Gone**
- Legacy bulk promotion: `POST /api/triage/bulk-promote` → **410 Gone**

The civilian staging layer cannot create `fire_incidents` through the public API or the deprecated promotion routes.

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

**Cluster discovery**: PostGIS `ST_DWithin(geography, geography, 100)` + `ABS(EXTRACT(EPOCH FROM time_offset)) < 3600`.

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
- **Keyboard shortcuts** (navigation-only, focus-guarded):
  - `Esc` → close modal
  - `R` → refresh queue
  - Shortcut hint shown in modal header: "Esc close · R refresh"
- **Keyboard guard**: shortcuts are suppressed when focus is inside `INPUT`, `TEXTAREA`, or `SELECT` elements.

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
