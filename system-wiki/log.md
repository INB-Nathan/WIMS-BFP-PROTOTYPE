## [2026-06-27] fix | center /fire-stations around user location when available

- **Scope:** `/fire-stations` no longer forces the initial map viewport to fit all nationwide stations when browser geolocation succeeds. It centers on the user's location at local zoom while still rendering all station markers.
- **Files modified:**
  - `src/frontend/src/app/fire-stations/page.tsx` — requests browser geolocation on load, passes `userLocation` to the map, and refreshes `/api/ref/emergency-services` with `lat/lon` for distance metadata when available. Denied/unavailable geolocation keeps the existing national fallback.
  - `src/frontend/src/app/fire-stations/FireStationsMapInner.tsx` — accepts `userLocation`, skips nationwide `fitBounds` when present, centers at zoom 12, and renders the shared user-location marker.
  - `src/frontend/src/app/fire-stations/FireStationsMapInner.test.tsx` — adds coverage for user-location centering.
- **Validation:** Targeted Vitest command could not run in the current host checkout because `vitest/config` is missing from local `node_modules`; no application test failure observed.
- **Route map:** `system-wiki/frontend/route-map.md` still omits `/fire-stations` as a pre-existing route-table gap; behavior change logged here.

## [2026-06-27] fix: remove orphaned AI incident narrative endpoints (dead code)

Branch: cleanup-ai-narrative-and-geography (off origin/master).

### Scope
Removed the AI incident narrative feature (PR #104 / #69) — backend-only feature that was never wired to the frontend and is not in the FRS.

### Changes
- **Deleted:** `src/backend/tasks/narrative.py` — Celery batch task (`batch_generate_narratives`)
- **Deleted:** `src/backend/tests/test_incident_narrative.py` — 7 tests for the orphaned endpoints
- **Removed:** `generate_incident_narrative()` from `src/backend/services/ai_service.py` (~160 lines incl. Ollama prompt, encryption, DB write)
- **Removed:** Two POST endpoints from `src/backend/api/routes/analytics.py` — `POST /incidents/{incident_id}/narrative` and `POST /incidents/batch-narratives`
- **Removed:** `TestNarrativeTaskReturnShape` from `tests/test_ai_service_retry.py`
- **Cleaned:** `celery_config.py` — removed `"tasks.narrative"` from both `include` and `imports`
- **Cleaned:** Unused imports in `ai_service.py` — `get_crypto_provider`, `SecurityProviderError`

### Preserved
- DB columns (`ai_narrative`, `ai_narrative_enc`, etc.) — harmless, no migration needed
- Historical migration script `encrypt_ai_narratives_backlog.py` — reference only
- `xai_narrative` feature for security threat logs — unrelated, actively used
- `narrative_report` field — human-written, unrelated

