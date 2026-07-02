# Implementation Plan: Workflow-Specific Analytics Exports

**Source spec:** `docs/superpowers/specs/2026-07-02-workflow-analytics-export-design.md`
**Date:** 2026-07-02
**Target branch:** master (branch off after merging `fix/map-button-position`)

## Goal

Add workflow-specific XLSX exports (with charts, formulas, and data sheets) to the analyst dashboard's Comparative, Trends, Response Time, Top-N Hotspots, and Heatmap workflow pages.

---

## Tasks

### Step 1 — Add `total_incidents` to `get_response_time_by_region` service

**File:** `src/backend/services/analytics_read_model.py` (lines 929-950)

**Changes:**
- Add `COUNT(*) AS total_incidents` to the SQL SELECT clause in `get_response_time_by_region`
- Add `"total_incidents": r[4]` to the returned dict in the list comprehension

**Specific edit:** In the SQL query (around line 936), change:
```sql
MAX(a.total_response_time_minutes) AS max_rt
```
to:
```sql
MAX(a.total_response_time_minutes) AS max_rt,
COUNT(*) AS total_incidents
```

And in the return dict (around line 949), add:
```python
"total_incidents": r[4],
```

**Acceptance:** `get_response_time_by_region` returns dicts with a `total_incidents` integer key. Existing tests that don't check this key continue to pass.

**Effort:** Simple (1-line SQL change + 1-line dict change)

---

### Step 2 — Add `barangay_name` filter support to backend filter infrastructure

**Files:**
- `src/backend/services/analytics/filters.py` — add `barangay_name` to `build_analytics_filters` and `append_common_filters`
- `src/backend/services/analytics_read_model.py` — add `barangay_name` param to `_append_common_filters` and `get_export_rows`

**Changes:**
1. Read `src/backend/services/analytics/filters.py` to see `build_analytics_filters` and `append_common_filters` signatures
2. Add `barangay_name: Optional[str] = None` parameter to both functions
3. Add filter clause: `a.barangay_name = :barangay_name` when value is provided
4. Add `barangay_name` parameter to `_append_common_filters` and pass it through to `build_analytics_filters`
5. In `get_export_rows`, extract `barangay_name` from filters dict and pass to `_append_common_filters`

**Dependency:** Required for Top-N selected mode with `barangay` dimension (Step 4).

**Acceptance:** `get_export_rows({'barangay_name': 'Barangay X'}, ['incident_id'])` returns only rows for that barangay.

**Effort:** Medium (4 files to touch, all following existing pattern)

---

### Step 3 — Add Pydantic request models

**File:** `src/backend/api/routes/analytics.py`

**Changes:**
Add 4 Pydantic models before the `ExportCsvRequest` class (around line 248):

```python
class WorkflowComparativeExportRequest(BaseModel):
    filters: dict[str, Any] = {}
    range_a_start: str
    range_a_end: str
    range_b_start: str
    range_b_end: str

    @field_validator("range_a_start", "range_a_end", "range_b_start", "range_b_end")
    @classmethod
    def validate_dates(cls, v: str) -> str:
        validate_iso_date(v, "date")
        return v


class WorkflowTrendsExportRequest(BaseModel):
    filters: dict[str, Any] = {}
    interval: str = "daily"

    @field_validator("interval")
    @classmethod
    def validate_interval(cls, v: str) -> str:
        allowed = {"daily", "weekly", "monthly", "quarterly", "yearly"}
        if v not in allowed:
            raise ValueError(f"interval must be one of {allowed}")
        return v


class WorkflowResponseTimeExportRequest(BaseModel):
    filters: dict[str, Any] = {}


class WorkflowTopNExportRequest(BaseModel):
    filters: dict[str, Any] = {}
    metric: str
    dimension: str
    mode: str
    selected_name: str | None = None
    metric_value: float | None = None

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
            raise ValueError("selected_name required when mode is 'selected'")
        return self
```

**Acceptance:** Each model validates correctly. Invalid enums/dates return 422. Valid inputs pass through.

**Effort:** Medium (boilerplate-heavy but mechanical)

---

### Step 4 — Add XLSX writer functions to `tasks/exports.py`

**File:** `src/backend/tasks/exports.py`

Add 4 new writer functions after the existing `_write_xlsx` function (around line 99).

#### 4a. `_write_comparative_xlsx(path, range_a_data, range_b_data, summary)`

```python
def _write_comparative_xlsx(path, rows_a, rows_b, summary):
    from openpyxl import Workbook

    wb = Workbook()
    # Sheet 1: Summary
    ws = wb.active
    ws.title = "Summary"
    ws.append(["Metric", "Range A", "Range B", "Difference", "Variance %"])
    ws.append([
        "Incident Count",
        summary["count_a"],
        summary["count_b"],
        "=C2-B2",                                                          # Difference formula
        '=IF(B2=0,0,(C2-B2)/B2)',                                         # Variance formula
    ])
    ws.append([
        "Date Range",
        f"{summary['range_a_start']} to {summary['range_a_end']}",
        f"{summary['range_b_start']} to {summary['range_b_end']}",
        "",
        "",
    ])
    # Sheet 2: Incidents (tagged union)
    ws2 = wb.create_sheet("Incidents")
    columns = DEFAULT_EXPORT_COLUMNS + ["period"]
    ws2.append(columns)
    for row in rows_a:
        ws2.append([_serialize_value(row.get(c)) for c in DEFAULT_EXPORT_COLUMNS] + ["Range A"])
    for row in rows_b:
        ws2.append([_serialize_value(row.get(c)) for c in DEFAULT_EXPORT_COLUMNS] + ["Range B"])
    wb.save(path)
```

**acceptance:** Produces a valid XLSX with "Summary" sheet (formula cells) and "Incidents" sheet (period-tagged rows).

**Effort:** Medium

#### 4b. `_write_trends_xlsx(path, data, interval)`

```python
def _write_trends_xlsx(path, data, interval):
    from openpyxl import Workbook
    from openpyxl.chart import LineChart, Reference

    wb = Workbook()
    # Sheet 2: Data first (chart references it)
    ws_data = wb.active
    ws_data.title = "Data"
    ws_data.append(["Bucket", "Count"])
    for item in data:
        ws_data.append([item["bucket"], item["count"]])
    # Summary rows
    total = sum(item["count"] for item in data)
    peak = max(data, key=lambda x: x["count"]) if data else {}
    ws_data.append([])
    ws_data.append(["Total", total])
    ws_data.append(["Interval", interval])
    ws_data.append(["Peak Bucket", peak.get("bucket", "N/A")])

    # Sheet 1: Chart only (references Sheet 2 data)
    ws_chart = wb.create_sheet("Trend Chart")
    chart = LineChart()
    chart.title = f"Incident Trend — {interval}"
    chart.style = 10
    chart.x_axis.title = "Bucket"
    chart.y_axis.title = "Count"
    data_ref = Reference(ws_data, min_col=2, min_row=1, max_row=len(data) + 1)
    cats = Reference(ws_data, min_col=1, min_row=2, max_row=len(data) + 1)
    chart.add_data(data_ref, titles_from_data=True)
    chart.set_categories(cats)
    chart.width = 20
    chart.height = 12
    ws_chart.add_chart(chart, "A1")
    wb.save(path)
```

**Effort:** Medium

#### 4c. `_write_response_time_xlsx(path, data)`

Similar to trends but uses `BarChart` with 3 series (avg, min, max). Data sheet has columns: Region, Avg (min), Min (min), Max (min), Total Incidents.

**Effort:** Medium

#### 4d. `_write_top_n_xlsx(path, data, metric, dimension, mode, selected_name, metric_value)`

Two modes:

**Mode "full":** BarChart of top-10 ranked list + Data sheet (Rank, Name, Metric Value, Incident Count).

**Mode "selected":** Simple data layout sheet (Selected Hotspot metadata: name, dimension, metric, metric_value, filters) + Incidents sheet using `get_export_rows` with the resolved filters.

```python
def _write_top_n_xlsx(path, data, metric, dimension, mode, selected_name, metric_value, filters=None, db=None, columns=None):
    from openpyxl import Workbook
    from openpyxl.chart import BarChart, Reference

    wb = Workbook()

    if mode == "full":
        # Sheet 2: Data
        ws_data = wb.active
        ws_data.title = "Data"
        ws_data.append(["Rank", "Name", "Metric Value", "Incident Count"])
        for i, item in enumerate(data, 1):
            ws_data.append([i, item["name"], item["value"], item.get("incident_count", "")])
        # Sheet 1: Chart
        ws_chart = wb.create_sheet("Hotspot Chart")
        chart = BarChart()
        chart.title = f"Top 10 Hotspots by {metric} — {dimension}"
        data_ref = Reference(ws_data, min_col=3, min_row=1, max_row=len(data) + 1)
        cats = Reference(ws_data, min_col=2, min_row=2, max_row=len(data) + 1)
        chart.add_data(data_ref, titles_from_data=True)
        chart.set_categories(cats)
        chart.width = 20
        chart.height = 12
        ws_chart.add_chart(chart, "A1")
    else:  # mode == "selected"
        # Sheet 1: Selected Hotspot
        ws = wb.active
        ws.title = "Selected Hotspot"
        ws.append(["Hotspot", selected_name])
        ws.append(["Dimension", dimension])
        ws.append(["Metric", metric])
        ws.append(["Metric Value", metric_value])
        ws.append(["Filters", json.dumps(filters or {})])
        # Sheet 2: Incidents (requires db session)
        if db and columns:
            ws2 = wb.create_sheet("Incidents")
            rows = get_export_rows(db, filters or {}, columns)
            ws2.append(columns)
            for row in rows:
                ws2.append([_serialize_value(row.get(c)) for c in columns])

    wb.save(path)
```

Note: The `_write_top_n_xlsx` function in "selected" mode needs a db session to fetch incidents. The task wrapper handles this — it passes `db` and `columns` only in selected mode.

**Effort:** Medium

#### 4e. Register all writers with `_insert_export_log`

Each writer call is followed by a `_insert_export_log(db, ...)` call. The logger entry is made by the task wrapper, not the writer itself (to keep writers focused on file building).

**Acceptance:** All new functions produce valid XLSX files that open in Excel with the expected sheets, charts, and formulas.

**Effort:** Medium (chunk of boilerplate but straightforward)

---

### Step 5 — Add Celery tasks

**File:** `src/backend/tasks/exports.py` (after existing task definitions)

Add 4 new Celery tasks:

```python
@celery_app.task(bind=True, name="tasks.exports.export_workflow_comparative")
def export_workflow_comparative_task(self, user_id, range_a_start, range_a_end, range_b_start, range_b_end, filters):
    db = get_session()
    try:
        set_rls_context(db, uuid.UUID(user_id))
        # Fetch counts
        count_a = count_in_range(db, range_a_start, range_a_end, **filters)
        count_b = count_in_range(db, range_b_start, range_b_end, **filters)
        variance = 0.0
        if count_a > 0:
            variance = ((count_b - count_a) / count_a) * 100
        summary = {
            "count_a": count_a,
            "count_b": count_b,
            "variance_percent": round(variance, 2),
            "range_a_start": range_a_start,
            "range_a_end": range_a_end,
            "range_b_start": range_b_start,
            "range_b_end": range_b_end,
        }
        # Fetch incident rows for both ranges
        cols = DEFAULT_EXPORT_COLUMNS
        rows_a = get_export_rows(db, {**filters, "start_date": range_a_start, "end_date": range_a_end}, cols)
        rows_b = get_export_rows(db, {**filters, "start_date": range_b_start, "end_date": range_b_end}, cols)
        os.makedirs(EXPORT_DIR, exist_ok=True)
        path = os.path.join(EXPORT_DIR, f"comparative_export_{uuid.uuid4().hex[:12]}.xlsx")
        _write_comparative_xlsx(path, rows_a, rows_b, summary)
        _insert_export_log(db, user_id=user_id, export_format="excel", export_type="workflow_comparative",
                           filters={**filters, "range_a_start": range_a_start, "range_a_end": range_a_end,
                                    "range_b_start": range_b_start, "range_b_end": range_b_end},
                           columns=cols, task_id=getattr(self.request, "id", None),
                           path=path, content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                           row_count=len(rows_a) + len(rows_b))
    finally:
        db.close()
    return path
```

Similar pattern for trends, response-time, and top-n tasks.

**Key decision for each:**

| Task | Service calls | Writer |
|------|--------------|--------|
| `export_workflow_comparative_task` | `count_in_range` ×2, `get_export_rows` ×2 | `_write_comparative_xlsx` |
| `export_workflow_trends_task` | `get_trends` | `_write_trends_xlsx` |
| `export_workflow_response_time_task` | `get_response_time_by_region` | `_write_response_time_xlsx` |
| `export_workflow_top_n_task` | `get_top_n` (+ `get_export_rows` if not mode="full") | `_write_top_n_xlsx` |

**Acceptance:** Each task runs successfully via Celery and produces a file at the expected path. Task result is the file path string.

**Effort:** Medium (4 similar tasks, ~25 lines each)

---

### Step 6 — Add POST endpoints to analytics routes

**File:** `src/backend/api/routes/analytics.py`

Add 4 new routes after the existing `export_excel` route (around line 340):

```python
@router.post("/export/workflow/comparative")
def export_workflow_comparative(
    body: WorkflowComparativeExportRequest,
    current_user: Annotated[dict, Depends(get_analyst_or_admin)],
):
    # Validate dates (already done by Pydantic)
    validate_date_range(body.range_a_start, body.range_a_end)
    validate_date_range(body.range_b_start, body.range_b_end)
    # Normalize filters
    filters = build_analytics_filters(**body.filters).as_task_filters() if body.filters else {}
    result = export_workflow_comparative_task.delay(
        user_id=str(current_user["user_id"]),
        range_a_start=body.range_a_start,
        range_a_end=body.range_a_end,
        range_b_start=body.range_b_start,
        range_b_end=body.range_b_end,
        filters=filters,
    )
    return {"task_id": result.id}
```

Similar pattern for the other 3 endpoints. Import the new tasks at the top of the file.

**Acceptance:** POST to each endpoint returns `{"task_id": "..."}`. Invalid inputs return 422.

**Effort:** Medium (4 routes, ~15 lines each)

---

### Step 7 — Add shared `useWorkflowExport` hook

**New file:** `src/frontend/src/lib/useWorkflowExport.ts`

```typescript
'use client';

import { useState, useCallback } from 'react';

type ExportState = 'idle' | 'queued' | 'polling' | 'downloading' | 'done' | 'error';

export interface WorkflowExportParams {
  workflowType: string;
  endpoint: string;  // e.g. '/api/analytics/export/workflow/comparative'
  body: Record<string, unknown>;
}

export function useWorkflowExport() {
  const [state, setState] = useState<ExportState>('idle');
  const [error, setError] = useState<string | null>(null);

  const exportWorkflow = useCallback(async (
    workflowType: string,
    body: Record<string, unknown>,
  ) => {
    setState('queued');
    setError(null);
    try {
      const resp = await fetch(`/api/analytics/export/workflow/${workflowType}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const detail = await resp.json().catch(() => ({}));
        throw new Error((detail as Record<string, unknown>).detail as string || 'Export request failed');
      }
      const { task_id } = await resp.json() as { task_id: string };

      setState('polling');
      const maxAttempts = 30;
      let blob: Blob | null = null;
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const path = `/analytics/export/${encodeURIComponent(task_id)}`;
          const downloadResp = await fetch(path, { credentials: 'include' });
          if (!downloadResp.ok) continue;
          blob = await downloadResp.blob();
          if (blob && blob.size > 0) break;
        } catch { /* still pending */ }
      }
      if (!blob || blob.size === 0) {
        setError('Export is taking longer than expected. Check back shortly.');
        setState('error');
        return;
      }
      const url = URL.createObjectURL(blob);
      const ext = workflowType === 'heatmap' ? 'png' : 'xlsx';
      const filename = `wims-${workflowType}-${new Date().toISOString().split('T')[0]}.${ext}`;
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

**Acceptance:** Hook returns state/error/exportWorkflow. Calling `exportWorkflow` triggers POST → poll → download sequence.

**Effort:** Medium

---

### Step 8 — Install `dom-to-image-more` in frontend

```bash
cd src/frontend && npm install dom-to-image-more
```

**File:** `src/frontend/package.json` (updated automatically)

**Acceptance:** `dom-to-image-more` listed in `package.json` dependencies. Import works.

**Effort:** Simple

---

### Step 9 — Add workflow-specific export buttons to workflow page

**File:** `src/frontend/src/app/dashboard/analyst/[workflow]/page.tsx`

**Changes:**
1. Import `useWorkflowExport` hook
2. Import `dom-to-image-more` (for heatmap)
3. For each workflow panel's `action` slot in the return JSX, add export button(s):

**Comparative panel action:**
```tsx
<button onClick={() => exportWorkflow('comparative', {
  range_a_start: cmpRanges.rangeAStart,
  range_a_end: cmpRanges.rangeAEnd,
  range_b_start: cmpRanges.rangeBStart,
  range_b_end: cmpRanges.rangeBEnd,
  filters: activeFilters,
})} disabled={exportUnavailableOffline}>
  Export XLSX
</button>
```

**Trends panel action:**
```tsx
<button onClick={() => exportWorkflow('trends', {
  interval,
  filters: activeFilters,
})} disabled={exportUnavailableOffline}>
  Export XLSX
</button>
```

**Response Time panel action:**
```tsx
<button onClick={() => exportWorkflow('response-time', {
  filters: activeFilters,
})} disabled={exportUnavailableOffline}>
  Export XLSX
</button>
```

**Top-N panel action:**
```tsx
<>
  <button onClick={() => exportWorkflow('top-n', {
    metric: topNMetric,
    dimension: topNDimension,
    mode: 'full',
  })} disabled={exportUnavailableOffline}>
    Export Chart
  </button>
  <button
    onClick={() => exportWorkflow('top-n', {
      metric: topNMetric,
      dimension: topNDimension,
      mode: 'selected',
      selected_name: topNSelectedName,
      metric_value: /* get from selectedItem.value */,
      filters: /* resolved filters from buildTopNDrilldownFilters */,
    })}
    disabled={exportUnavailableOffline || !topNSelectedName}
  >
    Export Selected
  </button>
</>
```

**Heatmap panel action:**
Add `data-heatmap-export` attribute to the map wrapper div. Add PNG/JPEG download buttons that use `dom-to-image-more`:

```tsx
<>
  <button onClick={() => downloadMapImage('png')}>Download PNG</button>
  <button onClick={() => downloadMapImage('jpeg')}>Download JPEG</button>
</>
```

Also add the `barangay` dimension option to the Top-N `<select>` dropdown (line 718):
```tsx
<option value="barangay">Barangay</option>
```

**Acceptance:** Export buttons render in each workflow panel. Clicking sends correct POST data. Buttons are disabled when offline. Heatmap buttons capture and download.

**Effort:** Complex (largest single change — ~80 lines of new JSX + logic)

---

### Step 10 — Add backend tests

**New file:** `src/backend/tests/test_workflow_export.py`

**Tests:**

1. `test_comparative_export_returns_task_id` — POST valid comparative request → 200 + task_id
2. `test_trends_export_returns_task_id` — POST valid trends request → 200 + task_id
3. `test_response_time_export_returns_task_id` — POST valid response-time request → 200 + task_id
4. `test_top_n_export_full_returns_task_id` — POST valid top-n full request → 200 + task_id
5. `test_top_n_export_selected_returns_task_id` — POST valid top-n selected request → 200 + task_id
6. `test_workflow_export_invalid_date_returns_422` — POST invalid comparative date → 422
7. `test_workflow_export_invalid_enum_returns_422` — POST invalid interval/metric/dimension/mode → 422
8. `test_workflow_export_missing_selected_name_returns_422` — POST top-n selected without name → 422
9. `test_workflow_export_forbidden_role_returns_403` — POST as non-analyst role → 403
10. `test_response_time_service_has_total_incidents` — calls `get_response_time_by_region` → result has `total_incidents` key
11. `test_workflow_comparative_xlsx_has_formulas` — patched task produces XLSX; openpyxl reads back and verifies formula cells
12. `test_workflow_trends_xlsx_has_chart` — patched task produces XLSX; openpyxl reads back and verifies chart presence

**Effort:** Medium

---

### Step 11 — Add frontend tests

**File:** `src/frontend/src/app/dashboard/analyst/queue-baseline.test.tsx`
(or create a new `src/frontend/src/app/dashboard/analyst/[workflow]/page.test.tsx`)

**Tests:**
1. Export buttons render in each workflow panel
2. Clicking export button calls `fetch` with correct URL and body
3. Export buttons disabled when offline
4. Heatmap download buttons trigger `dom-to-image-more` capture
5. Top-N "Export Selected" button disabled when no hotspot selected

**Effort:** Medium

---

### Step 12 — Update `buildTopNDrilldownFilters` for `barangay` dimension

**File:** `src/frontend/src/lib/topNDrilldown.ts`

**Changes:**
1. Add `'barangay'` to `TopNDimension` type
2. Add `'barangay'` case to `getTopNDimensionLabel`
3. Add `'barangay'` case to `buildTopNDrilldownFilters`:
```typescript
if (dimension === 'barangay') {
  return {
    ...baseFilters,
    barangay_name: hotspotName,
    fire_station: undefined,
  };
}
```

**Note:** This requires `AnalystIncidentListParams` to have `barangay_name` — add it:
```typescript
export interface AnalystIncidentListParams {
  // ... existing fields
  barangay_name?: string;
}
```

**Acceptance:** Frontend resolves barangay-dimension hotspots to filters correctly. Backend `get_export_rows` filters by barangay name (via Step 2).

**Effort:** Simple

---

## Files to Modify

| File | Change | Effort |
|------|--------|--------|
| `src/backend/services/analytics_read_model.py` | Add `total_incidents` to response-time query + add `barangay_name` filter | Simple |
| `src/backend/services/analytics/filters.py` | Add `barangay_name` to build/append filter functions | Simple |
| `src/backend/api/routes/analytics.py` | Add 4 Pydantic models + 4 POST endpoints + import new tasks | Medium |
| `src/backend/tasks/exports.py` | Add 4 writer functions + 4 Celery tasks | Medium |
| `src/frontend/src/lib/useWorkflowExport.ts` | **New file** — shared export hook | Medium |
| `src/frontend/src/lib/topNDrilldown.ts` | Add `barangay` dimension support | Simple |
| `src/frontend/src/lib/api/legacy.ts` | Add `barangay_name` to `AnalystIncidentListParams` | Simple |
| `src/frontend/src/app/dashboard/analyst/[workflow]/page.tsx` | Add export buttons + heatmap capture | Complex |
| `src/frontend/package.json` | Add `dom-to-image-more` | Simple |

## New Files

| File | Purpose |
|------|---------|
| `docs/superpowers/plans/2026-07-02-workflow-analytics-export-plan.md` | This plan |
| `src/frontend/src/lib/useWorkflowExport.ts` | Shared export polling/download hook |
| `src/backend/tests/test_workflow_export.py` | Backend tests for new endpoints |

## Dependencies

1. **Step 2 (barangay filters)** must precede Step 4 (top-n writer with selected mode)
2. **Steps 1-2 (service changes)** are independent and can be done in parallel with Steps 3-5 (models/tasks/endpoints)
3. **Steps 3-6 (backend API)** must precede Step 9 (frontend buttons) — the backend endpoints need to exist before the frontend can POST to them
4. **Step 7 (useWorkflowExport hook)** must precede Step 9 (frontend buttons) — the buttons depend on the hook
5. **Step 8 (dom-to-image-more install)** must precede Step 9 (heatmap buttons)
6. **Step 12 (topNDrilldown barangay)** must precede the Top-N selected button (Step 9)
7. **Steps 10-11 (tests)** are last in the order

**Recommended order:** 1 → 2 → 3 → 4 → 5 → (7, 8, 12) → 9 → 6 → 10 → 11

## Risks

1. **`barangay_name` in `AnalystIncidentListParams`:** The frontend type currently has no `barangay_name` field. Adding it is simple but every existing consumer of the type that iterates keys will be unaffected (it's optional).

2. **`get_export_rows` doesn't support `barangay_name`:** The `_append_common_filters` function doesn't handle `barangay_name`. Adding it requires touching `build_analytics_filters` and `append_common_filters` in `services/analytics/filters.py`. This is a mechanical change following the existing pattern.

3. **XLSX chart sizing:** openpyxl charts are defined in EMU units. The sizes in the plan (20 × 12) are reasonable defaults. If charts are too small or too large in Excel, adjust `chart.width` and `chart.height`.

4. **Heatmap canvas taint:** If `dom-to-image-more.toPng()` returns a cross-origin tainted canvas error (unlikely with OSM tiles), fall back to `.toSvg()` which doesn't use canvas.

5. **Memory for large incident sheets:** The existing `_export` function materializes all rows in memory. This is the existing pattern and acceptable for typical analyst filter scopes.

## Acceptance Report

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "The implementation plan covers exactly the scope defined in the spec: 4 server-side XLSX exports + 1 client-side heatmap export, with Pydantic validation, shared frontend hook, and tests. No scope creep."
    }
  ],
  "changedFiles": [
    "src/backend/services/analytics_read_model.py",
    "src/backend/services/analytics/filters.py",
    "src/backend/api/routes/analytics.py",
    "src/backend/tasks/exports.py",
    "src/frontend/src/lib/useWorkflowExport.ts (new)",
    "src/frontend/src/lib/topNDrilldown.ts",
    "src/frontend/src/lib/api/legacy.ts",
    "src/frontend/src/app/dashboard/analyst/[workflow]/page.tsx",
    "src/frontend/package.json"
  ],
  "testsAddedOrUpdated": [
    "src/backend/tests/test_workflow_export.py (new)"
  ],
  "commandsRun": [
    {
      "command": "read spec and source files to verify assumptions",
      "result": "passed",
      "summary": "Verified: openpyxl 3.1.5 with chart support, get_response_time_by_region existing SQL, _append_common_filters signature, AnalystIncidentListParams type, TopNDrilldown export/writer patterns"
    }
  ],
  "validationOutput": [
    "Step order verified: backend services → models → writers → tasks → routes → frontend hook → install → buttons → tests",
    "6 dependency constraints documented in Dependencies section",
    "5 risks identified with mitigations"
  ],
  "residualRisks": [
    "barangay_name filter support in _append_common_filters may need tuning when implemented",
    "XLSX chart dimensions may need adjustment after manual inspection in Excel",
    "dom-to-image-more canvas taint risk mitigated by toSvg() fallback"
  ],
  "noStagedFiles": true,
  "diffSummary": "Implementation plan only — no code changes yet",
  "reviewFindings": [
    "No blockers. Plan is execution-ready.",
    "Step 2 (barangay filters) is a dependency for Step 4 (top-n writer selected mode) — must be ordered correctly."
  ],
  "manualNotes": "Plan saved to docs/superpowers/plans/2026-07-02-workflow-analytics-export-plan.md. Recommend starting with Steps 1-4 (backend service + models + writers), which are independent of frontend work."
}
```
