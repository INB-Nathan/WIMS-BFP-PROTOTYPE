---
title: "Phase 1 Slice 2: Gap 1 — Step State Machine Reorder (Safety-First)"
created: 2026-05-22
type: issue
tags: [wims-bfp, civilian-reporting, phase-2, gap-1]
status: open
phase: 1
gaps: [1]
parent: civilian-reporting-phase-2-implementation-issues
blocked-by: [civilian-reporting-phase2-slice-1-gap9-calm-emergency-landing-block]
---

# Phase 1 Slice 2: Gap 1 — Step State Machine Reorder (Safety-First)

**Type:** AFK
**Blocked by:** Slice 1 (Gap 9 — calm emergency landing block)
**Gaps covered:** Gap 1 (core)

## What to build

Reorder the `/report` wizard so that `safety` is the first interactive step. The state machine initialization and the progress bar step order array are changed together; no other logic changes are required.

### Changes

1. **Step initialization (line ~227)**
   ```tsx
   // FROM:
   const [step, setStep] = useState<Step>('context');
   // TO:
   const [step, setStep] = useState<Step>('safety');
   ```

2. **Step order array (line ~256)**
   ```tsx
   // FROM:
   const stepOrder: Step[] = ['context', 'safety', 'category', 'details'];
   // TO:
   const stepOrder: Step[] = ['safety', 'context', 'category', 'details'];
   ```

3. **Safety step back button (line ~783)**  
   The safety step is now the entry point — it has no prior step. The "Back" button on the safety step must be removed. The button currently reads:
   ```tsx
   <button type="button" onClick={() => setStep('context')}>
     <ChevronLeft className="w-4 h-4" /> Back
   </button>
   ```
   Remove this element entirely from the safety step navigation row.

### Side effects

- `currentStepIndex = stepOrder.indexOf(step)` auto-adjusts once `stepOrder` is correct — no explicit change needed
- Progress bar will now show "1 of 4" on safety, "2 of 4" on context, "3 of 4" on category, "4 of 4" on details
- The useEffect at line ~311 that triggers GPS requests based on `reportingContext === 'WITNESS'` is unchanged — `reportingContext` is `null` when the user first sees the safety step, which is correct; GPS fires after the user selects a context
- `tryAdvanceFromContext()` and `handleGpsMismatchConfirm()` currently call `setStep('safety')` — those are fixed in Slice 3, not here

## Acceptance criteria

- [ ] Fresh page load lands on safety step (not context)
- [ ] Progress bar shows "1 of 4" on safety, "2 of 4" on context, etc.
- [ ] Safety step has no Back button
- [ ] Safety step Continue → context step
- [ ] All four steps reachable in correct order via Continue navigation

## File to modify

- `src/frontend/src/app/report/page.tsx`