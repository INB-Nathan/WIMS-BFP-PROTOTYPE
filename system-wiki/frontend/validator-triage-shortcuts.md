---
title: Validator Triage Shortcuts
created: 2026-05-20
updated: 2026-05-20
type: frontend
tags: [wims-bfp, frontend, triage, validation, ui-ux, hci]
sources: [system-wiki/decisions/0001-civilian-reporting-overhaul.md, src/frontend/src/app/incidents/triage/page.tsx]
status: draft
---

# Validator Triage Shortcuts

This page defines the safe keyboard shortcut scope for the civilian report triage workflow. It is linked to [[decisions/0001-civilian-reporting-overhaul]] and [[frontend/route-map]].

## Allowed Shortcuts

| Shortcut | Action | Notes |
|---|---|---|
| `/` | Focus search | Search/filter focus only |
| `j` | Move to next queue item | Navigation only |
| `k` | Move to previous queue item | Navigation only |
| `f` | Open filters | Opens quick filter panel/menu |
| `m` | Open map/table modal | Opens inspection modal for focused cluster |
| `Esc` | Close modal/panel | Does not save or apply actions |

## Explicitly Not Allowed

Terminal or bulk actions must not have keyboard shortcuts:

- `ACTIONED`
- `REJECTED_BOGUS`
- `REJECTED_DUPLICATE`
- `REJECTED_INSUFFICIENT`
- Bulk apply
- Claim takeover
- Split cluster
- Merge cluster

These actions require deliberate UI clicks, preview of the civilian-visible `status_explanation`, and audit capture where applicable.

## Implementation Notes

- Shortcuts apply only when the triage queue has focus and no text input/textarea/select is active.
- Shortcut help should be visible from the validator triage page, for example a help button or command/help modal.
- Terminal action dialogs must trap focus and ignore queue navigation shortcuts while open.
