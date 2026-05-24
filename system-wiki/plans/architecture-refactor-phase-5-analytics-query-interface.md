---
title: Architecture Refactor Phase 5 Analytics Query Interface
created: 2026-05-23
updated: 2026-05-24
type: operations
tags: [wims-bfp, architecture, refactor, analytics, reporting]
sources: [src/backend/services/analytics_read_model.py, src/backend/api/routes/analytics.py, src/backend/api/routes/incidents.py, src/frontend/src/lib/api.ts, system-wiki/backend/services.md]
status: completed
---

# Architecture Refactor Phase 5 Analytics Query Interface

Prerequisite: [[plans/architecture-refactor-phase-4-civilian-triage-workflow]]
Next phase: [[plans/architecture-refactor-phase-6-frontend-api-slices]]

## Purpose

Centralize analytics filter semantics and query contracts so aggregate analytics, exports, and analyst incident lists share a deeper Interface.

## Goal

Create an Analytics Query Interface Module with a typed filter object and shared SQL filter compiler used by analytics endpoints, exports, and analyst incident list queries.

Agents should stop this phase when filter semantics are centralized and tested; adding new analytics features is out of scope unless explicitly approved.

## Completion Summary

Completed on 2026-05-24.

Created `src/backend/services/analytics/filters.py`:
- `AnalyticsQueryFilters` is the typed normalized filter object.
- `build_analytics_filters` normalizes route/task filter input, parses comma-separated `region_ids`, deduplicates selected incident ids, and consistently rejects `damage_max < damage_min`.
- `append_common_filters` compiles shared SQL clauses for date, region scope, geography, alarm/type, casualty severity, damage range, and selected incident filters.

`src/backend/services/analytics_read_model.py` now delegates its legacy `_append_common_filters` compatibility wrapper to the new filter Interface. `src/backend/api/routes/analytics.py` uses `build_analytics_filters` for heatmap and trends route parsing while preserving response shapes. `src/backend/api/routes/incidents.py` uses the shared compiler for the analyst incident list, including selected incident ids and analyst-specific SQL column expressions.

Drift decisions:
- `/analytics/top-barangays` is stale documentation/client drift. Live backend exposes generic `/analytics/top-n`; this refactor did not add a new top-barangays endpoint.
- `damage_max < damage_min` is rejected through `AnalyticsQueryFilters` and therefore applies consistently to read-model callers using the shared compiler.
- Selected incident filtering is represented in `AnalyticsQueryFilters.selected_incident_ids` and compiled through the shared Interface.

## Proposed Module Shape

Create:
- `src/backend/services/analytics/filters.py`
- optional `src/backend/services/analytics/queries.py`

Target Interface:
- `AnalyticsQueryFilters`
- route Adapter parser from FastAPI query params to `AnalyticsQueryFilters`
- SQL filter compiler used by heatmap, trends, comparative, export, filter options, and analyst incident list queries

Keep sync/backfill behavior separate from query Interface work because read queries and write-model sync change for different reasons.

## Invariants

- Analytics endpoints remain `NATIONAL_ANALYST` / `SYSTEM_ADMIN` only.
- RLS/session assumptions remain explicit at route or task seams.
- Export task payload remains serializable.
- SQL dimensions and columns remain whitelist-driven.
- Existing output shapes remain unchanged unless a separate product fix is approved.

## Stop Criteria

Stop when:
- analytics routes parse query params into one typed filter object or equivalent normalized structure;
- common SQL filter compilation is shared by aggregate, export, filter-option, and analyst-list paths where applicable;
- damage range, region scope, casualty severity, and selected incident filters have explicit tests;
- top-barangays drift is resolved as either stale documentation or a separate feature task;
- focused analytics API, analyst export, analyst SQL contract, and frontend analytics/API tests pass or failures are documented;
- this page and [[system-wiki/log]] are updated with the completed extraction summary.

## Drift Decisions

Resolve before implementation:
- Does `/analytics/top-barangays` still exist as a requirement? Wiki/client documentation mention it, but inspected live code did not show a matching route/client.
- Should `damage_max < damage_min` be rejected consistently across all analytics endpoints?
- Should analyst incident list and aggregate analytics share selected incident filtering exactly?

## Tests

Preserve:
- `src/backend/tests/integration/test_analytics_api.py`
- `src/backend/tests/test_analyst_export.py`
- `src/backend/tests/test_analyst_incidents_sql_contract.py`
- frontend analytics and API tests

Add:
- `AnalyticsQueryFilters` normalization and validation tests
- filter parity tests across endpoints
- `region_id` vs `region_ids` precedence tests
- selected incident set consistency tests
- route/client parity tests for intended analytics endpoints

Completed verification:
- Host `pytest tests/test_analytics_filters.py -q` -> 3 passed.
- Docker `pytest tests/integration/test_analytics_api.py tests/test_analyst_export.py tests/test_analyst_incidents_sql_contract.py tests/test_analytics_filters.py -q` -> 26 passed.
- Frontend analytics API wrapper tests passed as part of `src/frontend/src/lib/api.test.ts`.

## Risks

- Centralizing filters can change many analyst workflows at once.
- `incident_type` currently maps to `general_category` in some paths; preserve or explicitly rename.
- Top-barangays drift should not be silently fixed as part of a refactor.

## Related

- [[backend/services]]
- [[backend/api-route-map]]
- [[frontend/frontend-infrastructure]]
- [[plans/architecture-refactor-phase-6-frontend-api-slices]]
