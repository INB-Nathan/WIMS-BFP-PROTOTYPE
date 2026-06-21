---
title: Validator Triage Shortcuts
created: 2026-05-20
updated: 2026-06-21
type: frontend
tags: [wims-bfp, frontend, triage, validation, ui-ux, hci]
sources: [system-wiki/decisions/0001-civilian-reporting-overhaul.md, src/frontend/src/app/incidents/triage/page.tsx, src/frontend/src/components/triage/TriageInspectionModal.tsx]
status: current
related: [subsystems/civilian-reporting-phase2, operations/civilian-triage-hci-polish, frontend/route-map]
---

# Validator Triage Shortcuts

This page defines the safe keyboard shortcut scope for the civilian report triage workflow. It is linked to [[decisions/0001-civilian-reporting-overhaul]] and [[frontend/route-map]].

## Modal-Scoped Shortcuts (Triage Inspection Modal)

While the inspection modal is open (`src/frontend/src/components/triage/TriageInspectionModal.tsx`), the following shortcuts are active. The handler is suppressed when focus is inside an `INPUT` / `TEXTAREA` / `SELECT` so typing is never hijacked.

| Shortcut | Action | Notes |
|---|---|---|
| `Esc` | Close modal | Does not save or apply actions. Cancels any open destructive confirm. |
| `1` | Switch to **Terminal** tab | Navigation only |
| `2` | Switch to **Correct** tab | Navigation only |
| `3` | Switch to **Split** tab | Cluster mode only |
| `4` | Switch to **Merge** tab | Cluster mode only |
| `5` | Switch to **Activity** tab | Navigation only |

The destructive confirm dialog also traps `Esc` (capture phase) so it cancels without closing the parent modal.

## Queue-Level Shortcuts (existing)

| Shortcut | Action | Notes |
|---|---|---|
| `/` | Focus search | Search/filter focus only |
| `j` | Move to next queue item | Navigation only |
| `k` | Move to previous queue item | Navigation only |
| `f` | Open filters | Opens quick filter panel/menu |
| `m` | Open map/table modal | Opens inspection modal for focused cluster |
| `Esc` | Close modal/panel | Does not save or apply actions |

## Explicitly Not Allowed (unchanged policy)

Terminal or bulk actions must not have keyboard shortcuts. The commit step is always a deliberate UI click:

- `ACTIONED` (or any `REJECTED_*`) terminal action
- Apply correction
- Split cluster
- Merge cluster
- Bulk apply
- Claim takeover

These actions require a deliberate UI click, the citizen-visible `status_explanation` preview, and (for destructive or audit-visible actions) a two-step destructive confirm before the API call lands. The commit button in each panel reads "click to confirm" rather than showing a `⌘↵` shortcut, to make the no-shortcut policy visible to the operator.

## Rationale

The Triage inspection modal previously showed no in-modal shortcuts at all. The 1–5 tab navigation is safe because it changes the *form* the operator is editing, never commits. Splitting tab navigation from commit-key keeps the operator's muscle memory for tab management without exposing the destructive paths to a stray keystroke. The audit trail for terminal / split / merge / correction always shows the deliberate click as the trigger event.

## Related Files

| File | Role |
|---|---|
| `src/frontend/src/components/triage/TriageInspectionModal.tsx` | Tab-nav + Esc-close keydown handler |
| `src/frontend/src/components/triage/ConfirmActionDialog.tsx` | `Esc` cancel for destructive confirm (capture phase) |
| `src/frontend/src/components/triage/TriageActionTabs.tsx` | Tab buttons with 1–5 number-key hints |
| `src/frontend/src/components/triage/TerminalActionPanel.tsx` | Terminal commit button (click only) |
| `src/frontend/src/components/triage/CorrectionActionPanel.tsx` | Correction commit button (click only) |
| `src/frontend/src/components/triage/SplitActionPanel.tsx` | Split commit button (click only) |
| `src/frontend/src/components/triage/MergeActionPanel.tsx` | Merge commit button (click only) |

## Implementation Notes

- Shortcuts apply only when the triage queue has focus and no text input/textarea/select is active.
- Shortcut help should be visible from the validator triage page, for example a help button or command/help modal.
- Terminal action dialogs must trap focus and ignore queue navigation shortcuts while open.
