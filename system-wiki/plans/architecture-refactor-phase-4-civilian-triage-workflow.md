---
title: Architecture Refactor Phase 4 Civilian Triage Workflow
created: 2026-05-23
updated: 2026-05-24
type: operations
tags: [wims-bfp, architecture, refactor, civilian-reporting, triage, public-dmz, validation]
sources: [src/backend/api/routes/triage.py, src/backend/api/routes/civilian.py, system-wiki/subsystems/civilian-reporting-phase2.md]
status: completed
---

# Architecture Refactor Phase 4 Civilian Triage Workflow

Prerequisite: [[plans/architecture-refactor-phase-3-regional-incident-lifecycle]]
Next phase: [[plans/architecture-refactor-phase-5-analytics-query-interface]]

## Purpose

Extract civilian report triage behavior from `api/routes/triage.py` into a deeper Civilian Triage Workflow Module.

The route should become an HTTP Adapter. Workflow commands and queue projection should become testable Modules.

## Goal

Create a Civilian Triage Workflow Module that owns triage policies, queue projection, claim/activity handling, terminal actions, corrections, split/merge, and notification enqueue seams without changing the public triage endpoint contracts.

Agents should stop this phase when backend workflow behavior is behind named Modules; frontend triage UI redesign is out of scope unless needed for contract compatibility.

## Completion Summary

Completed on 2026-05-24.

Created `src/backend/services/civilian_triage/`:
- `models.py` owns the Pydantic route/workflow contracts.
- `policies.py` owns terminal statuses, role capability predicates, claim staleness, aging/timeout, related-report, merge-candidate, GPS mismatch, and severity thresholds.
- `repository.py` owns reusable cluster fetch/claim and internal-note helpers.
- `queue_projection.py` owns `get_queue`; it intentionally materializes durable singleton clusters before reading so every active public signal row has a claimable workflow cluster id.
- `workflow.py` owns claim, activity refresh, activity projection, merge-candidate lookup, terminal action, correction, split, and merge commands.
- `notifications.py` is the notification enqueue seam; enqueue failures are logged and swallowed after DB state commits.

`src/backend/api/routes/triage.py` is now primarily an HTTP Adapter: auth dependencies, FastAPI query/body binding, response models, legacy disabled endpoints, and direct delegation to the service Module.

Duplicate-related spatial drift remains intentionally split by workflow:
- Public duplicate suggestions remain 500m in `api/routes/civilian.py`.
- Triage queue related-count/severity remains 100m / 1hr in `services.civilian_triage.policies` and queue SQL.

## Proposed Module Shape

Create:
- `src/backend/services/civilian_triage/policies.py`
- `src/backend/services/civilian_triage/repository.py`
- `src/backend/services/civilian_triage/queue_projection.py`
- `src/backend/services/civilian_triage/workflow.py`
- optional `src/backend/services/civilian_triage/notifications.py`

Policy Implementation:
- terminal status validation
- role capabilities
- claim staleness
- aging and timeout thresholds
- severity thresholds

Workflow command Interface:
- `claim_cluster`
- `refresh_activity`
- `apply_terminal_action`
- `correct_terminal_report`
- `split_cluster`
- `merge_clusters`

Projection Interface:
- `get_queue`
- `get_activity`
- `get_merge_candidates`

## Invariants

- Civilian reports remain public signal rows in `citizen_reports`; triage does not create `fire_incidents`.
- Queue response does not expose `device_id`, `ip_hash`, FCM tokens, or other privacy fields.
- Terminal actions require claimed, non-stale clusters and civilian-visible explanations.
- Notification enqueue failure must not roll back committed DB state if current behavior allows commit to succeed.
- RLS-backed DB session behavior remains unchanged.

## Stop Criteria

Stop when:
- triage policy rules live in `services.civilian_triage.policies`;
- queue projection and workflow commands are separate named Modules;
- `api/routes/triage.py` is primarily an HTTP Adapter for the moved behavior;
- queue privacy guarantees are covered by tests;
- queue materialization behavior is explicitly documented as part of `get_queue` or a named command;
- backend triage, civilian API, notification, and frontend triage contract tests pass or failures are documented;
- this page and [[system-wiki/log]] are updated with the completed extraction summary.

## Open Decision

`GET /api/triage/queue` currently materializes durable singleton clusters before reading. Decide whether the new `get_queue` keeps this behavior internally or the route explicitly calls `ensure_queue_materialized` first.

Also resolve duplicate-related spatial drift:
- wiki public duplicate suggestion: 500m
- triage related counts: 100m/1hr

## Tests

Preserve:
- `src/backend/tests/integration/test_triage_queue.py`
- `src/backend/tests/integration/test_civilian_api.py`
- `src/backend/tests/test_triage_notifications.py`
- `src/frontend/src/app/incidents/triage/page.test.tsx`

Add:
- policy unit tests
- workflow command tests with a repository Adapter fake where practical
- projection privacy contract tests
- regression test for duplicate-suggestion threshold after the product rule is decided

Completed verification:
- Host `pytest tests/test_civilian_triage_module.py tests/test_triage_notifications.py -q` -> 4 passed.
- Docker `pytest tests/integration/test_triage_queue.py tests/integration/test_civilian_api.py tests/test_triage_notifications.py tests/test_civilian_triage_module.py -q` -> 71 passed.
- Frontend `npx vitest run src/app/incidents/triage/page.test.tsx` passed as part of the Phase 6 focused frontend suite.

## Risks

- Queue projection SQL is large and index-position mapped today.
- Moving SQL behind a repository Adapter can accidentally change RLS assumptions.
- Backend response model changes can drift from frontend TypeScript types.

## Related

- [[subsystems/civilian-reporting-phase2]]
- [[frontend/validator-triage-shortcuts]]
- [[plans/architecture-refactor-phase-5-analytics-query-interface]]
