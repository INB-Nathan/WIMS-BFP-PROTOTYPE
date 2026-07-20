---
title: Validator Triage Shortcuts
created: 2026-05-20
updated: 2026-07-20
type: frontend
tags: [wims-bfp, frontend, triage, validation, ui-ux, hci]
sources: [system-wiki/decisions/0001-civilian-reporting-overhaul.md, src/frontend/src/app/incidents/triage/page.tsx, src/frontend/src/app/incidents/triage/[clusterId]/page.tsx, src/frontend/src/components/triage/TriageWorkflowPanel.tsx, src/frontend/src/components/triage/ConfirmActionDialog.tsx]
status: verified
related: [subsystems/civilian-reporting-phase2, operations/civilian-triage-hci-polish, frontend/route-map]
---

# Validator Triage Shortcuts

Current safe keyboard policy for civilian-report triage. See [[subsystems/civilian-reporting-phase2]] and [[frontend/route-map]].

## Workspace Action Navigation

`src/frontend/src/components/triage/TriageWorkflowPanel.tsx` installs these shortcuts while route-based workspace action controls are mounted. Handler ignores events from `INPUT`, `TEXTAREA`, and `SELECT` elements.

| Shortcut | Action | Notes |
|---|---|---|
| `1` | Terminal tab | Navigation only |
| `2` | Split tab | Cluster mode only |
| `3` | Merge tab | Cluster mode only |
| `4` | Activity tab | Navigation only |
| `5` | Send Update tab | NATIONAL_VALIDATOR or REGIONAL_ENCODER capability only |

Retired modal-level `Esc` close behavior no longer exists. Browser/route navigation returns from `/incidents/triage/[clusterId]` to URL-preserved queue state. `Esc` remains local to `ConfirmActionDialog`, where it cancels confirmation.

## Queue-Level State

`/incidents/triage` currently provides clickable map/board/report selection and URL-backed filters. It does not implement `/`, `j`, `k`, `f`, `m`, or queue-level `Esc` handlers. Those shortcuts remain design guidance in [[decisions/0001-civilian-reporting-overhaul]], not current implementation claims.

## No Commit Shortcuts

No keyboard shortcut may commit:

- `ACTIONED` or any `REJECTED_*` terminal action;
- split or merge;
- correction;
- status update;
- claim takeover.

Commit controls require deliberate clicks. Destructive/caution terminal decisions, split, merge, correction, takeover, and status-update flows use explicit confirmation where their panel contract requires it. Citizen-visible terminal copy remains previewed before commit.

## Related Files

| File | Role |
|---|---|
| `src/frontend/src/components/triage/TriageWorkflowPanel.tsx` | Action-tab keyboard navigation and confirmation orchestration |
| `src/frontend/src/components/triage/ConfirmActionDialog.tsx` | Focus-contained two-step confirmation and `Esc` cancel |
| `src/frontend/src/components/triage/TriageActionTabs.tsx` | Action-tab buttons and numeric hints |
| `src/frontend/src/components/triage/TerminalActionPanel.tsx` | Click-only terminal commit and citizen preview |
| `src/frontend/src/components/triage/SplitActionPanel.tsx` | Click-only split commit |
| `src/frontend/src/components/triage/MergeActionPanel.tsx` | Click-only merge commit |
