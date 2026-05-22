# Handoff — Civilian Reporting Phase 2 Slices 5–9

**Session:** 2026-05-22 | Civilian Reporting Phase 2 implementation
**Branch:** `feat/m14-civilian-reporting-phase2`
**Status at handoff:** Work-in-progress — slice 5 partially applied, slices 6–9 not started

---

## What Was Done

Implemented slices 1–4 (committed as `448bf50`):
- Slice 1: CalmEmergencyBlock before first interactive step
- Slice 2: Safety-first step reorder (defaultStep='safety', stepOrder=['safety','context','category','details'])
- Slice 3: Context-to-category navigation fixes
- Slice 4: Life-safety category dual CTA (Send now + Add details)

Created slice plan documents for 5–9 (committed as `3972424`).

Applied partial fixes to slice 5 in current session (uncommitted):
- Submitted screen: 911 block unconditionally rendered (removed `isLifeSafety &&` guard) + added "does not replace emergency call" EN+FIL copy
- Review step: inserted 911 emergency boundary block before submit CTA (all users, EN+FIL)

---

## What Needs to Be Continued

### Slice 5 — Remaining Work

**File:** `src/frontend/src/app/report/page.tsx`

Two patches already applied:
1. Submitted screen 911 block — unconditional render + "does not replace" copy ✅
2. Review step 911 boundary — inserted before submit button row ✅

Verify both changes at lines ~571-590 (submitted) and ~505-523 (review step) are consistent, then run verification:
```bash
cd src/frontend && npm run lint && npx vitest run
```

### Slice 6 — Submit Error 911 + Error-Type Copy

**Specs in:** `system-wiki/plans/civilian-reporting-phase2-slice-6-gap3-submit-error-911.md`

**What to do:**
1. Add `submitErrorType` state (already added at line ~247, verify it's there)
2. Update `handleSubmit` catch block — error type detection + `setSubmitErrorType(type)` (patch already applied, verify at ~447-460)
3. Replace plain `{submitError && ...}` error display in review step (around line 549-553) with typed error banner that shows:
   - Per-type heading: network/validation/rate_limit/server/unknown
   - Per-type next-step copy
   - Always-present 911 boundary with EN+FIL sentence

Current plain error display to replace:
```tsx
{submitError && (
  <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 text-red-700 text-sm">
    <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {submitError}
  </div>
)}
```

Target: replace with the typed banner from the plan doc (lines ~99-127).

### Slice 7 — Tracking Page 911 ALL Statuses + Station Phone Fallback

**File:** `src/frontend/src/app/report/tracking/page.tsx`

**Two changes:**

**1. 911 boundary — ALL statuses (lines ~326-335):**
Current: only `REJECTED_*` statuses show 911 block.
Target: PENDING/UNDER_REVIEW/LINKED → prominent red; ACTIONED → muted lower-key; REJECTED_* → keep as-is.

**2. Station phone 911 fallback label (lines ~310-321):**
Current: always "Nearest BFP Station" label.
Target: If `nearest_station_phone === '911'` → label "Emergency Number" with secondary treatment.

See full target JSX in `system-wiki/plans/civilian-reporting-phase2-slice-7-gap2-gap5-tracking-911.md` lines 45-137.

### Slice 8 — Context GPS Challenge Prompts

**Files:** `src/frontend/src/app/report/page.tsx` + new `src/frontend/src/app/report/GpsChallengeModal.tsx`

**Three changes:**

1. Add `gpsSource` state: `'acquired' | 'manual' | null`
2. Set `gpsSource='acquired'` in `requestGps` success callback (around line ~281-286)
3. Set `gpsSource='manual'` in `handlePinChange` when user places pin manually
4. In context step Continue onClick: if `reportingContext === 'SECONDHAND' && gpsSource === 'acquired'` → open `GpsChallengeModal`; else `tryAdvanceFromContext()`
5. Show NEARBY non-blocking reminder when `reportingContext === 'NEARBY' && gpsSource === 'acquired'`
6. Create `GpsChallengeModal.tsx` with "Is this current location where the fire is?" confirm/deny

See full spec in `system-wiki/plans/civilian-reporting-phase2-slice-8-gap4-context-gps-challenge.md`.

### Slice 9 — GPS-Denied/Timeout 911 Persistent Boundary

**File:** `src/frontend/src/app/report/page.tsx` (lines ~714-725)

**Change:** GPS-denied panel (when `phoneGeoStatus.denied || phoneGeoStatus.timedOut`) gains bilingual 911 reminder when `isLifeSafety === true` only.

Target: wrap existing "Try again" button in a fragment with a conditional 911 block above it for life-safety path. See `system-wiki/plans/civilian-reporting-phase2-slice-9-gap7-gps-denied-911.md`.

---

## Verification After All Slices

```bash
cd src/frontend && npm run lint
cd src/frontend && npx vitest run
```

All 20 test files / 130 tests must pass. No new test files needed.

---

## Key File References

| File | Relevant for |
|---|---|
| `src/frontend/src/app/report/page.tsx` | Slices 5, 6, 8, 9 |
| `src/frontend/src/app/report/tracking/page.tsx` | Slice 7 |
| `src/frontend/src/app/report/GpsChallengeModal.tsx` | Slice 8 (new) |
| `system-wiki/plans/civilian-reporting-phase2-slice-{5,6,7,8,9}*.md` | Spec reference |

---

## Skills to Load

- `wims-bfp` — project context
- `tdd` — red-green-refactor if writing tests