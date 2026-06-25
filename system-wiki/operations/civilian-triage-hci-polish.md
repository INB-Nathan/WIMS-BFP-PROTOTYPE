---
title: Civilian Triage Queue — HCI Polish
created: 2026-05-20
updated: 2026-06-25
type: operation
tags: [wims-bfp, civilian-reporting, triage, validator, hci, ux, frontend]
sources: [src/frontend/src/app/incidents/triage/page.tsx, src/frontend/src/components/triage/, system-wiki/subsystems/civilian-reporting-phase2.md]
status: in-progress
related: [subsystems/civilian-reporting-phase2, frontend/validator-triage-shortcuts, frontend/route-map, gaps/ui-ux-gap-register]
---

# Civilian Triage Queue — HCI Polish

Tracker: `# TBD`
Tags: `civic-triage-hci`

---

## Problem Statement

The current triage queue at `/incidents/triage` renders clusters and singleton reports in a single undifferentiated list. Each entry looks like a cluster card regardless of whether `cluster_id` is set, forcing validators to mentally separate two fundamentally different workflows:

- **Cluster** — multi-report incident requiring merge/split/terminal-action across members
- **Singleton** — single report requiring a straightforward terminal action with no map or multi-select

Visually they are identical cards. The Inspect modal can handle both cases, but the queue list itself gives no indication of which type a row represents without clicking into it.

---

## Desired UX

The queue page must render **two separate tables** above the fold:

### Table 1 — Clusters
For rows where `cluster_id !== null`.

| # | Severity | Life Safety | Timeout Risk | Assigned To | Members | Avg Trust | Station | Age | Actions |
|---|----------|-------------|--------------|-------------|---------|-----------|---------|-----|---------|
| 42 | HIGH | ⚠️ | — | jdelgado | 4 | 72 | Balayan BS | 12m | [Claim] [Inspect] |

- **Sort**: life-safety first → timeout_risk → severity → member_count desc → age desc
- **Cluster badge**: bold "Cluster N" label (not ambiguous with singleton)
- **Claim button**: only visible when `assigned_to === null` and role is VALIDATOR/NATIONAL_VALIDATOR
- **Inspect button**: always visible, opens the full inspection modal

### Table 2 — Individual Reports
For rows where `cluster_id === null` (i.e., singleton reports with no cluster membership).

| # | Severity | Life Safety | Timeout Risk | Status | Category | Trust | Station | Age | Actions |
|---|----------|-------------|--------------|--------|----------|-------|---------|-----|---------|
| 8811 | MEDIUM | — | — | PENDING | STRUCTURAL / ESTABLISHMENT | 68 | Nasugbu FS | 8m | [Inspect] |

- **Sort**: aging → timeout_risk → severity → age desc
- **No Claim button**: singletons are not claimable (no cluster-level lock needed)
- **No merge/split controls** in the inspection modal for singletons — only terminal action + optional correction
- **Terminal rows**: show status badge inline (ACTIONED / REJECTED_*) with a **Correct** link instead of Inspect

---

## Inspection Modal — Singleton vs Cluster

Both use the same modal shell. Content inside adapts:

### Cluster modal
- Map with all member markers + 100m radius circle
- Multi-select report table with merge/split/terminal-action controls
- Merge-candidate panel
- Activity history panel
- Split/merge cards only visible when `cluster_id !== null`

### Singleton modal
- No map (single marker only — consider a simple static map or location text)
- Single-row table with no multi-select
- No merge/split/claim controls
- Correct card (NATIONAL_VALIDATOR / SYSTEM_ADMIN only)

---

## Filter Behavior

The current filter chips (`needs_help`, `someone_else_needs_help`, `aging`, `timeout_risk`, `unreviewed`) apply to both tables. However:

- `unreviewed` maps to singleton-only: reports not part of any cluster
- Cluster filters do NOT apply to the singleton table

When a filter would result in an empty table, show a placeholder message: "No clusters matching current filters" / "No individual reports matching current filters."

---

## Metrics Bar

Retain the aggregate count from the current header:

```
Clusters: 12        Individual reports: 47        Polled 14:32:01
```

The count labels must reflect the actual data split, not a combined "report(s)" count.

---

## Backend Contract (no change needed)

`GET /api/triage/queue` returns the same response shape. The frontend is responsible for splitting:

```typescript
const clusters = queue.clusters.filter(c => c.cluster_id !== null);
const singletons = queue.clusters.filter(c => c.cluster_id === null);
```

---

## Scope for Implementation

### Phase A — UI Split (this ticket)
1. Parse `TriageQueueResponse.clusters` into two arrays in `page.tsx`
2. Render two `<table>` sections instead of one `.divide-y` list
3. Adjust sort/filter logic per-table
4. Pass a `mode: 'cluster' | 'singleton'` prop to the inspection modal so it can suppress inapplicable controls

### Phase B — Inspection Modal Singleton Adaptations
5. Singleton modal: static map or location text instead of full `ClusterInspectionMap`
6. Singleton modal: remove claim/split/merge panels
7. Singleton modal: show Correct card inline (no separate tab)

### Phase C — Metrics and Empty States
8. Metrics bar with per-table counts
9. Empty state placeholders per table
10. URL filter parity check (both tables should react to the same query params, but `unreviewed` maps to singleton-only)

### Phase D — Inspection Modal Action Tab Architecture (DONE 2026-06-21)

The four destructive paths (terminal, correction, split, merge) used to share the same visual weight, the same apply button style, and the same one-click commit. This ticket added a tabbed action architecture in `src/frontend/src/components/triage/`:

11. Tabbed right rail with Terminal / Correct / Split / Merge / Activity tabs.
12. Per-action citizen-visible previews: phone-card mock for terminal + correction, leaving/staying for split, source/target for merge.
13. Two-step destructive confirmation for any `REJECTED_*` terminal, every correction, every split, every merge. `ConfirmActionDialog` shows the exact impact summary + payload preview; `Esc` cancels only the confirm (capture-phase listener) without closing the parent modal.
14. Sticky dark-maroon header with cluster summary, severity, life-safety pulsing badge, member count, trust, station, oldest-report age, and explicit Close button.
15. Report cards (not a table) with one-card-per-report scan, heavy maroon left border for selected rows, inline "Correct" button on terminal rows.
16. `1`–`5` keyboard navigation between tabs (cluster-only for Split + Merge). Per `frontend/validator-triage-shortcuts` policy, **no commit shortcuts** — terminal / correction / split / merge must be committed by clicking the panel commit button.
17. Per-action "Why this status?" / "What will happen?" disclosure blocks explaining audit + notification consequences.
18. State extracted to `useTriageModalState` hook so the modal is a presentational component.

Validation: 27 triage tests pass (13 original + 14 new), 732 tests in the full frontend suite, `npx eslint src/components/triage/ src/app/incidents/triage/page.tsx` clean, no new `tsc` errors.

---

## Phase E — Spatial Triage Workspace

The queue page now uses a map-first triage canvas paired with an investigation board. Selecting a cluster or singleton marker updates the board without opening the modal. The modal opens only through the explicit `Inspect / Act` CTA.

The inspection modal is retained as the guarded action surface. Its body is refit into three regions:

1. spatial panel with derived cluster centroid/spread or singleton location
2. report evidence panel using shared evidence cards
3. action rail with Terminal / Correct / Split / Merge / Activity controls and existing confirmation safeguards

Cluster geometry is derived client-side from valid report coordinates. Reports with invalid or missing runtime coordinates remain visible in evidence/list surfaces and are omitted from map markers with a `No usable location` hint.

## Related Files

| File | Role |
|---|---|
| `src/frontend/src/app/incidents/triage/page.tsx` | Queue page shell, table rendering, modal mount |
| `src/frontend/src/components/triage/TriageInspectionModal.tsx` | Modal shell, tab routing, two-step confirm orchestration |
| `src/frontend/src/components/triage/ClusterSummaryHeader.tsx` | Sticky dark-maroon header |
| `src/frontend/src/components/triage/TriageActionTabs.tsx` | Left-rail tab nav with `1`–`5` shortcuts |
| `src/frontend/src/components/triage/ReportsListPanel.tsx` | Center report cards |
| `src/frontend/src/components/triage/TerminalActionPanel.tsx` | Terminal action form + previews |
| `src/frontend/src/components/triage/CorrectionActionPanel.tsx` | Correction form + previews |
| `src/frontend/src/components/triage/SplitActionPanel.tsx` | Split form + leaving/staying preview |
| `src/frontend/src/components/triage/MergeActionPanel.tsx` | Merge form + source/target preview |
| `src/frontend/src/components/triage/CitizenMessagePreview.tsx` | Phone-card mock of citizen-visible message |
| `src/frontend/src/components/triage/ActivityPanel.tsx` | Activity timeline |
| `src/frontend/src/components/triage/ConfirmActionDialog.tsx` | Two-step destructive confirmation |
| `src/frontend/src/components/triage/useTriageModalState.ts` | Extracted state hook |
| `src/frontend/src/components/triage/triage-modal.css` | Operations-console visual system |
| `src/frontend/src/components/ClusterInspectionMap.tsx` | Used only for cluster modal center panel |
| `src/frontend/src/lib/api.ts` | `fetchTriageQueue` returns `TriageQueueResponse` — no change |
| `system-wiki/subsystems/civilian-reporting-phase2.md` | Authority for Phase 2 spec |
| `system-wiki/frontend/validator-triage-shortcuts.md` | Keyboard shortcut policy |