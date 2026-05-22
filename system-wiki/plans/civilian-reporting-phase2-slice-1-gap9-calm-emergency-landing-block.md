---
title: "Phase 1 Slice 1: Gap 9 — Calm Emergency Landing Block"
created: 2026-05-22
type: issue
tags: [wims-bfp, civilian-reporting, phase-2, gap-9]
status: open
phase: 1
gaps: [9]
parent: civilian-reporting-phase-2-implementation-issues
---

# Phase 1 Slice 1: Gap 9 — Calm Emergency Landing Block

**Type:** AFK
**Blocked by:** None — entry point
**Gaps covered:** Gap 9

## What to build

A passive, stateless bilingual alert block renders above the `ProgressBar` on every pre-submit wizard step of `/report`. It contains three static English/Filipino lines with an `AlertTriangle` icon. No buttons, no links, no state management, no `useEffect`.

This block is purely informational — it is the "calm before the form" guidance that appears before any interactive step. It disappears on the `review` and `submitted` screens, which have their own 911 boundaries (Gap 8 and Gap 2 respectively).

**Placement:** Inside the main report card, between the card header (`<div className="p-4 text-center" style={{ background: 'var(--bfp-gradient)' }}>`) and the `ProgressBar`.

**Content (3 lines, bilingual):**
1. "Call 911 now if anyone is in immediate danger / Tumawag sa 911 kung may tao sa agarang panganib"
2. "Move away from smoke or fire / Umatras mula sa usok o sunog"
3. "Do not get closer to take photos / Huwag lumapit para kumuha ng litrato"

**Visual direction:** Amber/yellow-tinted alert box, `AlertTriangle` icon left-aligned, static text. Does not use the red life-safety style — this is neutral guidance for all users.

## Technical notes

- Pure render — no `useState`, no `onClick`, no `useEffect`
- Rendered conditionally inside the multi-step form block: only when `step !== 'review'` and `step !== 'submitted'`
- Does not affect `step` state or any other state
- Must persist across back/forward step navigation

## Acceptance criteria

- [ ] Alert block visible on page load before any interactive step
- [ ] No button, link, or form control inside the block
- [ ] Block absent on `review` step
- [ ] Block absent on `submitted` step
- [ ] Block visible when navigating Back from any step
- [ ] All three bilingual lines present with `AlertTriangle` icon

## File to modify

- `src/frontend/src/app/report/page.tsx`