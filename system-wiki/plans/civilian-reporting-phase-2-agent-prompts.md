---
title: Civilian Reporting Phase 2 Agent Prompts
created: 2026-05-20
updated: 2026-05-20
type: operations
tags: [wims-bfp, civilian-reporting, agent-prompts, implementation]
sources:
  - system-wiki/plans/civilian-reporting-phase-2-implementation-issues.md
  - system-wiki/prd/civilian-reporting-phase-2.md
  - system-wiki/decisions/0001-civilian-reporting-overhaul.md
status: draft
---

# Civilian Reporting Phase 2 Agent Prompts

Use these prompts to hand one bounded slice to a fresh agent. Keep each run scoped. Do not paste the whole PRD unless the agent asks for a specific missing detail.

Shared constraints for every prompt:

- Read `AGENTS.md` first.
- Read only the relevant files listed in the prompt before editing.
- Preserve unrelated working-tree changes.
- Do not revert files you did not touch.
- Civilian reports are public signal records, not official `fire_incidents`.
- Do not add direct civilian-triage creation of `fire_incidents`.
- Trust scoring is deterministic, no AI, capped at 100.
- Terminal row statuses are permanent: `ACTIONED`, `REJECTED_BOGUS`, `REJECTED_DUPLICATE`, `REJECTED_INSUFFICIENT`, `REJECTED_TIMEOUT`.
- Recovery from terminal status is a new report referencing the old report ID through `previous_report_id`.
- No challenge endpoint.
- No photo/media upload in Phase 2.
- 30-second polling is enough; do not add SSE/realtime.

## Issue 3 Fix Prompt: Public Reporting UX Validation Findings

```text
Fix Civilian Reporting Phase 2 Issue 3 validation findings only.

Scope:
- Frontend only.
- Primary file: src/frontend/src/app/report/page.tsx
- You may touch src/frontend/src/lib/api.ts only if strictly needed.
- Do not touch backend, schema, triage, tracking page, or unrelated files.
- Preserve unrelated working-tree changes.

Context:
Issue 3 rewrote the public civilian reporting UX. It already linted and built, but validation found two required fixes and one deferred TODO to document clearly.

Required fixes:

1. Fix submitted tracking link.
Current success state shows/links to /track/{id}, but this app only has:
- /report
- /report/tracking

Change the success copy and href to use:
- /report/tracking?id={submittedReportId}

2. Fix NEARBY / SECONDHAND GPS mismatch behavior.
Requirement:
- WITNESS uses phone GPS directly as incident location.
- NEARBY and SECONDHAND require a map pin.
- For NEARBY/SECONDHAND, compare the pinned location against the phone's current GPS.
- If distance >200m, show the existing mismatch confirmation modal before proceeding.
- If phone GPS is denied/timed out/unavailable, allow manual pin submission without mismatch bonus, but preserve denied/timedOut state.

Current bug:
- requestGps() only auto-runs for WITNESS.
- Switching away from WITNESS clears phoneGeo.
- tryAdvanceFromContext() only checks mismatch if phoneGeo exists, so NEARBY/SECONDHAND usually skip the warning.

Implement behavior:
- When selecting NEARBY or SECONDHAND, request phone GPS in the background to populate phoneGeo, but do not use GPS as the incident location.
- Keep the map pin as geo.source = 'pin'.
- Do not overwrite a manually placed pin when GPS returns.
- For WITNESS, GPS may set geo.source = 'gps' as it does now.
- If NEARBY/SECONDHAND GPS fails, keep/mark denied or timedOut and still allow pin-based progress.
- Clear stale gpsWarningConfirmed when the pin changes or context changes.

3. Duplicate suggestion remains deferred.
Do not invent a fake duplicate endpoint. Leave the TODO stub, but make sure it is clear this is blocked until a backend suggestion endpoint exists.

Validation:
- Run cd src/frontend && npm run lint
- Run cd src/frontend && npm run build if available
- Report any warnings/errors and whether they are related.
- In final response, summarize files changed and the exact behavior fixed.
```

## Issue 4 Prompt: Public Tracking UX

```text
Implement Civilian Reporting Phase 2 Issue 4: public tracking UX only.

Scope:
- Frontend tracking page and API client types only.
- Primary files:
  - src/frontend/src/app/report/tracking/page.tsx
  - src/frontend/src/lib/api.ts
  - existing tracking tests, if present
- Do not modify backend, schema, validator triage, or report submission page except for broken links strictly related to tracking.
- Preserve unrelated working-tree changes.

Context:
Backend Issue 2 exposes GET /api/civilian/reports/{report_id} with Phase 2 fields:
report_id, latitude, longitude, category, sub_category, reporting_context, safety_status, witness fields, trust_score, status, status_explanation, guidance, escalation_guidance, related_cluster_status, previous_report_id, nearest_station_name, nearest_station_phone, link_count, created_at.

Build:
- Tracking lookup by report ID.
- Status-specific guidance blocks for:
  PENDING, UNDER_REVIEW, LINKED, ACTIONED,
  REJECTED_BOGUS, REJECTED_DUPLICATE, REJECTED_INSUFFICIENT, REJECTED_TIMEOUT.
- Show status_explanation for ACTIONED and all rejected/timeout states.
- Rejected/timeout states show nearest station phone if available plus 911 guidance.
- Terminal reports show a clear action to submit a new report referencing current ID:
  /report?previous_report_id={report_id}
- Show related_cluster_status separately from row status when present.
- Show append/link count or timeline affordance if linked reports exist; if backend lacks child timeline data, show count only and leave a clear TODO.
- Keep notification opt-in only if existing backend support still works; do not create new notification backend.
- Use deterministic status-specific guidance blocks; do not rely only on backend free text.
- Critical public messages should have concise English/Filipino microcopy.

Validation:
- Run cd src/frontend && npm run lint
- Run focused tracking tests if present.
- Run cd src/frontend && npm run build if available.
- Final response must list changed files and note any deferred backend data gaps.
```

## Issue 5 Prompt: Triage Queue Projection API

```text
Implement Civilian Reporting Phase 2 Issue 5: GET /api/triage/queue projection API.

Scope:
- Backend API only, plus backend tests.
- Primary files:
  - src/backend/api/routes/triage.py
  - src/backend/schemas/*
  - src/backend/tests/integration/*
  - system-wiki/backend/api-route-map.md and system-wiki/log.md only if behavior changes are verified
- Do not modify frontend.
- Do not create official fire_incidents from civilian reports.
- Preserve unrelated working-tree changes.

Read first:
- system-wiki/decisions/0001-civilian-reporting-overhaul.md
- system-wiki/plans/civilian-reporting-phase-2-implementation-issues.md, Issue 5 only
- src/backend/api/routes/civilian.py
- src/postgres-init/05_citizen_reports.sql

Build:
- GET /api/triage/queue returns cluster-oriented civilian report triage data.
- Include explicit clusters plus suggested nearby reports using 100m spatial and 1hr temporal logic.
- Default ordering:
  1. life-safety
  2. aging/timeout risk
  3. severity
  4. cluster size
  5. average trust
  6. oldest report time
- Query params for quick filters:
  needs_help, someone_else_needs_help, aging, timeout_risk, confidence,
  unreviewed, claimed_by_me, actioned_today, rejected_today.
- Severity is read-time confidence, not fire size:
  HIGH: >=5 related reports within 100m/1hr and avg trust >=50
  MEDIUM: >=2 related reports within 100m/1hr and avg trust >=30
  LOW: everything else
- Include trust breakdown enough for UI:
  included signals, missing/neutral signals, GPS mismatch state, duplicate-device indicators.
- Include station context:
  nearest station name, distance, phone availability.
- Hide raw device_id, ip_hash, notification tokens.
- Include freshness timestamps for 30s polling.

Tests:
- Cover ordering, filters, severity formulas, trust breakdown, station context, and privacy-safe fields.
- Run relevant backend tests through Docker if local DB dependencies require it.

Final response:
- Summarize endpoint contract, tests run, and any known schema/data gaps.
```

## Issue 6 Prompt: Cluster Claim, Activity, and Audit Workflow

```text
Implement Civilian Reporting Phase 2 Issue 6: cluster claim/lock, activity, and audit workflow.

Scope:
- Backend API/database-access layer/tests only.
- Primary files:
  - src/backend/api/routes/triage.py or a new focused triage workflow route module if existing conventions support it
  - src/backend/schemas/*
  - src/backend/tests/integration/*
  - src/postgres-init/* only if schema gaps block the workflow
  - system-wiki/log.md after verification
- Do not modify frontend except generated API types if this repo uses them.
- Preserve unrelated working-tree changes.

Read first:
- system-wiki/decisions/0001-civilian-reporting-overhaul.md
- system-wiki/plans/civilian-reporting-phase-2-implementation-issues.md, Issue 6 only
- src/postgres-init/05_citizen_reports.sql
- current triage routes/tests

Build:
- Validator can claim a cluster:
  status -> CLUSTER_UNDER_REVIEW, assigned_to set, review_started_at set.
- Other validators can view claimed clusters but cannot perform normal actions while claim is active.
- Meaningful validator actions refresh claim activity.
- Claims become stale after 15 minutes without activity.
- Higher-privilege validator/admin can take over stale claims with required audit reason.
- Activity/history projection includes:
  creation, claim/reassignment, membership changes, status changes, explanations,
  corrections, timeouts, split, merge.
- Audit logs for:
  claim, takeover, selection changes, status apply, explanation edits, correction,
  split, merge, cluster close, contact reveal/copy where implemented.

Design constraints:
- Keep audit writes explicit and testable.
- Do not silently unlock or steal active claims.
- Do not introduce terminal action behavior here beyond what is needed for activity/audit scaffolding.

Tests:
- Claim success.
- Active claim blocks another validator.
- Stale claim takeover with reason.
- Takeover blocked without reason or insufficient privilege.
- Activity projection includes expected events.
- Audit rows are written.

Final response:
- List routes/functions added, schema assumptions, and tests run.
```

## Issue 7 Prompt: Validator Queue UI Shell

```text
Implement Civilian Reporting Phase 2 Issue 7: validator queue UI shell.

Scope:
- Frontend validator triage page only, plus frontend tests.
- Primary files:
  - src/frontend/src/app/incidents/triage/page.tsx
  - src/frontend/src/lib/api.ts
  - src/frontend/src/app/incidents/triage/* tests if present or new focused tests
- Do not implement cluster inspection modal internals, terminal actions, split, or merge beyond opening placeholders.
- Do not modify backend unless a tiny API type mismatch blocks compilation.
- Preserve unrelated working-tree changes.

Read first:
- system-wiki/frontend/validator-triage-shortcuts.md
- system-wiki/plans/civilian-reporting-phase-2-implementation-issues.md, Issue 7 only
- src/frontend/src/app/incidents/triage/page.tsx
- src/frontend/src/lib/api.ts

Build:
- Consume GET /api/triage/queue from Issue 5.
- Queue cards show:
  priority signals, safety status, severity badge, cluster size, average trust,
  station context, claim state, and non-binding next action.
- Quick filters update URL query params and are bookmarkable:
  needs_help, someone_else_needs_help, aging, timeout_risk, confidence,
  unreviewed, claimed_by_me, actioned_today, rejected_today.
- Poll every 30 seconds while document is visible.
- Show freshness indicator.
- If cluster changes while a modal/selection is open, show non-destructive refresh banner.
- Add navigation-only keyboard shortcuts from the shortcut reference.
- No terminal or bulk action may have a keyboard shortcut.
- Provide shortcut help/reference link or modal matching system-wiki/frontend/validator-triage-shortcuts.md.

Tests:
- Filter URL params.
- Polling/freshness behavior.
- Claim indicators.
- Refresh banner behavior.
- Shortcut restrictions when text input is focused.

Validation:
- cd src/frontend && npm run lint
- focused vitest tests
- cd src/frontend && npm run build if available
```

## Issue 8 Prompt: Cluster Inspection Modal

```text
Implement Civilian Reporting Phase 2 Issue 8: validator cluster inspection modal.

Scope:
- Frontend modal and API client integration only, plus focused tests.
- Primary files:
  - src/frontend/src/app/incidents/triage/page.tsx or extracted components under src/frontend/src/components/
  - src/frontend/src/lib/api.ts
  - frontend tests
- Do not implement terminal apply, correction, split, or merge actions except buttons/placeholders that open future flows.
- Do not modify backend unless queue payload has a minor shape mismatch agreed by tests.
- Preserve unrelated working-tree changes.

Read first:
- system-wiki/plans/civilian-reporting-phase-2-implementation-issues.md, Issue 8 only
- system-wiki/frontend/validator-triage-shortcuts.md
- existing triage page and queue API client

Build modal:
- Compact map with anchor report, member/suggested pins, status/trust coloring, 100m radius.
- Table columns:
  report ID, distance from anchor, safety status, reporting context,
  category/sub-category, trust score, age, row status, previous report reference.
- Sorting by distance, trust, age, safety status.
- Outlier highlighting:
  >100m distance, >1hr time gap, category mismatch, GPS mismatch/unavailable,
  duplicate-device signal.
- "Select all likely related" selects only non-outlier and non-terminal rows.
- Trust score breakdown drawer per report.
- Witness phone only inside details/modal, never queue cards.
- Never show raw device_id, ip_hash, notification tokens.
- Station context and explanation quick insert area.
- Internal notes and activity/history panel visible to validators only.

Tests:
- Selection rules exclude terminal rows and outliers.
- Outlier labels render correctly.
- Trust breakdown opens.
- Witness phone privacy rule.
- Activity/history and internal notes render.

Validation:
- cd src/frontend && npm run lint
- focused vitest tests
- cd src/frontend && npm run build if available
```

## Issue 9 Prompt: Terminal Actions, Corrections, and Explanations

```text
Implement Civilian Reporting Phase 2 Issue 9: terminal actions, corrections, and explanations.

Scope:
- Backend terminal action endpoints plus frontend modal integration and tests.
- Primary files:
  - src/backend/api/routes/triage.py
  - src/backend/schemas/*
  - src/backend/tests/integration/*
  - src/frontend/src/app/incidents/triage/page.tsx or extracted modal components
  - src/frontend/src/lib/api.ts
  - src/frontend tests
- Do not implement split/merge except respecting their activity/audit structures.
- Preserve unrelated working-tree changes.

Read first:
- system-wiki/decisions/0001-civilian-reporting-overhaul.md
- system-wiki/plans/civilian-reporting-phase-2-implementation-issues.md, Issue 9 only
- current cluster claim/audit implementation from Issue 6
- current cluster modal from Issue 8

Build:
- Terminal action modal for:
  ACTIONED, REJECTED_BOGUS, REJECTED_DUPLICATE, REJECTED_INSUFFICIENT.
- Non-empty status_explanation required.
- Editable quick templates:
  ACTIONED: "Your report was reviewed and forwarded to your local fire station."
  ACTIONED follow-up: "Your report was reviewed and included in an operational follow-up."
  REJECTED_BOGUS, REJECTED_DUPLICATE, REJECTED_INSUFFICIENT with deterministic guidance.
- Bulk action preview shows exact civilian-visible message.
- Mixed-status selection shows counts by current status before confirmation.
- Terminal rows excluded from "select all likely related."
- Manual terminal-row selection is blocked from normal apply and routed to correction flow.
- Correction flow requires:
  higher privilege, correction reason, replacement explanation, audit log.
- Tracking sees latest row status/explanation; audit keeps full history.

Backend tests:
- Apply terminal statuses with explanations.
- Blank explanation rejected.
- Active claim required or enforced according to Issue 6 behavior.
- Audit rows written.
- Correction privilege and reason enforced.

Frontend tests:
- Explanation required.
- Templates insert and remain editable.
- Bulk preview exact message.
- Mixed-status warning.
- Terminal row exclusion and correction path.

Validation:
- Run relevant backend tests.
- cd src/frontend && npm run lint
- focused frontend tests.
```

## Issue 10 Prompt: Cluster Split and Merge

```text
Implement Civilian Reporting Phase 2 Issue 10: cluster split and conservative merge.

Scope:
- Backend workflow endpoints, frontend modal flows, and tests.
- Primary files:
  - src/backend/api/routes/triage.py
  - src/backend/schemas/*
  - src/backend/tests/integration/*
  - src/frontend/src/app/incidents/triage/page.tsx or extracted cluster components
  - src/frontend/src/lib/api.ts
  - frontend tests
- Do not change public civilian report/tracking UX.
- Preserve unrelated working-tree changes.

Read first:
- system-wiki/plans/civilian-reporting-phase-2-implementation-issues.md, Issue 10 only
- Issue 6 claim/audit code
- Issue 8 cluster modal code

Build split:
- Validator selects outlier rows and splits them into a new explicit cluster.
- Require audit/internal note.
- Original cluster retains remaining explicit members.
- Activity/history and audit logs record split details.

Build merge:
- Queue/API suggests candidates within 250m and 1 hour.
- UI shows side-by-side map/table comparison for both clusters.
- Merge requires confirmation and audit/internal note.
- Surviving cluster stays active.
- Merged cluster becomes CLUSTER_CLOSED with merged_into_cluster_id.
- Activity/history and audit logs update both clusters.

Conservative rules:
- Do not auto-merge.
- Make outlier warnings visible.
- Block merge when either cluster is actively claimed by another validator unless privileged takeover flow is used.

Tests:
- Split membership changes.
- Merge membership/status changes.
- Audit/activity rows for both workflows.
- Claim conflict behavior.
- Frontend confirmation and side-by-side comparison.

Validation:
- Run relevant backend tests.
- cd src/frontend && npm run lint
- focused frontend tests.
```

## Issue 11 Prompt: Timeout Job and Aging Indicators

```text
Implement Civilian Reporting Phase 2 Issue 11: timeout job and aging indicators.

Scope:
- Backend scheduled task/API projection tests, plus small frontend queue indicator work if queue UI exists.
- Primary files:
  - src/backend/tasks/* or existing Celery task location
  - src/backend/api/routes/triage.py
  - src/backend/tests/*
  - src/frontend/src/app/incidents/triage/page.tsx only if needed for aging/timeout-risk display
  - system-wiki/log.md after verification
- Do not alter public report submission behavior.
- Preserve unrelated working-tree changes.

Read first:
- system-wiki/decisions/0001-civilian-reporting-overhaul.md
- system-wiki/plans/civilian-reporting-phase-2-implementation-issues.md, Issue 11 only
- existing Celery/beat configuration
- current triage queue projection

Build:
- Scheduled task transitions PENDING citizen_reports older than 2 hours to REJECTED_TIMEOUT.
- Timeout writes locked default status_explanation explaining the 2-hour emergency review window elapsed.
- Row-level UNDER_REVIEW is exempt.
- Cluster-level CLUSTER_UNDER_REVIEW alone does not exempt pending rows.
- Timeout event appears in activity/history and audit logs.
- Queue flags:
  >1 hour as aging
  >90 minutes as timeout risk
- If frontend queue exists, render aging/timeout-risk quick filter and badges.

Tests:
- PENDING older than 2h transitions.
- PENDING younger than 2h does not.
- UNDER_REVIEW older than 2h is exempt.
- Cluster-under-review-only does not exempt row.
- Default explanation written.
- Audit/history event written.
- Queue aging indicators/filter behavior.

Validation:
- Run relevant backend tests.
- If frontend changed: cd src/frontend && npm run lint and focused tests.
```

## Issue 12 Prompt: Final Integration, Regression, and Documentation

```text
Implement Civilian Reporting Phase 2 Issue 12: final integration, regression, and documentation pass.

Scope:
- Reconcile completed Phase 2 slices end to end.
- Touch backend/frontend/wiki/tests only where needed to remove stale assumptions and make the flow coherent.
- Preserve unrelated working-tree changes.

Read first:
- AGENTS.md
- system-wiki/SCHEMA.md
- system-wiki/index.md
- system-wiki/mocs/system-map.md
- system-wiki/operations/agent-routing-guide.md
- system-wiki/decisions/0001-civilian-reporting-overhaul.md
- system-wiki/prd/civilian-reporting-phase-2.md
- system-wiki/plans/civilian-reporting-phase-2-implementation-issues.md
- current git status

Goals:
- Remove stale free-text civilian reporting assumptions from code, UI labels, tests, and docs.
- Remove/deprecate civilian promotion-to-fire_incidents behavior.
- Ensure API client types match backend contracts.
- Ensure public report -> tracking -> validator queue -> cluster modal -> terminal action -> tracking status can be exercised locally.
- Ensure no direct official fire_incidents creation happens from civilian triage.
- Ensure terminal rows are permanent and new reports use previous_report_id.
- Ensure row-level UNDER_REVIEW timeout exemption works; cluster-level alone does not.
- Ensure validator keyboard shortcuts are navigation-only.
- Ensure no SSE/realtime dependency was added.
- Ensure no media/photo upload was added.

Validation:
- Backend: run relevant integration tests for schema, civilian API, triage queue/workflow, timeout job.
- Frontend: run npm run lint, focused vitest tests, and npm run build if available.
- Manually smoke-test or document exact local API/UI steps for:
  public report submit
  tracking lookup
  terminal rejected/actioned guidance
  validator queue filters
  cluster inspect
  terminal action

Docs:
- Update system-wiki/backend/api-route-map.md if routes changed.
- Update system-wiki/frontend/route-map.md if route behavior changed.
- Update system-wiki/database/schema-overview.md if schema changed.
- Update system-wiki/gaps/frs-codebase-gap-register.md or UI gap register only for true remaining gaps.
- Append concise implementation and verification notes to system-wiki/log.md.

Final response:
- Summarize changed files by area.
- List tests and results.
- List remaining known gaps, if any.
```
