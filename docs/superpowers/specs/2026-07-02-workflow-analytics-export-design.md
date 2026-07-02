# Workflow-Specific Analytics Export Design

**Date:** 2026-07-02
**Status:** Draft
**Author:** Agent (following brainstorming skill)

## 1. Problem

The analyst dashboard has workflow pages (Comparative, Trends, Response Time, Top-N Hotspots, Heatmap) that each compute and display analysis-specific data. The current "Export Workflow Results" panel only exports filtered **incident records** (CSV/PDF/Excel columns). It does not export the workflow's own calculation results — the comparative variance, the trend chart, the response-time bar chart, the top-N ranking, or the heatmap image.

Analysts need workflow-specific exports to produce policymaking artifacts: XLSX files with embedded charts, formulas, and underlying data, plus heatmap screenshots.

## 2. Approach

**Server-side XLSX generation with openpyxl** for the four data workflows (Comparative, Trends, Response Time, Top-N). **Client-side browser capture with `dom-to-image-more`** for the Heatmap image export.

Rationale: openpyxl (v3.1.5) is already installed and used in `tasks/exports.py`. The existing Celery export pipeline (queue → async task → poll → download) is reused. Server-side chart/formula generation produces richer XLSX files without frontend bundle bloat.

## 3. New Backend Endpoints

### 3.1 POST `/api/analytics/export/workflow/comparative`

**Request body (Pydantic: `WorkflowComparativeExportRequest`):**

```python
class WorkflowComparativeExportRequest(BaseModel):
    filters: dict[str, Any] = {}
    range_a_start: str  # ISO date, validated via validate_iso_date
    range_a_end: str    # ISO date, validated via validate_iso_date
    range_b_start: str  # ISO date, validated via validate_iso_date
    range_b_end: str    # ISO date, validated via validate_iso_date

    @field_validator("range_a_start", "range_a_end", "range_b_start", "range_b_end")
    @classmethod
    def validate_dates(cls, v: str) -> str:
        validate_iso_date(v, "date")
        return v
```

**Response:** `{"task_id": "uuid-string"}` (same pattern as existing export endpoints).

**Celery task:** `export_workflow_comparative_task`

### 3.2 POST `/api/analytics/export/workflow/trends`

**Request body (Pydantic: `WorkflowTrendsExportRequest`):**

```python
class WorkflowTrendsExportRequest(BaseModel):
    filters: dict[str, Any] = {}
    interval: str = "daily"  # enum: daily, weekly, monthly, quarterly, yearly

    @field_validator("interval")
    @classmethod
    def validate_interval(cls, v: str) -> str:
        allowed = {"daily", "weekly", "monthly", "quarterly", "yearly"}
        if v not in allowed:
            raise ValueError(f"interval must be one of {allowed}")
        return v
```

**Celery task:** `export_workflow_trends_task`

### 3.3 POST `/api/analytics/export/workflow/response-time`

**Request body (Pydantic: `WorkflowResponseTimeExportRequest`):**

```python
class WorkflowResponseTimeExportRequest(BaseModel):
    filters: dict[str, Any] = {}
```

**Celery task:** `export_workflow_response_time_task`

### 3.4 POST `/api/analytics/export/workflow/top-n`

**Request body (Pydantic: `WorkflowTopNExportRequest`):**

```python
class WorkflowTopNExportRequest(BaseModel):
    filters: dict[str, Any] = {}
    metric: str       # enum: incidents, response_time, casualties, damage_cost
    dimension: str    # enum: fire_station, region, municipality, barangay
    mode: str         # enum: full, selected
    selected_name: str | None = None  # required when mode == "selected"
    metric_value: float | None = None  # optional; frontend sends pre-computed value for selected mode

    @field_validator("metric")
    @classmethod
    def validate_metric(cls, v: str) -> str:
        allowed = {"incidents", "response_time", "casualties", "damage_cost"}
        if v not in allowed:
            raise ValueError(f"metric must be one of {allowed}")
        return v

    @field_validator("dimension")
    @classmethod
    def validate_dimension(cls, v: str) -> str:
        allowed = {"fire_station", "region", "municipality", "barangay"}
        if v not in allowed:
            raise ValueError(f"dimension must be one of {allowed}")
        return v

    @field_validator("mode")
    @classmethod
    def validate_mode(cls, v: str) -> str:
        allowed = {"full", "selected"}
        if v not in allowed:
            raise ValueError(f"mode must be one of {allowed}")
        return v

    @model_validator(mode="after")
    def validate_selected_fields(self):
        if self.mode == "selected" and not self.selected_name:
            raise ValueError("selected_name is required when mode is 'selected'")
        return self
```

**Filter validation:** All workflow export endpoints pass `filters` through `build_analytics_filters().as_task_filters()` (same as existing analytics route pattern) before queueing the Celery task. This normalizes dates and drops unknown filter keys.

**Celery task:** `export_workflow_top_n_task`

### 3.5 Existing download endpoint reused

`GET /api/analytics/export/{task_id}` — already exists, returns the completed file. No changes needed.

All new endpoints use the `get_analyst_or_admin` dependency for RBAC enforcement (same as existing analytics routes).

## 4. Celery Tasks

Each new task follows the existing `_export` pattern but with its own writer function. Tasks are registered in `tasks/exports.py`.

### 4.1 Common pattern

```
task receives validated request body
  → get_session(), set_rls_context(user_id)
  → call service functions to fetch data
  → call workflow-specific writer to build XLSX
  → _insert_export_log(db, ...)
  → return file path
```

All tasks import service functions directly from `services/analytics_read_model.py`. No circular import risk: `tasks/exports.py` already imports from `services/analytics_read_model`, and the service module does not import tasks.

### 4.2 Writer: `_write_comparative_xlsx(path, rows_a, rows_b, summary)`

**XLSX structure (2 sheets):**

- **Sheet 1: "Summary"**
  Row 1 (headers): "Metric", "Range A", "Range B", "Difference", "Variance %"
  Row 2 (data): "Incident Count", `{count_a}` (col B), `{count_b}` (col C), `=C2-B2` (col D), `=IF(B2=0,0,(C2-B2)/B2)` (col E)
  Row 3: "(Date Range)", `{range_a_start} to {range_a_end}`, `{range_b_start} to {range_b_end}`, "", ""

  Column layout: A=Metric, B=Range A, C=Range B, D=Difference, E=Variance %.
  Formula cells are `openpyxl` `Cell.value` set to formula strings with worksheet coordinates.

- **Sheet 2: "Incidents"**
  Union of Range A and Range B incidents with a "Period" column tagging each row as "Range A" or "Range B".
  Columns determined by `DEFAULT_EXPORT_COLUMNS` + "period" tag column.
  Rows fetched using `get_export_rows(db, filters_with_date_range, columns)` — called once for each range.

### 4.3 Writer: `_write_trends_xlsx(path, data, interval)`

**XLSX structure (2 sheets):**

- **Sheet 1: "Trend Chart"**
  openpyxl `LineChart` using data from Sheet 2 as Reference.
  Chart title: "Incident Trend — {interval}"
  X-axis: bucket labels. Y-axis: count.
  No data table visible on this sheet (chart-only), or minimal layout.

- **Sheet 2: "Data"**
  Column A: "Bucket" (string dates). Column B: "Count" (integers).
  Row 1: headers. Rows 2..N: data. Row N+2: summary — "Total", "Interval", "Peak Bucket" labels with computed values.

### 4.4 Writer: `_write_response_time_xlsx(path, data)`

**XLSX structure (2 sheets):**

- **Sheet 1: "Response Time Chart"**
  openpyxl `BarChart` (grouped bar) with 3 data series:
    - Avg (min), Min (min), Max (min)
  X-axis: region_name labels.
  Chart title: "Response Time by Region".
  Color-coded series.

- **Sheet 2: "Data"**
  Columns: Region, Avg (min), Min (min), Max (min), Total Incidents.
  `total_incidents` is populated by adding `COUNT(*) AS total_incidents` to the `get_response_time_by_region` SQL query in `services/analytics_read_model.py`.
  Note: `total_incidents` only counts rows with non-null `total_response_time_minutes`, because the query starts with `a.total_response_time_minutes IS NOT NULL`. This is correct — response time analysis concerns incidents that have response times.

### 4.5 Writer: `_write_top_n_xlsx(path, data, metric, dimension, mode, selected_name)`

**Mode "full" — XLSX structure (2 sheets):**

- **Sheet 1: "Hotspot Chart"**
  openpyxl `BarChart` (simple bar) plotting rank vs metric value.
  Chart title: "Top 10 Hotspots by {metric} — {dimension}"
  X-axis: name labels. Y-axis: metric value.

- **Sheet 2: "Data"**
  Columns: Rank, Name, Metric Value, Incident Count.
  Rows: top-10 ranked list from `get_top_n`.

**Mode "selected" — XLSX structure (2 sheets):**

- **Sheet 1: "Selected Hotspot"**
  Row: "Hotspot", `{selected_name}`
  Row: "Dimension", `{dimension}`
  Row: "Metric", `{metric}`
  Row: "Metric Value", `{metric_value}` (sent by the frontend — avoids fragile server-side lookup against top-10 list)
  Row: "Filters", `{json_summary_of_resolved_filters}`

- **Sheet 2: "Incidents"**
  Incident rows matching the resolved filters passed in `filters`.
  The frontend sends **pre-resolved filters** (computed by the existing `buildTopNDrilldownFilters` in `src/frontend/src/lib/topNDrilldown.ts`), not raw dimension+name. These are the same filters the workflow page uses for the incident evidence table when a hotspot is selected.

  **Note:** The frontend's `buildTopNDrilldownFilters` currently supports `region`, `municipality`, and `fire_station`. When `barangay` is the dimension, the frontend uses `filters.barangay_name = hotspotName` directly (since barangay is a text filter field, not a FK lookup). The `buildTopNDrilldownFilters` function needs a `barangay` case added for this.

  **Failure case:** If `buildTopNDrilldownFilters` returns null (unrecognized region name), the frontend disables the "Export Selected" button. The POST body is never sent with null filters. This matches the existing behavior where the "View matching incidents" button is gated by the same resolution logic.

### 4.6 All writers call `_insert_export_log` after saving

Reuses the existing audit-logging function with `export_type="workflow"`.

## 5. Service Changes

### 5.1 Add `total_incidents` to `get_response_time_by_region`

**File:** `src/backend/services/analytics_read_model.py:896-951`

**Change:** Add `COUNT(*) AS total_incidents` to the SQL SELECT and include `total_incidents` in the returned dict.

```python
rows = db.execute(
    text(f"""
        SELECT a.region_id,
               AVG(a.total_response_time_minutes) AS avg_rt,
               MIN(a.total_response_time_minutes) AS min_rt,
               MAX(a.total_response_time_minutes) AS max_rt,
               COUNT(*) AS total_incidents
        FROM wims.analytics_incident_facts a
        WHERE {where_sql}
        GROUP BY a.region_id
        ORDER BY avg_rt DESC
    """),
    params,
).fetchall()
return [
    {
        "region_id": r[0],
        "region_name": str(r[0]),
        "avg_response_time": round(float(r[1]), 1),
        "min_response_time": r[2],
        "max_response_time": r[3],
        "total_incidents": r[4],
    }
    for r in rows
]
```

**Backward compatibility:** Existing callers that don't read `total_incidents` are unaffected. Callers that do read `total_incidents` (the new export task) will get the correct value.

### 5.2 No other service changes

The other workflows use existing service functions without modification:
- `get_trends(db, interval=interval, **filters)` — unchanged
- `count_in_range(db, start, end, **filters)` — unchanged (called twice by the comparative task)
- `get_top_n(db, metric=metric, dimension=dimension, limit=10, **filters)` — unchanged
- `get_export_rows(db, filters, columns)` — unchanged (used for incident sheets)

## 6. Frontend Changes

### 6.1 Install `dom-to-image-more`

```bash
npm install dom-to-image-more
```

No other new frontend dependencies needed.

### 6.2 Workflow-specific export buttons

**File:** `src/frontend/src/app/dashboard/analyst/[workflow]/page.tsx`

Add export buttons to each workflow panel's existing `action` slot.

**Comparative panel:** "Export XLSX" button → calls a new frontend function that POSTs to the workflow comparative endpoint with `range_a_start`, `range_a_end`, `range_b_start`, `range_b_end` from component state.

**Trends panel:** "Export XLSX" button → POSTs to workflow trends endpoint with current `interval`.

**Response Time panel:** "Export XLSX" button → POSTs to workflow response-time endpoint.

**Top-N panel:** Two buttons:
  - "Export Chart" (mode=full) → POSTs full ranking data
  - "Export Selected" (mode=selected) → POSTs resolved filters + `selected_name` + `metric_value` (already available from `TopNExplorer` component state as `selectedItem.value`)

**Heatmap panel:** Two buttons:
  - "Download PNG"
  - "Download JPEG"
  Both use `dom-to-image-more` to capture the Leaflet map container element and trigger a download. No server call.

### 6.3 Shared `useWorkflowExport` hook

Each workflow export button follows the same polling/download pattern as the existing `ExportPreviewModal`:
```
click → POST to workflow endpoint → receive task_id → poll GET /api/analytics/export/{task_id} → download blob
```

With 6 export surfaces (Comparative, Trends, Response Time, Top-N full, Top-N selected, Heatmap), inlining this 33-line state machine each time is not acceptable — it will drift across copies. **Extract a shared `useWorkflowExport` hook** before any button is implemented:

```typescript
// lib/useWorkflowExport.ts
import { useState, useCallback } from 'react';
import { downloadAnalyticsExport, queueAnalyticsExport } from '@/lib/api';

type ExportState = 'idle' | 'queued' | 'polling' | 'downloading' | 'done' | 'error';

export function useWorkflowExport() {
  const [state, setState] = useState<ExportState>('idle');
  const [error, setError] = useState<string | null>(null);

  const exportWorkflow = useCallback(async (
    workflowType: string,
    params: Record<string, unknown>,
  ) => {
    setState('queued');
    setError(null);
    try {
      const { task_id } = await queueAnalyticsExport({
        format: 'excel',
        filters: params,
        columns: [],
      });
      // Alternative: use a dedicated POST endpoint instead of queueAnalyticsExport
      // const { task_id } = await fetch(`/api/analytics/export/workflow/${workflowType}`, { method: 'POST', body: JSON.stringify(params) }).then(r => r.json());

      setState('polling');
      const maxAttempts = 30;
      let blob: Blob | null = null;
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          blob = await downloadAnalyticsExport(task_id);
          if (blob && blob.size > 0) break;
        } catch { /* still pending */ }
      }
      if (!blob || blob.size === 0) {
        setError('Export is taking longer than expected. Check back shortly.');
        setState('error');
        return;
      }
      const url = URL.createObjectURL(blob);
      const filename = `wims-${workflowType}-${new Date().toISOString().split('T')[0]}.xlsx`;
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setState('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
      setState('error');
    }
  }, []);

  const reset = useCallback(() => {
    setState('idle');
    setError(null);
  }, []);

  return { state, error, exportWorkflow, reset };
}
```

**Top-N selected mode:** the hook sends `metric_value` (the already-displayed metric value from the selected hotspot row) in the POST body alongside `selected_name` and resolved `filters`. This avoids a server-side lookup against the top-10 ranked list (which could fail for hotspots outside the top 10).

**Offline gating:** Export buttons are disabled when offline (using existing `exportUnavailableOffline` checks), matching the current behavior.

### 6.4 Heatmap capture logic

The HeatmapViewer component renders a Leaflet map inside a container `<div>`. When in the workflow page (non-fullscreen mode), the map is rendered within the workflow Panel. The export buttons capture this in-panel map container.

```typescript
import domtoimage from 'dom-to-image-more';

async function downloadMapImage(format: 'png' | 'jpeg') {
  // Capture the in-panel map container, not the fullscreen overlay
  const node = document.querySelector('[data-heatmap-export]');
  if (!node) return;
  const dataUrl = format === 'png'
    ? await domtoimage.toPng(node, { scale: 2 })
    : await domtoimage.toJpeg(node, { quality: 0.95, scale: 2 });
  const link = document.createElement('a');
  link.download = `heatmap-${new Date().toISOString().split('T')[0]}.${format}`;
  link.href = dataUrl;
  link.click();
}
```

The map wrapping `<div>` in the Panel gets a `data-heatmap-export` attribute (data attribute rather than id to avoid conflicts with the fullscreen overlay's container).

OSM tiles serve `access-control-allow-origin: *`, so CORS is not an issue. Note: Leaflet renders SVG markers (CircleMarker) overlaid on tile `<img>` elements. `dom-to-image-more` serializes the full DOM subtree, which handles this mixed SVG+img layout correctly. If canvas tainting occurs in certain browser configurations, fallback to the library's `toSvg()` method which serializes as SVG data URL without canvas involvement.

### 6.5 Existing export panel unchanged

The "Export Workflow Results" panel stays as-is. It continues to provide generic CSV/PDF/Excel incident record exports.

## 7. RBAC and Security

- All new POST endpoints use the `get_analyst_or_admin` dependency (same as existing analytics routes).
- All new Celery tasks call `set_rls_context(db, uuid.UUID(user_id))` before querying data (same as existing export tasks).
- Audit trail: `_insert_export_log` records every workflow export with `export_type="workflow"`.
- Input validation: Pydantic models reject invalid enums, malformed dates, and missing required fields before the task is queued.

## 8. File Size and Performance

- XLSX files with embedded charts are typically small (charts store rendering instructions, not bitmaps).
- Incident-row sheets materialize rows in memory, matching the existing export pattern. This is acceptable for typical analyst filter scopes.
- Future escape hatch: openpyxl supports write-only mode (`write_only=True`) for streaming large datasets without loading all rows into memory. Not needed now, but documented for future reference.

## 9. Testing

### Backend tests (in `tests/test_analytics_export.py` or new `tests/test_workflow_export.py`):
- Each new POST endpoint returns 200 with `{"task_id": "..."}` for valid input.
- Each new endpoint returns 422 for invalid input (bad date, bad enum, missing selected_name).
- Each new endpoint returns 403 for non-analyst roles.
- Each Celery task produces a valid XLSX file with the expected sheets and content.
- The `total_incidents` field is present in `get_response_time_by_region` results.

### Frontend tests:
- Export buttons render in the correct workflow panels.
- Clicking an export button triggers the POST call with correct parameters.
- Heatmap download buttons fire the capture function.
- Export buttons are disabled when offline (following existing pattern).

## 10. Implementation Order

1. Add `total_incidents` to `get_response_time_by_region` service
2. Add Pydantic request models to `api/routes/analytics.py`
3. Add writer functions to `tasks/exports.py`
4. Add Celery tasks to `tasks/exports.py`
5. Add POST endpoints to `api/routes/analytics.py`
6. Add shared `useWorkflowExport` hook to frontend
7. Install `dom-to-image-more` in frontend
8. Add export buttons and handlers to workflow page
9. Add backend tests
10. Add frontend tests
11. Commit and PR

## 11. Appendix: Data Flow Diagram

```
[Workflow Page]
    ↓ Click Export Button
[Frontend Handler]
    ↓ POST { validated params }
[/api/analytics/export/workflow/{type}]
    ↓ validate → queue Celery task
[Celery Task]
    ↓ set_rls_context
    ↓ fetch data from service functions
    ↓ build XLSX (openpyxl)
    ↓ _insert_export_log
    ↓ return file path
[Frontend polls] ← GET /api/analytics/export/{task_id}
    ↓ file ready → blob download

[Heatmap: no server]
[User clicks Download PNG/JPEG]
    ↓ dom-to-image-more captures #heatmap-container
    ↓ download data URL as .png or .jpg
```
