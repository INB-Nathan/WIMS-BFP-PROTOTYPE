---
title: "Phase 2 Slice 9: Gap 7 — GPS-Denied/Timeout 911 Persistent Boundary"
created: 2026-05-22
type: issue
tags: [wims-bfp, civilian-reporting, phase-2, gap-7]
status: open
phase: 1
gaps: [7]
parent: civilian-reporting-phase-2-implementation-issues
---

# Phase 2 Slice 9: GPS-Denied/Timeout — 911 Persistent Boundary

**Type:** AFK — frontend-only
**File:** `src/frontend/src/app/report/page.tsx`

## Current State

Lines 714-724 in `page.tsx` (inside context step):
```tsx
{(phoneGeoStatus.denied || phoneGeoStatus.timedOut) && reportingContext !== 'WITNESS' && (
  <div className="flex items-center gap-2 mt-2">
    <button
      type="button"
      onClick={() => requestGps('phone-only')}
      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border"
      style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}
    >
      <Locate className="w-3.5 h-3.5" /> Try again / Subukan ulit
    </button>
  </div>
)}
```
When GPS is denied or times out on the context step, the panel shows only a "Try again" retry button with **no 911 call-to-action**, even when the user is on a life-safety path.

## Required Behavior

Per the log.md entry for this gap:
> "when GPS is denied or times out (lines 709-720), the location error panel shows only a 'Try again / Subukan ulit' retry button with no 911 call-to-action, even when the user is on a life-safety path. The panel must display a **bilingual 911 boundary reminder regardless of whether the user is on the life-safety path**. Per user direction, the fix is not a GPS-handler-specific change but rather ensuring the location/map selection screen honors the persistent 911 guidance boundary when on the life-safety path."

### When to Show

The 911 reminder should appear when **all three** of these are true:
1. `phoneGeoStatus.denied || phoneGeoStatus.timedOut`
2. `reportingContext !== 'WITNESS'` (WITNESS uses current GPS as their own location — no challenge needed)
3. `isLifeSafety === true` (only on life-safety path, per log.md)

### Design

For life-safety users who are denied GPS and unable to proceed: they need to be reminded that 911 is the primary action. The 911 reminder should not be intrusive for non-life-safety users (who can proceed with manual pin placement without emergency escalation).

### Target

Replace the GPS-denied panel section (lines 714-724):

```tsx
{(phoneGeoStatus.denied || phoneGeoStatus.timedOut) && reportingContext !== 'WITNESS' && (
  <>
    {/* 911 reminder — life-safety path only */}
    {isLifeSafety && (
      <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 mb-2">
        <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-600" />
        <div>
          <p className="text-xs font-semibold text-red-700">
            For immediate danger, call 911. Your report helps BFP — but for life-threatening situations, call emergency services first.
          </p>
          <p className="text-xs text-red-600 mt-0.5">
            Kung may agarang peligro, tumawag sa 911. Ang report mo ay tumutulong sa BFP — ngunit para sa mgaSitwasyong may banta sa buhay, tumawag muna sa emergency services.
          </p>
        </div>
      </div>
    )}

    {/* Retry button */}
    <div className="flex items-center gap-2 mt-1">
      <button
        type="button"
        onClick={() => requestGps('phone-only')}
        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border"
        style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}
      >
        <Locate className="w-3.5 h-3.5" /> Try again / Subukan ulit
      </button>
    </div>
  </>
)}
```

## Acceptance Criteria

- [ ] GPS-denied/timeout panel shows 911 bilingual reminder when `isLifeSafety === true`
- [ ] GPS-denied/timeout panel does NOT show 911 reminder for non-life-safety (no alarm fatigue)
- [ ] 911 reminder shows EN + FIL bilingual copy
- [ ] Retry "Try again" button still available for all users
- [ ] No change to WITNESS path (they need their own GPS — no GPS-denied block shown)

## File to Modify

- `src/frontend/src/app/report/page.tsx` — GPS-denied/timeout panel inside context step