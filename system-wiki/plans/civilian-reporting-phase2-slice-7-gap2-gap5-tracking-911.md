---
title: "Phase 2 Slice 7: Gap 2 + Gap 5 — Tracking 911 ALL Statuses + Station Phone Fallback Label"
created: 2026-05-22
type: issue
tags: [wims-bfp, civilian-reporting, phase-2, gap-2, gap-5]
status: open
phase: 1
gaps: [2, 5]
parent: civilian-reporting-phase-2-implementation-issues
---

# Phase 2 Slice 7: Tracking — 911 ALL Statuses + Station Phone Fallback Label

**Type:** AFK — frontend-only
**File:** `src/frontend/src/app/report/tracking/page.tsx`

## Gap 2: Tracking Page 911 ALL Statuses

### Current State
Lines 326-335 in `tracking/page.tsx`:
```tsx
{/* 911 guidance for rejected / timeout */}
{status?.startsWith('REJECTED_') && (
  <div className="flex items-start gap-2 p-3 rounded-lg border border-red-200 bg-red-50">
    <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-600" />
    <div>
      <p className="text-sm font-semibold text-red-700">For urgent emergencies, call 911.</p>
      <p className="text-xs text-red-600 mt-0.5">Kung kailangan mo ng agarang tulong, tumawag sa 911.</p>
    </div>
  </div>
)}
```
911 guidance only shown for `REJECTED_*` statuses. PENDING / UNDER_REVIEW / LINKED / ACTIONED users see no 911 guidance.

### Required Change
911 emergency boundary must show for **ALL statuses**:
- **PENDING, UNDER_REVIEW, LINKED** → prominent display (full red/amber treatment)
- **ACTIONED** → lower/softer display (muted, smaller, below station info)
- **REJECTED_*** → already prominent, keep as-is

Prominence differentiation: waiting/uncertain statuses need the 911 boundary visually prominent. ACTIONED status has been resolved so the 911 guidance can be lower-key — but it must still appear.

### Target (inside the main status display block, after station info)

```tsx
{/* 911 boundary — ALL statuses, prominence varies */}
{(status === 'PENDING' || status === 'UNDER_REVIEW' || status === 'LINKED') && (
  <div className="flex items-start gap-2 p-3 rounded-lg border border-red-200 bg-red-50">
    <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-600" />
    <div>
      <p className="text-sm font-semibold text-red-700">For urgent emergencies, call 911.</p>
      <p className="text-xs text-red-600 mt-0.5">Kung kailangan mo ng agarang tulong, tumawag sa 911.</p>
      <p className="text-xs text-red-600 mt-1">
        This report helps BFP review signals — it does not replace an emergency call.
      </p>
      <p className="text-xs text-red-600 mt-0.5">
        Ang report na ito ay tumutulong sa BFP na suriin ang mga signal — hindi ito kapalit ng agarang tawag sa 911.
      </p>
    </div>
  </div>
)}

{status === 'ACTIONED' && (
  <div className="flex items-start gap-2 p-2 rounded-lg" style={{ backgroundColor: 'var(--content-bg)', border: '1px solid var(--border-color)' }}>
    <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--text-secondary)' }} />
    <div>
      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
        For immediate danger, call 911. Ang report na ito ay hindi kapalit ng agarang tawag sa 911.
      </p>
    </div>
  </div>
)}
```

---

## Gap 5: Station Phone Fallback Label — Semantic Distinction for 911

### Current State
Lines 310-321 in `tracking/page.tsx`:
```tsx
<p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Nearest BFP Station</p>
<p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{data.nearest_station_name}</p>
{data.nearest_station_phone && (
  <a href={`tel:${data.nearest_station_phone}`} ...>
    <PhoneCall className="w-3.5 h-3.5" />
    {data.nearest_station_phone}
  </a>
)}
```
Always shows "Nearest BFP Station" label. When the backend falls back to `nearest_station_phone = '911'` (as per `36_ref_fire_stations_phone_null.sql`), the UI labels it as a station and presents it as the primary follow-up number.

### Required Change
When `nearest_station_phone === '911'`, the label and semantics must change:
- Label: "Emergency Number" (not "Nearest BFP Station")
- Phone: click-to-call `tel:911` link
- Treatment: secondary to the 911 boundary, not a station follow-up

### Target
```tsx
{data.nearest_station_phone === '911' ? (
  <div className="flex items-start gap-3 p-3 rounded-lg border" style={{ borderColor: 'var(--border-color)' }}>
    <PhoneCall className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--text-secondary)' }} />
    <div>
      <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Emergency Number</p>
      <a
        href="tel:911"
        className="text-sm font-medium mt-1 inline-flex items-center gap-1"
        style={{ color: 'var(--bfp-red, #dc2626)' }}
      >
        <PhoneCall className="w-3.5 h-3.5" />
        911
      </a>
      <p className="text-xs" style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
        For follow-up, contact your nearest BFP station. For immediate danger, call 911.
      </p>
    </div>
  </div>
) : (
  <div className="flex items-start gap-3 p-3 rounded-lg border" style={{ borderColor: 'var(--border-color)' }}>
    <PhoneCall className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--bfp-red, #dc2626)' }} />
    <div>
      <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Nearest BFP Station</p>
      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{data.nearest_station_name}</p>
      {data.nearest_station_phone && (
        <a
          href={`tel:${data.nearest_station_phone}`}
          className="text-sm font-medium mt-1 inline-flex items-center gap-1"
          style={{ color: 'var(--bfp-red, #dc2626)' }}
        >
          <PhoneCall className="w-3.5 h-3.5" />
          {data.nearest_station_phone}
        </a>
      )}
    </div>
  </div>
)}
```

---

## Acceptance Criteria

- [ ] PENDING status shows prominent 911 emergency boundary
- [ ] UNDER_REVIEW status shows prominent 911 emergency boundary
- [ ] LINKED status shows prominent 911 emergency boundary
- [ ] ACTIONED status shows lower/softer 911 emergency boundary
- [ ] REJECTED_* statuses keep existing prominent treatment
- [ ] All 911 boundaries include "does not replace emergency call" in EN+FIL
- [ ] When `nearest_station_phone === '911'`: label shows "Emergency Number" (not "Nearest BFP Station")
- [ ] When `nearest_station_phone === '911'`: secondary treatment (below the 911 boundary)
- [ ] When `nearest_station_phone !== '911'`: existing "Nearest BFP Station" label preserved

## File to Modify

- `src/frontend/src/app/report/tracking/page.tsx`
  - 911 boundary: change `REJECTED_*` only condition to all statuses with prominence differentiation
  - Station phone: add conditional rendering for `nearest_station_phone === '911'` case