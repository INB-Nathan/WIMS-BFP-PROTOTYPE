# Operations Linked Civilian Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a validator-only linked civilian report workflow for `/home` Operations Board, with read-only linked report details for other staff roles and a 70/30 map-first console.

**Architecture:** Backend owns authorization, status transitions, uniqueness, spatial mapping, and PII minimization. Frontend consumes typed operations APIs, renders a persistent split console, and keeps validator mutations inside the selected-operation panel and create-operation modal. Implementation is TDD-first: one failing behavior test, verify RED, minimal code, verify GREEN, then repeat.

**Tech Stack:** FastAPI, SQLAlchemy text queries, PostgreSQL/PostGIS, Pydantic, pytest, Next.js App Router, React 19, TypeScript, Vitest, React Testing Library, react-leaflet, TailwindCSS.

## Global Constraints

- Backend RBAC remains the source of truth; frontend role checks only hide or show UI affordances.
- Only `NATIONAL_VALIDATOR` can create/update/delete operations or link/unlink reports.
- `REGIONAL_ENCODER`, `NATIONAL_ANALYST`, and `SYSTEM_ADMIN` can read operations and linked report details, but must not see add/remove controls.
- Linked report details must exclude witness name, witness phone, device ID, IP hash, and other civilian PII.
- Linkable reports include only `PENDING`, `UNDER_REVIEW`, `LINKED`, and `ACTIONED`; rejected reports are excluded.
- One civilian report can belong to only one operation at a time.
- Link status transition: `PENDING` / `UNDER_REVIEW` / `LINKED` -> `LINKED`; `ACTIONED` remains `ACTIONED`.
- Unlink status transition: `LINKED` -> `UNDER_REVIEW`; `ACTIONED` remains `ACTIONED`.
- Citizen report `latitude` / `longitude` are derived from `ST_Y(location::geometry)` / `ST_X(location::geometry)`, not `phone_latitude` / `phone_longitude`.
- Distance sorting/display uses PostGIS SQL distance functions, not FastAPI application-layer coordinate loops.
- Desktop/tablet Operations Board uses about 70% map and 30% operations/report panel; mobile stacks map first.
- Follow existing frontend rule: API calls go through `src/frontend/src/lib/api/`; components do not call `fetch()` directly.
- Run backend commands from `src/backend/`; run frontend commands from `src/frontend/`.

---

## File Structure

### Backend files

- Modify: `src/backend/schemas/operations.py`
  - Add linked report response/search schemas.
  - Add optional `linked_report_ids` to `OperationCreate`.
  - Add `linked_reports` to `OperationResponse`.
- Modify: `src/backend/api/routes/operations.py`
  - Batch-fetch linked report details for `GET /api/operations`.
  - Add `GET /api/operations/linkable-reports` guarded by `get_national_validator`.
  - Apply transactional create/link/unlink status transitions.
  - Replace `ON CONFLICT DO NOTHING` with explicit conflict responses.
- Create: `src/postgres-init/71_operation_report_unique.sql`
  - Fail fast if duplicate `report_id` links exist.
  - Add a unique index/constraint for one-operation-per-report.
- Modify: `src/backend/tests/test_operations.py`
  - Unit-style route tests using existing `TestClient` and mock DB patterns.
- Create: `src/backend/tests/integration/test_operations_linked_reports_sql.py`
  - SQL contract tests for PostGIS field derivation and migration text.

### Frontend files

- Modify: `src/frontend/src/lib/api/operations.ts`
  - Add `LinkedReportDetail`, `LinkableReportSearchParams`, `fetchLinkableReports`, `linked_report_ids` on create payload, and `linked_reports` on operation response.
- Modify: `src/frontend/src/components/OperationsMap.tsx`
  - Add selected operation centering.
  - Add linked report markers for selected operation.
  - Preserve fallback for operations without coordinates.
- Create: `src/frontend/src/components/operations/LinkedReportCard.tsx`
  - Presentational linked-report card with read-only/validator action modes.
- Create: `src/frontend/src/components/operations/LinkableReportSearch.tsx`
  - Validator-only search/filter UI for linkable reports.
- Create: `src/frontend/src/components/operations/OperationsConsole.tsx`
  - Split map + panel composition.
- Modify: `src/frontend/src/app/home/page.tsx`
  - Replace table/map toggle with `OperationsConsole`.
  - Wire selected operation, report linking, and create modal.
- Modify: `src/frontend/src/app/home/__tests__/operations-board.test.tsx`
  - Update existing tests from table/map toggle assumptions to split console behavior.
- Modify: `src/frontend/src/app/tracking/page.tsx`
  - Change `LINKED` status copy to neutral active-operation wording.
- Create or modify: `src/frontend/src/app/tracking/page.test.tsx` if existing tracking tests cover status copy; otherwise keep the tracking copy assertion in the closest existing tracking test file.

### Documentation files

- Modify: `system-wiki/frontend/route-map.md`
  - Document `/home` 70/30 Operations Board and validator-only report linking controls.
- Modify: `system-wiki/backend/api-route-map.md`
  - Document changed `/api/operations` response and new `/api/operations/linkable-reports` endpoint.
- Modify: `system-wiki/log.md`
  - Add implementation summary and verification results.

---

### Task 1: Backend response contract for linked report details

**Files:**
- Modify: `src/backend/schemas/operations.py`
- Modify: `src/backend/api/routes/operations.py`
- Modify: `src/backend/tests/test_operations.py`

**Interfaces:**
- Consumes: existing `GET /api/operations`, existing `OperationResponse`, existing mock DB helper `_make_db()`.
- Produces:
  - `schemas.operations.OperationLinkedReport`
  - `OperationResponse.linked_reports: list[OperationLinkedReport]`
  - `GET /api/operations` response with both `linked_report_ids` and `linked_reports`.

- [ ] **Step 1: Write the failing backend test for linked report details without PII**

Add this helper class near the existing DB mock helpers in `src/backend/tests/test_operations.py`:

```python
class _LinkedReportRow:
    def __init__(self, operation_id=1, report_id=5, status="PENDING"):
        self.operation_id = operation_id
        self.report_id = report_id
        self.status = status
        self.category = "STRUCTURAL"
        self.sub_category = "Residential"
        self.reported_at = "2026-06-10T07:55:00+00:00"
        self.created_at = "2026-06-10T07:56:00+00:00"
        self.latitude = 14.5995
        self.longitude = 120.9842
        self.trust_score = 80
        self.safety_status = "I_AM_SAFE"
        self.reporting_context = "WITNESS"
        self.linked_operation_id = operation_id
        self.linked_operation_label = f"Operation #{operation_id}"
        self.distance_meters = 42.0
```

Add this test class after `TestListOperations`:

```python
class TestListOperationsLinkedReportDetails:
    def test_list_operations_returns_linked_reports_without_pii(self, client: TestClient):
        row = _op_row()
        linked_row = _LinkedReportRow()

        def execute_side_effect(query, params=None):
            result = MagicMock()
            sql = str(query)
            if "ST_Y(cr.location::geometry)" in sql and "operation_citizen_reports" in sql:
                result.fetchall.return_value = [linked_row]
            elif "operation_citizen_reports" in sql and "SELECT" in sql:
                result.fetchall.return_value = [linked_row]
            elif "wims.operations" in sql:
                result.fetchall.return_value = [row]
                result.fetchone.return_value = row
            else:
                result.fetchall.return_value = []
                result.fetchone.return_value = None
            result.rowcount = 1
            return result

        mock_db = MagicMock()
        mock_db.execute.side_effect = execute_side_effect
        app.dependency_overrides[get_db] = lambda: mock_db
        app.dependency_overrides[get_incident_viewer] = lambda: _mock_encoder()

        resp = client.get("/api/operations")

        assert resp.status_code == 200
        data = resp.json()[0]
        assert data["linked_report_ids"] == [5]
        assert data["linked_reports"] == [
            {
                "report_id": 5,
                "status": "PENDING",
                "category": "STRUCTURAL",
                "sub_category": "Residential",
                "reported_at": "2026-06-10T07:55:00+00:00",
                "latitude": 14.5995,
                "longitude": 120.9842,
                "trust_score": 80,
                "safety_status": "I_AM_SAFE",
                "reporting_context": "WITNESS",
                "linked_operation_id": 1,
                "linked_operation_label": "Operation #1",
                "distance_meters": 42.0,
            }
        ]
        serialized = str(data["linked_reports"])
        assert "witness" not in serialized.lower()
        assert "phone" not in serialized.lower()
        assert "device" not in serialized.lower()
        assert "ip_hash" not in serialized.lower()
```

- [ ] **Step 2: Run the failing test and verify RED**

Run from `src/backend/`:

```bash
pytest tests/test_operations.py::TestListOperationsLinkedReportDetails::test_list_operations_returns_linked_reports_without_pii -v
```

Expected: FAIL because `linked_reports` is missing from the response schema/body.

- [ ] **Step 3: Add backend schema types**

In `src/backend/schemas/operations.py`, add this model above `OperationResponse`:

```python
class OperationLinkedReport(BaseModel):
    report_id: int
    status: str
    category: str
    sub_category: Optional[str] = None
    reported_at: Optional[datetime] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    trust_score: Optional[int] = None
    safety_status: Optional[str] = None
    reporting_context: Optional[str] = None
    linked_operation_id: Optional[int] = None
    linked_operation_label: Optional[str] = None
    distance_meters: Optional[float] = None
```

Then add this field to `OperationResponse`:

```python
    linked_reports: list[OperationLinkedReport] = []
```

- [ ] **Step 4: Add linked report mapping helpers**

In `src/backend/api/routes/operations.py`, update imports:

```python
from schemas.operations import (
    FireStatus,
    LinkReportRequest,
    OperationCreate,
    OperationLinkedReport,
    OperationResponse,
    OperationUpdate,
)
```

Add these helpers above `_row_to_response`:

```python
def _linked_report_row_to_schema(row) -> OperationLinkedReport:
    return OperationLinkedReport(
        report_id=row.report_id,
        status=str(row.status),
        category=row.category,
        sub_category=row.sub_category,
        reported_at=row.reported_at or getattr(row, "created_at", None),
        latitude=float(row.latitude) if row.latitude is not None else None,
        longitude=float(row.longitude) if row.longitude is not None else None,
        trust_score=row.trust_score,
        safety_status=row.safety_status,
        reporting_context=row.reporting_context,
        linked_operation_id=getattr(row, "linked_operation_id", None),
        linked_operation_label=getattr(row, "linked_operation_label", None),
        distance_meters=float(row.distance_meters) if getattr(row, "distance_meters", None) is not None else None,
    )


def _fetch_linked_reports_for_operations(
    db: Session,
    operation_ids: list[int],
) -> dict[int, list[OperationLinkedReport]]:
    if not operation_ids:
        return {}
    placeholders = ", ".join(f":oid{i}" for i in range(len(operation_ids)))
    params = {f"oid{i}": oid for i, oid in enumerate(operation_ids)}
    rows = db.execute(
        text(
            f"""
            SELECT
                ocr.operation_id,
                cr.report_id,
                cr.status,
                cr.category,
                cr.sub_category,
                cr.reported_at,
                cr.created_at,
                ST_Y(cr.location::geometry) AS latitude,
                ST_X(cr.location::geometry) AS longitude,
                cr.trust_score,
                cr.safety_status,
                cr.reporting_context,
                ocr.operation_id AS linked_operation_id,
                ('Operation #' || ocr.operation_id::text) AS linked_operation_label,
                CASE
                    WHEN op.latitude IS NOT NULL AND op.longitude IS NOT NULL THEN
                        ST_DistanceSphere(
                            cr.location::geometry,
                            ST_SetSRID(ST_MakePoint(op.longitude, op.latitude), 4326)
                        )
                    ELSE NULL
                END AS distance_meters
            FROM wims.operation_citizen_reports ocr
            JOIN wims.citizen_reports cr ON cr.report_id = ocr.report_id
            JOIN wims.operations op ON op.operation_id = ocr.operation_id
            WHERE ocr.operation_id IN ({placeholders})
            ORDER BY cr.reported_at DESC NULLS LAST, cr.created_at DESC
            """,
        ),
        params,
    ).fetchall()
    grouped: dict[int, list[OperationLinkedReport]] = {oid: [] for oid in operation_ids}
    for row in rows:
        grouped.setdefault(row.operation_id, []).append(_linked_report_row_to_schema(row))
    return grouped
```

- [ ] **Step 5: Thread linked report details through the operation response**

Change `_row_to_response` signature and body in `src/backend/api/routes/operations.py`:

```python
def _row_to_response(
    row,
    linked_report_ids: list[int] | None = None,
    db: Session | None = None,
    linked_reports: list[OperationLinkedReport] | None = None,
) -> OperationResponse:
    if linked_report_ids is None and db is not None:
        result = db.execute(
            text("SELECT report_id FROM wims.operation_citizen_reports WHERE operation_id = :oid"),
            {"oid": row.operation_id},
        ).fetchall()
        linked_report_ids = [r.report_id for r in result]
    elif linked_report_ids is None:
        linked_report_ids = []
    if linked_reports is None:
        linked_reports = []
    return OperationResponse(
        operation_id=row.operation_id,
        fire_status=row.fire_status,
        start_time=row.start_time,
        location=row.location,
        size_hectares=row.size_hectares,
        notes=row.notes,
        created_by=row.created_by,
        created_at=row.created_at,
        updated_at=row.updated_at,
        latitude=getattr(row, "latitude", None),
        longitude=getattr(row, "longitude", None),
        radius_meters=getattr(row, "radius_meters", None),
        linked_report_ids=linked_report_ids,
        linked_reports=linked_reports,
    )
```

Update the end of `list_operations()`:

```python
    linked_reports_by_op = _fetch_linked_reports_for_operations(db, op_ids)

    return [
        _row_to_response(
            r,
            linked_by_op.get(r.operation_id, []),
            linked_reports=linked_reports_by_op.get(r.operation_id, []),
        )
        for r in rows
    ]
```

- [ ] **Step 6: Run the targeted test and existing operations route suite; verify GREEN**

Run from `src/backend/`:

```bash
pytest tests/test_operations.py::TestListOperationsLinkedReportDetails::test_list_operations_returns_linked_reports_without_pii -v
pytest tests/test_operations.py -v
```

Expected: both commands PASS. If an existing list-operations mock starts failing because a future test passes ID-shaped rows through the new detail-query branch, split that mock branch so detail rows and report-ID rows are returned by different SQL predicates.

- [ ] **Step 7: Commit Task 1**

```bash
git add src/backend/schemas/operations.py src/backend/api/routes/operations.py src/backend/tests/test_operations.py
git commit -m "feat: return linked report details on operations"
```

---

### Task 2: Database uniqueness and linkable report search endpoint

**Files:**
- Create: `src/postgres-init/71_operation_report_unique.sql`
- Modify: `src/backend/schemas/operations.py`
- Modify: `src/backend/api/routes/operations.py`
- Modify: `src/backend/tests/test_operations.py`
- Create: `src/backend/tests/integration/test_operations_linked_reports_sql.py`

**Interfaces:**
- Consumes: `OperationLinkedReport` from Task 1.
- Produces:
  - `GET /api/operations/linkable-reports`
  - `schemas.operations.LinkableReportSearchResponse`
  - one-operation-per-report DB invariant.

- [ ] **Step 1: Write failing tests for validator-only search and rejected exclusion**

Add this test class to `src/backend/tests/test_operations.py`:

```python
class TestLinkableReportsSearch:
    def test_linkable_reports_requires_validator(self, client: TestClient):
        _, get_db_override = _make_db()
        app.dependency_overrides[get_db_with_rls] = get_db_override
        app.dependency_overrides[auth.get_current_wims_user] = _mock_encoder

        resp = client.get("/api/operations/linkable-reports")

        assert resp.status_code == 403

    def test_linkable_reports_returns_disabled_already_linked_cards(self, client: TestClient):
        linked_row = _LinkedReportRow(operation_id=2, report_id=9, status="LINKED")

        def execute_side_effect(query, params=None):
            result = MagicMock()
            sql = str(query)
            if "FROM wims.citizen_reports cr" in sql:
                result.fetchall.return_value = [linked_row]
            else:
                result.fetchall.return_value = []
            result.fetchone.return_value = None
            result.rowcount = 1
            return result

        mock_db = MagicMock()
        mock_db.execute.side_effect = execute_side_effect
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db
        app.dependency_overrides[get_national_validator] = _mock_validator
        app.dependency_overrides[auth.get_current_wims_user] = _mock_validator

        resp = client.get("/api/operations/linkable-reports?operation_id=1")

        assert resp.status_code == 200
        data = resp.json()
        assert data[0]["report_id"] == 9
        assert data[0]["linked_operation_id"] == 2
        assert data[0]["link_disabled"] is True
        assert data[0]["disabled_reason"] == "Already linked to Operation #2"
        executed_sql = "\n".join(str(call.args[0]) for call in mock_db.execute.call_args_list)
        assert "REJECTED_%" in executed_sql
        assert "ST_Y(cr.location::geometry)" in executed_sql
        assert "ST_X(cr.location::geometry)" in executed_sql
        assert "phone_latitude" not in executed_sql
        assert "phone_longitude" not in executed_sql
```

- [ ] **Step 2: Write failing SQL contract tests for uniqueness migration**

Create `src/backend/tests/integration/test_operations_linked_reports_sql.py`:

```python
from pathlib import Path


def test_operation_report_unique_migration_fails_before_duplicate_constraint():
    sql = Path("../postgres-init/71_operation_report_unique.sql").read_text()

    assert "duplicate operation_citizen_reports.report_id" in sql
    assert "GROUP BY report_id" in sql
    assert "COUNT(*) > 1" in sql
    assert "RAISE EXCEPTION" in sql


def test_operation_report_unique_migration_adds_report_id_unique_index():
    sql = Path("../postgres-init/71_operation_report_unique.sql").read_text()

    assert "CREATE UNIQUE INDEX IF NOT EXISTS uq_operation_citizen_reports_report_id" in sql
    assert "ON wims.operation_citizen_reports (report_id)" in sql
```

- [ ] **Step 3: Run tests and verify RED**

Run from `src/backend/`:

```bash
pytest tests/test_operations.py::TestLinkableReportsSearch tests/integration/test_operations_linked_reports_sql.py -v
```

Expected: FAIL because the endpoint and migration file do not exist.

- [ ] **Step 4: Add the uniqueness migration**

Create `src/postgres-init/71_operation_report_unique.sql`:

```sql
-- 71_operation_report_unique.sql
-- Enforce one-operation-per-civilian-report for the Operations Board.
-- Idempotent: YES for the index creation; deliberately fails if duplicates exist.

BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT report_id
        FROM wims.operation_citizen_reports
        GROUP BY report_id
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'duplicate operation_citizen_reports.report_id rows must be resolved before adding one-operation-per-report uniqueness';
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_operation_citizen_reports_report_id
    ON wims.operation_citizen_reports (report_id);

COMMIT;
```

- [ ] **Step 5: Add search response schema**

In `src/backend/schemas/operations.py`, add:

```python
class LinkableReportSearchResponse(OperationLinkedReport):
    link_disabled: bool = False
    disabled_reason: Optional[str] = None
```

Update the imports in `src/backend/api/routes/operations.py` to include it:

```python
    LinkableReportSearchResponse,
```

- [ ] **Step 6: Add the validator-only search endpoint**

In `src/backend/api/routes/operations.py`, add below `list_operations()` and before `create_operation()`:

```python
@router.get("/linkable-reports", response_model=list[LinkableReportSearchResponse])
def list_linkable_reports(
    current_user: Annotated[dict, Depends(get_national_validator)],
    db: Annotated[Session, Depends(get_db_with_rls)],
    operation_id: Optional[int] = Query(None),
    q: Optional[str] = Query(None),
    status: Optional[List[str]] = Query(None),
    category: Optional[str] = Query(None),
    start: Optional[datetime] = Query(None),
    end: Optional[datetime] = Query(None),
    latitude: Optional[float] = Query(None, ge=-90, le=90),
    longitude: Optional[float] = Query(None, ge=-180, le=180),
) -> list[LinkableReportSearchResponse]:
    allowed_statuses = {"PENDING", "UNDER_REVIEW", "LINKED", "ACTIONED"}
    requested_statuses = [s for s in (status or []) if s in allowed_statuses]

    params: dict[str, object] = {}
    where = ["cr.status IN ('PENDING', 'UNDER_REVIEW', 'LINKED', 'ACTIONED')"]
    where.append("cr.status NOT LIKE 'REJECTED_%'")

    if requested_statuses:
        placeholders = ", ".join(f":status{i}" for i in range(len(requested_statuses)))
        where.append(f"cr.status IN ({placeholders})")
        params.update({f"status{i}": s for i, s in enumerate(requested_statuses)})
    if q:
        where.append("(cr.category ILIKE :q OR cr.sub_category ILIKE :q)")
        params["q"] = f"%{q}%"
    if category:
        where.append("cr.category = :category")
        params["category"] = category
    if start:
        where.append("COALESCE(cr.reported_at, cr.created_at) >= :start")
        params["start"] = start
    if end:
        where.append("COALESCE(cr.reported_at, cr.created_at) <= :end")
        params["end"] = end

    origin_select = "NULL::double precision AS origin_latitude, NULL::double precision AS origin_longitude"
    distance_expr = "NULL::double precision AS distance_meters"
    if operation_id is not None:
        params["operation_id"] = operation_id
        origin_select = "op_origin.latitude AS origin_latitude, op_origin.longitude AS origin_longitude"
        distance_expr = """
            CASE
                WHEN op_origin.latitude IS NOT NULL AND op_origin.longitude IS NOT NULL THEN
                    ST_DistanceSphere(
                        cr.location::geometry,
                        ST_SetSRID(ST_MakePoint(op_origin.longitude, op_origin.latitude), 4326)
                    )
                ELSE NULL
            END AS distance_meters
        """
    elif latitude is not None and longitude is not None:
        params["latitude"] = latitude
        params["longitude"] = longitude
        distance_expr = """
            ST_DistanceSphere(
                cr.location::geometry,
                ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326)
            ) AS distance_meters
        """

    origin_join = "LEFT JOIN wims.operations op_origin ON op_origin.operation_id = :operation_id" if operation_id is not None else ""
    rows = db.execute(
        text(
            f"""
            SELECT
                cr.report_id,
                cr.status,
                cr.category,
                cr.sub_category,
                cr.reported_at,
                cr.created_at,
                ST_Y(cr.location::geometry) AS latitude,
                ST_X(cr.location::geometry) AS longitude,
                cr.trust_score,
                cr.safety_status,
                cr.reporting_context,
                ocr.operation_id AS linked_operation_id,
                CASE
                    WHEN ocr.operation_id IS NOT NULL THEN 'Operation #' || ocr.operation_id::text
                    ELSE NULL
                END AS linked_operation_label,
                {origin_select},
                {distance_expr}
            FROM wims.citizen_reports cr
            LEFT JOIN wims.operation_citizen_reports ocr ON ocr.report_id = cr.report_id
            {origin_join}
            WHERE {' AND '.join(where)}
            ORDER BY distance_meters ASC NULLS LAST, COALESCE(cr.reported_at, cr.created_at) DESC
            LIMIT 100
            """,
        ),
        params,
    ).fetchall()

    response: list[LinkableReportSearchResponse] = []
    for row in rows:
        base = _linked_report_row_to_schema(row)
        disabled = row.linked_operation_id is not None and row.linked_operation_id != operation_id
        response.append(
            LinkableReportSearchResponse(
                **base.model_dump(),
                link_disabled=disabled,
                disabled_reason=(
                    f"Already linked to Operation #{row.linked_operation_id}" if disabled else None
                ),
            )
        )
    return response
```

- [ ] **Step 7: Run targeted tests and verify GREEN**

Run from `src/backend/`:

```bash
pytest tests/test_operations.py::TestLinkableReportsSearch tests/integration/test_operations_linked_reports_sql.py -v
```

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

```bash
git add src/postgres-init/71_operation_report_unique.sql src/backend/schemas/operations.py src/backend/api/routes/operations.py src/backend/tests/test_operations.py src/backend/tests/integration/test_operations_linked_reports_sql.py
git commit -m "feat: add linkable report search contract"
```

---

### Task 3: Transactional link/unlink/create status transitions

**Files:**
- Modify: `src/backend/schemas/operations.py`
- Modify: `src/backend/api/routes/operations.py`
- Modify: `src/backend/tests/test_operations.py`

**Interfaces:**
- Consumes:
  - `OperationCreate.linked_report_ids`
  - `LinkReportRequest.report_id`
  - uniqueness invariant from Task 2.
- Produces:
  - transactional `create_operation(... linked_report_ids=[...])`
  - conflict-aware `link_report()`
  - status-aware `unlink_report()`.

- [ ] **Step 1: Write failing tests for conflict and status transitions**

Add this row helper to `src/backend/tests/test_operations.py`:

```python
class _CitizenReportStatusRow:
    def __init__(self, report_id=5, status="PENDING", linked_operation_id=None):
        self.report_id = report_id
        self.status = status
        self.linked_operation_id = linked_operation_id
```

Add this test class:

```python
class TestReportLinkStatusTransitions:
    def test_link_report_conflict_when_report_belongs_to_other_operation(self, client: TestClient):
        op = _op_row(operation_id=1)

        def execute_side_effect(query, params=None):
            result = MagicMock()
            sql = str(query)
            if "SELECT * FROM wims.operations" in sql:
                result.fetchone.return_value = op
            elif "operation_citizen_reports" in sql and "WHERE report_id = :rid" in sql:
                result.fetchone.return_value = _CitizenReportStatusRow(report_id=5, linked_operation_id=2)
            else:
                result.fetchone.return_value = None
                result.fetchall.return_value = []
            result.rowcount = 1
            return result

        mock_db = MagicMock()
        mock_db.execute.side_effect = execute_side_effect
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db
        app.dependency_overrides[get_national_validator] = _mock_validator
        app.dependency_overrides[auth.get_current_wims_user] = _mock_validator

        resp = client.post("/api/operations/1/link", json={"report_id": 5})

        assert resp.status_code == 409
        assert resp.json()["detail"] == "Report already linked to Operation #2"
        assert not any("INSERT INTO wims.operation_citizen_reports" in str(call.args[0]) for call in mock_db.execute.call_args_list)

    def test_link_report_same_operation_is_idempotent(self, client: TestClient):
        op = _op_row(operation_id=1)

        def execute_side_effect(query, params=None):
            result = MagicMock()
            sql = str(query)
            if "SELECT * FROM wims.operations" in sql:
                result.fetchone.return_value = op
            elif "operation_citizen_reports" in sql and "WHERE report_id = :rid" in sql:
                result.fetchone.return_value = _CitizenReportStatusRow(report_id=5, linked_operation_id=1)
            elif "SELECT report_id FROM wims.operation_citizen_reports" in sql:
                linked = MagicMock()
                linked.report_id = 5
                result.fetchall.return_value = [linked]
            else:
                result.fetchone.return_value = None
                result.fetchall.return_value = []
            result.rowcount = 1
            return result

        mock_db = MagicMock()
        mock_db.execute.side_effect = execute_side_effect
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db
        app.dependency_overrides[get_national_validator] = _mock_validator
        app.dependency_overrides[auth.get_current_wims_user] = _mock_validator

        resp = client.post("/api/operations/1/link", json={"report_id": 5})

        assert resp.status_code == 201
        assert not any("INSERT INTO wims.operation_citizen_reports" in str(call.args[0]) for call in mock_db.execute.call_args_list)

    @pytest.mark.parametrize(
        ("initial_status", "expected_status"),
        [("PENDING", "LINKED"), ("UNDER_REVIEW", "LINKED"), ("LINKED", "LINKED"), ("ACTIONED", "ACTIONED")],
    )
    def test_link_report_applies_expected_status_transition(self, client: TestClient, initial_status, expected_status):
        op = _op_row(operation_id=1)
        report = _CitizenReportStatusRow(report_id=5, status=initial_status, linked_operation_id=None)
        executed_updates: list[dict] = []

        def execute_side_effect(query, params=None):
            result = MagicMock()
            sql = str(query)
            if "SELECT * FROM wims.operations" in sql:
                result.fetchone.return_value = op
            elif "operation_citizen_reports" in sql and "WHERE report_id = :rid" in sql:
                result.fetchone.return_value = None
            elif "SELECT report_id, status FROM wims.citizen_reports" in sql:
                result.fetchone.return_value = report
            elif "UPDATE wims.citizen_reports" in sql:
                executed_updates.append(params)
                result.rowcount = 1
            elif "SELECT report_id FROM wims.operation_citizen_reports" in sql:
                linked = MagicMock()
                linked.report_id = 5
                result.fetchall.return_value = [linked]
            else:
                result.fetchone.return_value = None
                result.fetchall.return_value = []
            result.rowcount = getattr(result, "rowcount", 1)
            return result

        mock_db = MagicMock()
        mock_db.execute.side_effect = execute_side_effect
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db
        app.dependency_overrides[get_national_validator] = _mock_validator
        app.dependency_overrides[auth.get_current_wims_user] = _mock_validator

        resp = client.post("/api/operations/1/link", json={"report_id": 5})

        assert resp.status_code == 201
        if initial_status == "ACTIONED":
            assert executed_updates == []
        else:
            assert executed_updates[0]["status"] == expected_status

    @pytest.mark.parametrize(
        ("initial_status", "expected_updates"),
        [("LINKED", ["UNDER_REVIEW"]), ("ACTIONED", [])],
    )
    def test_unlink_report_applies_expected_status_transition(self, client: TestClient, initial_status, expected_updates):
        op = _op_row(operation_id=1)
        report = _CitizenReportStatusRow(report_id=5, status=initial_status, linked_operation_id=1)
        executed_updates: list[dict] = []

        def execute_side_effect(query, params=None):
            result = MagicMock()
            sql = str(query)
            if "SELECT * FROM wims.operations" in sql:
                result.fetchone.return_value = op
            elif "SELECT report_id, status FROM wims.citizen_reports" in sql:
                result.fetchone.return_value = report
            elif "UPDATE wims.citizen_reports" in sql:
                executed_updates.append(params)
                result.rowcount = 1
            elif "SELECT report_id FROM wims.operation_citizen_reports" in sql:
                result.fetchall.return_value = []
            else:
                result.fetchone.return_value = None
                result.fetchall.return_value = []
            result.rowcount = getattr(result, "rowcount", 1)
            return result

        mock_db = MagicMock()
        mock_db.execute.side_effect = execute_side_effect
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db
        app.dependency_overrides[get_national_validator] = _mock_validator
        app.dependency_overrides[auth.get_current_wims_user] = _mock_validator

        resp = client.delete("/api/operations/1/link/5")

        assert resp.status_code == 200
        assert [params["status"] for params in executed_updates] == expected_updates
```

- [ ] **Step 2: Write failing test for create with linked report IDs**

Add this test to `TestCreateOperation`:

```python
    def test_create_operation_accepts_initial_linked_report_ids(self, client: TestClient):
        op = _op_row(operation_id=1)
        captured_inserts: list[dict] = []

        def execute_side_effect(query, params=None):
            result = MagicMock()
            sql = str(query)
            if "INSERT INTO" in sql:
                captured_inserts.append({"sql": sql, "params": params})
                if "RETURNING" in sql:
                    result.fetchone.return_value = op
            elif "operation_citizen_reports" in sql and "WHERE report_id = :rid" in sql:
                result.fetchone.return_value = None
            elif "SELECT report_id, status FROM wims.citizen_reports" in sql:
                result.fetchone.return_value = _CitizenReportStatusRow(
                    report_id=params["rid"],
                    status="PENDING",
                    linked_operation_id=None,
                )
            elif "SELECT report_id FROM wims.operation_citizen_reports" in sql:
                result.fetchall.return_value = []
            else:
                result.fetchone.return_value = None
                result.fetchall.return_value = []
            result.rowcount = 1
            return result

        mock_db = MagicMock()
        mock_db.execute.side_effect = execute_side_effect
        mock_db.captured_inserts = captured_inserts
        app.dependency_overrides[get_db_with_rls] = lambda: mock_db
        app.dependency_overrides[get_national_validator] = _mock_validator
        app.dependency_overrides[auth.get_current_wims_user] = _mock_validator

        resp = client.post(
            "/api/operations",
            json={
                "fire_status": "ACTIVE",
                "start_time": "2026-06-10T08:00:00Z",
                "location": "Test City",
                "linked_report_ids": [5, 6],
            },
        )

        assert resp.status_code == 201
        executed_sql = "\n".join(str(call.args[0]) for call in mock_db.execute.call_args_list)
        assert "INSERT INTO wims.operation_citizen_reports" in executed_sql
        linked_insert_params = [
            item["params"] for item in captured_inserts if "operation_citizen_reports" in item["sql"]
        ]
        assert linked_insert_params == [{"oid": 1, "rid": 5}, {"oid": 1, "rid": 6}]
```

- [ ] **Step 3: Run tests and verify RED**

Run from `src/backend/`:

```bash
pytest tests/test_operations.py::TestReportLinkStatusTransitions tests/test_operations.py::TestCreateOperation::test_create_operation_accepts_initial_linked_report_ids -v
```

Expected: FAIL because create payload rejects `linked_report_ids`, link conflicts are silent, same-operation relink is not explicitly idempotent, and status transitions are not implemented.

- [ ] **Step 4: Extend create schema**

In `src/backend/schemas/operations.py`, add to `OperationCreate`:

```python
    linked_report_ids: list[int] = []
```

- [ ] **Step 5: Add shared link helpers**

In `src/backend/api/routes/operations.py`, add these helpers above route functions:

```python
LINKABLE_REPORT_STATUSES = {"PENDING", "UNDER_REVIEW", "LINKED", "ACTIONED"}


def _get_report_for_link(db: Session, report_id: int):
    return db.execute(
        text("SELECT report_id, status FROM wims.citizen_reports WHERE report_id = :rid FOR UPDATE"),
        {"rid": report_id},
    ).fetchone()


def _get_existing_operation_for_report(db: Session, report_id: int):
    return db.execute(
        text(
            "SELECT operation_id AS linked_operation_id "
            "FROM wims.operation_citizen_reports WHERE report_id = :rid"
        ),
        {"rid": report_id},
    ).fetchone()


def _apply_link_status_transition(db: Session, report_id: int, old_status: str) -> str:
    if old_status == "ACTIONED":
        return old_status
    if old_status not in LINKABLE_REPORT_STATUSES:
        raise HTTPException(status_code=400, detail="Report status is not linkable")
    db.execute(
        text("UPDATE wims.citizen_reports SET status = :status WHERE report_id = :rid"),
        {"status": "LINKED", "rid": report_id},
    )
    return "LINKED"


def _apply_unlink_status_transition(db: Session, report_id: int, old_status: str) -> str:
    if old_status == "ACTIONED":
        return old_status
    if old_status == "LINKED":
        db.execute(
            text("UPDATE wims.citizen_reports SET status = :status WHERE report_id = :rid"),
            {"status": "UNDER_REVIEW", "rid": report_id},
        )
        return "UNDER_REVIEW"
    return old_status


def _link_report_to_operation(
    db: Session,
    operation_id: int,
    report_id: int,
    current_user: dict,
) -> None:
    existing = _get_existing_operation_for_report(db, report_id)
    if existing and existing.linked_operation_id == operation_id:
        return
    if existing and existing.linked_operation_id != operation_id:
        raise HTTPException(
            status_code=409,
            detail=f"Report already linked to Operation #{existing.linked_operation_id}",
        )

    report = _get_report_for_link(db, report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Citizen report not found")
    old_status = str(report.status)
    new_status = _apply_link_status_transition(db, report_id, old_status)

    db.execute(
        text(
            "INSERT INTO wims.operation_citizen_reports (operation_id, report_id) "
            "VALUES (:oid, :rid)"
        ),
        {"oid": operation_id, "rid": report_id},
    )
    log_system_audit(
        db=db,
        user_id=current_user["user_id"],
        action_type="LINK_REPORT",
        table_affected="operation_citizen_reports",
        record_id=report_id,
        old_values={"status": old_status},
        new_values={"status": new_status, "operation_id": operation_id},
    )
```

- [ ] **Step 6: Use the helper in create and link**

In `create_operation()`, after the operation insert and before `OPERATION_CREATE` audit, add:

```python
    for report_id in payload.linked_report_ids:
        _link_report_to_operation(db, row.operation_id, report_id, current_user)
```

Replace the body of `link_report()` after operation existence check with:

```python
    _link_report_to_operation(db, operation_id, payload.report_id, current_user)
    db.commit()
    return _row_to_response(op, db=db)
```

Remove the old `try/except` block that swallowed DB conflicts as a generic 400.

- [ ] **Step 7: Apply unlink status transition**

In `unlink_report()`, before the `DELETE FROM wims.operation_citizen_reports`, add:

```python
    report = _get_report_for_link(db, report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Citizen report not found")
    old_status = str(report.status)
    new_status = _apply_unlink_status_transition(db, report_id, old_status)
```

Change the existing `log_system_audit()` call for unlink to include status metadata:

```python
    log_system_audit(
        db=db,
        user_id=current_user["user_id"],
        action_type="UNLINK_REPORT",
        table_affected="operation_citizen_reports",
        record_id=report_id,
        old_values={"status": old_status, "operation_id": operation_id},
        new_values={"status": new_status},
    )
```

- [ ] **Step 8: Run targeted tests and verify GREEN**

Run from `src/backend/`:

```bash
pytest tests/test_operations.py::TestReportLinkStatusTransitions tests/test_operations.py::TestCreateOperation::test_create_operation_accepts_initial_linked_report_ids -v
```

Expected: PASS.

- [ ] **Step 9: Run existing operations route tests**

Run from `src/backend/`:

```bash
pytest tests/test_operations.py -v
```

Expected: PASS. If existing mocks fail because helper queries need extra mocked rows, update only test mocks to return `_CitizenReportStatusRow` for the new `SELECT report_id, status FROM wims.citizen_reports` query.

- [ ] **Step 10: Commit Task 3**

```bash
git add src/backend/schemas/operations.py src/backend/api/routes/operations.py src/backend/tests/test_operations.py
git commit -m "feat: enforce operation report link transitions"
```

---

### Task 4: Frontend API types and map behavior

**Files:**
- Modify: `src/frontend/src/lib/api/operations.ts`
- Modify: `src/frontend/src/components/OperationsMap.tsx`
- Modify: `src/frontend/src/app/home/__tests__/operations-board.test.tsx`

**Interfaces:**
- Consumes: backend response fields from Tasks 1-3.
- Produces:
  - `LinkedReportDetail` TypeScript interface.
  - `fetchLinkableReports(params)` API wrapper.
  - `OperationsMap` props: `selectedOperationId`, `linkedReports`, `onOperationSelect`.

- [ ] **Step 1: Write failing frontend tests for map centering and linked report markers**

Update the `react-leaflet` mock in `src/frontend/src/app/home/__tests__/operations-board.test.tsx` to expose `CircleMarker` and a trackable `setView`:

```typescript
const mockSetView = vi.fn();

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: React.ReactNode }) => (
    <div className="leaflet-container">{children}</div>
  ),
  TileLayer: () => <div />,
  Circle: ({ children }: { children?: React.ReactNode }) => <div data-testid="operation-circle">{children}</div>,
  CircleMarker: ({ children }: { children?: React.ReactNode }) => <div data-testid="linked-report-marker">{children}</div>,
  Popup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useMap: () => ({
    getZoom: () => 12,
    getCenter: () => ({ lat: 14.5995, lng: 120.9842 }),
    setView: mockSetView,
    fitBounds: vi.fn(),
    on: () => {},
    off: () => {},
  }),
  useMapEvents: () => ({}),
}));
```

Add these tests to the Operations Board map section:

```typescript
it('clicking an operation centers the map on that operation', async () => {
  const { fetchOperations } = await import('@/lib/api/operations');
  (fetchOperations as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
    {
      operation_id: 1,
      fire_status: 'ACTIVE',
      start_time: '2026-06-10T08:00:00Z',
      location: 'Manila',
      size_hectares: 5.0,
      notes: null,
      created_by: null,
      created_at: '2026-06-10T08:00:00Z',
      updated_at: '2026-06-10T08:00:00Z',
      latitude: 14.5995,
      longitude: 120.9842,
      radius_meters: 500,
      linked_report_ids: [],
      linked_reports: [],
    },
  ]);

  const { default: HomePage } = await import('../page?split-center');
  render(<HomePage />);

  await waitFor(() => expect(screen.getByText('Manila')).toBeDefined());
  screen.getByText('Manila').click();

  await waitFor(() => {
    expect(mockSetView).toHaveBeenCalledWith([14.5995, 120.9842], 12, { animate: true });
  });
});

it('renders linked report markers for the selected operation', async () => {
  const { fetchOperations } = await import('@/lib/api/operations');
  (fetchOperations as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
    {
      operation_id: 1,
      fire_status: 'ACTIVE',
      start_time: '2026-06-10T08:00:00Z',
      location: 'Manila',
      size_hectares: 5.0,
      notes: null,
      created_by: null,
      created_at: '2026-06-10T08:00:00Z',
      updated_at: '2026-06-10T08:00:00Z',
      latitude: 14.5995,
      longitude: 120.9842,
      radius_meters: 500,
      linked_report_ids: [5],
      linked_reports: [
        {
          report_id: 5,
          status: 'LINKED',
          category: 'STRUCTURAL',
          sub_category: 'Residential',
          reported_at: '2026-06-10T07:55:00Z',
          latitude: 14.6,
          longitude: 120.98,
          trust_score: 80,
          safety_status: 'I_AM_SAFE',
          reporting_context: 'WITNESS',
          linked_operation_id: 1,
          linked_operation_label: 'Operation #1',
          distance_meters: 42,
        },
      ],
    },
  ]);

  const { default: HomePage } = await import('../page?linked-report-marker');
  render(<HomePage />);

  await waitFor(() => expect(screen.getByText('Manila')).toBeDefined());
  screen.getByText('Manila').click();

  await waitFor(() => {
    expect(screen.getByText('Report #5')).toBeDefined();
    expect(document.querySelectorAll('[data-testid="linked-report-marker"]').length).toBe(1);
  });
});
```

- [ ] **Step 2: Run failing tests and verify RED**

Run from `src/frontend/`:

```bash
npx vitest run src/app/home/__tests__/operations-board.test.tsx -t "centers the map|linked report markers"
```

Expected: FAIL because the split console and linked report markers do not exist.

- [ ] **Step 3: Update API types**

In `src/frontend/src/lib/api/operations.ts`, add:

```typescript
export interface LinkedReportDetail {
  report_id: number;
  status: 'PENDING' | 'UNDER_REVIEW' | 'LINKED' | 'ACTIONED' | string;
  category: string;
  sub_category: string | null;
  reported_at: string | null;
  latitude: number | null;
  longitude: number | null;
  trust_score: number | null;
  safety_status: string | null;
  reporting_context: string | null;
  linked_operation_id: number | null;
  linked_operation_label: string | null;
  distance_meters: number | null;
}

export interface LinkableReportDetail extends LinkedReportDetail {
  link_disabled: boolean;
  disabled_reason: string | null;
}

export interface LinkableReportSearchParams {
  operation_id?: number;
  q?: string;
  status?: string[];
  category?: string;
  start?: string;
  end?: string;
  latitude?: number;
  longitude?: number;
}
```

Add to `Operation`:

```typescript
  linked_reports: LinkedReportDetail[];
```

Add to `OperationCreate`:

```typescript
  linked_report_ids?: number[];
```

Add this API function:

```typescript
export async function fetchLinkableReports(
  params: LinkableReportSearchParams = {},
): Promise<LinkableReportDetail[]> {
  const search = new URLSearchParams();
  if (params.operation_id != null) search.set('operation_id', String(params.operation_id));
  if (params.q) search.set('q', params.q);
  params.status?.forEach((s) => search.append('status', s));
  if (params.category) search.set('category', params.category);
  if (params.start) search.set('start', params.start);
  if (params.end) search.set('end', params.end);
  if (params.latitude != null) search.set('latitude', String(params.latitude));
  if (params.longitude != null) search.set('longitude', String(params.longitude));
  const qs = search.toString();
  return apiFetch<LinkableReportDetail[]>(`/operations/linkable-reports${qs ? `?${qs}` : ''}`);
}
```

- [ ] **Step 4: Add map centering and linked report marker support**

Replace `src/frontend/src/components/OperationsMap.tsx` with this focused implementation:

```typescript
'use client';

import { useEffect } from 'react';
import { MapContainer, TileLayer, Circle, CircleMarker, Popup, useMap } from 'react-leaflet';
import type { LinkedReportDetail, Operation } from '@/lib/api/operations';

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: '#dc2626',
  CONTAINED: '#ea580c',
  FIRE_OUT: '#16a34a',
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active',
  CONTAINED: 'Contained',
  FIRE_OUT: 'Fire Out',
};

interface OperationsMapProps {
  operations: Operation[];
  selectedOperationId?: number | null;
  linkedReports?: LinkedReportDetail[];
}

function SelectedOperationCenter({ operation }: { operation: Operation | null }) {
  const map = useMap();

  useEffect(() => {
    if (operation?.latitude != null && operation.longitude != null) {
      map.setView([operation.latitude, operation.longitude], 12, { animate: true });
    }
  }, [map, operation]);

  return null;
}

export default function OperationsMap({
  operations,
  selectedOperationId = null,
  linkedReports = [],
}: OperationsMapProps) {
  const opsWithCoords = operations.filter(
    (op) => op.latitude != null && op.longitude != null,
  );
  const selectedOperation = operations.find((op) => op.operation_id === selectedOperationId) ?? null;
  const reportsWithCoords = linkedReports.filter(
    (report) => report.latitude != null && report.longitude != null,
  );

  return (
    <MapContainer
      center={[12.8, 121.8]}
      zoom={6}
      style={{ height: 'min(68vh, 680px)', minHeight: '420px', width: '100%', borderRadius: '0.75rem' }}
      zoomControl={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <SelectedOperationCenter operation={selectedOperation} />

      {opsWithCoords.map((op) => (
        <Circle
          key={op.operation_id}
          center={[op.latitude!, op.longitude!]}
          radius={op.radius_meters || 500}
          pathOptions={{
            color: STATUS_COLORS[op.fire_status] || '#dc2626',
            fillColor: STATUS_COLORS[op.fire_status] || '#dc2626',
            fillOpacity: op.operation_id === selectedOperationId ? 0.5 : 0.28,
            weight: op.operation_id === selectedOperationId ? 3 : 1,
          }}
        >
          <Popup>
            <div className="text-xs min-w-[140px]">
              <p className="font-semibold text-sm">{op.location}</p>
              <span
                className="inline-block rounded-full px-2 py-0.5 text-xs font-medium mt-1"
                style={{ backgroundColor: STATUS_COLORS[op.fire_status] || '#dc2626', color: '#fff' }}
              >
                {STATUS_LABELS[op.fire_status] || op.fire_status}
              </span>
              {op.size_hectares != null && <p className="text-slate-500 mt-1">Size: {op.size_hectares} ha</p>}
              <p className="text-slate-400 mt-0.5">{new Date(op.start_time).toLocaleString()}</p>
            </div>
          </Popup>
        </Circle>
      ))}

      {reportsWithCoords.map((report) => (
        <CircleMarker
          key={report.report_id}
          center={[report.latitude!, report.longitude!]}
          radius={7}
          pathOptions={{ color: '#1d4ed8', fillColor: '#60a5fa', fillOpacity: 0.85, weight: 2 }}
        >
          <Popup>
            <div className="text-xs min-w-[150px]">
              <p className="font-semibold text-sm">Report #{report.report_id}</p>
              <p className="text-slate-600">{report.category}{report.sub_category ? ` / ${report.sub_category}` : ''}</p>
              <p className="text-slate-500">Status: {report.status}</p>
              {report.distance_meters != null && <p className="text-slate-500">{Math.round(report.distance_meters)} m from operation</p>}
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
```

- [ ] **Step 5: Run map-focused tests and verify partial GREEN**

Run from `src/frontend/`:

```bash
npx vitest run src/app/home/__tests__/operations-board.test.tsx -t "centers the map|linked report markers"
```

Expected: Still FAIL until Task 5 wires `selectedOperationId` and `linkedReports` through `/home`. The API and map component should type-check locally after Task 5.

- [ ] **Step 6: Commit Task 4 after Task 5 passes the tests**

Do not commit Task 4 separately if tests remain red. Carry these changes into Task 5, then commit them together there.

---

### Task 5: Split Operations Board console and read-only role behavior

**Files:**
- Create: `src/frontend/src/components/operations/LinkedReportCard.tsx`
- Create: `src/frontend/src/components/operations/OperationsConsole.tsx`
- Modify: `src/frontend/src/app/home/page.tsx`
- Modify: `src/frontend/src/app/home/__tests__/operations-board.test.tsx`

**Interfaces:**
- Consumes: `Operation.linked_reports`, `OperationsMap` props from Task 4.
- Produces:
  - split 70/30 console
  - selected operation state
  - validator-only controls hidden for other roles.

- [ ] **Step 1: Replace old toggle tests with split console tests**

In `src/frontend/src/app/home/__tests__/operations-board.test.tsx`, remove or rewrite tests that expect Table/Map toggle buttons. Add:

```typescript
it('renders a split operations console instead of table map toggle buttons', async () => {
  const { default: HomePage } = await import('../page?split-console');
  render(<HomePage />);

  await waitFor(() => expect(screen.getByTestId('operations-split-console')).toBeDefined());
  expect(screen.getByTestId('operations-map-pane')).toBeDefined();
  expect(screen.getByTestId('operations-panel-pane')).toBeDefined();
  expect(screen.queryByText('Table')).toBeNull();
  expect(screen.queryByText('Map')).toBeNull();
});

it('shows linked report details read only for regional encoder', async () => {
  vi.doMock('@/context/AuthContext', () => ({
    useAuth: vi.fn().mockReturnValue({
      user: { id: 'encoder-user', role: 'REGIONAL_ENCODER', assignedRegionId: 1 },
      isAuthenticated: true,
      loading: false,
      loggingOut: false,
      login: vi.fn(),
      logout: vi.fn(),
      refreshSession: vi.fn(),
    }),
  }));

  const { fetchOperations } = await import('@/lib/api/operations');
  (fetchOperations as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
    {
      operation_id: 1,
      fire_status: 'ACTIVE',
      start_time: '2026-06-10T08:00:00Z',
      location: 'Quezon City',
      size_hectares: 2.5,
      notes: null,
      created_by: null,
      created_at: '2026-06-10T08:00:00Z',
      updated_at: '2026-06-10T08:00:00Z',
      latitude: 14.5995,
      longitude: 120.9842,
      radius_meters: 500,
      linked_report_ids: [5],
      linked_reports: [
        {
          report_id: 5,
          status: 'LINKED',
          category: 'STRUCTURAL',
          sub_category: 'Residential',
          reported_at: '2026-06-10T07:55:00Z',
          latitude: 14.6,
          longitude: 120.98,
          trust_score: 80,
          safety_status: 'I_AM_SAFE',
          reporting_context: 'WITNESS',
          linked_operation_id: 1,
          linked_operation_label: 'Operation #1',
          distance_meters: 42,
        },
      ],
    },
  ]);

  const { default: HomePage } = await import('../page?encoder-readonly-linked-reports');
  render(<HomePage />);

  await waitFor(() => expect(screen.getByText('Quezon City')).toBeDefined());
  screen.getByText('Quezon City').click();

  await waitFor(() => expect(screen.getByText('Report #5')).toBeDefined());
  expect(screen.getByText('STRUCTURAL / Residential')).toBeDefined();
  expect(screen.queryByText('Add civilian reports')).toBeNull();
  expect(screen.queryByLabelText('Unlink report 5')).toBeNull();
});
```

- [ ] **Step 2: Run split console tests and verify RED**

Run from `src/frontend/`:

```bash
npx vitest run src/app/home/__tests__/operations-board.test.tsx -t "split operations console|read only for regional encoder|centers the map|linked report markers"
```

Expected: FAIL because console components do not exist and `/home` still uses the toggle layout.

- [ ] **Step 3: Create linked report card component**

Create `src/frontend/src/components/operations/LinkedReportCard.tsx`:

```typescript
import { Link2, MapPin, ShieldCheck } from 'lucide-react';
import type { LinkedReportDetail } from '@/lib/api/operations';

export function LinkedReportCard({
  report,
  canManage,
  onUnlink,
}: {
  report: LinkedReportDetail;
  canManage: boolean;
  onUnlink?: (reportId: number) => void;
}) {
  const categoryLabel = report.sub_category ? `${report.category} / ${report.sub_category}` : report.category;

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-slate-900">Report #{report.report_id}</p>
          <p className="text-xs font-medium text-slate-600">{categoryLabel}</p>
        </div>
        <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700">
          {report.status}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
        <div className="flex items-center gap-1"><ShieldCheck className="h-3 w-3" /> Trust {report.trust_score ?? '—'}</div>
        <div>{report.safety_status ?? 'Safety unknown'}</div>
        <div>{report.reporting_context ?? 'Context unknown'}</div>
        <div>{report.reported_at ? new Date(report.reported_at).toLocaleString() : 'Submission time only'}</div>
        <div className="col-span-2 flex items-center gap-1">
          <MapPin className="h-3 w-3" />
          {report.latitude != null && report.longitude != null
            ? `${report.latitude.toFixed(5)}, ${report.longitude.toFixed(5)}`
            : 'No coordinates'}
        </div>
        {report.distance_meters != null && <div className="col-span-2">{Math.round(report.distance_meters)} m from operation</div>}
      </dl>
      {canManage && onUnlink && (
        <button
          type="button"
          onClick={() => onUnlink(report.report_id)}
          aria-label={`Unlink report ${report.report_id}`}
          className="mt-3 inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 text-xs font-bold text-red-700 hover:bg-red-50"
        >
          <Link2 className="h-3 w-3" /> Unlink
        </button>
      )}
    </article>
  );
}
```

- [ ] **Step 4: Create split console component**

Create `src/frontend/src/components/operations/OperationsConsole.tsx`:

```typescript
import OperationsMap from '@/components/OperationsMap';
import type { FireStatus, Operation } from '@/lib/api/operations';
import { LinkedReportCard } from './LinkedReportCard';

const STATUS_BADGE: Record<FireStatus, { label: string; className: string }> = {
  ACTIVE: { label: 'Active', className: 'bg-red-100 text-red-700 border-red-200' },
  CONTAINED: { label: 'Contained', className: 'bg-amber-100 text-amber-700 border-amber-200' },
  FIRE_OUT: { label: 'Fire Out', className: 'bg-green-100 text-green-700 border-green-200' },
};

export function OperationsConsole({
  operations,
  selectedOperationId,
  onSelectOperation,
  canManageReports,
  onUnlinkReport,
}: {
  operations: Operation[];
  selectedOperationId: number | null;
  onSelectOperation: (operationId: number) => void;
  canManageReports: boolean;
  onUnlinkReport: (operationId: number, reportId: number) => void;
}) {
  const selectedOperation = operations.find((op) => op.operation_id === selectedOperationId) ?? operations[0] ?? null;
  const selectedReports = selectedOperation?.linked_reports ?? [];

  return (
    <div data-testid="operations-split-console" className="grid gap-4 xl:grid-cols-[minmax(0,7fr)_minmax(320px,3fr)]">
      <section data-testid="operations-map-pane" className="order-1 rounded-2xl border border-slate-200 bg-slate-950/5 p-2">
        <OperationsMap
          operations={operations}
          selectedOperationId={selectedOperation?.operation_id ?? null}
          linkedReports={selectedReports}
        />
      </section>

      <aside data-testid="operations-panel-pane" className="order-2 space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-red-700">Operations</p>
          <h2 className="text-lg font-black text-slate-950">Live board</h2>
        </div>
        <div className="space-y-2">
          {operations.map((op) => (
            <button
              key={op.operation_id}
              type="button"
              onClick={() => onSelectOperation(op.operation_id)}
              className={`w-full rounded-xl border p-3 text-left transition ${
                selectedOperation?.operation_id === op.operation_id
                  ? 'border-red-300 bg-red-50 shadow-sm'
                  : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-bold text-slate-900">{op.location}</p>
                <span className={`rounded-md border px-2 py-0.5 text-[11px] font-bold ${STATUS_BADGE[op.fire_status].className}`}>
                  {STATUS_BADGE[op.fire_status].label}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500">{new Date(op.start_time).toLocaleString()}</p>
              <p className="mt-1 text-xs font-medium text-slate-600">{op.linked_reports?.length ?? op.linked_report_ids.length} linked report(s)</p>
            </button>
          ))}
        </div>

        {selectedOperation && (
          <section className="space-y-3 border-t border-slate-200 pt-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-black text-slate-900">Linked civilian reports</h3>
              {canManageReports && <span className="rounded-full bg-red-50 px-2 py-1 text-[11px] font-bold text-red-700">Validator controls</span>}
            </div>
            {selectedReports.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                {canManageReports ? 'No civilian reports linked yet. Add civilian reports from this panel.' : 'No civilian reports linked.'}
                {canManageReports && <p className="mt-2 font-bold text-red-700">Add civilian reports</p>}
              </div>
            ) : (
              <div className="space-y-2">
                {selectedReports.map((report) => (
                  <LinkedReportCard
                    key={report.report_id}
                    report={report}
                    canManage={canManageReports}
                    onUnlink={(reportId) => onUnlinkReport(selectedOperation.operation_id, reportId)}
                  />
                ))}
              </div>
            )}
          </section>
        )}
      </aside>
    </div>
  );
}
```

- [ ] **Step 5: Wire `OperationsConsole` into `/home`**

In `src/frontend/src/app/home/page.tsx`:

1. Add import:

```typescript
import { OperationsConsole } from '@/components/operations/OperationsConsole';
```

2. Remove `MapIcon`, `List`, `OperationsMap`, `viewMode`, and the table/map toggle rendering.

3. Add state:

```typescript
  const [selectedOperationId, setSelectedOperationId] = useState<number | null>(null);
```

4. After `filteredOps` is computed, add:

```typescript
  useEffect(() => {
    if (filteredOps.length === 0) {
      setSelectedOperationId(null);
      return;
    }
    if (selectedOperationId == null || !filteredOps.some((op) => op.operation_id === selectedOperationId)) {
      setSelectedOperationId(filteredOps[0].operation_id);
    }
  }, [filteredOps, selectedOperationId]);
```

5. Replace the old map/table render block with:

```tsx
          {opsLoading ? (
            <div className="flex justify-center p-8">
              <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
            </div>
          ) : filteredOps.length === 0 ? (
            <div className="rounded-md border border-slate-200 p-8 text-center text-sm text-slate-500">
              No operations found.
            </div>
          ) : (
            <OperationsConsole
              operations={filteredOps}
              selectedOperationId={selectedOperationId}
              onSelectOperation={setSelectedOperationId}
              canManageReports={isValidator}
              onUnlinkReport={(operationId, reportId) => void handleUnlink(operationId, reportId)}
            />
          )}
```

- [ ] **Step 6: Run split console and carried map tests; verify GREEN**

Run from `src/frontend/`:

```bash
npx vitest run src/app/home/__tests__/operations-board.test.tsx -t "split operations console|read only for regional encoder|centers the map|linked report markers"
```

Expected: PASS.

- [ ] **Step 7: Commit Tasks 4 and 5 together**

```bash
git add src/frontend/src/lib/api/operations.ts src/frontend/src/components/OperationsMap.tsx src/frontend/src/components/operations/LinkedReportCard.tsx src/frontend/src/components/operations/OperationsConsole.tsx src/frontend/src/app/home/page.tsx src/frontend/src/app/home/__tests__/operations-board.test.tsx
git commit -m "feat: add split operations linked reports console"
```

---

### Task 6: Validator link search panel and create-operation report selection

**Files:**
- Create: `src/frontend/src/components/operations/LinkableReportSearch.tsx`
- Modify: `src/frontend/src/components/operations/OperationsConsole.tsx`
- Modify: `src/frontend/src/app/home/page.tsx`
- Modify: `src/frontend/src/app/home/__tests__/operations-board.test.tsx`

**Interfaces:**
- Consumes:
  - `fetchLinkableReports(params)` from Task 4.
  - `linkReport()`, `unlinkReport()`, `createOperation()` from existing API layer.
  - `OperationCreate.linked_report_ids` from Task 3.
- Produces:
  - validator-only in-panel report search/linking
  - create modal initial linked report IDs and first-report field suggestions.

- [ ] **Step 1: Add failing tests for validator search and disabled cards**

Update the operations API mock in `operations-board.test.tsx` to include `fetchLinkableReports`, `linkReport`, and `unlinkReport` if not already present:

```typescript
  fetchLinkableReports: vi.fn().mockResolvedValue([
    {
      report_id: 7,
      status: 'PENDING',
      category: 'STRUCTURAL',
      sub_category: 'Residential',
      reported_at: '2026-06-10T07:45:00Z',
      latitude: 14.61,
      longitude: 120.99,
      trust_score: 70,
      safety_status: 'I_AM_SAFE',
      reporting_context: 'WITNESS',
      linked_operation_id: null,
      linked_operation_label: null,
      distance_meters: 120,
      link_disabled: false,
      disabled_reason: null,
    },
    {
      report_id: 8,
      status: 'LINKED',
      category: 'STRUCTURAL',
      sub_category: 'Warehouse',
      reported_at: '2026-06-10T07:40:00Z',
      latitude: 14.62,
      longitude: 121,
      trust_score: 60,
      safety_status: 'UNKNOWN',
      reporting_context: 'WITNESS',
      linked_operation_id: 99,
      linked_operation_label: 'Operation #99',
      distance_meters: 240,
      link_disabled: true,
      disabled_reason: 'Already linked to Operation #99',
    },
  ]),
  linkReport: vi.fn().mockResolvedValue({}),
  unlinkReport: vi.fn().mockResolvedValue({}),
```

Add tests:

```typescript
it('validator can search and link reports from the selected operation panel', async () => {
  const { default: HomePage } = await import('../page?validator-link-search');
  render(<HomePage />);

  await waitFor(() => expect(screen.getByText('Quezon City, Barangay Tatalon')).toBeDefined());
  screen.getByText('Quezon City, Barangay Tatalon').click();
  screen.getByText('Add civilian reports').click();

  await waitFor(() => expect(screen.getByText('Report #7')).toBeDefined());
  expect(screen.getByText('Already linked to Operation #99')).toBeDefined();
  screen.getByRole('button', { name: 'Link report 7' }).click();

  const { linkReport } = await import('@/lib/api/operations');
  await waitFor(() => expect(linkReport).toHaveBeenCalledWith(1, 7));
});

it('create operation can select a report and suggest fields from the first selected report', async () => {
  const { default: HomePage } = await import('../page?create-with-linked-report');
  render(<HomePage />);

  await waitFor(() => expect(screen.getByText('New Operation')).toBeDefined());
  screen.getByText('New Operation').click();
  screen.getByText('Select civilian reports').click();

  await waitFor(() => expect(screen.getByText('Report #7')).toBeDefined());
  screen.getByRole('button', { name: 'Select report 7' }).click();

  await waitFor(() => {
    expect(screen.getByDisplayValue(/Report #7/)).toBeDefined();
    expect(screen.getByText(/1 selected report/)).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run from `src/frontend/`:

```bash
npx vitest run src/app/home/__tests__/operations-board.test.tsx -t "search and link reports|select a report and suggest"
```

Expected: FAIL because `LinkableReportSearch` and create selection do not exist.

- [ ] **Step 3: Create linkable report search component**

Create `src/frontend/src/components/operations/LinkableReportSearch.tsx`:

```typescript
'use client';

import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { fetchLinkableReports, type LinkableReportDetail, type Operation } from '@/lib/api/operations';

export function LinkableReportSearch({
  operation,
  mode,
  selectedReportIds = [],
  onLink,
  onSelect,
}: {
  operation: Operation | null;
  mode: 'link' | 'select';
  selectedReportIds?: number[];
  onLink?: (reportId: number) => void;
  onSelect?: (report: LinkableReportDetail) => void;
}) {
  const [query, setQuery] = useState('');
  const [reports, setReports] = useState<LinkableReportDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchLinkableReports({
      operation_id: operation?.operation_id,
      q: query || undefined,
      latitude: operation?.latitude ?? undefined,
      longitude: operation?.longitude ?? undefined,
    })
      .then((data) => {
        if (!cancelled) setReports(data);
      })
      .catch(() => {
        if (!cancelled) setError('Unable to load linkable reports.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [operation?.operation_id, operation?.latitude, operation?.longitude, query]);

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
        <Search className="h-4 w-4 text-slate-400" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search reports by category or location..."
          className="w-full bg-transparent outline-none"
        />
      </label>
      {loading && <p className="text-xs text-slate-500">Loading civilian reports…</p>}
      {error && <p className="text-xs font-medium text-red-700">{error}</p>}
      {!loading && !error && reports.length === 0 && <p className="text-xs text-slate-500">No linkable reports match the current filters.</p>}
      <div className="space-y-2">
        {reports.map((report) => {
          const categoryLabel = report.sub_category ? `${report.category} / ${report.sub_category}` : report.category;
          const selected = selectedReportIds.includes(report.report_id);
          const disabled = report.link_disabled || selected;
          return (
            <article key={report.report_id} className={`rounded-lg border p-3 ${disabled ? 'border-slate-200 bg-slate-100' : 'border-white bg-white shadow-sm'}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-slate-900">Report #{report.report_id}</p>
                  <p className="text-xs text-slate-600">{categoryLabel}</p>
                  {report.distance_meters != null && <p className="text-xs text-slate-500">{Math.round(report.distance_meters)} m away</p>}
                </div>
                <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-700">{report.status}</span>
              </div>
              {report.disabled_reason && <p className="mt-2 text-xs font-medium text-amber-700">{report.disabled_reason}</p>}
              {selected && <p className="mt-2 text-xs font-medium text-green-700">Selected for this operation</p>}
              {!disabled && mode === 'link' && onLink && (
                <button type="button" aria-label={`Link report ${report.report_id}`} onClick={() => onLink(report.report_id)} className="mt-3 rounded-md bg-red-700 px-3 py-1.5 text-xs font-bold text-white">
                  Link report
                </button>
              )}
              {!disabled && mode === 'select' && onSelect && (
                <button type="button" aria-label={`Select report ${report.report_id}`} onClick={() => onSelect(report)} className="mt-3 rounded-md bg-red-700 px-3 py-1.5 text-xs font-bold text-white">
                  Select report
                </button>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Add in-panel link search to `OperationsConsole`**

In `OperationsConsole.tsx`, import:

```typescript
import { useState } from 'react';
import { LinkableReportSearch } from './LinkableReportSearch';
```

Add prop:

```typescript
  onLinkReport: (operationId: number, reportId: number) => void;
```

Inside component, add state:

```typescript
  const [showReportSearch, setShowReportSearch] = useState(false);
```

Replace the validator empty-state CTA text with a button:

```tsx
<button
  type="button"
  onClick={() => setShowReportSearch((value) => !value)}
  className="mt-2 font-bold text-red-700"
>
  Add civilian reports
</button>
```

Below the linked reports section, add:

```tsx
{canManageReports && selectedOperation && showReportSearch && (
  <LinkableReportSearch
    operation={selectedOperation}
    mode="link"
    onLink={(reportId) => onLinkReport(selectedOperation.operation_id, reportId)}
  />
)}
```

- [ ] **Step 5: Wire `onLinkReport` in `/home`**

In `src/frontend/src/app/home/page.tsx`, update the `OperationsConsole` usage:

```tsx
            <OperationsConsole
              operations={filteredOps}
              selectedOperationId={selectedOperationId}
              onSelectOperation={setSelectedOperationId}
              canManageReports={isValidator}
              onLinkReport={(operationId, reportId) => void handleLink(operationId, reportId)}
              onUnlinkReport={(operationId, reportId) => void handleUnlink(operationId, reportId)}
            />
```

- [ ] **Step 6: Add linked report selection to create modal**

In `src/frontend/src/app/home/page.tsx`, update imports:

```typescript
import { LinkableReportSearch } from '@/components/operations/LinkableReportSearch';
import type { LinkableReportDetail } from '@/lib/api/operations';
```

Inside `OperationFormModal`, add state:

```typescript
  const [selectedReports, setSelectedReports] = useState<LinkableReportDetail[]>([]);
  const [showReportPicker, setShowReportPicker] = useState(false);
```

Add helper inside `OperationFormModal`:

```typescript
  function handleSelectReport(report: LinkableReportDetail) {
    setSelectedReports((current) => {
      if (current.some((item) => item.report_id === report.report_id)) return current;
      return [...current, report];
    });
    if (selectedReports.length === 0) {
      if (report.latitude != null && report.longitude != null) {
        setLat(report.latitude);
        setLng(report.longitude);
        if (!location) setLocation(`Report #${report.report_id} (${report.latitude.toFixed(5)}, ${report.longitude.toFixed(5)})`);
      }
      if (report.reported_at && !startTime) {
        setStartTime(new Date(report.reported_at).toISOString().slice(0, 16));
      }
      if (!notes) {
        setNotes(`Report #${report.report_id}: ${report.category}${report.sub_category ? ` / ${report.sub_category}` : ''}`);
      }
    }
  }
```

Update submit payload:

```typescript
        linked_report_ids: selectedReports.map((report) => report.report_id),
```

Add this JSX before the notes textarea:

```tsx
          <div className="rounded-lg border border-slate-200 p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-bold text-slate-700">Linked civilian reports</p>
                <p className="text-xs text-slate-500">{selectedReports.length} selected report(s)</p>
              </div>
              <button
                type="button"
                onClick={() => setShowReportPicker((value) => !value)}
                className="rounded-md border border-red-200 px-2 py-1 text-xs font-bold text-red-700 hover:bg-red-50"
              >
                Select civilian reports
              </button>
            </div>
            {selectedReports.length === 0 && (
              <p className="mt-2 text-xs text-amber-700">No civilian reports linked yet. You can save without links.</p>
            )}
            {selectedReports.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {selectedReports.map((report) => (
                  <span key={report.report_id} className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">
                    Report #{report.report_id}
                  </span>
                ))}
              </div>
            )}
            {showReportPicker && (
              <div className="mt-3">
                <LinkableReportSearch
                  operation={null}
                  mode="select"
                  selectedReportIds={selectedReports.map((report) => report.report_id)}
                  onSelect={handleSelectReport}
                />
              </div>
            )}
          </div>
```

- [ ] **Step 7: Run targeted tests and verify GREEN**

Run from `src/frontend/`:

```bash
npx vitest run src/app/home/__tests__/operations-board.test.tsx -t "search and link reports|select a report and suggest"
```

Expected: PASS.

- [ ] **Step 8: Commit Task 6**

```bash
git add src/frontend/src/components/operations/LinkableReportSearch.tsx src/frontend/src/components/operations/OperationsConsole.tsx src/frontend/src/app/home/page.tsx src/frontend/src/app/home/__tests__/operations-board.test.tsx
git commit -m "feat: add validator report linking controls"
```

---

### Task 7: Civilian tracking copy and documentation updates

**Files:**
- Modify: `src/frontend/src/app/tracking/page.tsx`
- Modify: nearest existing tracking test file, likely `src/frontend/src/app/tracking/page.test.tsx`
- Modify: `system-wiki/frontend/route-map.md`
- Modify: `system-wiki/backend/api-route-map.md`
- Modify: `system-wiki/log.md`

**Interfaces:**
- Consumes: existing tracking `STATUS_META` mapping.
- Produces: neutral civilian `LINKED` message and project-local wiki updates.

- [ ] **Step 1: Write failing tracking copy test**

If `src/frontend/src/app/tracking/page.test.tsx` exists, add this assertion in the status metadata/render test for `LINKED`. If it does not exist, create a focused test that imports/renders the tracking page using existing mocks from sibling tests:

```typescript
it('uses neutral active-operation copy for linked reports', async () => {
  const file = await import('./page');
  expect(JSON.stringify(file)).not.toContain('Linked to Another Report');
});
```

If the page module does not export metadata and the import assertion is not viable, render the page with the existing `fetchReportStatus` mock returning `{ status: 'LINKED' }` and assert:

```typescript
expect(screen.getByText('Linked to Active BFP Operation')).toBeDefined();
expect(screen.getByText(/linked to an active BFP operation/i)).toBeDefined();
expect(screen.queryByText(/another report/i)).toBeNull();
```

- [ ] **Step 2: Run tracking test and verify RED**

Run from `src/frontend/`:

```bash
npx vitest run src/app/tracking -t "neutral active-operation copy"
```

Expected: FAIL because current copy says “Linked to Another Report.”

- [ ] **Step 3: Update tracking copy**

In `src/frontend/src/app/tracking/page.tsx`, change the `LINKED` entry in `STATUS_META` to:

```typescript
  LINKED: {
    icon: Link2,
    badge: 'LINKED',
    badgeColor: 'bg-blue-100 text-blue-800 border-blue-300',
    heading: 'Linked to Active BFP Operation',
    headingSub: 'Your report has been linked to an active BFP operation.',
    cardBg: 'bg-blue-50',
    cardBorder: 'border-blue-200',
    headingColor: 'text-blue-900',
    iconColor: 'text-blue-600',
  },
```

- [ ] **Step 4: Run tracking test and verify GREEN**

Run from `src/frontend/`:

```bash
npx vitest run src/app/tracking -t "neutral active-operation copy"
```

Expected: PASS.

- [ ] **Step 5: Update system-wiki route/API docs**

In `system-wiki/frontend/route-map.md`, update the `/home` row or authenticated shell section to include:

```markdown
`/home` now renders a split Operations console: a 70% operational map paired with a 30% operations/report panel on desktop and a map-first stacked layout on mobile. National Validators can create operations with optional linked civilian reports and manage linked reports from the selected-operation panel. Regional Encoders, National Analysts, and System Administrators see linked report details read-only.
```

In `system-wiki/backend/api-route-map.md`, add an operations note:

```markdown
- `GET /api/operations` returns operation rows with `linked_report_ids` and PII-free `linked_reports` detail objects derived from `wims.citizen_reports.location` via PostGIS.
- `GET /api/operations/linkable-reports` is `NATIONAL_VALIDATOR`-only and returns eligible non-rejected civilian reports for operation linking, including disabled already-linked cards.
- `POST /api/operations/{operation_id}/link` and `DELETE /api/operations/{operation_id}/link/{report_id}` enforce one-operation-per-report and transactional status transitions.
```

In `system-wiki/log.md`, add a dated entry with the files changed and verification commands actually run.

- [ ] **Step 6: Commit Task 7**

```bash
git add src/frontend/src/app/tracking/page.tsx src/frontend/src/app/tracking/page.test.tsx system-wiki/frontend/route-map.md system-wiki/backend/api-route-map.md system-wiki/log.md
git commit -m "docs: record operations linked reports workflow"
```

If `src/frontend/src/app/tracking/page.test.tsx` did not exist and no file was created, omit it from `git add`.

---

### Task 8: Full verification and cleanup

**Files:**
- Modify only files required by failures from verification commands.

**Interfaces:**
- Consumes: all tasks.
- Produces: final verified branch ready for review/PR.

- [ ] **Step 1: Run backend focused verification**

Run from `src/backend/`:

```bash
pytest tests/test_operations.py tests/integration/test_operations_linked_reports_sql.py -v
```

Expected: all tests PASS.

- [ ] **Step 2: Run backend lint and format checks**

Run from `src/backend/`:

```bash
ruff check .
ruff format --check .
```

Expected: both exit 0. If format fails, run `ruff format .`, inspect diff, and rerun both commands.

- [ ] **Step 3: Run frontend focused verification**

Run from `src/frontend/`:

```bash
npx vitest run src/app/home/__tests__/operations-board.test.tsx src/app/tracking
```

Expected: all tests PASS.

- [ ] **Step 4: Run frontend lint**

Run from `src/frontend/`:

```bash
npm run lint
```

Expected: exit 0. Existing warnings are acceptable only if the command exits 0 and the warnings are unrelated to touched files.

- [ ] **Step 5: Run full pre-flight before PR/merge**

Run from repository root:

```bash
make ci-local
```

Expected: exit 0. If this cannot run due to environment constraints, record the exact skipped reason and run the subsystem commands from Steps 1-4.

- [ ] **Step 6: Review git status**

Run:

```bash
git status --short
```

Expected: only intended files are modified or the working tree is clean after commits.

- [ ] **Step 7: Commit verification fixes if any**

If verification forced code changes:

```bash
git add <changed-files>
git commit -m "fix: stabilize operations linked reports workflow"
```

If no verification fixes were needed, do not create an empty commit.

---

## Self-Review

### Spec coverage

- Validator-only add/remove controls: Task 3 backend, Tasks 5-6 frontend.
- Read-only linked details for encoder/analyst/admin: Task 5.
- Create operation with optional linked reports: Task 3 backend, Task 6 frontend.
- Ongoing operation report management: Task 6.
- 70/30 map/panel layout and mobile stack: Tasks 5 and 8.
- Linked report details instead of integer-only IDs: Tasks 1 and 5.
- PII exclusion: Task 1 test and schema.
- Neutral tracking message: Task 7.
- PostGIS coordinate derivation and distance: Tasks 1-2.
- One-report-one-operation invariant: Tasks 2-3.
- TDD verification: every implementation task starts with failing tests and commands.
- Documentation updates: Task 7.

### Placeholder scan

No unresolved placeholder markers are present. All tasks include exact files, test commands, expected outcomes, and concrete code snippets.

### Type consistency

- Backend `OperationLinkedReport` maps to frontend `LinkedReportDetail` field-for-field.
- Backend `LinkableReportSearchResponse` adds `link_disabled` and `disabled_reason`; frontend `LinkableReportDetail` has matching fields.
- `OperationCreate.linked_report_ids` is added on both backend and frontend.
- `OperationsMap` accepts `selectedOperationId` and `linkedReports`; `OperationsConsole` passes both.
- `OperationsConsole` uses `onLinkReport(operationId, reportId)` and `onUnlinkReport(operationId, reportId)`; `/home` wires these to `handleLink` and `handleUnlink`.
