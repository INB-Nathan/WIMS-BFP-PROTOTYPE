---
title: Civilian Triage Queue — HCI Polish
created: 2026-05-20
updated: 2026-05-20
type: operation
tags: [wims-bfp, civilian-reporting, triage, validator, hci, ux, frontend]
sources: [src/frontend/src/app/incidents/triage/page.tsx, system-wiki/subsystems/civilian-reporting-phase2.md]
status: draft
related: [subsystems/civilian-reporting-phase2, frontend/validator-triage-shortcuts, gaps/ui-ux-gap-register]
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

---

## Related Files

| File | Role |
|---|---|
| `src/frontend/src/app/incidents/triage/page.tsx` | Primary edit target |
| `src/frontend/src/lib/api.ts` | `fetchTriageQueue` returns `TriageQueueResponse` — no change |
| `src/frontend/src/components/ClusterInspectionMap.tsx` | Used only for cluster modal |
| `system-wiki/subsystems/civilian-reporting-phase2.md` | Authority for Phase 2 spec |
| `system-wiki/frontend/validator-triage-shortcuts.md` | Keyboard shortcuts to re-evaluate post-split |