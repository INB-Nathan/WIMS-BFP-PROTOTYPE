---
title: Civilian Triage Queue — HCI Polish
created: 2026-05-20
updated: 2026-07-20
type: operations
tags: [wims-bfp, civilian-reporting, triage, validator, hci, ui-ux, frontend]
sources: [src/frontend/src/app/incidents/triage/page.tsx, src/frontend/src/app/incidents/triage/[clusterId]/page.tsx, src/frontend/src/components/triage/, system-wiki/subsystems/civilian-reporting-phase2.md]
status: verified
related: [subsystems/civilian-reporting-phase2, frontend/validator-triage-shortcuts, frontend/route-map, gaps/ui-ux-gap-register]
---

# Civilian Triage Queue — HCI Polish

Current triage UX separates fast queue scanning from evidence-intensive action work. See [[frontend/route-map]] and [[subsystems/civilian-reporting-phase2]].

## Queue Surface

`/incidents/triage` is map-first:

- triage canvas and investigation board keep selection on-page without opening an overlay;
- ranked queue provides a non-map fallback;
- selected report evidence appears in a separate full-width table;
- quick filters, source filter, selected item, and selected report are represented in URL search state;
- queue polling continues every 30 seconds while visible;
- `Inspect / Act` is the only navigation into detailed action work.

`Inspect / Act` routes durable clusters to `/incidents/triage/[clusterId]`. Legacy rows without a durable `cluster_id` show a recoverable error instead of opening the retired singleton modal path.

## Dedicated Evidence Workspace

`/incidents/triage/[clusterId]` replaces `TriageInspectionModal`:

1. Sticky route header shows cluster state, claim owner, freshness, refresh, and return-to-queue link.
2. Report navigation reconstructs a valid `report_id` deep link and preserves the same selection when returning.
3. Selected-report content includes sanitized evidence, report/device/EXIF/IP location comparison, contributor credibility, explicit audited contact reveal, follow-ups, civilian feedback, and cluster activity.
4. Background 30-second checks mark data stale; they do not overwrite active action forms.
5. An owned active claim is refreshed every five minutes while the page is visible.
6. Closed clusters remain evidence-readable but hide action controls.
7. Missing, invalid, inaccessible, and no-longer-active clusters use neutral recoverable states.

National Validator and System Administrator roles can load evidence workspace projection. Backend authorization remains authoritative.

## Action Surface

`TriageWorkflowPanel` reuses established action components without modal shell, backdrop, body-scroll lock, or close state:

- Terminal, Split, Merge, Activity, and capability-gated Send Update tabs;
- selected report cards and citizen-visible terminal preview;
- source/target merge and leaving/staying split previews;
- explicit confirmation for destructive or audit-sensitive paths;
- click-only commits; numeric shortcuts navigate tabs only;
- correction lives in separate `workspace/CorrectionActionPanel.tsx` and requires review plus confirmation.

See [[frontend/validator-triage-shortcuts]] for exact keyboard behavior.

## Retirement Record

Removed modal-only files:

- `src/frontend/src/components/triage/TriageInspectionModal.tsx`
- `src/frontend/src/components/triage/useTriageModalState.ts`
- `src/frontend/src/components/triage/triage-modal.css`
- obsolete standalone `TriageSpatialPanel` wrapper/inner components

Shared action components remain. Renamed route-safe owners are `TriageWorkflowPanel.tsx`, `useTriageWorkflowState.ts`, and `triage-workflow.css`.

## Current Validation Anchors

- `src/frontend/src/app/incidents/triage/page.test.tsx`: route handoff, URL/selection preservation, orphan recovery, claim refresh.
- `src/frontend/src/app/incidents/triage/[clusterId]/__tests__/page.test.tsx`: deep-link reconstruction, report switching, stale-data guard, five-minute claim heartbeat, closed/missing/access states.
- `src/frontend/src/components/triage/TriageWorkflowPanel.update.test.tsx`: role-gated update tab, click-only destructive confirmation, merge/activity parity, terminal-state update guard.
- Workspace component tests cover evidence URL isolation, credibility/contact flow, correction confirmation, and location-map mount.

## Related Files

| File | Role |
|---|---|
| `src/frontend/src/app/incidents/triage/page.tsx` | Queue, URL selection, route handoff |
| `src/frontend/src/app/incidents/triage/[clusterId]/page.tsx` | Dedicated evidence workspace |
| `src/frontend/src/components/triage/TriageWorkflowPanel.tsx` | Embedded action orchestration |
| `src/frontend/src/components/triage/useTriageWorkflowState.ts` | Action form/state owner |
| `src/frontend/src/components/triage/triage-workflow.css` | Route-safe action styling |
| `src/frontend/src/components/triage/workspace/` | Evidence, credibility, location, correction components |
| `src/frontend/src/components/triage/ConfirmActionDialog.tsx` | Two-step confirmation |
