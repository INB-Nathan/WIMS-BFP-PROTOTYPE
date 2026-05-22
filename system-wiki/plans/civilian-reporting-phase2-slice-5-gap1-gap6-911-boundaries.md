---
title: "Phase 2 Slice 5: Gap 1 + Gap 6 — 911 Boundaries (Submitted + Review)"
created: 2026-05-22
type: issue
tags: [wims-bfp, civilian-reporting, phase-2, gap-1, gap-6]
status: open
phase: 1
gaps: [1, 6]
parent: civilian-reporting-phase-2-implementation-issues
---

# Phase 2 Slice 5: 911 Boundaries — Submitted + Review

**Type:** AFK — frontend-only
**Files:** `src/frontend/src/app/report/page.tsx`

## Gap 1: Submitted Screen 911 Boundary for ALL Submissions

### Current State
Lines 573-583 in `page.tsx`:
```tsx
{isLifeSafety && (
  <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4 text-left">
    ...911 block...
  </div>
)}
```
The 911 emergency boundary only renders when `isLifeSafety === true`. Non-life-safety users see "Report Submitted" then nearest station with no emergency guidance.

### Required Change
Remove the `isLifeSafety` condition — the 911 block must render for **every submission** regardless of safety status.

### Target
```tsx
{/* Always show for all submissions */}
<div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4 text-left">
  <div className="flex items-start gap-2">
    <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
    <div>
      <p className="text-sm font-semibold text-red-700">Call 911 if you have not done so.</p>
      <p className="text-xs text-red-600 mt-0.5">Kung kailangan mo ng agarang tulong, tumawag na sa 911.</p>
      <p className="text-xs text-red-600 mt-1">
        This report helps BFP review public signals — it does not replace an emergency call.
      </p>
      <p className="text-xs text-red-600 mt-0.5">
        Ang report na ito ay tumutulong sa BFP na suriin ang mga signal mula sa publiko — hindi ito kapalit ng agarang tawag sa 911.
      </p>
    </div>
  </div>
</div>
```

---

## Gap 6: Review Step 911 Boundary Before Submit CTA

### Current State
Lines 502-505 in `page.tsx`:
```tsx
<div className="text-xs p-3 rounded-lg" style={{ backgroundColor: 'var(--content-bg)', color: 'var(--text-secondary)' }}>
  Do not move closer or take photos if unsafe.
  <br />Huwag lumapit sa sunog kung hindi ka ligtas.
</div>
```
The review step has a "do not move closer" notice but no 911 emergency boundary or "does not replace emergency call" copy before the submit button.

### Required Change
Add 911 emergency boundary block **between** the data summary (line ~500) and the submit button row (line ~528). It must appear before the final submit CTA for non-life-safety users.

### Target
Insert before the `<div className="flex gap-3">` that holds the submit button (around line 522, after the `submitError` block):

```tsx
{/* 911 boundary before submit CTA — all users */}
<div className="bg-red-50 border border-red-200 rounded-lg p-4">
  <div className="flex items-start gap-2">
    <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
    <div>
      <p className="text-sm font-semibold text-red-700">
        For immediate danger, call 911 now. This report does not replace an emergency call.
      </p>
      <p className="text-xs text-red-600 mt-0.5">
        Kung may agarang peligro, tumawag sa 911 ngayon. Ang report na ito ay hindi kapalit ng agarang tawag sa 911.
      </p>
    </div>
  </div>
</div>
```

---

## Acceptance Criteria

- [ ] Submitted screen shows 911 block for ALL submissions (life-safety AND non-life-safety)
- [ ] Submitted screen 911 block includes "does not replace emergency call" in both EN+FIL
- [ ] Review step shows 911 boundary before the submit CTA (all users, not just life-safety)
- [ ] Review step 911 boundary includes "does not replace emergency call" in both EN+FIL

## File to Modify

- `src/frontend/src/app/report/page.tsx`
  - Submitted screen 911 block: remove `isLifeSafety &&` condition, add "does not replace" copy
  - Review step: insert 911 boundary block before the submit button row