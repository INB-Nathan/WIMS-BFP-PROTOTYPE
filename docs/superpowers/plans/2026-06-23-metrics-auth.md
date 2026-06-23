# Add Auth to `GET /metrics` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require a valid JWT token to access the Prometheus `/metrics` endpoint.

**Architecture:** Add `Depends(get_current_user)` to the existing `metrics_endpoint()` handler in `main.py`. This chains through `get_current_user` → JWT validation, returning 401 for unauthenticated requests. No role restriction — any valid WIMS JWT works. `/health` remains public for container orchestration liveness probes.

**Tech Stack:** FastAPI, Prometheus client, psutil

## Global Constraints

- `get_current_user` already imported in `main.py` (line 41: `from auth import get_current_user`)
- `Annotated` already imported in `main.py` (line 20: `from typing import Annotated`)
- Must not break `/health` (container liveness probe)
- Must not add any new imports
- Follow ruff format (run `ruff format .` before committing)

---
### Task 1: Add auth dependency to `/metrics`

**Files:**
- Modify: `src/backend/main.py:955-963`
- Test: `src/backend/tests/test_system_monitoring.py`

**Interfaces:**
- Consumes: `get_current_user` from `auth` — returns a dict with `sub`, `preferred_username`, `realm_access` from the validated JWT
- Produces: `GET /metrics` now returns 401 for unauthenticated requests, 200 for any authenticated request

- [ ] **Step 1: Go to worktree, fetch origin/master, create branch**

```bash
cd ~/WIMS-BFP-NEW/pr-worktrees/master-diagnosis
git fetch origin master
git checkout origin/master
git checkout -b fix/metrics-auth
```

- [ ] **Step 2: Add auth parameter to `metrics_endpoint()` in `main.py`**

In `src/backend/main.py`, change:

```python
@app.get("/metrics", include_in_schema=False)
async def metrics_endpoint():
    """Prometheus metrics scrape endpoint. Updates system resource gauges before returning."""
    import psutil  # lazy import — only loaded when /metrics is hit
```

To:

```python
@app.get("/metrics", include_in_schema=False)
async def metrics_endpoint(
    current_user: Annotated[dict, Depends(get_current_user)],
):
    """Prometheus metrics scrape endpoint. Updates system resource gauges before returning."""
    import psutil  # lazy import — only loaded when /metrics is hit
```

`Annotated` and `get_current_user` are already imported at the top of `main.py`.

- [ ] **Step 3: Run test to verify it fails (tests need auth now)**

```bash
cd src/backend
python -m pytest tests/test_system_monitoring.py -v -k "metrics" 2>&1 | head -30
```

Expected: 4 tests fail with 401 or 403 because they don't pass auth tokens.

- [ ] **Step 4: Add auth helper and import in `test_system_monitoring.py`**

At the top of `src/backend/tests/test_system_monitoring.py`, add to the existing imports:

```python
from auth import get_current_user
```

After the existing `_admin_override()` function (around line 40), add:

```python
def _any_user_override():
    """A valid authenticated user — no specific role check needed."""
    return {
        "user_id": uuid.UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
        "keycloak_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "role": "REGIONAL_ENCODER",
        "assigned_region_id": 1,
    }
```

- [ ] **Step 5: Update the 4 `/metrics` tests to pass auth**

Update each test function — add `app.dependency_overrides[get_current_user] = _any_user_override` before the `client.get("/metrics")` call.

Test 1: `test_metrics_endpoint_returns_200` (around line 49):

```python
def test_metrics_endpoint_returns_200():
    """GET /metrics returns 200 with prometheus text format."""
    client = TestClient(app)
    app.dependency_overrides[get_current_user] = _any_user_override
    resp = client.get("/metrics")
    assert resp.status_code == 200
    assert "text/plain" in resp.headers.get("content-type", "")
```

Test 2: `test_metrics_endpoint_contains_api_duration_metric` (around line 57):

```python
def test_metrics_endpoint_contains_api_duration_metric():
    """GET /metrics response contains api_request_duration_seconds metric."""
    client = TestClient(app)
    app.dependency_overrides[get_current_user] = _any_user_override
    resp = client.get("/metrics")
    body = resp.text
    assert "api_request_duration_seconds" in body
```

Test 3: `test_metrics_endpoint_contains_system_metrics` (around line 65):

```python
def test_metrics_endpoint_contains_system_metrics():
    """GET /metrics response contains system CPU, memory, disk gauges."""
    client = TestClient(app)
    app.dependency_overrides[get_current_user] = _any_user_override
    resp = client.get("/metrics")
    body = resp.text
    assert "system_cpu_percent" in body
    assert "system_memory_percent" in body
    assert "system_disk_percent" in body
```

Test 4: `test_metrics_endpoint_contains_ai_inference_histogram` (around line 134):

```python
def test_metrics_endpoint_contains_ai_inference_histogram():
    """GET /metrics includes ai_inference_duration_seconds histogram."""
    client = TestClient(app)
    app.dependency_overrides[get_current_user] = _any_user_override
    resp = client.get("/metrics")
    assert resp.status_code == 200
    assert "ai_inference_duration_seconds" in resp.text
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd src/backend
python -m pytest tests/test_system_monitoring.py -v -k "metrics"
```

Expected: 4 tests pass. Note: other tests in the file (`test_worker_status*`, `test_system_metrics*`, etc.) may fail in CI if they depend on DB or network — that's pre-existing and unrelated.

- [ ] **Step 7: Run ruff checks**

```bash
cd src/backend
ruff check main.py tests/test_system_monitoring.py
ruff format --check main.py tests/test_system_monitoring.py
```

If format check fails, run `ruff format main.py tests/test_system_monitoring.py`.

- [ ] **Step 8: Commit**

```bash
cd ~/WIMS-BFP-NEW/pr-worktrees/master-diagnosis
git add src/backend/main.py src/backend/tests/test_system_monitoring.py
git commit -m "fix: require auth on GET /metrics endpoint"
```

## Self-Review

1. **Spec coverage:** The plan covers the single requirement — add auth to `/metrics` and update tests. No gaps.
2. **Placeholder scan:** No TBD, TODOs, or incomplete code. All test changes show exact code.
3. **Type consistency:** `get_current_user`, `Annotated` use exact existing import names. No type drift.
