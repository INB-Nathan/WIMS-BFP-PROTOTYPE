---
title: "Public Report Nearby Fire Activity Map Placement + Geolocation Semantics"
created: 2026-06-17
type: implementation-spec
tags: [wims-bfp, civilian-reporting, public-report, map, geolocation, privacy, frontend]
status: proposed
sources:
  - system-wiki/prd/civilian-reporting-phase-2.md
  - system-wiki/subsystems/civilian-reporting-phase2.md
  - system-wiki/raw/frs/frs-publicanonymousincidentsubmission.md
  - system-wiki/raw/frs/frs-complianceanddataprivacy.md
  - src/frontend/src/app/page.tsx
  - src/frontend/src/components/PublicFireMap.tsx
  - src/frontend/src/components/PublicFireMapInner.tsx
  - src/frontend/src/components/NearbyPublicReportAreas.tsx
  - src/backend/api/routes/map.py
  - src/backend/api/routes/civilian.py
review-gate: frontiercode-review
---

# Public Report Nearby Fire Activity Map Placement + Geolocation Semantics

## Decision

Implement the public report map fix as a **privacy-first, display-only situational-awareness map** in the Safety step.

The refined path is:

1. Show **Nearby fire activity / Mga kalapit na sunog** only in the Safety step.
2. Remove the visible **Public Fire Report Areas** card from Context/Category/Details/Review.
3. Keep the existing `PublicFireMap` / `fetchClusters()` data path for Nearby Fire Activity.
4. Borrow only the useful UX behavior from `NearbyPublicReportAreas`: explicit locate action, user-location anchor, fallback/status copy, and polished marker treatment.
5. Do **not** let Safety-step geolocation mutate submitted incident/fire location, `geo`, `fireLocation`, `gpsSource`, or submitted `phoneGeo` metadata.
6. Label the data honestly: public map clusters are anonymous citizen report activity awaiting review, not BFP-confirmed incidents.

## Why this path

### Security / privacy basis

- FRS M10 requires data minimization, purpose limitation, DPIA/RoPA, and erasure support.
- `phone_latitude` / `phone_longitude` are submitted report metadata and are treated as removable PII in privacy anonymization.
- Public map endpoints are unauthenticated and use public, credentialless reads; Safety map geolocation must not create a hidden write-side data collection path.
- Public map clusters are area-level aggregates. The UI must not imply the points are confirmed BFP incidents.

### Product / HCI basis

- Civilian reporting is safety-first. The first step should reduce cognitive load, not add extra cards in every later step.
- Location semantics must be least-surprise:
  - **user location** = where the reporter/device is;
  - **incident/fire location** = where the fire is;
  - **activity map anchor** = where the map should look for nearby public activity.
- The Safety map is situational awareness only. The Context/location flow remains responsible for collecting the incident/fire location.
- Geolocation should be user-initiated through a visible locate button. Do not auto-prompt on page load.

## Current state to fix

### `src/frontend/src/app/page.tsx`

- `NearbyPublicReportAreas` is imported and rendered when `step !== 'safety'`, creating the unwanted visible card in later steps.
- The Safety step renders `PublicFireMap` with heading **Nearby fire activity / Mga kalapit na sunog**.
- The Safety map passes `onGeolocationAvailable` and calls `handlePinChange()` when `geo.latitude === null`.
- `handlePinChange()` sets the submitted incident/fire location state (`geo`, `fireLocation`) and marks `gpsSource='manual'`. This is incorrect for Safety-step situational awareness.
- `phoneGeo` is submitted in the final payload and participates in GPS mismatch calculations. It must not be used as a generic Safety map display state.

### `src/frontend/src/components/PublicFireMapInner.tsx`

- `MapContainer center={center}` is initial-only; changing center later does not recenter the Leaflet map.
- Geolocation currently only sets a pin in `selectionMode`; the Safety map uses `selectionMode={false}`, so location may not visibly anchor the map.
- Marker icons use remote Leaflet assets and default pin styling.

### `src/backend/api/routes/map.py`

- `/api/public/clusters` returns anonymous citizen report clusters from `wims.citizen_reports`, excluding rejected/actioned rows.
- Backend privacy contract says these are public signal records, **not BFP-confirmed incidents**, and returns aggregates only.

## Required user-facing behavior

### Safety step

Show exactly one compact map block:

- Title: `Nearby fire activity / Mga kalapit na sunog`
- Required subcopy: `Based on nearby public reports awaiting review. Not yet confirmed by BFP.`
- Map: `PublicFireMap`, height around 200px, zoom around 11.
- Locate control: explicit button, e.g. `Use my location / Gamitin ang lokasyon ko` or existing locate icon with accessible label.
- On successful locate:
  - show a visually distinct **user location** marker;
  - recenter nearby activity around the user's location;
  - refetch visible public clusters for the new viewport;
  - do not change incident/fire location state;
  - do not populate submitted `phoneGeo` solely from this action.
- On denied/unavailable/timed-out location:
  - keep national/default map fallback;
  - show concise non-blocking copy that location is only used to center this activity map;
  - do not block Continue.

### Non-Safety steps

- Do not render `NearbyPublicReportAreas` or any visible card titled **Public Fire Report Areas**.
- Do not render **Nearby fire activity / Mga kalapit na sunog** outside Safety.
- Context step remains responsible for incident/fire location selection and GPS mismatch checks.

## Implementation spec

### A. Remove separate Public Fire Report Areas surface

File: `src/frontend/src/app/page.tsx`

- Remove the `NearbyPublicReportAreas` import if no longer used.
- Remove the `step !== 'safety'` render block for `<NearbyPublicReportAreas ... />`.
- Do not delete `NearbyPublicReportAreas` components unless a full import search confirms they are unused and tests/docs are updated accordingly.

### B. Make Safety map geolocation display-only

Preferred implementation: keep display-only geolocation inside `PublicFireMap`/`PublicFireMapInner` so the public page does not need `activityAnchor` state at all.

- Remove Safety-step `onGeolocationAvailable` callback from `page.tsx`.
- Do not call `handlePinChange()` from Safety.
- Do not call `requestGps('phone-only')` from Safety.
- Do not set `phoneGeo`, `phoneGeoStatus`, `geo`, `fireLocation`, or `gpsSource` from Safety map locate.

If parent state is needed later, introduce a separate state name such as `activityMapAnchor`, but keep it transient and exclude it from submit payload.

### C. Recenter and user-marker support in `PublicFireMapInner`

Files:

- `src/frontend/src/components/PublicFireMap.tsx`
- `src/frontend/src/components/PublicFireMapInner.tsx`

Add behavior:

- Introduce internal state for display-only user location, e.g. `userLocation: [number, number] | null`.
- On locate success in non-selection mode:
  - set `userLocation`;
  - set an internal map view target;
  - recenter using a small component based on `useMap()` and `map.setView()` or `map.flyTo()`.
- Add a `MapRecenter` component that watches center/zoom and avoids setView loops by comparing previous target coordinates.
- Ensure `moveend`/viewport handling still refetches clusters after recenter.
- Keep `selectionMode` semantics intact: selection mode may still use geolocation to select a report pin, but the Safety map must not use selection mode.

Privacy refinement:

- Keep exact GPS coordinates client-side for the user marker only.
- Consider rounding/blurring the map-query center before triggering backend cluster fetches if feasible without harming UX. The endpoint receives viewport bounds, so avoid any extra exact-coordinate API parameter.
- Do not show exact coordinates in the user marker popup.

### D. Marker visuals

Create or reuse a small helper, e.g.:

- `src/frontend/src/components/map/leafletIcons.ts`

Use local/div markers instead of remote default pin URLs where practical:

- User location marker: blue/cyan dot, white center, subtle ring/pulse.
- Incident/fire pin marker: BFP maroon/red pin for actual incident selection contexts.
- Activity clusters: existing severity circles can remain; do not over-style clusters in this change.

Implementation notes:

- If using `L.divIcon()`, avoid relying on Tailwind classes inside raw HTML unless they are guaranteed to be included in the build. Prefer inline styles or stable CSS classes.
- Keep markers accessible through labels/popups/tooltips where supported.
- Do not convert every dashboard map in this scope; focus on public report maps touched by this UX issue.

### E. Copy and semantic guardrails

Required copy near Safety map:

```text
Nearby fire activity / Mga kalapit na sunog
Based on nearby public reports awaiting review. Not yet confirmed by BFP.
```

Avoid these phrases for public clusters:

- `confirmed incidents`
- `BFP-confirmed fire`
- `verified fire activity`
- anything that suggests public clusters are official operational incidents

Allowed phrasing:

- `public reports`
- `reported activity`
- `awaiting review`
- `nearby report activity`

### F. Tests

Use FrontierCode-style test expectations: tests should fail on the old behavior where feasible and assert user-visible or state-boundary outcomes.

Focused test targets:

1. `src/frontend/src/components/__tests__/PublicFireMapInner.test.tsx`
   - geolocation button in non-selection mode renders a user marker after success;
   - recenter helper calls `setView`/`flyTo` when center/view target changes;
   - cluster fetch is still driven by viewport bounds after map movement;
   - geolocation failure shows non-blocking fallback/status if implemented.

2. Public page / Safety map behavior
   - preferred: extract a small testable component for the Safety map block, then test:
     - title/subcopy render;
     - locate callback does not receive or call report-pin mutation props;
     - no `NearbyPublicReportAreas` render in non-Safety steps.
   - if full page testing is too heavy, use the closest practical regression test and document why in the PR body.

3. Existing `NearbyPublicReportAreas` tests
   - keep them if the component remains in the codebase;
   - delete or update them only if the component is removed after confirming zero imports.

Validation commands:

```bash
cd src/frontend && npx vitest run src/frontend/src/components/__tests__/PublicFireMapInner.test.tsx
cd src/frontend && npx eslint src/app/page.tsx src/components/PublicFireMap.tsx src/components/PublicFireMapInner.tsx
/usr/bin/git diff --check
```

Run `npm run build` if dynamic Leaflet imports, CSS, or map helper exports change in a way that lint/tests may not cover.

## Acceptance criteria

- [ ] **Nearby fire activity / Mga kalapit na sunog** renders only in the Safety step.
- [ ] No separate **Public Fire Report Areas** card renders in Context, Category, Details, or Review.
- [ ] Safety map locate action centers the map around the user and shows a user-location marker.
- [ ] Safety map geolocation does not call `handlePinChange()`.
- [ ] Safety map geolocation does not mutate `geo`, `fireLocation`, `gpsSource`, or submitted `phoneGeo` solely because the user centered the activity map.
- [ ] Nearby activity copy clearly says public reports are awaiting review and not yet confirmed by BFP.
- [ ] Public map continues to use credentialless public reads; no auth tokens or credentials are sent.
- [ ] Marker visuals are improved for public user/incident markers without relying on remote default Leaflet marker URLs where practical.
- [ ] Focused frontend tests pass.
- [ ] `git diff --check` passes.
- [ ] `system-wiki/log.md` is updated. No FRS gap register update unless gap status changes.

## Non-goals

- Do not change backend clustering logic or status inclusion rules.
- Do not turn public citizen clusters into official incident markers.
- Do not redesign the whole civilian report step order in this change.
- Do not add automatic geolocation prompting on page load.
- Do not add media upload, identity verification, phone OTP, or new public write endpoints.
- Do not delete `NearbyPublicReportAreas` unless zero usages and tests/docs are updated.

## FrontierCode review plan

Before PR merge, run the same review philosophy as `frontiercode-review`:

| Axis | What must be checked |
|---|---|
| Standards | Minimal, idiomatic React/Leaflet changes; no broad refactor; clear naming between user/activity/incident locations. |
| Spec | Every hunk traces to this spec or existing civilian reporting PRD; no step-order or backend scope creep. |
| Quality | No hidden incident-location mutation; no PII over-collection; map recenters reliably; public cluster wording is truthful. |
| Test quality | Tests assert behavior, not implementation trivia; reverse-classical check where feasible. |
| Cleanliness | ESLint/vitest/diff-check clean; no console/debug artifacts; no orphaned imports after removing `NearbyPublicReportAreas` from page. |

Human reviewer should especially verify the privacy boundary:

> Safety map geolocation is situational awareness only. Submitted incident/fire location remains collected later through the explicit report-location flow.
