# PR: Validator Fixes, Audit IP, UX Improvements

**Branch:** `fix/validator-accept-csrf-and-audit-ip`
**Base:** `master`

---

## Summary

Nine fixes and improvements across the validator flow, audit trail, and encoder/validator UX.

1. **CRITICAL — Validator could not accept any incidents (403 Forbidden)** — CSRF middleware blocking all state-changing requests from the nginx port.
2. **IP address missing from audit actions** — All lifecycle routes now pre-bind the client IP into the IVH callable. `CREATED_DRAFT` paths (bundle upload, AFOR commit) also fixed.
3. **"View Revision History" button** — Validators can now toggle revision history directly on the incident detail page without opening the accept modal.
4. **Narrative max length** — Raised from 2000 → 10000 chars; also fixes a silent AFOR commit rejection on long narratives.
5. **Disposition nav dot blind spot** — Scroll listener added so the last section's dot activates when near the bottom of the page.
6. **Stats hidden by default** — Both encoder and validator dashboards now start collapsed (resets each login via `sessionStorage`). Validator gets a dedicated toggle button.
7. **Unsaved changes warning** — New `formDirty` singleton; sidebar nav and browser back/close warn before discarding edits.
8. **Validator duplicate modal — pending warning** — Amber banner shown when both the matched and incoming incidents are `PENDING`/`PENDING_VALIDATION`, explaining the consequence of "Replace Existing".

---

## Changes

### 1. CSRF trusted origins — `src/docker-compose.yml`

**Problem:** The CSRF middleware (`utils/csrf.py`) rejects PATCH/POST/PUT/DELETE requests from origins not in its allowlist. The nginx gateway listens on port 8090, so browsers send `Origin: http://localhost:8090` on all state-changing requests. This origin was absent from `CSRF_TRUSTED_ORIGINS`, causing every validator accept/reject/verify action to return 403.

The `CSRF_TRUSTED_ORIGINS` env var **replaces** `DEFAULT_ORIGINS` entirely (not extends), so omitting any port means it is blocked.

**Fix:**

```
Before:
  CSRF_TRUSTED_ORIGINS=http://localhost,https://localhost,http://127.0.0.1,http://127.0.0.1:3000

After:
  CSRF_TRUSTED_ORIGINS=http://localhost,https://localhost,http://127.0.0.1,http://127.0.0.1:3000,http://localhost:8090,http://localhost:3000,http://localhost:8000
```

---

### 2. IP address in every IVH action — `__init__.py`, `encoder_crud.py`, `validator.py`, `incidents.py`, `afor.py`

**Problem:** `_regional_lifecycle_dependencies` built the IVH callable without binding the client IP. All routes that called lifecycle functions (unpend, delete, submit, archive, unarchive, bulk-approve, verify) were writing IVH rows without `ip_address`. Two additional paths for `CREATED_DRAFT` (bundle upload and AFOR commit) had the same gap.

**Fix — lifecycle routes (`__init__.py`):**

`_regional_lifecycle_dependencies(request_ip=...)` now wraps the IVH callable with `_ivh_with_ip` when a non-`None` IP is supplied. All routes in `encoder_crud.py` and `validator.py` pass `get_client_ip(request)` into this factory.

**Fix — bundle upload (`incidents.py`):**

`upload_incident_bundle` was missing `request: Request` entirely. Added parameter and passed `request_ip=get_client_ip(request)` to the `CREATED_DRAFT` IVH write.

**Fix — AFOR commit (`afor.py`):**

`commit_afor_import` injects the IVH callable into `AforCommitDependencies`. The closure now pre-binds the client IP using the same `_ivh_with_ip` pattern:

```python
_request_ip = get_client_ip(request)

def _ivh_with_ip(db, **kwargs):
    return _insert_incident_verification_history(db, request_ip=_request_ip, **kwargs)
```

`encoder_crud.py`'s `create_incident` already passed IP correctly — no change needed there.

---

### 3. View Revision History button — `src/frontend/src/app/dashboard/regional/incidents/[id]/page.tsx`

Validators previously could only view revision history through the accept/reject confirmation modal. Added a dedicated toggle button in the validator actions section beside "Back to Dashboard".

- Added `import { IncidentRevisionHistory }` and `useState(false)` for toggle state.
- Button label cycles between "View Revision History" and "Hide Revision History".
- `<IncidentRevisionHistory incidentId={incidentId} />` renders inline below the action row when toggled on.

---

### 4. Narrative max length — `incident_bundle.py` + test

**Problem:** `narrative` field was capped at 2000 chars. Structural AFOR rows with detailed narratives were silently rejected at commit time with no error surfaced to the user.

**Fix:** Raised the `max_length` validator from `2000` to `10000`. Test updated to match.

**Security note:** No vulnerability introduced. React escapes all rendered text by default (no `dangerouslySetInnerHTML`). The field is AES-256-GCM encrypted at rest. The 10,000-char ceiling still provides reasonable DoS protection.

---

### 5. Disposition nav dot — `SectionDotNav.tsx`

**Problem:** The `IntersectionObserver` approach has a blind spot: when the last section is shorter than the viewport, the final nav dot never activates because the observer threshold is never crossed.

**Fix:** Added a scroll listener — when `scrollY + innerHeight >= document.body.scrollHeight - 120`, the last dot activates regardless of intersection state.

---

### 6. Stats hidden by default — `regional/page.tsx`, `validator/page.tsx`

**Problem:** Stats panels were expanded on every page load, taking up space before the user needed them.

**Fix:** Both dashboards now initialise stats to hidden. State is stored in `sessionStorage` (keyed per-role) so it resets on each login rather than persisting across sessions. The validator dashboard gets a new "▼ Show Stats / ▲ Hide Stats" toggle button styled consistently with the encoder's.

---

### 7. Unsaved changes warning — `src/lib/formDirty.ts`, `IncidentForm.tsx`, `Sidebar.tsx`

**Problem:** Navigating away mid-edit silently discarded unsaved form changes with no warning.

**Fix:**

- New `src/lib/formDirty.ts` singleton exposes `setFormDirty(bool)` and `isFormDirty()`.
- `IncidentForm.tsx` calls `setFormDirty(true)` on the first field change and clears it on unmount.
- `Sidebar.tsx` intercepts all nav link clicks — if dirty, shows `window.confirm(...)` before routing.
- A `beforeunload` handler is also registered for browser back/close/refresh.

---

### 8. Validator duplicate modal — pending warning — `ValidatorDuplicateModal.tsx`

**Problem:** When both the matched incident and the incoming incident are `PENDING` or `PENDING_VALIDATION`, clicking "Replace Existing" immediately verifies the incoming one. This was non-obvious to validators.

**Fix:** `ValidatorDuplicateModal` now fetches the matched incident's status on open. If both are pending, an amber warning banner is shown:

> "The matched incident is also pending. Choosing 'Replace Existing' will immediately verify the incoming incident."

---

## Context: Why revision history may appear empty

The encoder withdraw → edit → resubmit flow creates a **new** incident (fresh `fire_incidents` row) rather than updating the existing one. Revision history is per-incident, so a newly submitted incident will only show its own `SUBMITTED` entry. This is expected behavior — the prior incident's history remains on the withdrawn record.

---

## Files Changed

| File | Change |
|---|---|
| `src/docker-compose.yml` | Added nginx port 8090 + localhost ports to `CSRF_TRUSTED_ORIGINS` |
| `src/backend/api/routes/regional/__init__.py` | `_regional_lifecycle_dependencies` now pre-binds IP into IVH callable |
| `src/backend/api/routes/regional/encoder_crud.py` | All lifecycle calls pass `get_client_ip(request)` |
| `src/backend/api/routes/regional/validator.py` | All lifecycle calls pass `get_client_ip(request)` |
| `src/backend/api/routes/incidents.py` | Added `request: Request` to `upload_incident_bundle`; pass IP to IVH |
| `src/backend/api/routes/regional/afor.py` | `_ivh_with_ip` closure pre-binds IP for AFOR commit |
| `src/backend/schemas/incident_bundle.py` | Narrative `max_length` 2000 → 10000 |
| `src/backend/tests/…` | Test updated for new narrative length |
| `src/frontend/src/app/dashboard/regional/incidents/[id]/page.tsx` | Revision history toggle button + inline panel |
| `src/frontend/src/app/dashboard/regional/page.tsx` | Stats hidden by default via `sessionStorage` |
| `src/frontend/src/app/dashboard/validator/page.tsx` | Stats hidden by default; new toggle button |
| `src/frontend/src/components/SectionDotNav.tsx` | Scroll-to-bottom activates last nav dot |
| `src/frontend/src/components/IncidentForm.tsx` | Calls `setFormDirty` on first edit; clears on unmount |
| `src/frontend/src/components/ValidatorDuplicateModal.tsx` | Fetches matched status; amber warning if both pending |
| `src/frontend/src/lib/formDirty.ts` | New singleton for unsaved-changes tracking |
| `src/frontend/src/components/Sidebar.tsx` | Intercepts nav clicks when form is dirty |

---

## CI

- `ruff check .` — 0 errors
- `ruff format --check .` — 0 errors
- `npx eslint .` — 0 errors (19 pre-existing warnings, unchanged)

---

## Deploy note

Requires container rebuild (no volume wipe needed):
```bash
cd src && docker compose down && docker compose up --build -d
```

---

## Addendum: Remove AFOR Wildland Create Form

**Branch:** `feat/validator-and-encoder-UI-enhancement`

### What changed

- **`src/frontend/src/app/afor/create/page.tsx`** — Removed the Structural/Wildland AFOR type toggle and the `WildlandAforManualForm` rendering block. The page now always renders the structural `IncidentForm`. Removed unused `formKind` state, `showToggle` variable, `AforFormKind` import, and `WildlandAforManualForm` import.
- **`src/frontend/src/components/WildlandAforManualForm.tsx`** — Deleted (dead code; no longer rendered anywhere).
- **`src/frontend/src/lib/offlineEnable.ts`** — Removed the `WildlandAforManualForm` chunk from `warmChunks()`.
- **`src/frontend/src/app/dashboard/regional/layout.tsx`** — Removed the eager `WildlandAforManualForm` preload from the regional layout `useEffect`.

### What was NOT changed

- Database schema (`wims.incident_wildland_afor` and child tables) — untouched.
- Backend routes (`encoder.py`, `commit.py`, `parse.py`, `stats.py`) — untouched; wildland AFOR import via file upload still persists correctly.
- Analyst read-only wildland detail view (`/dashboard/analyst/incidents/[id]/wildland`) — untouched.
- Wildland classification card and `WildlandFireBreakdown` stats widget — untouched.
- `WildlandFireBreakdown.tsx` dashboard component — untouched.

### Why

Only structural AFORs will be created manually. Wildland AFORs may still arrive via file import (the import → parse → commit pipeline is unchanged), but the manual creation path for wildland type is removed from the UI.
