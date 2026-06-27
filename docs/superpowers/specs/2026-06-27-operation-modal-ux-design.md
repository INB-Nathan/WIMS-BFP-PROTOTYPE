# Operation Modal UX Refinement Design

## Purpose

Refine the operations dashboard create/edit operation modal so selecting civilian reports no longer makes the dialog grow beyond the viewport. The new experience should keep the existing operation creation flow familiar while using desktop width more effectively and providing a mobile-friendly full-screen layout.

## Scope

In scope:

- Redesign the `OperationFormModal` layout in `src/frontend/src/app/home/page.tsx`.
- Keep civilian report selection collapsed by default.
- Move expanded report selection into a right-side modal column on desktop/tablet.
- Constrain modal height with internal scrolling and sticky header/footer.
- Add client-side pagination and scroll containment to `LinkableReportSearch` results.
- Preserve current first-selected-report autofill behavior for location, start time, and notes.
- Preserve current operations API contracts and link/select behavior.

Out of scope:

- Backend/API pagination for linkable reports.
- Changing operation creation semantics.
- Redesigning the main operations board outside the modal.
- Changing role permissions for operation/report management.

## Current Problem

`OperationFormModal` is currently a narrow `max-w-md` centered form without viewport-height containment. Clicking **Select civilian reports** renders `LinkableReportSearch` inline inside the form. Because the search component renders all fetched reports vertically, the modal can become taller than the viewport and push critical controls out of view.

## Design

### Modal Structure

Use a responsive modal shell:

- Desktop/tablet: centered wide dialog, approximately `max-w-5xl`, with `max-h-[calc(100vh-2rem)]`.
- Mobile: full-screen sheet using the viewport height.
- Header: sticky top section with title and concise context.
- Body: scroll-contained content area.
- Footer: sticky bottom section with Cancel and Save actions.

The body uses two columns on wider screens:

1. Left column: operation details form.
2. Right column: map and collapsible civilian report tools.

On narrow screens, the same sections stack vertically inside the full-screen sheet.

### Left Column

The left column contains the existing operation fields:

- fire status
- start time
- location
- fire radius
- size in hectares
- notes
- compact linked civilian report summary

Selected civilian reports appear as compact removable chips in this column. Chips keep the main form compact and make it clear which reports will be linked on save.

### Right Column

The right column contains:

- map picker
- collapsed/expanded civilian report selector
- detailed selected-report summaries

The **Select civilian reports** control remains collapsed by default. Opening it reveals the report selector in the right column instead of adding height to the left form.

### Civilian Report Picker

`LinkableReportSearch` should support constrained rendering:

- search input remains at the top
- results render inside a max-height scroll region
- simple client-side pagination limits visible results per page
- default page size: 5 reports
- pagination controls: Previous, Next, and `Page X of Y`
- disabled/already-linked reports remain visible with their disabled reason
- existing `mode="select"` and `mode="link"` behaviors remain intact

Client-side pagination is acceptable because the current API returns an array and this design does not require backend contract changes.

### Selection Behavior

When the first civilian report is selected during operation creation, preserve existing autofill behavior:

- if the report has coordinates and the operation has no location, set the map pin and location text
- if the report has `reported_at` and start time is empty, set start time
- if notes are empty, seed notes with the report category/sub-category

Selected reports should be visible in two ways:

- compact chips in the left form column
- detailed selected-report summaries in the right column

## Component Boundaries

Keep changes focused:

- `OperationFormModal` can remain in `src/frontend/src/app/home/page.tsx` for this refinement.
- `LinkableReportSearch` should receive small optional props such as `pageSize` and possibly class/label controls rather than duplicating report-search logic.
- No direct `fetch()` calls should be introduced in components; existing `fetchLinkableReports` client wrapper remains the data path.

If `OperationFormModal` becomes difficult to read after the layout change, extraction to a colocated component can be considered during implementation, but extraction is not required for this design.

## Accessibility and Responsive Behavior

- Keep Save and Cancel reachable through the sticky footer.
- Ensure the modal body, report results, and page controls are keyboard reachable.
- Preserve existing button labels/aria labels for selecting and linking reports.
- On mobile, use a full-screen sheet so map and report selection are usable without cramped centered-dialog behavior.
- Avoid body-level overflow caused by the dialog content.

## Error Handling

- Existing save errors remain displayed in the modal.
- Existing linkable-report loading/error/empty states remain in `LinkableReportSearch`.
- Pagination should reset to page 1 when the report query or fetched result set changes.
- If the current page becomes invalid after filtering, clamp back to the last valid page.

## Testing Plan

Extend `src/frontend/src/app/home/__tests__/operations-board.test.tsx` and/or colocated component tests to cover:

1. Opening **Select civilian reports** keeps core form controls and Save/Cancel available.
2. `LinkableReportSearch` paginates results and only shows the current page.
3. Next/Previous controls update visible reports and expose `Page X of Y`.
4. Selecting a report still creates the selected report chip and preserves first-report autofill.
5. Existing operation-panel report linking still calls `linkReport(operationId, reportId)`.

Run targeted frontend tests after implementation.

## Acceptance Criteria

- The create/edit operation modal no longer grows beyond the viewport when report selection is opened.
- Desktop/tablet users get a two-column modal with operation details and map/report tools side by side.
- Mobile users get a full-screen modal with stacked sections and sticky actions.
- Civilian report search results are constrained and paginated.
- Current operation creation, report selection, and report linking behavior continues to work.
- Relevant Vitest coverage passes.

## Spec Self-Review

- Placeholder scan: no TODO/TBD placeholders remain.
- Consistency check: layout, picker behavior, and tests all target the same two-column/full-screen design.
- Scope check: limited to frontend modal/report-picker UX; no backend changes included.
- Ambiguity check: default pagination size, responsive behavior, and out-of-scope items are explicit.
