---
title: Frontend Components Deep Documentation
created: 2026-05-16
updated: 2026-05-16
type: frontend
tags: [wims-bfp, frontend, components, analytics, modal, layout]
sources: [src/frontend/src/components/]
status: draft
---

# Frontend Components — Deep Documentation

## Analytics Components

### `TypeDistributionChart.tsx`

**Props:** `{ data: TypeDistributionItem[] }`
**Purpose:** Donut (pie) chart showing incident distribution by type/category.
**Renders:** Recharts `ResponsiveContainer` > `PieChart` > `Pie` (innerRadius=45, outerRadius=80, paddingAngle=2). 6-shade red palette. Tooltip + Legend.
**State:** None (pure presentational). Returns gray placeholder on empty data.

### `TopBarangaysChart.tsx`

**Props:** `{ data: TopBarangayItem[] }`
**Purpose:** Horizontal bar chart — top barangays by incident count.
**Renders:** Recharts `BarChart` layout="vertical". Barangay names truncated to 18 chars. Highest-count bar colored BFP_RED (#991b1b), subsequent bars use decreasing opacity. Rounded right corners.
**State:** None (pure presentational). Empty placeholder on no data.

### `TrendCharts.tsx`

**Props:** `{ data: TrendsResponse }`
**Purpose:** Line chart — incident counts over time periods.
**Renders:** Recharts `LineChart`. X-axis date formatting based on interval: 'monthly' → "Mon 'YY", 'weekly' → "Mon DD", default → "Mon DD". BFP maroon line with strokeWidth=2. Tooltip shows "N incident(s)".
**Helper:** `formatBucket(bucket, interval)` parses ISO date string per interval.

### `ResponseTimeChart.tsx`

**Props:** `{ data: ResponseTimeRegionItem[] }`
**Purpose:** Vertical bar chart — average response times per region.
**Renders:** Recharts `BarChart`. X-axis region names via `getShortRegionName()`. Y-axis formatted with "m" suffix. BFP maroon bars, rounded top, maxBarSize=48.
**Dependency:** Imports `getShortRegionName` from `@/lib/ph-regions`.

### `HeatmapViewer.tsx`

**Props:** `{ geojson: HeatmapGeoJSON }`
**Purpose:** Interactive Leaflet map with circle markers for incident locations.
**Renders:** `react-leaflet` MapContainer centered on Philippines (14.5995, 120.9842), zoom 6, height 400px. OpenStreetMap tiles. CircleMarker per GeoJSON feature at [lat,lon], radius 6, red fill 0.7 opacity. Features without valid coordinates skipped.
**Note:** leaflet CSS loaded globally in app/globals.css.

### `ExportPreviewModal.tsx`

**Props:** `{ format: ExportFormat, filters: Record<string,unknown>, filtersSummary: string, onClose: () => void }`
**Purpose:** Modal for configuring and queuing analytics data exports.
**Renders:** Centered modal overlay (z-50) with: format-specific icon, title (e.g. "Export CSV"), active filters summary, 15-column checkbox selector (6 default), error alert, Cancel/Queue buttons.
**State machine:** exportState: 'idle' → 'queued' → 'polling' → 'downloading' → 'done' | 'error'
**Behavior:** handleExport() calls `queueAnalyticsExport()` to get task_id, polls every 2s for up to 30 attempts (~60s) via `downloadAnalyticsExport()` until non-empty Blob. Creates temp `<a>` for download. Polling handled via recursive `setTimeout` with attempt tracking.
**API calls:** `queueAnalyticsExport()`, `downloadAnalyticsExport()`

### `AnalystIncidentList.tsx`

**Props:** `{ filters, pageSize=25, title, description, prominent, initialSelectedIncidentIds, onSelectionChange }`  
**Purpose:** Full-featured paginated, sortable, selectable incident data table.
**Renders:** Section with optional red ring. Header with counts. Toolbar with column visibility, workflow selector, "Analyze selected" button. Sortable table (click header toggles asc/desc). Checkbox multi-select. Row click opens detail slide-over (640px fixed right drawer). Pagination controls. Error/loading/empty states.
**Columns:** Notification, Region, Municipality, Barangay, Category, Sub Category, Alarm, Damage, Response.
**State:** items, total, page, sortBy, sortDir, selectedIds, visibleColumnKeys, loading, error.
**Effects:** Resets page+selection on filter change. Calls `onSelectionChange` callback. Fetches via `fetchAnalystIncidentList()` with cancellation flag.
**API calls:** `fetchAnalystIncidentList()`, `createAnalystWorkflowTransferUrl()`

---

## Modal Components

### `DuplicateIncidentModal.tsx`

**Props:** `{ duplicates, currentForm, onKeepBoth, onReplace, onRequestUpdate, onEditCurrent }`
**Purpose:** Warning modal when AFOR form submission may be a duplicate. Side-by-side comparison.
**Renders:** Amber header (⚠️ "Possible Duplicate Incident Detected"). Side-by-side grid: left (blue) current form values, right (amber) existing incident with Reference No. and status badge. Action buttons vary by existing status: DRAFT → Replace Draft, PENDING → Submit as Update, VERIFIED → Submit as New Copy.
**Row helper:** Label-value pair with fixed-width label column.
**State:** None (pure presentational with callback props).

### `DuplicateResolutionModal.tsx`

**Props:** `{ duplicates, radiusMeters, minMatchingFields, onResolve, onCancel }`
**Purpose:** Modal for resolving duplicates during bulk AFOR import. Per-row decision: skip, merge, force create.
**Renders:** Large scrollable modal (max-w-5xl, max-h-[90vh]). Header explaining matching criteria. Per-row comparison with matched fields highlighted in yellow. Radio buttons per row: Skip, Merge, Force Create. Footer with Cancel + Confirm.
**State:** `decisions: Record<number, DuplicateAction>` — defaults all to 'skip'.

---

## Layout Components

### `LayoutShell.tsx`

**Props:** `{ children: ReactNode }`
**Purpose:** Top-level layout wrapper for authenticated app. Provides sidebar, header, sync status, auth guard.
**Renders:** Loading state (full-screen spinner). Public routes (/, /login, /callback, /report/*) → children only. Authenticated routes → Sidebar + Header + SyncStatusBar + main content in max-w-7xl container.
**Effects:** On mount: unregisters PWA service workers (cleans up all caches). On !loading && !user && !loggingOut: debounced (500ms) auto-redirect to Keycloak login via `login()`.
**Dependencies:** `useAuth()`, `usePathname()`.

### `Header.tsx`

**Props:** `{ onMenuToggle: () => void }`
**Purpose:** App header bar with hamburger menu, breadcrumbs, live PST clock, network status, user badge, logout.
**Renders:** Sticky header. Left: hamburger (mobile only), breadcrumb trail from pathname. Right: PST clock (updates every second), `NetworkStatusIndicator`, user section with role badge (color-coded: red=ADMIN, amber=ADMIN, blue=VALIDATOR, purple=ANALYST, green=ENCODER, gray=default), logout button (red hover, disabled during loggingOut).
**Helpers:** `getBreadcrumbs(pathname)` using labelMap; `getRoleBadgeColor(role)` returns bg/text color pairs.

### Deprecated: dedicated Wildland AFOR manual form

`src/frontend/src/components/WildlandAforManualForm.tsx` has been removed. Wildland remains available as a standard incident category/sub-category in `IncidentForm.tsx`, but there is no separate wildland AFOR manual/import-correction workflow.
