---
title: "Phase 1 Slice 4: Gap 7 — Life-Safety Category Step Dual CTA"
created: 2026-05-22
type: issue
tags: [wims-bfp, civilian-reporting, phase-2, gap-7]
status: open
phase: 1
gaps: [7]
parent: civilian-reporting-phase-2-implementation-issues
blocked-by: [civilian-reporting-phase2-slice-3-gap1-gap5-context-to-category-nav]
---

# Phase 1 Slice 4: Gap 7 — Life-Safety Category Step Dual CTA

**Type:** AFK
**Blocked by:** Slice 3 (Context → Category navigation)
**Gaps covered:** Gap 7

## What to build

On the category step, when `isLifeSafety === true` and a category has been selected, the user is presented with two distinct CTAs:

- **Primary:** "Send now" — red/primary style — calls `handleSubmit()` immediately with only the required fields (location, context, safety status, category). Details fields are optional and skipped.
- **Secondary:** "Add details" — border/outline style — navigates to the `details` step via `setStep('details')`, preserving the ability to add optional fields before submit.
- **Back button:** Full-width, stacked below the two CTAs — returns to the context step.

Non-life-safety path (`!isLifeSafety`) is unchanged — single "Continue" button as before.

### Current implementation (lines ~830-848, category step navigation)

```tsx
<div class="flex gap-3">
  <button Back onClick={() => setStep('safety')} />
  <button Continue onClick={() => setStep('details')} disabled={!category} />
</div>
```

### Target implementation (category step navigation row)

When `isLifeSafety && category`:
```tsx
<div class="space-y-3">
  {/* Row 1: two CTAs side by side */}
  <div class="flex gap-3">
    {/* Send now — primary, red */}
    <button
      type="button"
      onClick={() => void handleSubmit()}
      className="flex-1 py-3 rounded-lg text-white text-sm font-bold"
      style={{ background: 'var(--bfp-red, #dc2626)' }}
    >
      Send now / Ipadala na
    </button>
    {/* Add details — secondary, border */}
    <button
      type="button"
      onClick={() => setStep('details')}
      className="flex-1 py-3 rounded-lg border text-sm font-medium"
      style={{ borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
    >
      Add details / Magdagdag ng detalye
    </button>
  </div>
  {/* Row 2: back button full-width */}
  <button
    type="button"
    onClick={() => setStep('context')}
    className="w-full flex items-center justify-center gap-1 px-4 py-3 rounded-lg border text-sm font-medium"
    style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}
  >
    <ChevronLeft className="w-4 h-4" /> Back / Bumalik
  </button>
</div>
```

When `!isLifeSafety || !category`: keep existing behavior (single Continue button + Back button).

### Why "Send now" submits correctly without modification

`handleSubmit()` (lines 436-452) calls `buildPayload()` which requires only:
- `geo.latitude` / `geo.longitude`
- `reportingContext`
- `safetyStatus`
- `category`

All details fields (`observedTime`, `witnessName`, `witnessPhone`, `previousReportId`) are optional and passed as `undefined` when empty. The backend accepts these as optional. No change to `handleSubmit` or `buildPayload` is needed.

### Mobile layout

The `flex gap-3` row on mobile will stack the two CTA buttons horizontally. If viewport is narrow, the buttons may compress. The mobile breakpoint is controlled by Tailwind — `flex gap-3` on small screens may need `flex-col` at `sm:` or `md:` breakpoint. Confirm visually during implementation and apply `flex-col sm:flex-row` if needed to avoid cramping.

## Acceptance criteria

- [ ] Life-safety path + category selected → two side-by-side CTA buttons visible
- [ ] "Send now" submits the report immediately with no details fields
- [ ] "Add details" navigates to the details step
- [ ] Full-width "Back" button below both CTAs routes to context step
- [ ] Non-life-safety path shows existing single Continue button unchanged
- [ ] Layout correct on mobile (buttons do not overlap or truncate)
- [ ] Category step Back button correctly routes to context step (not safety)

## File to modify

- `src/frontend/src/app/report/page.tsx`