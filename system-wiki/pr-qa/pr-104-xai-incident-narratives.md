---
title: PR #104 QA — #69 XAI Incident Narratives
created: 2026-05-17
updated: 2026-05-17
type: backend
tags: [wims-bfp, pr-qa, xai, narrative-generation, ollama, analytics]
sources: [pr-104, src/backend/api/routes/analytics.py, src/backend/services/ai_service.py, src/backend/tasks/narrative.py, src/postgres-init/33_incident_ai_narrative.sql, src/backend/tests/test_incident_narrative.py]
status: verified
---

# PR #104 QA — #69 XAI Incident Narratives

## Overview
PR #104 adds AI-generated plain-language summaries for verified fire incidents using the existing Qwen2.5-3B Ollama pipeline. National Analysts can call `POST /api/analytics/incidents/{id}/narrative` to generate a 2–3 sentence summary stored in `fire_incidents.ai_narrative`. A batch endpoint dispatches a Celery task to backfill narratives for all existing verified incidents.

**Author**: orljorstin
**Issue**: #69
**Base**: master (bea7325)
**Commits**: 3 (`92101bc` feat, `731102d` ruff fix, `ab531c3` import restoration)

## Changes by Component

### 1. Database Migration `33_incident_ai_narrative.sql`
```sql
ALTER TABLE wims.fire_incidents
    ADD COLUMN IF NOT EXISTS ai_narrative TEXT,
    ADD COLUMN IF NOT EXISTS ai_narrative_confidence DOUBLE PRECISION
        CHECK (ai_narrative_confidence IS NULL
               OR (ai_narrative_confidence >= 0.0
                   AND ai_narrative_confidence <= 1.0));
CREATE INDEX idx_fire_incidents_ai_narrative_null
    ON wims.fire_incidents (incident_id)
    WHERE ai_narrative IS NULL
      AND verification_status = 'VERIFIED';
```

✅ Idempotent. `IF NOT EXISTS` on both columns and index.
✅ CHECK constraint enforces 0.0–1.0 range.
✅ Partial index on `WHERE ai_narrative IS NULL AND verification_status='VERIFIED'` — efficient for batch queries.

### 2. AI Service `services/ai_service.py`
Two functions:

**`analyze_threat_log(log_id, db)`** — existing function (from PR #105, appears here due to shared code). Fetches a `security_threat_logs` row, sends to Ollama with JSON format prompt, stores `xai_narrative` / `xai_confidence` back to the log. Uses `qwen2.5:3b` model.

**`generate_incident_narrative(incident_id, db)`** — new function. The narrative generation endpoint uses this.

```python
async def generate_incident_narrative(incident_id, db) -> dict:
    # Fetch: incident + nonsensitive details via LEFT JOIN
    # Guard: 404 if not found, 409 if not VERIFIED
    # Build prompt with 13 fields: category, alarm, location, casualties, damage, station, response time, extent, stage
    # POST to Ollama /api/generate (60s timeout, format=json)
    # Parse response: narrative + confidence
    # Update fire_incidents.ai_narrative + ai_narrative_confidence
    # Return {incident_id, ai_narrative, ai_narrative_confidence}
```

**⚠️ Prompt injection risk**: Prompt builds from user-supplied DB fields (location, station name, fire stage, etc.). A maliciously crafted `fire_station_name` or `city_municipality` field could inject content into the prompt. However, since these are stored text fields from authenticated encoder input and the Ollama model is internal, risk is **Low**. Consider sanitizing or using a structured prompt format.

**⚠️ JSON parsing robustness**: Uses `json.loads()` on the raw `response` field from Ollama. If Ollama returns non-JSON (e.g., plain text), `JSONDecodeError` is caught and an HTTP 502 is raised. This is correct.

**⚠️ Confidence bounds**: `confidence = max(0.0, min(1.0, confidence))` — clamped to valid range. Good.

### 3. Analytics Routes `analytics.py`
Two new endpoints:

**`POST /api/analytics/incidents/{incident_id}/narrative`** (line 482):
```python
async def generate_narrative(
    incident_id: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[dict, Depends(get_analyst_or_admin)],
):
    """
    Generate an AI narrative for a verified fire incident via Qwen2.5-3B.
    Only works on VERIFIED incidents. Stores result in fire_incidents.ai_narrative.
    """
    from services.ai_service import generate_incident_narrative
    return await generate_incident_narrative(incident_id, db)
```

- Protected by `get_analyst_or_admin` ✅ (NATIONAL_ANALYST and SYSTEM_ADMIN only)
- Returns 409 if incident is not VERIFIED ✅
- Returns 404 if incident not found ✅

**`POST /api/analytics/incidents/batch-narratives`** (line 497):
```python
def trigger_batch_narratives(
    limit: int = Query(default=50, le=200),
    current_user: dict = Depends(get_analyst_or_admin),
):
    from tasks.narrative import batch_generate_narratives
    task = batch_generate_narratives.delay(limit=limit)
    return {"task_id": task.id, "status": "dispatched", "limit": limit}
```
- Returns 202 Accepted with Celery task ID ✅
- Limit capped at 200 per query param ✅
- Dispatched to Celery, not blocking ✅

### 4. Celery Task `tasks/narrative.py`
```python
@shared_task(name="tasks.narrative.batch_generate_narratives")
def batch_generate_narratives(limit: int = 50):
    # Query: SELECT incident_id FROM fire_incidents
    #        WHERE verification_status='VERIFIED' AND is_archived=FALSE AND ai_narrative IS NULL
    #        ORDER BY created_at DESC LIMIT :lim
    # For each incident_id, asyncio.run(generate_incident_narrative(iid, db))
    # Returns {"processed": count}
```

**⚠️ Uses `asyncio.run()` inside a Celery task** — Celery tasks are synchronous by default. `asyncio.run()` creates a new event loop for each task invocation. This works but creates overhead per task. Since narratives are generated sequentially (not concurrently), the overhead is minimal. Consider using `run_in_executor` or a dedicated async Celery worker for bulk backfill.

**⚠️ Session management**: Uses `next(get_db())` and `db.close()` in a try/finally. This matches the pattern used in other tasks. Correct.

**⚠️ No retry logic**: If a single narrative generation fails (Ollama timeout, 502, etc.), the task logs a warning and continues to the next incident. This is intentional — partial completion is better than full failure.

### 5. Test Coverage `test_incident_narrative.py`
263 lines, comprehensive:
- `test_narrative_endpoint_requires_auth` — unauthenticated → 401
- `test_narrative_endpoint_rejects_encoder` — encoder → 403
- `test_narrative_endpoint_returns_409_for_draft` — non-VERIFIED → 409
- `test_narrative_endpoint_returns_404_for_unknown_incident` — not found → 404
- `test_narrative_endpoint_stores_result_in_db` — mock Ollama, verify DB write
- `test_narrative_endpoint_increments_confidence_on_regenerate` — overwrite existing narrative
- `test_batch_endpoint_dispatches_celery_task` — trigger batch, verify task ID returned
- `test_batch_endpoint_respects_limit` — verify limit is passed to task

✅ All 8 tests cover the key paths.

**⚠️ Integration test pattern**: The fixture creates a real incident via the test client (uses the real `regional.py` create endpoint), then submits via `PATCH /api/regional/incidents/{id}/submit?force=True`. This is a full integration test. It requires a live DB and Keycloak session. The tests are properly scoped as integration tests (`tests/integration/`).

### 6. Celery Config `celery_config.py`
No new beat schedule for narrative — batch is dispatched on-demand, not scheduled. `celery_config.py` unchanged by this PR.

## Cross-PR Interaction Analysis

See [[pr-qa/pr-103-system-monitoring-prometheus]] for cross-PR conflict notes. This PR and #103 modify the same files (`admin.py`, `analytics.py`, `celery_config.py`). PR #104 adds narrative route to `analytics.py` (no conflict with #103's monitoring routes). The `celery_config.py` overlap is only in the shared base commit (f065468) — no new beat schedule additions conflict.

**PR #105 also adds to `admin.py` and `celery_config.py`** (Suricata auto-incident). Merge order recommendation: #102 → #104 → #103 → #105.

## FRS Alignment
M6-G (XAI Narrative Generation) spec calls for:
- Ollama `qwen2.5:3b` integration ✅
- Plain-language 2–3 sentence summary ✅
- Triggered by National Analyst role ✅
- Stored in incident record ✅
- Batch backfill for existing verified incidents ✅

All requirements met.

## Security Notes
- ✅ Protected by `get_analyst_or_admin` — National Analyst or System Admin only
- ✅ Ollama URL configurable via `OLLAMA_URL` env var (default: `http://wims-ollama:11434`)
- ✅ 60-second timeout on Ollama calls — prevents indefinite hanging
- ⚠️ Prompt injection: user-supplied DB fields in prompt (low risk — internal model)
- ⚠️ `/api/generate` endpoint on Ollama has no authentication — network-isolated via Docker internal network

## QA Verdict

| Area | Status | Risk |
|------|--------|------|
| DB migration | ✅ Idempotent, CHECK constraint | None |
| `ai_service.py` narrative generation | ✅ Correct flow | Low (prompt injection) |
| `POST /incidents/{id}/narrative` | ✅ Protected, correct guards | None |
| `POST /incidents/batch-narratives` | ✅ 202 response, task ID returned | None |
| Celery batch task | ✅ Sequential processing, partial failure handling | Low (asyncio.run overhead) |
| Test coverage | ✅ 8/8 tests | None |
| Ollama robustness | ✅ JSON parse error → 502, confidence clamped | Low |
| FRS alignment | ✅ All M6-G requirements met | None |
| Cross-PR merge order | ⚠️ Merge #104 before #103 and #105 | Medium (manageable) |

**Overall**: ✅ **APPROVE** — Clean implementation, comprehensive tests, all M6-G requirements satisfied. Prompt injection risk is low given the internal model context. Consider a structured prompt format (JSON schema instead of string interpolation) in a future iteration for hardening.

## Related Pages
- [[backend/api-route-map]] — analytics.py route reference
- [[backend/services]] — ai_service.py service reference
- [[backend/remaining-routes]] — analytics route details
- [[pr-qa/pr-103-system-monitoring-prometheus]] — overlapping PR
- [[pr-qa/pr-105-suricata-auto-incident]] — overlapping PR
- [[security/security-baseline]] — XAI/XAI baseline
- [[gaps/frs-codebase-gap-register]] — M6-G was a gap target
