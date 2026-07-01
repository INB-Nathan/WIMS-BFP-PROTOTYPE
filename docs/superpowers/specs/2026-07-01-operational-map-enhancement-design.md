# Operational Map Enhancement — Design Spec

**Date:** 2026-07-01
**Branch:** `feat/operational-map-enhancement`
**Target PR:** #501
**Status:** Draft

## Overview

Enrich the validator operational map (`/dashboard/validator/map`) with richer cluster data, time-range filtering, performance caching, navigation links, and map layers — decomposed into minimum-sized slices for reliable agent execution.

## Guiding Principle

Each slice must be:
- **Testable in isolation** — can be deployed without the next slice
- **Non-breaking** — all new fields are optional, all new params are optional
- **Small context** — ≤5 files touched, ≤100 LoC, one logical concept
- **Mergeable independently** — each slice is a separate PR or stacked branch

## Slice Decomposition

### Slice 1: Backend — enrich cluster response model with aggregates

**Files touched:** `map.py`, `map.ts` (types), `legacy.ts`

**What:** Extend the `get_operational_map()` SQL query to JOIN `incident_nonsensitive_details` and return per-cluster aggregate data. Add optional fields to `ClusterItem` Pydantic model.

**New response fields (all optional):**
| Field | Type | Source |
|-------|------|--------|
| `status_breakdown` | `dict[str, int] \| null` | `COUNT(*) FILTER (WHERE verification_status = ...)` |
| `category_mix` | `list[str] \| null` | `jsonb_agg(DISTINCT ind.general_category)` |
| `total_damage_php` | `float \| null` | `SUM(ind.estimated_damage_php)` |
| `total_casualties` | `int \| null` | `SUM(ind.civilian_injured + ind.civilian_deaths)` |
| `earliest_at` | `str \| null` | `MIN(fi.created_at)` |
| `latest_at` | `str \| null` | already exists (was `MAX(fi.created_at)`) |

**SQL change:**
```sql
LEFT JOIN wims.incident_nonsensitive_details ind
    ON ind.incident_id = fi.incident_id
-- Add to SELECT:
COUNT(*) FILTER (WHERE fi.verification_status = 'PENDING') AS pending_count,
COUNT(*) FILTER (WHERE fi.verification_status = 'PENDING_VALIDATION') AS pending_validation_count,
COUNT(*) FILTER (WHERE fi.verification_status = 'VERIFIED') AS verified_count,
COUNT(*) FILTER (WHERE fi.verification_status = 'REJECTED') AS rejected_count,
jsonb_agg(DISTINCT ind.general_category) FILTER (WHERE ind.general_category IS NOT NULL) AS categories,
SUM(ind.estimated_damage_php) AS total_damage,
SUM(COALESCE(ind.civilian_injured, 0) + COALESCE(ind.civilian_deaths, 0)) AS total_casualties,
MIN(fi.created_at) AS earliest_at
```

**`MapClusterItem` (TS)** — add optional fields:
```ts
status_breakdown?: Record<string, number>;
category_mix?: string[];
total_damage_php?: number;
total_casualties?: number;
earliest_at?: string | null;
```

**LoC:** ~55 backend (query + model) + ~15 types = **~70 total**
**Risk:** Low — additive, no breaking changes
**Tests:** Verify response shape includes new fields (manual via curl in slice; automated in final testing slice)

---

### Slice 2: Frontend — richer cluster popup

**Files touched:** `ValidatorMapInner.tsx`, `map.ts`

**What:** Redesign the `<Popup>` content to display the new aggregate data: status breakdown as a mini-table, category badges, damage amount, casualty count, date range.

**Popup layout:**
```
Incident Cluster — 12 incidents
─────────────────────────────
Status:  5 Pending | 4 Verified | 3 Rejected
Categories: Structural, Wildland, Vehicular
Damage:   PHP 2,500,000
Injuries/Deaths: 3 / 1
Range:   Jan 15 – Mar 20, 2026
```

**Pattern:** Use the same severity-color system for status badges (blue=PENDING_VALIDATION, green=VERIFIED, red=REJECTED, yellow=PENDING).

**LoC:** ~60-80 frontend (popup JSX + formatting helpers)
**Risk:** Low — pure JSX, conditionally renders when new fields exist
**Files:** 2

---

### Slice 3: Backend — time-range filter params

**Files touched:** `map.py`, `legacy.ts`

**What:** Add `date_from` and `date_to` optional query params to `GET /api/validator/operational-map`. Both are ISO-8601 date strings. When set, add `AND fi.created_at >= :date_from` / `AND fi.created_at <= :date_to` to the SQL WHERE clause.

**Query params:**
```
date_from: str | None = Query(None, description="Filter incidents from this date (ISO 8601)")
date_to: str | None = Query(None, description="Filter incidents up to this date (ISO 8601)")
```

**TypeScript** — add to `OperationalMapParams`:
```ts
date_from?: string;
date_to?: string;
```

**Wire** — add to `URLSearchParams` in `fetchOperationalMap()`.

**LoC:** ~15 backend + ~10 frontend types = **~25 total**
**Risk:** Low — additive, existing behavior unchanged when omitted
**Files:** 3

---

### Slice 4: Frontend — date range picker

**Files touched:** `page.tsx`

**What:** Add a date range trigger + popover in the filter bar, next to the status dropdown. Presets: Last 24h, Last 7 Days, Last 30 Days, All Time, Custom. Custom shows two date inputs (from/to).

**State:** `datePreset` enum or string, `customFrom`/`customTo` strings. On preset or custom change, call `fetchOperationalClusters()` with the new date params.

**Debounce:** Use same `VIEWPORT_DEBOUNCE_MS` pattern for custom date inputs.

**Layout:**
```
[Status: ▼ All] [▼ Last 7 Days]  [From: ____] [To: ____]
```

**LoC:** ~80-100 frontend (presets dropdown + date inputs + state wiring)
**Risk:** Low-Medium — needs to coexist with status filter; viewport changes should preserve time filter
**Files:** 1

---

### Slice 5: Backend — Redis cache for operational endpoint

**Files touched:** `map.py`

**What:** Reuse the `_get_redis()` / `_REDIS_POOL` / backoff pattern from the public clusters endpoint (lines 33-97 of `map.py`). Same 120s TTL. Cache key includes all params: `map:operational:{zoom}:{sw}:{ne}:{status}:{date_from}:{date_to}`.

**Pattern (exact copy of public endpoint):**
```python
cache_key = f"map:operational:{zoom}:{sw_lat:.4f}:{sw_lng:.4f}:{ne_lat:.4f}:{ne_lng:.4f}:{status_filter or 'all'}:{date_from or ''}:{date_to or ''}"
# Try cache → miss → query → write cache
```

**Stale-if-error:** On DB query failure, read from cache (even if expired) and return with a warning header.

**LoC:** ~35 backend (cache key gen + read/write + stale fallback)
**Risk:** Low — exact same pattern as public clusters, already proven in production
**Files:** 1
**Note:** This also naturally enables the `cached_at` response field (Slice 1 placeholder)

---

### Slice 6: Frontend — click-to-drill from popup to queue

**Files touched:** `ValidatorMapInner.tsx`

**What:** Add a `<Link>` at the bottom of each cluster popup: "View X pending incidents →" navigating to `/dashboard/validator?status=PENDING` (or filtered by the cluster's region — requires region_id in cluster data, which can be added by extending the SQL in Slice 1 to include a representative `region_id` from the cluster).

**Alternative (no region):** Navigate to `/dashboard/validator?status=PENDING` which shows all pending incidents. The validator can then use the existing region filter on the queue page.

**Link styling:** BFP-blue text, subtle hover underline, opens in same tab.

**LoC:** ~20-30 frontend (Link component + URL construction + conditional render)
**Risk:** Low — pure JSX addition
**Files:** 1

---

### Slice 7: Frontend — fire station layer

**Files touched:** `ValidatorMapInner.tsx`, `map.ts`

**What:** Fetch fire stations from `GET /api/ref/fire-stations` (already exists, returns all stations with lat/lng). Render them as distinct Leaflet markers (custom fire-station icon) on the validator map with a toggle switch in the filter bar.

**Icon:** Use `firePinIcon` from `src/components/map/leafletIcons.ts` (already exists, BFP maroon SVG divIcon).

**Toggle:** Small toggle button in filter bar: `[🔥 Stations]` — toggles station layer visibility.

**Popup on station click:** Station name, address, region.

**Fetch timing:** Load stations once on mount (they change rarely), cache in component state.

**LoC:** ~50-70 frontend (marker layer component + toggle UI + popup + fetch)
**Risk:** Low — reuse existing ref endpoint and icon; standard Leaflet overlay
**Files:** 2

---

### Slice 8: Frontend — operations overlay

**Files touched:** `ValidatorMapInner.tsx`

**What:** Fetch active operations from `GET /api/operations` (already exists, returns operations with lat/lng/radius/fire_status). Render them as `react-leaflet` `<Circle>` components (same pattern as `OperationsMap.tsx` lines 71-94) with a toggle in the filter bar.

**Toggle:** `[🚒 Operations]` — toggles operation circle visibility.

**Popup:** Operation name, fire status badge, size in hectares, start date.

**Styling:** Use the same STATUS_COLORS as `OperationsMap.tsx` (ACTIVE=red, CONTAINED=orange, FIRE_OUT=green).

**LoC:** ~50-70 frontend (Circle overlay + toggle + popup + fetch)
**Risk:** Low — established pattern from OperationsMap.tsx
**Files:** 1

---

### Slice 9: Backend integration tests

**Files touched:** new file `tests/test_operational_map.py`

**What:** Test the enriched `GET /api/validator/operational-map` endpoint. Use FastAPI TestClient with a mocked DB session.

**Tests (6):**
1. Returns clusters with default params (no filter)
2. Returns enriched fields (status_breakdown, category_mix, etc.)
3. `status_filter` narrows results
4. `date_from` + `date_to` narrow results
5. Status filter + date filter compose correctly
6. Empty bounding box returns empty clusters

**LoC:** ~100-120 backend tests
**Risk:** Low — standard FastAPI test pattern with DB mock
**Files:** 1

---

### Slice 10: Frontend component tests

**Files touched:** new test file (e.g., `__tests__/ValidatorMapInner.test.tsx`)

**What:** Test the map component rendering. Requires Leaflet mocking.

**Tests (4-5):**
1. Renders MapContainer with default center/zoom
2. Renders CircleMarkers for each cluster
3. Popup displays enriched fields when present
4. Layer toggle buttons render
5. Date range picker renders

**Leaflet mocking:** Mock `react-leaflet` exports — `MapContainer`, `TileLayer`, `CircleMarker`, `Popup`, `useMapEvents`. Verify props passed to mocked components.

**LoC:** ~100-130 frontend tests (including Leaflet mocks)
**Risk:** Medium — Leaflet DOM mocking is fragile; review existing `ClusterMapInner.test.tsx` and `MapPickerInner.test.tsx` for established patterns
**Files:** 1

---

## Slice Dependency Graph

```
Slice 1 (enriched backend)
  ├──→ Slice 2 (richer popup)
  ├──→ Slice 6 (click-to-drill)
  └──→ Slice 9 (backend tests)

Slice 3 (time-range backend)
  └──→ Slice 4 (date picker frontend)

Slice 5 (Redis cache)  [standalone]

Slice 7 (fire stations) [standalone]
Slice 8 (operations)    [standalone]

Slice 10 (frontend tests) [after slices 2, 4, 6, 7, 8 stabilize]
```

## Execution Strategy

### Recommended order (stacked branches / sequential PRs)

| Order | Slice | LoC | Agent sessions |
|-------|-------|-----|----------------|
| 1 | Slice 1 — enriched backend | ~70 | 1 |
| 2 | Slice 2 — richer popup | ~70 | 1 |
| 3 | Slice 3 — time-range backend | ~25 | 0.5 |
| 4 | Slice 4 — date picker | ~90 | 1 |
| 5 | Slice 5 — Redis cache | ~35 | 0.5 |
| 6 | Slice 6 — click-to-drill | ~25 | 0.5 |
| 7 | Slice 7 — fire stations | ~60 | 1 |
| 8 | Slice 8 — operations overlay | ~60 | 1 |
| 9 | Slice 9 — backend tests | ~110 | 1 |
| 10 | Slice 10 — frontend tests | ~115 | 1 |

### Alternative grouping (fewer PRs, larger slices)

| PR | Slices | Total LoC | Sessions |
|----|--------|-----------|----------|
| #501a | 1+2+6 (core enrichment) | ~165 | 2 |
| #501b | 3+4+5 (time + cache) | ~150 | 2 |
| #501c | 7+8 (layers) | ~120 | 1-2 |
| #501d | 9+10 (tests) | ~225 | 2 |

---

## Non-Goals (Explicitly Excluded)

- Heatmap layer (requires `leaflet.heat` npm dep audit, rendering perf concerns)
- WebSocket real-time updates (architectural change, out of scope)
- Offline tile caching strategy change (existing pattern works)
- Breaking changes to `MapClusterItem` or `ClusterItem` (all new fields optional)
- New database migrations (all data already exists)

## Risk Register

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| SQL performance: LEFT JOIN on large bounding boxes | Low-Medium | Redis cache (Slice 5) absorbs repeated queries; test with seeded 500-incident dataset |
| Shared `MapClusterItem` type breaks callers | Low | All new fields are optional (`?` in TS, `Optional` / `None` default in Python) |
| Shared `ClusterItem` Pydantic model between public + operational endpoints | Low | Add fields only to operational-specific model or use `None` defaults |
| Leaflet mocking fragile for frontend tests | Medium | Follow established patterns from `ClusterMapInner.test.tsx` and `MapPickerInner.test.tsx` |
| Date range + viewport debounce interaction | Low | Date range change triggers immediate refetch; viewport change preserves date range state |
