---
title: Civilian Reporting Phase 2 PRD
created: 2026-05-20
updated: 2026-05-20
type: concept
tags: [wims-bfp, prd, public-dmz, triage, validation, hci, ui-ux]
sources: [system-wiki/decisions/0001-civilian-reporting-overhaul.md, src/backend/api/routes/civilian.py, src/backend/api/routes/triage.py, src/frontend/src/app/report/page.tsx, src/frontend/src/app/incidents/triage/page.tsx]
status: draft
---

# Civilian Reporting Phase 2 PRD

Related: [[decisions/0001-civilian-reporting-overhaul]], [[frontend/validator-triage-shortcuts]], [[backend/api-route-map]], [[frontend/route-map]]

## Problem Statement

The current civilian reporting prototype is too thin for emergency reporting and validator review. Civilians can submit free-text reports with limited structured context, weak location guidance, no status-specific tracking guidance, and no clear path after rejection. Validators see a flat queue that does not support clustering, life-safety priority, claim ownership, explainable trust scores, or safe bulk actions.

WIMS-BFP needs a Phase 2 civilian reporting workflow that remains a public signal layer, not an official AFOR incident creation path. It must make emergency submission fast for civilians while giving validators a reliable, auditable triage surface for reviewing clustered civilian reports.

## Solution

Build a structured civilian reporting and validator triage workflow around `citizen_reports` and explicit citizen report clusters.

Civilians submit structured reports with reporting context, safety status, category/sub-category, observed time, map/GPS location, optional eyewitness contact, and optional reference to a previous terminal report. The public UI supports bilingual English/Filipino microcopy, fast submit for life-safety cases, GPS-denied fallback, deterministic tracking guidance, and nearest-station escalation.

Validators review clustered reports through a dedicated queue that prioritizes life-safety signals, aging reports, confidence severity, cluster size, and trust score. Validators can claim clusters, inspect map/table evidence, view trust breakdowns, split/merge clusters, apply terminal row actions with required civilian-visible explanations, keep internal notes, and audit every meaningful action.

Civilian reports remain public signal records. They do not directly create official `fire_incidents`; official incident records remain part of the regional/fire-station AFOR workflow.

## User Stories

1. As a civilian witness, I want to report a fire quickly, so that BFP receives a structured public signal without requiring an account.
2. As a civilian in danger, I want a fast-submit path after giving required details, so that I am not slowed down by review screens.
3. As a civilian reporting danger to someone else, I want the page to tell me to call 911 immediately, so that life-safety risk is escalated.
4. As a civilian with location permission enabled, I want the system to use my GPS when I am a witness, so that I do not have to place a pin manually.
5. As a civilian with location permission denied, I want to place a map pin manually, so that I can still report the emergency.
6. As a civilian reporting from nearby, I want to place the fire location on a map, so that the report points to the incident rather than my current position.
7. As a civilian reporting secondhand information, I want to identify that I did not directly witness the fire, so that validators can interpret the report correctly.
8. As a civilian submitting secondhand information, I want to optionally provide the direct eyewitness contact, so that validators can follow up if needed.
9. As a civilian, I want category and sub-category buttons instead of free text, so that I can report quickly under stress.
10. As a civilian, I want a warning if my selected pin is far from my current GPS location, so that I can avoid a location mistake.
11. As a civilian, I want the page to avoid encouraging unsafe photo-taking, so that I am not prompted to move closer to danger.
12. As a Filipino-speaking civilian, I want critical emergency prompts in English and Filipino, so that I understand them under stress.
13. As a civilian submitting a non-life-safety report, I want to know if a similar nearby report may already exist, so that I can add my signal to the related incident.
14. As a civilian whose previous report was terminally closed or rejected, I want to submit a new report referencing the old ID, so that validators see the context without reopening the old report.
15. As a civilian, I want a tracking page with my report status, explanation, and nearest-station contact, so that I know what to do next.
16. As a civilian with a pending report, I want clear guidance to call 911 if danger is immediate, so that I do not wait on the app during an emergency.
17. As a civilian with an actioned report, I want to see the validator explanation, so that I know what operational follow-up occurred.
18. As a civilian with a rejected report, I want the rejection explanation and escalation guidance, so that I know whether to call 911 or submit a new report.
19. As a civilian with a timed-out report, I want to know it was not verified within the emergency review window, so that I can submit a new report if the emergency continues.
20. As a validator, I want the queue sorted by life-safety, aging, severity, cluster size, trust, and age, so that the most urgent work appears first.
21. As a validator, I want quick filters for needs-help, aging, timeout risk, confidence, and unreviewed reports, so that I can focus my review.
22. As a validator, I want queue filters reflected in the URL, so that I can share or bookmark focused queue views.
23. As a validator, I want non-binding recommended next actions, so that the UI helps me triage without deciding outcomes for me.
24. As a validator, I want to claim a cluster before review, so that another validator does not apply conflicting actions.
25. As another validator, I want to see who claimed a cluster and when, so that I understand why actions are disabled.
26. As a higher-privilege validator, I want to take over stale claims with an audit reason, so that work does not remain blocked.
27. As a validator, I want a map and table inside the cluster modal, so that I can decide which reports are truly related.
28. As a validator, I want outlier highlights for distance, time, category, GPS, and duplicate-device signals, so that I can avoid bad cluster actions.
29. As a validator, I want to select all likely related reports excluding outliers and terminal rows, so that bulk actions remain safe.
30. As a validator, I want to split a cluster, so that unrelated reports are not handled together.
31. As a validator, I want to merge nearby clusters conservatively, so that duplicate cluster suggestions can be consolidated.
32. As a validator, I want trust score breakdowns, so that I understand why a report has a given confidence score.
33. As a validator, I want nearest-station context on queue cards and modals, so that I can write accurate follow-up explanations.
34. As a validator, I want required quick-template explanations for terminal actions, so that civilians receive clear status updates.
35. As a validator, I want to edit explanation templates, so that the message matches the specific report.
36. As a validator, I want internal notes separate from civilian-visible explanations, so that operational context is not accidentally disclosed.
37. As a validator, I want terminal action previews before applying bulk updates, so that I can verify what civilians will see.
38. As a validator, I want mixed-status warnings in bulk actions, so that I do not accidentally overwrite terminal rows.
39. As a higher-privilege validator/admin, I want to correct terminal decisions with an audit reason, so that mistakes can be fixed transparently.
40. As a validator, I want activity/history inside the cluster modal, so that I understand claims, splits, merges, status changes, and explanations before acting.
41. As a validator, I want privacy-safe identity signals, so that I can detect abuse without seeing raw device IDs or IP hashes.
42. As a validator, I want navigation keyboard shortcuts, so that queue review is efficient.
43. As a validator, I do not want shortcuts for terminal actions, so that serious decisions require deliberate confirmation.
44. As a validator, I want queue polling and freshness indicators, so that I know when another validator changed a cluster.
45. As a system operator, I want pending reports to time out after 2 hours unless explicitly under review, so that stale emergency reports do not remain indefinitely pending.
46. As a system auditor, I want validator actions logged, so that claims, takeovers, corrections, splits, merges, and contact reveals are traceable.
47. As a developer, I want civilian report logic separated into testable scoring, clustering, and workflow modules, so that behavior can be verified without driving the full UI.

## Implementation Decisions

- `citizen_reports` is the public signal table. It stores structured report details, status, status explanation, safety status, append linkage, previous terminal report reference, trust score, nearest station, and region.
- Official `fire_incidents` are not created by civilian triage. Civilian reporting may inform later official AFOR workflows, but it is not the authoritative incident creation path.
- Row statuses are `PENDING`, `UNDER_REVIEW`, `LINKED`, `ACTIONED`, `REJECTED_BOGUS`, `REJECTED_DUPLICATE`, `REJECTED_INSUFFICIENT`, and `REJECTED_TIMEOUT`.
- `ACTIONED` and all `REJECTED_*` statuses are terminal for append. Civilians must submit a new report if they have new information.
- `previous_report_id` is distinct from `linked_to_report_id`. It references a previous terminal report without reopening or mutating it.
- `status_explanation` is civilian-visible and required for `ACTIONED` and `REJECTED_*`.
- `internal_note` is validator-only and required for stale takeover, split, merge, correction, and cluster close.
- `PENDING` reports older than 2 hours transition to `REJECTED_TIMEOUT` by scheduled task using the locked default explanation.
- Row-level `UNDER_REVIEW` pauses timeout. Cluster-level `CLUSTER_UNDER_REVIEW` alone does not pause timeout.
- `citizen_report_clusters` stores durable workflow state. Read-time PostGIS clustering remains the discovery mechanism for suggested related reports.
- Cluster statuses are `CLUSTER_MONITORING`, `CLUSTER_UNDER_REVIEW`, `CLUSTER_ACTIONED`, and `CLUSTER_CLOSED`.
- `citizen_report_cluster_members` stores explicit validator-selected membership.
- Cluster claim/lock is lightweight: `assigned_to`, `review_started_at`, stale after 15 minutes of no activity.
- Cluster splitting creates a new explicit cluster from selected outlier rows.
- Cluster merging is conservative, suggested within 250m and 1 hour, and marks the merged cluster closed with `merged_into_cluster_id`.
- Trust score is deterministic, capped at 100, and must expose a breakdown to validators.
- Severity is confidence that the incident is real, derived at triage read time from 100m/1hr related reports and cluster average trust.
- Civilian flow uses reporting context: `WITNESS`, `NEARBY`, `SECONDHAND`.
- Civilian flow uses required safety status: `I_AM_SAFE`, `I_NEED_HELP`, `SOMEONE_ELSE_NEEDS_HELP`, `UNKNOWN`.
- Life-safety reports get fast submit and emergency contact guidance. Other reports get compact review before final submit.
- GPS-denied reports are accepted with manual pin and no GPS match bonus.
- Non-life-safety reports may see a nearby duplicate suggestion before submit, but it is non-blocking.
- Public reporting/tracking uses local English/Filipino static copy constants, not full app-wide i18n.
- Phase 2 has no media upload, no challenge endpoint, no saved custom queue views, and no realtime/SSE dependency.
- Validator queue uses quick filters, URL query params, and 30-second polling while visible.
- Validator shortcuts are navigation-only and documented in [[frontend/validator-triage-shortcuts]].
- Privacy rules hide raw `device_id`, `ip_hash`, and notification tokens from validator UI.

## Testing Decisions

Tests should verify external behavior: API responses, state transitions, database effects, and rendered user-visible states. Tests should not assert private helper implementation details.

- Backend schema/bootstrap tests should verify new columns, constraints, indexes, cluster tables, and station phone availability.
- Backend API tests should cover report submission, append, terminal append blocking, previous report reference, tracking guidance fields, trust scoring, duplicate-device behavior, and rate limits.
- Backend workflow tests should cover timeout transition, row-level `UNDER_REVIEW` timeout pause, cluster claim/takeover, split, merge, terminal action explanations, correction, and audit events.
- Triage queue tests should cover priority ordering, filters, severity computation, cluster membership, trust breakdown payloads, station context, privacy-safe fields, and polling-safe updated timestamps.
- Frontend tests should cover public report flow modes, GPS-denied fallback, GPS mismatch confirmation, duplicate suggestion, bilingual microcopy presence, tracking guidance, validator filters, cluster modal selection, mixed-status warnings, explanation preview, and shortcut behavior.
- Existing prior art includes backend integration tests under `src/backend/tests/integration/` and frontend Vitest/React Testing Library tests under `src/frontend`.

## Out of Scope

- Direct creation of official `fire_incidents` from civilian triage.
- Civilian challenge/dispute endpoint.
- Photo, video, or media upload.
- Full app-wide i18n framework.
- Saved custom validator queue views.
- Realtime/SSE updates for the validator queue.
- Per-station RBAC model for a national deployment.
- Verified civilian identity or phone OTP.
- AI-based trust/severity scoring.

## Further Notes

- Partial backend edits were started before this PRD was finalized. Those edits must be reconciled with the locked ADR/PRD before implementation continues.
- The implementation should prefer deep, testable modules for trust scoring, clustering/queue projection, status workflow, and timeout behavior instead of embedding all logic directly inside route handlers or UI components.
- The validator workflow is intentionally conservative: recommendations are non-binding, terminal actions require deliberate confirmation, and all risky actions require audit capture.
