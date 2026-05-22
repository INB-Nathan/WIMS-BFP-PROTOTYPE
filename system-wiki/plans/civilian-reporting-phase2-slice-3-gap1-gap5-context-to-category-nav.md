---
title: "Phase 1 Slice 3: Gap 1 (Nav) + Gap 5 (Nav) — Context Advances to Category"
created: 2026-05-22
type: issue
tags: [wims-bfp, civilian-reporting, phase-2, gap-1, gap-5]
status: open
phase: 1
gaps: [1, 5]
parent: civilian-reporting-phase-2-implementation-issues
blocked-by: [civilian-reporting-phase2-slice-2-gap1-step-reorder-safety-first]
---

# Phase 1 Slice 3: Gap 1 (Nav) + Gap 5 (Nav) — Context Advances to Category

**Type:** AFK
**Blocked by:** Slice 2 (Step Reorder)
**Gaps covered:** Gap 1 (navigation), Gap 5 (navigation — challenge prompts will be implemented in Phase 2)

## What to build

After the step reorder (Slice 2), the `context` step is no longer the entry point. Two functions that previously navigated to `safety` must now navigate to `category`. Additionally, the context step needs a Back button pointing to `safety`.

### Changes

1. **`tryAdvanceFromContext()` (line ~348-362)**
   ```tsx
   // FROM:
   setStep('safety');
   // TO:
   setStep('category');
   ```

2. **`handleGpsMismatchConfirm()` (line ~364-368)**
   ```tsx
   // FROM:
   setStep('safety');
   // TO:
   setStep('category');
   ```

3. **Context step — add Back button (lines ~724-736)**
   The context step navigation row currently has only a Continue button. Add a Back button to the left of Continue:
   ```tsx
   <button
     type="button"
     onClick={() => setStep('safety')}
     className="flex items-center gap-1 px-4 py-3 rounded-lg border text-sm font-medium"
     style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}
   >
     <ChevronLeft className="w-4 h-4" /> Back
   </button>
   ```
   The Continue button already exists and calls `tryAdvanceFromContext()`.

### Note on Gap 5 (Context Challenge Prompts)

The full Gap 5 implementation (SECONDHAND GPS challenge modal and NEARBY non-blocking reminder) will be implemented in Phase 2. This slice only corrects the navigation target that was changed by the step reorder. The challenge prompt logic itself (the `if` conditions that check `reportingContext === 'SECONDHAND'` or `'NEARBY'` after GPS) will be added in Phase 2 — this is a separate vertical slice.

## Acceptance criteria

- [ ] Context step Continue → category step (not safety)
- [ ] Context step Back button → safety step
- [ ] GPS mismatch confirmation (Confirm) → category step (not safety)
- [ ] No crash when GPS mismatch Cancel is clicked
- [ ] Back button on context step is styled consistently with other back buttons

## File to modify

- `src/frontend/src/app/report/page.tsx`