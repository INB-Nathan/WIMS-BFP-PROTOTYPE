---
title: Civilian Reporting Phase 2 Implementation Issues
created: 2026-05-20
updated: 2026-05-20
type: operations
tags: [wims-bfp, implementation-plan, triage, public-dmz, validation, ui-ux]
sources: [system-wiki/prd/civilian-reporting-phase-2.md, system-wiki/decisions/0001-civilian-reporting-overhaul.md]
status: draft
---

# Civilian Reporting Phase 2 Implementation Issues

Parent PRD: [[prd/civilian-reporting-phase-2]]
Decision record: [[decisions/0001-civilian-reporting-overhaul]]

These are local implementation issues/tasks, ordered roughly by dependency. They are written as vertical slices wherever possible: each slice should be demoable or externally verifiable when complete.

## 1. Bootstrap Civilian Report Schema and Reference Data

**Type:** AFK  
**Blocked by:** None  
**User stories covered:** 1, 14, 15, 20, 45, 46

## What to build

Add the Phase 2 database shape for civilian reports and clusters. The schema must support structured report fields, terminal explanations, previous report references, safety status, cluster workflow state, explicit cluster membership, claim/lock metadata, merge tracking, and nearest-station phone lookup.

## Acceptance criteria

- [ ] `citizen_reports` supports category, sub-category, reported time, device/IP signals, trust score, region, nearest station, row status, `status_explanation`, `safety_status`, append linkage, `previous_report_id`, and link count.
- [ ] `citizen_report_clusters` and `citizen_report_cluster_members` exist with claim, internal note, merge, and timestamp fields.
- [ ] Constraints or checks enforce allowed report statuses, cluster statuses, safety statuses, and reporting contexts.
- [ ] Required indexes exist for location, status, device, linked report, previous report, cluster status, and cluster membership.
- [ ] `ref_fire_stations` includes a phone/contact field usable by tracking and validator UI.
- [ ] Bootstrap/integration tests verify the schema and constraints.

## 2. Implement Civilian Report Submission and Tracking API

**Type:** AFK  
**Blocked by:** 1  
**User stories covered:** 1-19

## What to build

Replace the free-text public report API with structured Phase 2 submission, append, previous-report reference, and tracking responses. The API must compute trust score deterministically, resolve nearest station/region, support GPS context metadata, expose deterministic tracking guidance, and block append on terminal reports.

## Acceptance criteria

- [ ] `POST /api/civilian/reports` accepts structured report payloads and returns report ID, status, trust score, nearest station context, and tracking data.
- [ ] New reports can include `previous_report_id` without changing the referenced report.
- [ ] `PATCH /api/civilian/reports/{report_id}/append` creates child linked reports for active parents and increments parent link count.
- [ ] Append is blocked for `ACTIONED` and all `REJECTED_*` parent statuses.
- [ ] `GET /api/civilian/reports/{report_id}` returns status, status explanation, nearest-station phone, related cluster status where applicable, and deterministic guidance.
- [ ] Trust scoring covers locked signals and returns a capped score plus enough data for later breakdown.
- [ ] Rate limits are enforced: 5 new reports per IP hash per hour and 1 append per device per 5 minutes.
- [ ] API tests cover valid submission, GPS denied, GPS mismatch, life-safety reports, previous report reference, append, terminal append blocking, and tracking guidance.

## 3. Build Public Civilian Reporting UX

**Type:** AFK  
**Blocked by:** 2  
**User stories covered:** 1-14

## What to build

Rewrite the public report page into the Phase 2 structured flow: reporting context, safety prompt, map/GPS behavior, category/sub-category grids, observed time, optional eyewitness contact, two-mode submit, bilingual microcopy, and non-blocking duplicate suggestion for non-life-safety reports.

## Acceptance criteria

- [ ] Reporting context supports `WITNESS`, `NEARBY`, and `SECONDHAND`.
- [ ] Safety prompt is required and life-safety choices show immediate 911/nearest-station guidance.
- [ ] Life-safety reports can fast-submit after required fields are present.
- [ ] Non-life-safety reports show compact review before submit.
- [ ] GPS denied/timeout falls back to manual pin and tells the user to place the pin where the fire is.
- [ ] `NEARBY` and `SECONDHAND` require map pin and show >200m GPS mismatch confirmation.
- [ ] Category and sub-category icon grids replace free-text description.
- [ ] Optional eyewitness name/contact is labeled correctly, especially for `SECONDHAND`.
- [ ] No photo/media upload exists; safety copy says not to move closer or take photos if unsafe.
- [ ] English/Filipino microcopy appears for critical public prompts.
- [ ] Non-life-safety reports can see and act on nearby duplicate suggestions without being blocked.
- [ ] Frontend tests cover flow modes, validation, GPS denied, GPS mismatch confirmation, duplicate suggestion, and bilingual copy.

## 4. Build Public Tracking UX

**Type:** AFK  
**Blocked by:** 2  
**User stories covered:** 15-19

## What to build

Update the tracking page to show row status, cluster/related status, status explanation, nearest station contact, deterministic guidance, append timeline, and new-report reference affordances for terminal reports.

## Acceptance criteria

- [ ] Tracking page renders status-specific guidance for `PENDING`, `UNDER_REVIEW`, `ACTIONED`, `REJECTED_*`, and `REJECTED_TIMEOUT`.
- [ ] `ACTIONED` and rejected statuses show `status_explanation`.
- [ ] Rejected and timeout states show nearest station phone plus 911 guidance.
- [ ] Terminal reports prompt the user to submit a new report referencing the current ID.
- [ ] Related cluster status is shown separately from the report's own row status.
- [ ] Append timeline is visible when linked reports exist.
- [ ] Notification opt-in remains available where appropriate.
- [ ] Frontend tests cover each status guidance block and terminal new-report reference path.

## 5. Implement Triage Queue Projection and Priority API

**Type:** AFK  
**Blocked by:** 1, 2  
**User stories covered:** 20-23, 32, 33, 41, 44

## What to build

Add a `GET /api/triage/queue` projection that returns clusters, suggested nearby reports, priority ordering, filters, severity, trust breakdown, station context, privacy-safe duplicate/device signals, and freshness metadata.

## Acceptance criteria

- [ ] Queue returns report clusters and suggested related reports using 100m/1hr spatial-temporal logic.
- [ ] Default ordering prioritizes life-safety, aging/timeout risk, severity, cluster size, average trust, and oldest report time.
- [ ] Query params support quick filters for needs help, someone else needs help, aging, timeout risk, confidence levels, unreviewed, claimed by me, actioned today, and rejected today.
- [ ] Severity is derived at read time using locked confidence formulas.
- [ ] Trust breakdown payload includes included signals, missing/neutral signals, GPS mismatch state, and duplicate-device indicators.
- [ ] Queue payload includes nearest station name, distance, and phone availability but hides raw device IDs, IP hashes, and notification tokens.
- [ ] Payload includes freshness/updated timestamps suitable for 30-second polling.
- [ ] Backend tests cover ordering, filters, severity, trust breakdown, station context, and privacy-safe fields.

## 6. Implement Cluster Claim, Activity, and Audit Workflow

**Type:** AFK  
**Blocked by:** 5  
**User stories covered:** 24-26, 40, 46

## What to build

Implement validator cluster claim/start-review behavior, stale claim takeover, activity/history projection, and audit logging for validator workflow events.

## Acceptance criteria

- [ ] Validator can claim a cluster, moving it to `CLUSTER_UNDER_REVIEW` and setting `assigned_to` and `review_started_at`.
- [ ] Other validators can view claimed clusters but cannot apply normal actions while the claim is active.
- [ ] Claim activity refreshes on meaningful validator actions.
- [ ] Claims become stale after 15 minutes without activity.
- [ ] Higher-privilege validators/admins can take over stale claims with required audit reason.
- [ ] Cluster activity/history includes creation, claim/reassignment, report membership changes, status changes, explanations, corrections, timeouts, split, and merge events.
- [ ] Audit logs are written for claim, takeover, selection changes, status apply, explanation edits, correction, split, merge, cluster close, and contact reveal/copy where implemented.
- [ ] Backend tests cover claim, stale takeover, activity projection, and audit events.

## 7. Build Validator Queue UI Shell

**Type:** AFK  
**Blocked by:** 5, 6  
**User stories covered:** 20-26, 42-44

## What to build

Rewrite the validator triage page around the new queue projection. Include priority ordering, quick filters with URL params, claim indicators, non-binding recommendations, polling freshness, and navigation-only shortcuts with reference help.

## Acceptance criteria

- [ ] Queue cards show priority signals, safety status, severity, cluster size, average trust, station context, claim state, and non-binding next action.
- [ ] Quick filters update URL query params and can be bookmarked/shared.
- [ ] Queue polls every 30 seconds while visible and shows freshness text.
- [ ] If a cluster changes while open, UI shows a non-destructive refresh banner.
- [ ] Navigation-only shortcuts work when no text input is focused.
- [ ] No terminal or bulk action has a keyboard shortcut.
- [ ] Shortcut reference is available from the validator page and matches [[frontend/validator-triage-shortcuts]].
- [ ] Frontend tests cover filters, URL params, polling banner, claim indicators, and shortcut restrictions.

## 8. Build Cluster Inspection Modal

**Type:** AFK  
**Blocked by:** 5, 6, 7  
**User stories covered:** 27-29, 32, 33, 40, 41

## What to build

Add the validator cluster inspection modal with compact map, sortable table, outlier highlighting, trust breakdown access, station context, privacy-safe details, selection controls, internal notes, and activity/history panel.

## Acceptance criteria

- [ ] Modal shows compact map with anchor report, member/suggested pins, status/trust coloring, and 100m radius.
- [ ] Table shows report ID, distance from anchor, safety status, context, category/sub-category, trust score, age, row status, and previous report reference.
- [ ] Table sorts by distance, trust, age, and safety status.
- [ ] Outliers are highlighted for >100m distance, >1hr time gap, category mismatch, GPS mismatch/unavailable, and duplicate-device signals.
- [ ] "Select all likely related" selects non-outlier, non-terminal rows only.
- [ ] Trust score breakdown is visible per report.
- [ ] Witness phone is only visible in details/modal, never queue cards; raw device/IP/token values are not shown.
- [ ] Station context and explanation quick insert are available.
- [ ] Activity/history panel and internal notes are visible to validators only.
- [ ] Frontend tests cover selection rules, outlier highlighting, trust breakdown, privacy rules, and history panel.

## 9. Implement Terminal Actions, Corrections, and Explanations

**Type:** AFK  
**Blocked by:** 6, 8  
**User stories covered:** 34-39, 46

## What to build

Implement terminal row actions from the cluster modal: `ACTIONED`, `REJECTED_BOGUS`, `REJECTED_DUPLICATE`, `REJECTED_INSUFFICIENT`, plus audited correction flow for higher-privilege users.

## Acceptance criteria

- [ ] Terminal action modal requires non-empty `status_explanation`.
- [ ] Quick templates exist for `ACTIONED` and rejection sub-states and can be edited.
- [ ] Bulk action preview shows the exact civilian-visible message.
- [ ] Mixed-status selections show count by current status before confirmation.
- [ ] Terminal rows are excluded from "select all likely related."
- [ ] Manually selected terminal rows are blocked from normal bulk apply and routed to correction flow.
- [ ] Correction flow requires higher privilege, correction reason, replacement explanation, and audit log.
- [ ] Tracking page shows latest status while audit history preserves previous status/explanation/actor/time.
- [ ] Backend and frontend tests cover terminal apply, blank explanation blocking, mixed-status warnings, terminal-row exclusion, and correction.

## 10. Implement Cluster Split and Merge

**Type:** AFK  
**Blocked by:** 6, 8  
**User stories covered:** 30-31, 40, 46

## What to build

Add conservative cluster split and merge workflows from the inspection UI, backed by explicit cluster membership updates and audit notes.

## Acceptance criteria

- [ ] Validator can select rows and split them into a new explicit cluster with required audit/internal note.
- [ ] Original cluster retains remaining explicit members.
- [ ] Queue suggests merge candidates within 250m and 1 hour.
- [ ] Merge flow shows both clusters' maps/tables side by side.
- [ ] Merge requires confirmation and audit/internal note.
- [ ] Surviving cluster remains active; merged cluster becomes `CLUSTER_CLOSED` with `merged_into_cluster_id`.
- [ ] Activity/history and audit logs record split and merge details.
- [ ] Tests cover split, merge, membership changes, and activity/audit output.

## 11. Implement Timeout Job and Aging Notifications

**Type:** AFK  
**Blocked by:** 1, 2, 6  
**User stories covered:** 20, 45, 46

## What to build

Add scheduled timeout behavior for `PENDING` civilian reports and aging/timeout-risk indicators for validator triage.

## Acceptance criteria

- [ ] Scheduled task changes `PENDING` reports older than 2 hours to `REJECTED_TIMEOUT`.
- [ ] Timeout writes the locked default `status_explanation`.
- [ ] Row-level `UNDER_REVIEW` reports are exempt from the 2-hour timeout.
- [ ] Cluster-level `CLUSTER_UNDER_REVIEW` alone does not exempt nearby reports.
- [ ] Validator queue flags reports older than 1 hour and timeout risk over 90 minutes.
- [ ] Timeout events appear in activity/history and audit logs.
- [ ] Tests cover timeout transition, exemption behavior, default explanation, and queue aging indicators.

## 12. Final Integration, Regression, and Documentation Pass

**Type:** AFK  
**Blocked by:** 3, 4, 7, 8, 9, 10, 11  
**User stories covered:** All

## What to build

Reconcile the full Phase 2 flow, remove stale promotion/free-text assumptions, update route maps/wiki pages, and run relevant backend/frontend validation.

## Acceptance criteria

- [ ] Partial pre-PRD backend edits are reconciled with the final ADR/PRD.
- [ ] Deprecated civilian promotion semantics are removed from code, UI labels, and tests.
- [ ] API client types match backend contracts.
- [ ] Public report, tracking, and validator triage flows can be exercised end to end locally.
- [ ] Relevant backend tests pass.
- [ ] Relevant frontend lint/tests pass.
- [ ] System wiki pages and logs are updated with the implemented state and any known gaps.
