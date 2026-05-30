# Three-Axis Review: feat/kanban-batch-1
**Reviewed:** `feat/kanban-batch-1` @ `2313a5e`
**Base:** `f221bfb` (merge-base with `master`)
**Size:** 35 files, +2533 / −84 lines
**Date:** 2026-05-30

---

## BLOCKING — Must Address Before Merge

### 1. 🚨 Spec: Public map queries `wims.fire_incidents` (verified BFP incidents), not civilian reports

**severity: ARCHITECTURAL** | `src/backend/api/routes/map.py:146`

The `/api/public/clusters` endpoint queries `FROM wims.fire_incidents WHERE verification_status = 'VERIFIED'`. The spec (#126, #127) explicitly requires showing **civilian pressure report areas** — not official BFP-confirmed incidents — to avoid implying that report areas = BFP incidents.

> **quote(spec) #126:** "Public map shows clustered civilian report areas (NOT individual reports)" / "No implication that report areas = BFP incidents"

> **quote(spec) #127:** "Privacy contract: area-level data only, no raw reports or cluster workflow handles"

> **quote(code)** `map.py:146`: `FROM wims.fire_incidents`

This fundamentally violates the privacy contract. A public user seeing this map would reasonably believe these are official BFP-confirmed fire incidents. The endpoint must query `wims.citizen_reports` (or equivalent civilian pressure table) instead.

Additionally, the spec requested `GET /api/civilian/report-clusters`; the actual route is `/api/public/clusters`.

---

### 2. 🚨 Spec: Cluster algorithm ignores all specified parameters

**severity: SPEC-DEVIATION** | `src/backend/api/routes/map.py:65-75,130-164`

Spec #127 specifies: 500m bucket center, 10km radius, 1-hour time window, minimum 3 pressure reports, cap 50. The implementation uses a zoom-based `ST_SnapToGrid` grid with none of these parameters: no 500m bucket, no 10km radius filter, no 1hr time window, no min-3 threshold, no cap-50 limit.

> **quote(spec) #127:** "Local mode uses 500m bucket center query, 10km radius, 1-hour window, minimum 3 pressure reports, and cap 50."

> **quote(code)** `map.py:65-75`: `def _grid_size_for_zoom(zoom: int) -> float: ... return 360.0 / (math.pow(2.0, zoom) * 10.0)`

---

### 3. 🚨 Spec: No stale-if-error cache behavior

**severity: SPEC-DEVIATION** | `src/backend/api/routes/map.py:108-192`

Spec #128 requires: serve stale cached response when DB query fails (with `stale: true` marker), return 503 if both DB and cache fail, fresh TTL of 60s. The implementation only writes to cache after successful DB fetch and only handles Redis-read failures — there's no stale-data fallback path, no `stale: true` marker, no 503, and the TTL is 120s (not 60s).

> **quote(spec) #128:** "Stale cached response is served if DB query fails, with stale: true." / "If DB query fails and no stale cache: return 503."

> **quote(code)** `map.py:186-192`: Caches after successful fetch only; `map.py:35`: `_REDIS_CLUSTER_TTL = 120`

---

### 4. 🚨 Spec: Shared `fireLocation` state not implemented

**severity: SPEC-DEVIATION** | `src/frontend/src/app/page.tsx`

Spec #131 requires the root page to own a shared `fireLocation` state: the manual report fire pin AND confirmed GPS location should update both the report submission location and the public map anchor. The implementation passes only an `onGeolocationAvailable` callback one-way from map to report flow — no shared state the map reads from the report flow.

> **quote(spec) #131:** "Root page owns shared fire-location state" / "Manual report fire pin updates both report submission location and public map anchor."

> **quote(code)** No shared state lift exists in page.tsx. Geolocation flows one-way from map → report only.

---

### 5. 🚨 Spec: Missing backlog migration for AES-256-GCM plaintext data

**severity: DATA-INTEGRITY** | No migration file found

Spec #150 requires encrypting existing plaintext `narrative_report`, `casualty_details`, and `estimated_damage_php` into the encrypted `pii_blob_enc` blob. The encryption code paths are updated for NEW writes, but no migration or backfill script exists to encrypt data already stored in plaintext.

> **quote(spec) #150:** "Migration needed to encrypt existing plaintext data"

> **quote(code)** No migration file or backfill command exists in the repo.

---

### 6. 🚨 Quality: Duplicated role resolution in `events.py`

**severity: MAINTENANCE-RISK** | `src/backend/api/routes/events.py:36-68`

`_WIMS_ROLES` and `_resolve_role_from_token` are copy-pasted from `main.py:59-86`. The comment says "copied from main.py to avoid circular imports." Any role resolution change must now be synchronized across two files. The copies already diverge (type annotations differ). Extract to `auth.py`.

> **quote(code)** `events.py:36`: `# WIMS roles in precedence order — copied from main.py to avoid circular imports`

---

### 7. 🚨 Standards: Missing mandatory `system-wiki/log.md` entry

**severity: PROCESS** | `system-wiki/log.md`

Commit `2313a5e` updated 4+ wiki synthesis pages but did NOT append an entry to `system-wiki/log.md`. The last entry is 2026-05-27.

> **quote(standard) AGENTS.md:13:** "Append an entry to `system-wiki/log.md`."

---

## SUGGESTIONS (Non-blocking, but Recommended)

### S1. Spec: Buggy polling interval and missing tab-visibility pause

> **quote(spec) #132:** "Poll every 60s while visible" / "Pause polling when tab is hidden"

> **quote(code)** `PublicFireMapInner.tsx:63`: `const POLL_INTERVAL_MS = 30_000;` — polls every 30s, not 60s. No `document.visibilitychange` handler.

### S2. Spec: Backdrop click does not close triage inspect modal

> **quote(spec) #134:** "Backdrop click closes modal"

> **quote(code)** `triage/page.tsx:413`: Backdrop div has no `onClick` handler. Only the XCircle button closes the modal. (Escape key works.)

### S3. Spec: Backend ALLOWED_EXPORT_COLUMNS missing `created_at` and `families_affected`

> **quote(spec) #119:** "Backend ALLOWED_EXPORT_COLUMNS must match frontend"

> **quote(code)** `ExportPreviewModal.tsx` ALL_COLUMNS includes `created_at` and `families_affected`; backend `ALLOWED_EXPORT_COLUMNS` does not.

### S4. Spec: No `react-hot-toast` integration or notification history panel

> **quote(spec) #175:** "Non-intrusive toast notifications (react-hot-toast)" / "Notification history panel (Redis List User Inbox)"

> **quote(code)** `useEventStream.ts` is a hook but is not wired to any toast library. No Redis List inbox in `event_bus.py`.

### S5. Spec: BFP station markers not rendered on the map itself

> **quote(spec) #126/#130:** "Shows BFP station markers"

> **quote(code)** Station data is fetched but displayed only in a text panel (`EmergencyPanel`), not as map markers.

### S6. Quality: Dead imports — `HTTPException`, `status` in `map.py:17`

Neither `HTTPException` nor `status` is used anywhere in `map.py` (confirmed by grep — only the import line and a docstring comment).

### S7. Quality: Dead imports — full react-leaflet barrel + `useMemo` in `validator/map/page.tsx:10-12`

`MapContainer, TileLayer, CircleMarker, Popup, useMap, useMapEvents` — all 6 imported, none used (rendering delegated to `ValidatorMapInner` via `dynamic()`). `useMemo` imported but never called. `severityColor()` and `markerRadius()` (lines 42-52) defined but never called in this file — duplicated and actually used in `ValidatorMapInner.tsx`.

### S8. Quality: 6× `except RuntimeError: pass` boilerplate — extract helper

At `regional.py:1769,2175,2403`, `admin.py:716`, `workflow.py:154,491` — the identical fire-and-forget pattern repeats. Extract a `_fire_and_forget(coro)` helper to eliminate the duplication and ensure consistent logging.

> **quote(code)** `admin.py:717`: `except RuntimeError:\n        pass`

### S9. Quality: Duplicated `severityColor`/`markerRadius` across PublicFireMapInner + ValidatorMapInner

Extract shared map cluster helpers to `src/frontend/src/lib/map-helpers.ts`.

### S10. Standards: `CIVILIAN_REPORTER` missing from `_ROLE_CHANNEL_MAP` — docstring misleading

> **quote(standard) events.py:10:** `incident — any authenticated user`

> **quote(code)** `_ROLE_CHANNEL_MAP` has no entry for `CIVILIAN_REPORTER`, giving civilian users an empty channel list → HTTP 400. Either add the entry or fix the docstring (recommend fixing the docstring — civilians shouldn't get internal SSE).

### S11. Standards: New frontend components lack tests

`PublicFireMap.tsx`, `PublicFireMapInner.tsx`, `ValidatorMapInner.tsx`, `useEventStream.ts`, `map.ts` — no corresponding test files. AGENTS.md requires "colocate tests beside code."

## PRAISE

- ✅ Conventional Commit compliance on all 6 commits with issue references
- ✅ No real secrets committed (Redis URL uses Docker internal hostname)
- ✅ Auth dependency order maintained (operational map correctly orders `get_db` before `auth.get_current_wims_user`)
- ✅ System wiki synthesis pages updated with accurate implementation details
- ✅ #115 (copy ID), #116 (export filenames), #117 (select-page labels), #118 (damage_cost), #120 (rows-per-page), #135 (validator map), #147 (map only on safety step), #153 (TLS 1.3), #154 (cipher suite) — all correctly implemented

## SPEC VERIFICATION TABLE

| # | Title | Status |
|---|-------|--------|
| #113 | Curated default export columns | PARTIAL — 9 columns vs spec's 7; `alarm_level`/`estimated_damage_php`/`total_response_time` added |
| #115 | Copy incident ID controls | ✅ IMPLEMENTED |
| #116 | Descriptive export filenames | ✅ IMPLEMENTED |
| #117 | Action-oriented select-page labels | ✅ IMPLEMENTED |
| #118 | damage_cost Top-N metric | ✅ IMPLEMENTED |
| #119 | Export column parity | PARTIAL — backend missing `created_at`, `families_affected` |
| #120 | Rows-per-page selector | ✅ IMPLEMENTED |
| #126 | Public map PRD | ❌ BROKEN — shows BFP incidents, not civilian reports |
| #127 | Report-area cluster API | ❌ NOT IMPLEMENTED — wrong table, wrong algorithm, wrong route path |
| #128 | Stale-if-error cache | ❌ NOT IMPLEMENTED — basic cache only, no stale-fallback |
| #129 | Emergency services endpoint | ✅ IMPLEMENTED |
| #130 | Root public map component | PARTIAL — BFP stations not on map itself |
| #131 | Shared fireLocation state | ❌ NOT IMPLEMENTED |
| #132 | Polling/degraded behavior | PARTIAL — 30s not 60s; no tab-visibility pause |
| #133 | Tests and wiki updates | ✅ IMPLEMENTED |
| #134 | Triage modal escape/close | PARTIAL — Escape works; backdrop click does NOT close |
| #135 | Validator operational map | ✅ IMPLEMENTED |
| #147 | Map only on safety step | ✅ IMPLEMENTED |
| #150 | Expand AES-256-GCM encryption | PARTIAL — encryption paths updated; **no migration** |
| #153 | Enforce TLS 1.3 only | ✅ IMPLEMENTED |
| #154 | Cipher suite hardening | ✅ IMPLEMENTED |
| #175 | SSE notification infrastructure | PARTIAL — SSE backend + hook exist; **no toast UI, no inbox** |

## AGGREGATE SUMMARY

| Axis | Blocking | Suggestion | Nitpick | Praise |
|------|----------|------------|---------|--------|
| Standards | 1 (missing log.md) | 2 | 2 | 3 |
| Spec | 5 (wrong table, wrong algorithm, no cache, no shared state, no migration) | 5 | 0 | — |
| Quality | 1 (duplicated role logic) | 5 | 3 | — |

## VERDICT

**REQUEST CHANGES.** 7 blocking items must be resolved before merging.

The most critical is #1 (public map queries the wrong database table — shows BFP-verified incidents instead of civilian pressure reports), which violates the entire privacy contract of the feature. Items #2-#5 are spec-deviations that make the public map feature incomplete or incorrect. Item #6 is a maintenance risk from duplicated role logic. Item #7 is a mandatory process requirement (wiki log).

Commit-by-commit assessment:
- `0d7e416` (analyst QoL): Ready — minor issues only (#113 column diff, #119 backend parity gap)
- `b922cb9` (public map): **Most problematic** — 4 blocking spec deviations
- `e23dfff` (TLS/cipher): Ready ✅
- `322e82c` (AES-GCM): Needs migration for existing data
- `1c4d3b6` (SSE): Backend ready — missing frontend toast/inbox wiring
- `2313a5e` (wiki): Ready — missing mandatory log.md entry
