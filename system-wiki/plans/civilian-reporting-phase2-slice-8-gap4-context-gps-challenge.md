---
title: "Phase 2 Slice 8: Gap 4 — Context GPS Challenge Prompts"
created: 2026-05-22
type: issue
tags: [wims-bfp, civilian-reporting, phase-2, gap-4]
status: open
phase: 1
gaps: [4]
parent: civilian-reporting-phase-2-implementation-issues
---

# Phase 2 Slice 8: Context Step — GPS / Reporting Context Challenge Prompts

**Type:** AFK — frontend-only
**File:** `src/frontend/src/app/report/page.tsx`

## Current State

`tryAdvanceFromContext()` (lines ~355-370) and `canProceedFromContext()` check GPS distance mismatch for NEARBY/SECONDHAND, but the code does not track **whether GPS was user-acquired vs manually placed**, and does not implement the two required challenge prompts:

1. If `SECONDHAND` selected after current GPS was acquired → "Is this current location where the fire is?" confirmation
2. If `NEARBY` selected after current GPS was acquired → non-blocking reminder to place pin on fire

## Required Behavior

### GPS Source Tracking

Add state to track how the location was set:
```tsx
type GpsSource = 'acquired' | 'manual' | null;
const [gpsSource, setGpsSource] = useState<GpsSource>(null);
```

- `setGpsSource('acquired')` when GPS succeeds (`requestGps` success callback)
- `setGpsSource('manual')` when user manually places pin (`onChange` callback in `MapPicker`)
- Reset `gpsSource` to `null` when `geo.latitude` is cleared

### Challenge 1: SECONDHAND after GPS-Acquired Location → Confirmation Modal

When user selects `SECONDHAND` AND `gpsSource === 'acquired'`:
- Show modal: "Is this current location where the fire is?"
- "Yes" → keep current GPS coordinates, proceed to category
- "No" → clear pin, reset `gpsSource` to `null`, prompt manual pin placement

This prevents users who acquired GPS as their location but then select `SECONDHAND` (they are a witness reporting second-hand info) from having the GPS pin used as the fire location.

### Challenge 2: NEARBY after GPS-Acquired Location → Non-Blocking Reminder

When user selects `NEARBY` AND `gpsSource === 'acquired'`:
- Show non-blocking reminder above the Continue button:
  "If the fire is not exactly where you are, place the pin on the fire instead. / Kung ang sunog ay wala sa iyong kasalukuyang lokasyon, ilagay ang pin sa lokasyon ng sunog."
- "Continue" remains available (no blocking modal)
- Reminder dismisses on selection of NEXT context (not on NEARBY re-click)

### Implementation

Add to context step JSX (inside the `{step === 'context' && (` block)):

```tsx
{/* SECONDHAND challenge modal */}
{gpsChallengeOpen && (
  <GpsChallengeModal
    onConfirm={() => {
      setGpsChallengeOpen(false);
      tryAdvanceFromContext();
    }}
    onDeny={() => {
      setGpsChallengeOpen(false);
      // Return to location step for manual pin placement
      setGeo({ latitude: null, longitude: null });
      setGpsSource(null);
    }}
  />
)}

{/* NEARBY reminder — non-blocking, shows above Continue */}
{reportingContext === 'NEARBY' && gpsSource === 'acquired' && (
  <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 mb-2">
    <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-600" />
    <div>
      <p className="text-xs font-medium text-amber-800">
        If the fire is not exactly where you are, place the pin on the fire instead.
      </p>
      <p className="text-xs text-amber-600 mt-0.5">
        Kung ang sunog ay wala sa iyong kasalukuyang lokasyon, ilagay ang pin sa lokasyon ng sunog.
      </p>
    </div>
  </div>
)}
```

### New Modal: GpsChallengeModal

Create `src/frontend/src/app/report/GpsChallengeModal.tsx`:
- Title: "Is this current location where the fire is?" / "Ito ba ang kasalukuyang lokasyon ng sunog?"
- Sub-copy: "You selected 'I saw it / Aking nakita' but used current location. The pin will be set to your current location. Is that where the fire is?" / "Nakita mo ito ngunit ginamit ang iyong kasalukuyang lokasyon. Ang pin ay ilalagay sa iyong kasalukuyang lokasyon. doon ba ang sunog?"
- Two buttons: "Yes, use my location" + "No, I'll place the pin"
- No 911 copy needed (this is a location accuracy prompt, not emergency)

### State Additions

```tsx
const [gpsChallengeOpen, setGpsChallengeOpen] = useState(false);

// In requestGps success callback:
setGpsSource('acquired');

// In handlePinChange (manual pin placement):
setGpsSource('manual');

// In context step onClick handler:
if (reportingContext === 'SECONDHAND' && gpsSource === 'acquired') {
  setGpsChallengeOpen(true);
} else {
  tryAdvanceFromContext();
}
```

## Acceptance Criteria

- [ ] `gpsSource` tracks whether location was set via GPS acquisition vs manual pin placement
- [ ] Selecting `SECONDHAND` after GPS-acquired location triggers confirmation modal
- [ ] "Yes" in modal keeps GPS coordinates and proceeds
- [ ] "No" in modal clears pin and prompts manual placement
- [ ] Selecting `NEARBY` after GPS-acquired location shows non-blocking reminder
- [ ] NEARBY reminder does NOT block Continue
- [ ] NEARBY reminder shows bilingual copy (EN + FIL)
- [ ] `gpsSource` resets when pin is manually cleared/reset

## File to Modify

- `src/frontend/src/app/report/page.tsx` — state additions, context step logic, modal trigger
- `src/frontend/src/app/report/GpsChallengeModal.tsx` — new component (create)