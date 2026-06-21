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

## Triage Inspection Components

Lives under `src/frontend/src/components/triage/`. Imported as `import { TriageInspectionModal } from '@/components/triage';` and styled by `triage-modal.css` (imported once at `incidents/triage/page.tsx`). Aesthetic direction: operations console — BFP maroon dominant, deep slate chrome, bone-cream `#FAF7F2` surface, Bricolage Grotesque display, JetBrains Mono for IDs/timestamps.

### `TriageInspectionModal.tsx`

**Props:** `{ openCluster: TriageClusterEntry | null; inspectionMode: 'cluster' | 'singleton'; onClose: () => void; onReloadQueue: () => Promise<void> | void; onMessage: (msg: string) => void; onError: (err: string) => void; role: string | null }`
**Purpose:** Main shell for the triage inspection modal. Owns the three-column grid (180px left rail / flexible center / 380px right rail) and orchestrates the two-step destructive confirm.
**Renders:** Backdrop (click-to-close) + sticky dark-maroon header + grid body + `<ConfirmActionDialog>` overlay. Body scroll is locked while open; `body.style.overflow` is restored on close.
**Keyboard:** `Esc` closes the modal; `1`–`5` switch action tabs (cluster-only for `3` Split and `4` Merge); shortcuts suppressed inside `INPUT`/`TEXTAREA`/`SELECT`. **No commit shortcuts** — terminal/correction/split/merge must be committed by clicking the panel commit button, per `frontend/validator-triage-shortcuts`.
**State:** Delegated entirely to `useTriageModalState`. Local state is only `pending: PendingConfirm | null` for the destructive confirm.

### `ClusterSummaryHeader.tsx`

**Props:** `{ cluster: TriageClusterEntry; inspectionMode: 'cluster' | 'singleton'; onClose: () => void }`
**Purpose:** Sticky top header of the inspection modal. Breadcrumb `TRIAGE / QUEUE / CLUSTER|SINGLETON`, title (Cluster N or Singleton report), severity badge (HIGH/MEDIUM/LOW), LIFE SAFETY pulsing badge, 2H+ DANGER, TIMEOUT RISK, AGING, member count, trust, station, oldest-report age, "Esc close" hint, explicit Close button.
**Renders:** Dark-maroon gradient background with subtle grid overlay (1px vertical lines every 80px @ 0.025 alpha). Relative age is recomputed every 30s via a `useNow` tick so the label stays fresh while the modal is open.

### `TriageActionTabs.tsx`

**Props:** `{ tab, setTab, inspectionMode, selectedCount, totalCount, correctionReportId, mergeCandidateCount }`
**Purpose:** Left-rail vertical tab nav with single-key shortcuts `1`–`5`. Cluster-only tabs (Split, Merge) are hidden in singleton mode. Each tab shows a count badge (selected count for Split, candidate count for Merge, target report id for Correct) and a single-key kbd.
**Renders:** Stacked `<button>` with maroon stripe + icon + label + badge + kbd. Active tab gets the maroon stripe + inverted kbd + white background + subtle shadow.

### `ReportsListPanel.tsx`

**Props:** `{ cluster, inspectionMode, selected, onToggle, onStartCorrection, suggestedReportIds }`
**Purpose:** Center panel. One report per card (not a table row) so the operator can scan a single report at a time. Trust score, GPS-mismatch / duplicate-device warnings, follow-ups, status pill, "Correct" button on terminal rows, heavy maroon left border on selected cards.
**Renders:** In cluster mode, renders `<ClusterInspectionMap>` above the list. In singleton mode, renders a lat/lon/station metadata strip. Uses `stripHtml()` on description and follow-up text so XSS-tagged mock data never reaches the DOM as markup.

### `TerminalActionPanel.tsx`

**Props:** `{ cluster, selected, terminalStatus, setTerminalStatus, explanation, setExplanation, internalNote, setInternalNote, onApply, busy }`
**Purpose:** Terminal action form. Status radio-cards (standard / caution / destructive tones), required citizen-visible explanation textarea (with char counter), optional internal note, "Why this status?" disclosure, `<CitizenMessagePreview>` phone-card mock, commit button. Standard `ACTIONED` commits without confirm; `REJECTED_*` open the destructive confirm.

### `CorrectionActionPanel.tsx`

**Props:** `{ correctionReportId, terminalStatus, setTerminalStatus, explanation, setExplanation, correctionReason, setCorrectionReason, onApply, busy }`
**Purpose:** Correction form. Target-report slot (filled by clicking "Correct" on a terminal row, which auto-switches the tab via the `startCorrection` helper), replacement status + explanation, required audit reason (visually distinguished as audit-only with a maroon left border), phone-card preview, commit button.

### `SplitActionPanel.tsx`

**Props:** `{ cluster, selected, splitNote, setSplitNote, onApply, busy }`
**Purpose:** Split form. Side-by-side "Leaving" / "Staying" preview columns, required internal note, "What will happen?" disclosure showing the count split, caution-tone commit button.

### `MergeActionPanel.tsx`

**Props:** `{ cluster, mergeCandidates, mergeSourceClusterId, setMergeSourceClusterId, mergeNote, setMergeNote, onPickCandidate, onApply, busy }`
**Purpose:** Merge form. Source / target flow cards (Source is dashed-empty until a candidate is picked), suggested-candidate list rendered as visual cards (not text rows), source-id input as a backup, required internal note, destructive-tone commit button.

### `CitizenMessagePreview.tsx`

**Props:** `{ status, message, reportCount }`
**Purpose:** Phone-card mock rendering the exact civilian-facing message that will be sent for the current selection. Lays the explanation next to a phone-chrome frame so the operator sees what the citizen will read before commit.

### `ActivityPanel.tsx`

**Props:** `{ activity: TriageClusterActivityEntry[] }`
**Purpose:** Most-recent-first timeline of audit events with status transitions and notes. Empty state explains what should appear once actions are taken.

### `ConfirmActionDialog.tsx`

**Props:** `{ open, title, body, confirmLabel, confirmTone, busy, onConfirm, onCancel, preview }`
**Purpose:** Two-step confirmation for any `REJECTED_*` terminal action, every correction, every split, every merge. Shows the impact summary + the citizen-visible message (for terminal) or the source/target or leaving/staying preview (for split/merge).
**Keyboard:** `Esc` cancels only the confirm (capture-phase listener wins the race against the parent modal's `Esc` handler), leaving the parent modal open.

### `useTriageModalState.ts`

Hook that owns all form state for the inspection modal. Returns the full state object (`tab`, `selected`, `terminalStatus`, `explanation`, `internalNote`, `correctionReportId`, `correctionReason`, `splitNote`, `mergeSourceClusterId`, `mergeNote`, `mergeCandidates`, `activity`, plus the four `apply*` functions and `claimCluster`). Single source of truth for pre-select-on-open, tab auto-switch on correction-target click, and singleton-mode tab filtering.

### `triage-modal.css`

Operations-console visual system. CSS variables on `.triage-modal__panel` define the bone-cream surface. Bricolage Grotesque loads via Google Fonts in `app/globals.css` alongside Inter (body) and JetBrains Mono (IDs/timestamps). Status-toned radio cards (standard blue / caution amber / destructive maroon). Animations: `triage-modal-rise` on open, `triage-pulse` on LIFE SAFETY badge, `triage-badge-in` on header badges, `triage-fade-in` on backdrop. All scrollbars are styled to match the slate chrome.
