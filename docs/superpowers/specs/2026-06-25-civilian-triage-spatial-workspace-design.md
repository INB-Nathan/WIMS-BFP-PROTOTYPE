# Civilian Triage Spatial Workspace Design

Date: 2026-06-25
Status: Draft pending user review
Owner: WIMS-BFP National Validator civilian triage workflow

## Problem

The civilian triage queue at `/incidents/triage` separates clustered reports from individual reports, but the main page remains table-first. Validators can inspect details in `TriageInspectionModal`, yet the queue does not make the spatial relationship between clusters, singleton reports, urgency, confidence, and nearby evidence visible enough before opening the modal.

Recent Operations Board work introduced a split map + panel console for active operations. The civilian triage queue needs a related but distinct experience: triage is not only a 70/30 map/table problem. Validators need a map-first canvas for spatial reasoning and an investigation board for evidence review while preserving the existing action safeguards.

## Goals

- Turn `/incidents/triage` into a map-first triage canvas paired with an investigation board.
- Let validators visualize clusters and individual reports before opening the inspection modal.
- Keep map exploration fluid: selecting a marker updates the board, but does not auto-open the modal.
- Preserve the current `TriageInspectionModal` as the primary inspection/action surface.
- Add net-new triage map surfaces for the page canvas and modal spatial panel.
- Restructure the modal by relocating the existing action-tab rail into the action column and adding a new spatial panel.
- Preserve existing terminal, correction, split, merge, preview, confirmation, audit, and keyboard-safety behavior.
- Reuse the current triage API/data shape for raw report data, while deriving cluster centroid/spread on the client unless backend fields prove necessary.

## Non-goals

- Do not deprecate or replace `TriageInspectionModal`.
- Do not move destructive terminal/correct/split/merge commits directly into the page-level board in this phase.
- Do not change backend triage mutation semantics.
- Do not add new backend endpoints unless the existing queue response lacks a required field.
- Do not redesign unrelated validator dashboard or operations-board pages.

## Recommended Approach

Use an evolutionary hybrid redesign.

The page-level triage queue becomes the exploration and decision workspace. The modal remains the focused inspection/action shell. This improves spatial understanding and evidence scanning while avoiding regressions in already-polished destructive action flows.

Rejected alternatives:

1. **Full triage console with inline action rail** — more ambitious, but higher regression risk because existing modal safeguards would need to be recreated on the page.
2. **Separate map route plus queue route** — lower disruption, but splits the validator workflow and weakens the spatial triage experience.

## Page Information Architecture

### Header / command bar

The top strip should keep queue state visible:

- page title: `Civilian Triage Queue`
- count summary: clusters, individual reports, life-safety items, timeout-risk items
- last polled timestamp
- refresh button
- current filter chips: life safety, timeout risk, aging, unreviewed
- optional density/view control if needed after implementation discovery

### Main workspace

Desktop/tablet layout:

```text
┌────────────────────────────────────────────────────────────┐
│ Header / filters / queue health                            │
├───────────────────────────────┬────────────────────────────┤
│ Map-first triage canvas        │ Investigation board        │
│                               │                            │
│ - cluster markers              │ - selected cluster/report  │
│ - singleton markers            │ - report evidence cards    │
│ - severity/urgency styling     │ - urgency/trust/station    │
│ - selected radius/spread       │ - Inspect / Act button     │
│ - legend                       │ - ranked nearby items      │
└───────────────────────────────┴────────────────────────────┘
```

Mobile layout:

```text
Header / filters
Map canvas
Investigation board
Ranked queue cards
```

### Selection flow

- Clicking a cluster or report marker selects that triage item.
- The investigation board updates inline.
- Marker selection does not auto-open the modal.
- The selected marker and matching board card must have unmistakable selected styling.
- Clicking `Inspect / Act` opens the enlarged `TriageInspectionModal`.
- Closing the modal returns to the same selected item on the page.
- If the selected item disappears after refresh, select the highest-priority remaining item and show a subtle notice.

### Queue fallback

The current cluster/singleton table behavior should not disappear completely. It should be transformed into one of these equivalent scan surfaces:

- ranked cards inside the investigation board, or
- a collapsible `Queue list` below the map/board.

The implementation should choose the smaller diff that preserves scanability and test coverage.

## Map Canvas Design

The map canvas is net-new for triage. It should follow the existing dynamic Leaflet import / SSR-guard pattern used by other map surfaces and should reuse `OperationsMap` implementation ideas where appropriate: `Circle`, `CircleMarker`, `Popup`, and `useMap`-based centering.

The map canvas should show both workflow types:

- clustered report groups, using derived count/radius/spread visual cues
- singleton reports, using distinct individual markers
- selected cluster radius or spatial spread
- severity and urgency through existing BFP palette-compatible styling
- marker affordances for life-safety and timeout-risk signals
- a compact legend explaining cluster marker, singleton marker, selected marker, suggested/related item if shown

Cluster geometry must be derived from member reports when backend aggregate geometry is absent:

- centroid: average latitude/longitude of valid member report coordinates
- spread/radius: maximum valid member distance from centroid, with a minimum visible radius for small clusters
- bounds: valid member coordinate bounds, used for optional fit-to-selection behavior

Reports with missing or invalid coordinates must remain visible in the board/list. They should not render map markers and should show a `No usable location` hint. Because `TriageReportEntry.latitude` and `longitude` are typed as non-null numbers, the implementation must still apply runtime coordinate guards for `null`, `undefined`, `NaN`, `0,0`, and coordinates outside the expected Philippines bounds.

Dense/overlapping markers should prioritize operational clarity:

- selected item renders above unselected items
- clustered reports render as a cluster circle/count before individual member markers
- singleton markers at nearly identical coordinates should be visually offset or spiderfied only at high zoom
- marker popups/board selection must identify the exact report or cluster without relying on hover precision

## Investigation Board Design

The board should support real triage work without replacing modal actions.

For the selected cluster/report, show:

- ID and type: cluster or individual report
- severity, life-safety, timeout-risk, aging, station, oldest report age
- member count, related count, average trust or primary trust score
- evidence cards for member reports or the selected singleton
- category/sub-category, reporting context, safety status, trust breakdown highlights
- follow-up/status context when available
- `Inspect / Act` primary action

The board may also show nearby/ranked items so validators can move through work without relying only on map clicks.

## Modal Design

`TriageInspectionModal` is retained and structurally refit. This is not a simple enlargement of an existing map; triage currently has no modal spatial panel. The work is to add a new spatial panel and relocate existing modal navigation/actions without changing destructive-action semantics.

### Shell

- Large overlay: approximately 90–95vw by 90vh on desktop.
- Use a bounded desktop size so ultrawide displays do not create unreadable line lengths; target max width around 1600px unless implementation testing suggests otherwise.
- Keep explicit close button.
- Preserve sticky maroon summary header.
- Use the larger header area for cluster/report ID, severity, life-safety, timeout-risk, member count, station, and oldest report age.

### Three-panel body

The existing modal body is already a grid, but its columns are currently action-tab rail, report evidence, and action panel. The target anatomy changes the meaning of the columns. The action-tab rail must move into the action column header or a compact action-column subnav, and a new spatial panel must be added.

Desktop anatomy:

```text
┌──────────────────────────────────────────────────────────────┐
│ Sticky summary header                                        │
├──────────────────┬────────────────────────┬─────────────────┤
│ Spatial panel     │ Report evidence panel  │ Action rail      │
│                  │                        │                 │
│ new map           │ selected cards         │ compact tabs     │
│ radius/spread     │ trust/signals          │ terminal         │
│ marker selection  │ followups/status       │ correct          │
│ nearby hints      │ terminal rows          │ split/merge      │
│                  │                        │ previews/confirm │
└──────────────────┴────────────────────────┴─────────────────┘
```

Initial desktop grid ratio should favor the map and evidence over the action rail, for example `40% / 35% / 25%` or `45% / 35% / 20%`. The implementation should verify this at 1366×768 and 1280×720 before settling the final CSS.

### Modal behavior

- Marker click highlights the matching report card.
- Report card click highlights the matching marker.
- Selection state persists while switching action tabs.
- Terminal, correction, split, and merge behavior remains functionally unchanged.
- Destructive actions still require two-step confirmation.
- No keyboard commit shortcuts are introduced.
- The modal map must initialize only after its container has non-zero dimensions, or call Leaflet `invalidateSize()` after the overlay is painted, to avoid gray/zero-size tiles.

### Singleton mode

Singletons use the same large shell but simplified content:

- spatial panel shows one marker/location summary instead of cluster radius
- evidence panel shows one primary report card plus follow-ups/related context
- action rail hides cluster-only split/merge affordances unless a relation workflow is applicable

## Data and Technical Constraints

### API reuse

Use existing `GET /api/triage/queue` response from `src/frontend/src/lib/api/legacy.ts`:

- `TriageQueueResponse.clusters`
- `TriageClusterEntry.cluster_id`
- `TriageClusterEntry.reports`
- report latitude/longitude
- severity, trust breakdown, station metadata
- aging/timeout flags
- report status and timestamps

No backend change is required for the raw report fields verified for this design. The implementation must first verify whether derived spatial metadata is sufficient. If centroid, spread/radius, bounds, or aggregate values become too expensive or ambiguous to compute client-side, add the smallest backend extension with tests instead of repeatedly deriving unstable values in multiple components.

### Frontend state model

The page should derive:

- `clusters`: entries where `cluster_id != null`
- `singletons`: entries where `cluster_id == null`
- `selectedTriageItem`: selected cluster or singleton
- `selectedReportId`: report highlighted inside the selected item
- `mapViewport`: current map center/zoom/bounds if needed

### State ownership

The page owns cross-surface state:

- `selectedTriageItemId`
- `selectedTriageItemType: 'cluster' | 'singleton'`
- `selectedReportId`
- `isInspectionModalOpen`
- `mapViewport` / current camera state
- active filters and raw queue payload

The modal receives the selected item, selected report, and callbacks. It may keep local action-form/tab state through the existing triage modal hook, but it should not create a second source of truth for page-level selection.

### Component boundaries

Likely component split:

- `TriagePage` — route shell, auth, loading, filters, queue fetch/reload, page-owned selection state
- `TriageCanvasMap` — net-new map markers, selected marker rendering, viewport events
- `TriageInvestigationBoard` — selected item details, evidence cards, `Inspect / Act`
- `TriageEvidenceCard` or equivalent shared evidence-card primitive — used by both page board and modal where practical
- `TriageQueueList` — ranked clusters/singletons fallback scan surface
- existing `TriageInspectionModal` — enlarged, with action-tab rail relocated and a new spatial panel added
- existing triage action panels/hooks — reused where possible

Components should remain presentational where practical. API calls should stay in the route/client layer, matching frontend agent guidance. The page board and modal should share evidence-card primitives instead of maintaining two parallel card implementations unless a concrete styling/behavior difference requires separation.

## Loading, Empty, Error, and Offline States

- Loading: map and board show neutral skeleton/placeholder states.
- Empty filters: explain active filters and provide a clear reset path.
- Missing coordinates: keep the item visible in board/list, omit marker, show `No usable location`.
- Refresh removes selected item: select the highest-priority remaining item and show a subtle notice, but keep the current map camera/viewport stable to avoid spatial disorientation.
- Refresh changes a selected item while the modal is open: keep the modal on a stable snapshot for the active action flow, then refresh the page board after close/reload unless implementation can safely hot-update without disrupting form state.
- API failure: preserve the last visible state when possible and show a recoverable error.
- Offline: do not add new mutation behavior. If no offline queue cache exists, show a friendly unavailable state consistent with existing offline-aware frontend patterns.

## Accessibility and HCI Requirements

- Selected marker/card state must not rely on color alone; use border, label, or icon changes.
- The modal close button remains explicit and reachable by keyboard.
- Existing `1`–`5` action-tab keyboard navigation policy is preserved.
- No terminal/correct/split/merge commit keyboard shortcuts are added.
- Action buttons must distinguish normal actions from destructive or terminal actions.
- The action rail must continue to show citizen-visible preview and audit/impact guidance before state-changing commits.

## Testing and Verification Strategy

Prioritized frontend behavior tests:

Page-level layout tests should be rewritten, not merely preserved, because the current tests assert table-specific contracts such as `clusters-table` and `singletons-table`. Modal action tests should be preserved or adapted narrowly because they cover behavior that must remain unchanged.

- `/incidents/triage` renders a map canvas and investigation board.
- Cluster and singleton data still split correctly from `queue.clusters`.
- Clicking a map marker updates the board without opening the modal.
- Clicking `Inspect / Act` opens `TriageInspectionModal`.
- Closing the modal preserves selected item on the page.
- Refresh while the modal is open does not disrupt active action form state.
- Refresh that removes the selected item keeps the map viewport stable and selects the next highest-priority item.
- Missing-coordinate reports remain visible in board/list but do not render markers.
- Overlapping singleton markers remain distinguishable by board selection/popup identity.
- Modal renders as a large overlay.
- Cluster modal mode shows three panels: spatial map, report evidence, action rail.
- Existing action-tab rail behavior is still reachable after relocation into the action column.
- Singleton modal mode hides cluster-only split/merge affordances when not applicable.
- Existing terminal/correct/split/merge confirmation behavior remains covered.
- Existing no-commit-keyboard-shortcut policy remains covered.
- React Leaflet is mocked or dynamically isolated in tests following existing map test patterns.

Verification commands for implementation:

```bash
cd src/frontend && npx vitest run src/app/incidents/triage/page.test.tsx
cd src/frontend && npx vitest run src/components/triage
cd src/frontend && npm run lint
cd src/frontend && npx vitest run
```

Performance expectation: the initial implementation should remain responsive for the expected validator queue size using memoized cluster/singleton splits, derived centroid/spread calculations, and filter evaluations keyed to the raw queue payload and active filters. If manual testing or seeded fixtures show hundreds of markers/reports causing slow interaction, add marker clustering, viewport culling, or list virtualization as a follow-up rather than hiding the issue.

Run broader CI pre-flight before PR/merge when implementation is complete.

## Documentation Updates After Implementation

Update project-local documentation after implementation:

- `system-wiki/frontend/route-map.md` for `/incidents/triage`
- `system-wiki/operations/civilian-triage-hci-polish.md` for the new spatial workspace and modal anatomy
- `system-wiki/log.md` if required by the project wiki convention

## Open Implementation Notes

- Prefer extending existing triage components instead of creating a parallel triage workflow.
- Keep the first implementation focused on layout, selection, and visualization.
- Preserve action-panel behavior before improving action-panel visuals.
- Avoid unrelated validator dashboard or operations-board refactors.
