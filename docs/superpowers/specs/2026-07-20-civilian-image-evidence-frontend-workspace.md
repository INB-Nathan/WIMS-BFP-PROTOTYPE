# Civilian Image Evidence — Frontend Workspace Execution Specification

**Date:** 2026-07-20

**Status:** Approved decomposition of the canonical design

**Canonical behavioral contract:**
`docs/superpowers/specs/2026-07-20-civilian-image-evidence-workspace-design.md`

This document translates the canonical behavior into frontend route, component,
state, accessibility, and browser-storage work. It does not redefine backend or
product contracts.

## 1. Scope

This execution specification owns:

- the cluster-level validator route;
- queue-to-workspace navigation and return-state preservation;
- report navigation, sanitized image gallery, evidence map, credibility summary,
  feedback timeline, and action-panel parity;
- anonymous reporter identity UX;
- authenticated reporter profile-derived UX;
- encrypted browser persistence for anonymous reporter PII;
- frontend tests, accessibility, loading, error, and responsive behavior.

It does not own server authorization, database migrations, image decryption,
GeoIP lookup, deployment operations, or wiki synchronization.

## 2. Route and state architecture

### 2.1 Route

Create the App Router workspace:

```text
/incidents/triage/[clusterId]
```

Queue `Inspect / Act` controls navigate to this route instead of opening the modal.
The return target preserves active queue filters and selected item through explicit
URL/search state rather than hidden global state.

A direct load or browser refresh reconstructs the workspace from `clusterId` and
server data. Invalid, inaccessible, closed/merged, and missing clusters use
recoverable neutral states consistent with backend disclosure rules.

### 2.2 State ownership

The workspace route owns:

- cluster workspace query state;
- selected report ID;
- freshness/stale-data state;
- active action tab;
- claim/activity heartbeat lifecycle;
- pending destructive-confirmation state;
- return-to-queue query state.

Existing triage action hooks/components should be adapted rather than duplicated.
Modal-only concerns—backdrop click, body lock, overlay sizing, modal Escape close—do
not move into the route state.

Background refresh must not overwrite in-progress forms. If remote data changes
during an action, show a refresh-needed notice and let the validator resolve it
after cancel/commit.

## 3. Page information architecture

### 3.1 Sticky cluster header

Shows:

- cluster identity;
- severity;
- life-safety, aging, and timeout-risk indicators;
- claim owner and claim age/countdown;
- last-updated/freshness state;
- refresh action;
- return-to-queue action.

No terminal/correction/split/merge commit shortcut is introduced.

### 3.2 Report navigator

Each report item shows:

- report ID and status;
- trust score;
- authenticated/anonymous source type;
- photo count;
- GPS mismatch and duplicate-device derived signals;
- update/follow-up count;
- selected state.

Selecting a report updates the evidence panes without a route transition.
Selection must be keyboard accessible and must not rely on color alone.

### 3.3 Evidence gallery

The gallery renders sanitized images only through backend-owned content URLs.
Required states:

- loading;
- loaded;
- no images;
- unavailable/missing;
- corrupt/decryption failure;
- authorization loss;
- partial failure when one image fails but others remain available.

Displayed safe metadata is limited to the canonical contract. Browser code never
receives original paths, original filenames, ciphertext, unrestricted EXIF, or
crypto metadata. Image/content responses are not placed in service-worker,
IndexedDB, localStorage, or application offline caches.

### 3.4 Location comparison map

Render distinct, labeled markers for each available source:

- report pin;
- device GPS;
- image EXIF GPS;
- coarse IP-city centroid.

The IP centroid includes the server-provided accuracy circle. Distance lines and
plain-language classifications are rendered from server-provided evidence rather
than recomputing authoritative spatial results in JavaScript.

Requirements:

- legend identifies marker shape, label, and source;
- missing sources remain visible as unavailable evidence rows;
- mismatch/availability state does not rely on color alone;
- text explicitly states that IP location is approximate;
- no UI recommends rejection or terminal action from a mismatch;
- map components follow the repository's SSR-safe dynamic-import pattern;
- invalid/missing coordinates do not crash or hide the report.

### 3.5 Contributor credibility

The compact summary shows only the approved projection:

- authenticated/anonymous source;
- reliability score/badge when available;
- prior outcome summary;
- evidence-quality component;
- account activity summary.

Expandable details use the existing validator contributor boundary or the new
workspace projection. Anonymous reports show non-identifying signals only.

Reporter contact is not prefetched. An explicit `Reveal contact` interaction calls
the audited POST endpoint, communicates that the action is logged, and keeps the
revealed value out of persistent browser storage and diagnostic logs.

### 3.6 Review and feedback

Reuse existing components and safeguards for:

- Terminal;
- Correction;
- Split;
- Merge;
- Activity;
- Send Update;
- citizen-message preview;
- two-step destructive confirmation.

The report detail includes narrative, category, reported/received times, safety
status, previous-report reference, follow-ups, validator-visible activity, and the
civilian-visible feedback timeline.

## 4. Civilian reporter identity UX

### 4.1 Anonymous reports

Normal reports require reporter name and phone before review/submit. Life-safety
reports require reporter name but allow the phone to be omitted.

Reporter fields must be labeled as the submitter's details. Existing eyewitness
fields must remain separately labeled as direct-eyewitness details, especially for
`SECONDHAND` reporting. The UI must not silently copy reporter values into witness
fields.

Validation errors retain the established emergency boundary and explain the
specific missing reporter field.

### 4.2 Authenticated reports

Authenticated `CIVILIAN_REPORTER` sessions do not render duplicate reporter
name/phone inputs. The wizard shows concise text that the account profile will be
used. It does not trust browser-supplied identity values.

When the backend reports incomplete profile data:

- normal report: show a profile-completion action and preserve the draft;
- life-safety report with only phone missing: allow submit according to the
  canonical contract;
- never display or log sensitive profile values merely to prove prefill.

## 5. Browser privacy and offline identity

The current public offline operation payload is plaintext and was designed under a
no-PII assumption. Required reporter identity invalidates that assumption.

### 5.1 Online drafts

Reporter PII remains in component memory while online. It must not be written to the
existing plaintext localStorage draft. Non-sensitive draft fields may continue
using the established draft mechanism.

### 5.2 Offline queue

When an anonymous report is queued offline:

1. construct a reporter-identity snapshot separate from the non-sensitive report
   operation payload;
2. encrypt it with the existing device-bound, non-extractable Web Crypto pattern;
3. use a purpose-specific, versioned AAD distinct from photo encryption;
4. store only ciphertext, IV, version, and association identifiers in IndexedDB;
5. replay by decrypting only when the report is ready to submit;
6. clear the sensitive envelope after successful sync according to the established
   queue cleanup contract.

The design must preserve per-device/account isolation and ordered/idempotent replay.
No service worker may replay authenticated mutations or cache revealed validator
PII.

### 5.3 Key loss and failure

If the non-extractable key is missing or decryption fails:

- mark the identity envelope permanently unreadable;
- do not submit a report without required identity;
- do not fall back to plaintext;
- preserve non-sensitive report details where safe;
- ask the user to re-enter reporter identity and retry.

## 6. Modal retirement strategy

The existing modal remains available until the dedicated page reaches parity for:

- claim/activity lifecycle;
- terminal, correction, split, merge, and update actions;
- destructive confirmation;
- citizen-message preview;
- activity history;
- selection behavior and keyboard safety.

After parity tests pass, queue inspection navigates exclusively to the route and
modal-only shell/state/CSS is removed. Shared action components remain.

This is a migration, not a parallel permanent workflow.

## 7. Accessibility and HCI invariants

- All report selection, tabs, image controls, map alternatives, credibility
  expansion, contact reveal, and action controls are keyboard reachable.
- Focus moves to a meaningful page heading on navigation and to confirmation
  headings when dialogs open.
- Marker meaning is available in text outside the map.
- Status and mismatch state use text/icon/border in addition to color.
- Images have evidence-oriented alt text that does not invent visual content.
- Loading/error changes use appropriate live-region behavior without excessive
  announcements.
- Reduced-motion preferences are respected.
- Destructive actions remain deliberate clicks with two-step confirmation.
- Existing navigation shortcuts may be preserved; commit shortcuts remain
  prohibited.
- Layout remains usable at the repository's supported mobile/tablet/desktop
  breakpoints, while the full validator workflow remains optimized for staff
  desktop use.

## 8. Frontend validation checklist

### Route and state

- queue action navigates to the cluster workspace;
- active filters and selected item survive return navigation;
- direct load and refresh reconstruct state;
- report selection updates evidence without navigation;
- stale refresh does not overwrite action forms;
- inaccessible/missing/merged clusters show safe recoverable states.

### Evidence

- gallery covers loaded, empty, partial, missing, corrupt, and denied states;
- only sanitized content URLs are used;
- image and contact responses are absent from offline caches;
- four source markers, accuracy circle, legend, distances, and unavailable states
  render correctly;
- no mismatch-driven terminal recommendation appears.

### Identity and offline

- anonymous normal report requires name/phone;
- anonymous life-safety report requires name and permits missing phone;
- reporter and eyewitness controls are distinct;
- authenticated reporter inputs are absent;
- incomplete-profile handling preserves safety behavior;
- localStorage draft contains no reporter PII;
- IndexedDB operation payload contains no plaintext reporter PII;
- encrypted envelope replay, cleanup, key loss, and re-entry work.

### Existing action parity

- claim/activity heartbeat;
- terminal/correction/split/merge/update behavior;
- citizen-message preview;
- destructive confirmation;
- activity timeline;
- no commit keyboard shortcuts.

### Minimum implementation gates

From `src/frontend/`:

```bash
npm run lint
npx vitest run src/app/report/__tests__/page.test.tsx src/app/incidents/triage/page.test.tsx src/components/civilian/PhotoUpload.test.tsx
npm run build
```

Append every new focused workspace, identity, map, evidence-gallery, and contact-
reveal test file to this baseline command during implementation.

Run focused offline-store/sync tests whenever IndexedDB schema, encryption,
replay, cleanup, or account/device isolation changes. Before push or PR, follow the
full frontend gate in `.github/workflows/ci.yml` and
`docs/agents/ci-preflight.md`.

## 9. Stop conditions

Implementation must pause for a product/security decision if the frontend would
need to:

- display originals or unrestricted EXIF;
- persist reporter/contact PII in plaintext;
- expose raw IPs or device IDs;
- compute an authoritative spatial verdict client-side;
- introduce an automatic terminal recommendation;
- remove an existing destructive-action safeguard;
- cache validator evidence or contact data offline.
