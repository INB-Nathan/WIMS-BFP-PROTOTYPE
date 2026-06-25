# WIMS-BFP Repudiation Fix Plan — v2
# RP-05, RP-06, RP-08, RP-18, RP-19, RP-20, RP-23

**HEAD verified against:** `39a2396` (feat(#394): audit integrity — correlation IDs + fail-closed + backfill)
**Compiled:** 2026-06-25
**Status:** Plan only — no code changes committed.

---

## Corrected-from-v1 Notice

The prior `AuditGapsPlan.md` was authored against `C:\Users\Shiba\WIMS-BFP-PROTOTYPE`, a
checkout that does not match this repo at `E:\WIMS-GIT\WIMS-BFP-PROTOTYPE`. Every claim
below was re-verified from source on HEAD `39a2396`. The following v1 citations were stale
or wrong and are **not carried forward**:

| v1 claim | Reality on this HEAD |
|---|---|
| `67_repudiation_hardening.sql` existed with `no_update_ivh` at line 24 | File does not exist; postgres-init ends at `62_*.sql` |
| `68_correction_data_hash_fix.sql` existed | File does not exist |
| `helpers.py:55-81` held `HASHED_NSD_FIELDS`; `:84-137` held `compute_incident_data_hash` | Those symbols do not exist; lines 55–137 are category normalisation + safe_int/safe_float + region aliases |
| `main.py:304-328` was correction-hash exception | Lines 314–328 insert `svc_task` service account |
| `main.py:335-350` was `no_update_ivh` patch | Lines 334–346 transfer materialized view ownership |
| `main.py:357-378` was `verified_requires_data_hash` patch | Lines 362–366 set RLS helpers to `SECURITY DEFINER` |
| `POST /api/auth/security-event` existed at `auth.py:379` with `_AUTH_EVENT_RESULTS` | `src/backend/api/routes/auth.py` is the email-verification router (362 lines, no security-event endpoint, no such dict) |
| `audit.py:171` was `export_audit_logs` CSV endpoint | `audit.py` is 130 lines; no export endpoint exists |
| `admin/audit/page.tsx:184` was `handleExportCsv`; `:414` was export button | Line 184 is `toggleRowExpand`; line 414 is `<th>IP Address</th>`; no export anywhere in the 553-line file |
| `sessions.py:68,118` and `admin/users.py:427` showed admin force-logout as audited | Neither file calls `log_system_audit`; the admin force-logout path is also unaudited |
| `callback/page.tsx:43-46` fired `FAILED_LOGIN` to `/api/auth/security-event` | callback/page.tsx (98 lines) makes no such call |
| `AuthContext.tsx:235-287` was the logout function body | `logout()` is at lines 192–232; 234+ is the Provider JSX return |

---

## 1. Gap Status Table — verified on HEAD `39a2396`

| # | Gap | Status | Evidence |
|---|---|---|---|
| RP-05 | No UPDATE block on `incident_verification_history` | **OPEN** | `17_immutable_records.sql:54-57` adds `no_delete_ivh` (DELETE only). No UPDATE block anywhere in codebase. |
| RP-06 | `data_hash` covers only provenance, not NSD fields | **OPEN** | `validator.py:460-468` builds `canonical` from 6 provenance fields only: `encoder_id`, `keycloak_id`, `incident_id`, `region_id`, `verification_status`, `created_at`. Zero NSD fields included. |
| RP-08 | No `FAILED_LOGIN` audit capture | **OPEN** | `callback/page.tsx` makes no security-event call. No Keycloak event-listener SPI (only `demo-otp-provider` under `src/keycloak/`). |
| RP-18 | No `PASSWORD_RESET` audit | **OPEN** | `src/frontend/src/app/login/page.tsx` has no forgot-password link (grep: zero matches). Reset flow is Keycloak-hosted and never touches WIMS frontend. |
| RP-19 | No self-service `LOGOUT` audit | **OPEN** | `AuthContext.tsx:192-232` `logout()` POSTs to `/api/auth/logout` (session teardown) but makes no security-event call. No `/api/auth/security-event` endpoint exists to call. |
| RP-20 part 1 | No `verified_requires_data_hash` CHECK constraint | **OPEN** | Symbol absent from all SQL files and main.py. `61_check_constraints.sql` covers non-negative numerics only. VERIFIED rows can be inserted without `data_hash`. |
| RP-20 part 2 | No audit trigger on direct `fire_incidents` INSERTs | **OPEN** | No trigger or function named `audit_fire_incidents_insert` exists. |
| RP-23 | No audit-log CSV export | **OPEN** | `audit.py` (130 lines) has only `GET /audit-logs` (paginated JSON) and `POST /audit-logs/analyze`. `admin/audit/page.tsx` (553 lines) has no export function or button. |

### Nearest existing code for each gap

| # | Nearest existing code |
|---|---|
| RP-05 | `17_immutable_records.sql:33-47` — `no_update_verified` and `no_delete_verified` on `fire_incidents`; `17_immutable_records.sql:54-57` — `no_delete_ivh` |
| RP-06 | `validator.py:460-468` — existing canonical dict (provenance only) |
| RP-08 | `callback/page.tsx:40-45` — sync-fail redirect path (no security-event call) |
| RP-18 | N/A — reset runs entirely on Keycloak pages |
| RP-19 | `AuthContext.tsx:196` — existing `fetch('/api/auth/logout', …)` call in logout() |
| RP-20 part 1 | `61_check_constraints.sql` — pattern for idempotent CHECK constraints |
| RP-20 part 2 | `public_dmz.py:243-252` — `log_system_audit` call pattern with `sensitive=True` |
| RP-23 | `audit.py:21-119` — existing `GET /audit-logs` to extend; `admin/audit/page.tsx:1-553` — existing page to add export to |

---

## 2. Shared Infrastructure Reality

### 2.1 `POST /api/auth/security-event` — NET NEW

This endpoint **does not exist** on this HEAD. WS-A must create it. Design:

**File:** `src/backend/api/routes/security_events.py`

```python
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional
import redis.asyncio as aioredis
import os

from auth import get_db_with_rls, get_current_wims_user
from utils.audit import log_system_audit, hash_client_ip, get_client_ip

router = APIRouter(prefix="/api/auth", tags=["security-events"])

# action_type → result (fail-closed: unknown event_type rejected with 422)
_SECURITY_EVENT_ACTIONS: dict[str, str] = {
    "LOGOUT": "success",
    "FAILED_LOGIN": "failure",
    "PASSWORD_RESET": "success",
}
```

- **Route:** `POST /api/auth/security-event`
- **Auth:** Optional — LOGOUT fires while cookie is still present; do not require auth so that a short-lived race between cookie expiry and the fetch doesn't 401-fail the audit. Accept the Keycloak cookie if present but do not gate on it.
- **Body:**
  ```python
  class SecurityEventRequest(BaseModel):
      event_type: str          # must be in _SECURITY_EVENT_ACTIONS
      username: Optional[str] = None
  ```
- **Rate limit:** per-IP Redis counter, max 30 calls / 60 s window. Follow the `_check_rate_limit` pattern from `src/backend/api/routes/auth.py:85-102`.
- **Rejection:** unknown `event_type` → 422 (do not silently accept unknown strings into the audit trail).
- **Write:** `log_system_audit(db, None, event_type, "wims.auth", None, request, result=_SECURITY_EVENT_ACTIONS[event_type])`
- **Registration:** add `from api.routes.security_events import router as security_events_router` and `app.include_router(security_events_router)` to `main.py` alongside the other `app.include_router` calls at `main.py:604-623`.

### 2.2 `log_system_audit` — verified signature (`utils/audit.py:227`)

```python
def log_system_audit(
    db: Session,
    user_id: uuid.UUID | str | None,   # None for anonymous/system events
    action_type: str,                   # e.g. "LOGOUT", "CREATE_INCIDENT"
    table_affected: str,                # e.g. "wims.auth", "wims.fire_incidents"
    record_id: int | None,             # PK of the affected row, or None
    request: Request | None = None,    # FastAPI Request for IP/UA extraction
    old_values: dict | None = None,    # JSONB snapshot for UPDATE actions
    new_values: dict | None = None,    # JSONB snapshot for INSERT/UPDATE
    correlation_id: str | None = None, # X-Request-ID propagated by middleware
    result: str = "success",           # "success" or "failure"
    ip_hash: str | None = None,        # pre-hashed IP (pass None to auto-hash)
    sensitive: bool = False,           # True = fail-closed, raises AuditInsertFailed
)
```

**Caller is responsible for `db.commit()`** — `log_system_audit` never commits.

**Example call from `public_dmz.py:243-252`** (fail-closed, user_id=None):
```python
log_system_audit(
    db=db,
    user_id=None,
    action_type="PUBLIC_INCIDENT_SUBMIT",
    table_affected="wims.fire_incidents",
    record_id=incident_id,
    request=request,
    ip_hash=ip_hash_value,
    sensitive=True,
)
db.commit()
```

**Example call from `incidents.py:879`** (fail-open, authenticated):
```python
log_system_audit(db, user_id, "CREATE_INCIDENT", "wims.fire_incidents", row[0], request)
db.commit()
```

### 2.3 `get_db_with_rls` — verified location (`auth.py:449-470`)

Sets `SET LOCAL wims.current_user_id = :uid` via `set_rls_context()` when a user is present. Does **not** currently set `app.audit_source`. WS-C adds that second GUC here.

### 2.4 `get_db` — verified location (`database.py:78-96`)

Yields `_AdminSessionLocal` (superuser). Used by `public_dmz.py:163`. Does **not** set any GUC. WS-C must also patch this.

---

## 3. Workstreams

### WS-A — RP-19 self-service LOGOUT audit (frontend + backend)

**Scope:** Create the client-reported security-event backend endpoint, then wire the frontend logout to call it.

#### WS-A files to create

1. `src/backend/api/routes/security_events.py` — new router with `POST /api/auth/security-event` as specified in §2.1. Accepts `LOGOUT` and `FAILED_LOGIN` (leave `PASSWORD_RESET` for WS-B). Rate-limited 30/60s per IP. Writes via `log_system_audit`.

#### WS-A files to change

2. `src/backend/main.py` — add `from api.routes.security_events import router as security_events_router` and `app.include_router(security_events_router)` near line 622.

3. `src/frontend/src/context/AuthContext.tsx` — in `logout()` at line 192, insert the following **before** the existing `fetch('/api/auth/logout', …)` call so the OIDC cookie is still present when the request fires. Use `AbortController` with a 1500 ms timeout so a network delay never blocks logout:

   ```ts
   // RP-19: record self-service logout before session teardown.
   // Fire-and-forget; a failure must never block logout.
   try {
     const ctrl = new AbortController();
     const tid = setTimeout(() => ctrl.abort(), 1500);
     await fetch('/api/auth/security-event', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ event_type: 'LOGOUT', username: user?.preferred_username ?? null }),
       signal: ctrl.signal,
     }).catch(() => {});
     clearTimeout(tid);
   } catch { /* non-fatal */ }
   ```

4. `src/frontend/src/context/AuthContext.test.tsx` — add tests:
   - Mock `global.fetch`. Call `logout()`. Assert one call to `/api/auth/security-event` with `{event_type:'LOGOUT'}` **and** that `userManager.signoutRedirect` is still reached.
   - Assert that when the security-event fetch throws (network error), logout still completes.

5. `src/backend/tests/test_security_events.py` — new test file:
   - `POST /api/auth/security-event` with `{event_type:'LOGOUT'}` → 202, audit row written.
   - Unknown `event_type` → 422.
   - Rate-limit enforcement: 31st call in window → 429.
   - Confirmed `user_id=None` in the audit row (anonymous call).

#### WS-A CI gates

- Backend: `ruff check . && ruff format --check . && pytest -v`
- Frontend: `npm run lint && npx vitest run && npm run build`
- No SQL, no migration, no infra change.

---

### WS-B — RP-08 + RP-18 Keycloak EventListener SPI (greenfield)

**Scope:** New Java SPI that pushes Keycloak-native auth events to a new backend ingest
endpoint. `POST /api/auth/security-event` (WS-A) remains the frontend-reported path; this
adds a second, SPI-reported path. WS-B does NOT handle LOGOUT (WS-A owns it) to prevent
duplicate rows.

**Note:** `_AUTH_EVENT_RESULTS` does not exist and WS-B cannot "extend" it. The new ingest
endpoint is fully greenfield. The SPI mirrors `demo-otp-provider`'s structure, which is
confirmed present at `src/keycloak/demo-otp-provider/`.

#### WS-B captured events

| Keycloak EventType | WIMS `action_type` | `result` |
|---|---|---|
| `LOGIN_ERROR` | `FAILED_LOGIN` | `failure` |
| `USER_DISABLED_BY_BRUTE_FORCE` | `FAILED_LOGIN` | `failure` |
| `UPDATE_PASSWORD` | `PASSWORD_RESET` | `success` |
| `RESET_PASSWORD_EMAIL` | `PASSWORD_RESET` | `success` |
| `LOGOUT` | **excluded** — WS-A is the sole LOGOUT source | — |

#### WS-B files to create (SPI)

1. `src/keycloak/wims-audit-event-listener/pom.xml` — copy `src/keycloak/demo-otp-provider/pom.xml`, change `artifactId` to `wims-audit-event-listener`, add `org.keycloak:keycloak-core` dependency.

2. `src/keycloak/wims-audit-event-listener/src/main/java/gov/bfp/wims/keycloak/WimsAuditEventListenerProvider.java` — implements `EventListenerProvider`. `onEvent()` filters the four event types above, builds `{event_type, username, error, keycloak_event_id}`, POSTs to `${WIMS_AUDIT_INGEST_URL}` with `Authorization: Bearer ${WIMS_KEYCLOAK_EVENT_SECRET}`. Failures logged and swallowed — never block login.

3. `src/keycloak/wims-audit-event-listener/src/main/java/gov/bfp/wims/keycloak/WimsAuditEventListenerProviderFactory.java` — implements `EventListenerProviderFactory`, `getId()` returns `"wims-audit-event-listener"`.

4. `src/keycloak/wims-audit-event-listener/src/main/resources/META-INF/services/org.keycloak.events.EventListenerProviderFactory` — single line with the factory FQCN.

#### WS-B files to change

5. `src/keycloak/Dockerfile` (EXISTS ✓) — add build + copy stage for `wims-audit-event-listener` jar alongside the existing `demo-otp-provider` stage.

6. `src/keycloak/import/bfp-realm.json` (EXISTS ✓) and `src/keycloak/bfp-realm.json` (EXISTS ✓) — add `"wims-audit-event-listener"` to the realm's `eventsListeners` array.

7. `src/docker-compose.yml` — add `WIMS_KEYCLOAK_EVENT_SECRET` env to both `keycloak` and `backend` services. Add `WIMS_AUDIT_INGEST_URL=http://backend:8000/api/auth/keycloak-event` to `keycloak` service.

8. `src/backend/api/routes/security_events.py` (created by WS-A) — append `POST /api/auth/keycloak-event`:
   - **Auth:** validate `Authorization: Bearer` against `os.environ["WIMS_KEYCLOAK_EVENT_SECRET"]`. **Fail-closed:** if the env var is unset or empty, return 500 at startup (or 401 on every request) — do not silently accept unauthenticated ingest. Recommended: check at import time with `_KC_SECRET = os.environ.get("WIMS_KEYCLOAK_EVENT_SECRET", "")` and return 503/no-op if blank, with a startup log warning. Do NOT use `os.environ["…"]` (raises `KeyError` on missing and crashes the process); instead use `.get()` and return 401 immediately if blank.
   - **Body:** `{event_type: str, username: str | None, error: str | None, keycloak_event_id: str | None}`
   - **Mapping table:** `_KEYCLOAK_EVENT_MAP = {"LOGIN_ERROR": "FAILED_LOGIN", "USER_DISABLED_BY_BRUTE_FORCE": "FAILED_LOGIN", "UPDATE_PASSWORD": "PASSWORD_RESET", "RESET_PASSWORD_EMAIL": "PASSWORD_RESET"}` — reject anything outside this map with 422.
   - **Write:** `log_system_audit(db, None, mapped_action, "wims.auth", None, request, new_values={"username": username, "error": error, "source": "keycloak_spi"}, result=result_val)`
   - **No rate limit** (single known internal caller; body-size cap instead).
   - **Coexistence:** `/api/auth/security-event` (WS-A, public) and `/api/auth/keycloak-event` (WS-B, SPI-authenticated) are independent routes. Do not merge them.

9. `src/.env.production.example` — document `WIMS_KEYCLOAK_EVENT_SECRET` (required before rollout) and `WIMS_AUDIT_INGEST_URL` (default `http://backend:8000/api/auth/keycloak-event`).

#### WS-B files to change (tests)

10. `src/backend/tests/test_security_events.py` (created by WS-A) — add:
    - Valid secret + `LOGIN_ERROR` body → 202, audit row with `action_type='FAILED_LOGIN'`, `result='failure'`.
    - Missing secret header → 401.
    - Wrong secret → 401.
    - Unknown `event_type` → 422.
    - All four Keycloak EventTypes round-trip to correct WIMS action/result pairs.
    - `user_id=None` in the written audit row (never look up accounts on ingest — avoids account-existence leakage).

11. `src/backend/tests/integration/test_keycloak_password_reset.py` — add assertion that `bfp-realm.json` (both paths) registers `wims-audit-event-listener` in `eventsListeners`.

#### WS-B CI gates

- Backend: `ruff check . && ruff format --check . && pytest -v`
- Keycloak image: `cd src/keycloak && docker build -t wims-kc-precheck .` (verifies Maven compilation). If the build fails, `docker compose up` fails fast — no silent breakage.
- SQL: no migration.
- Frontend: no change.

**Deploy prerequisite:** `WIMS_KEYCLOAK_EVENT_SECRET` must be set on the VPS **before** the new Keycloak image rolls out. Coordinate via deploy runbook.

---

### WS-C — RP-20 part 2 direct-INSERT audit trigger (defense-in-depth)

**Scope:** Postgres trigger + `app.audit_source` GUC carve-out in three session-creation
paths. The trigger fires on every `wims.fire_incidents` INSERT; the GUC suppresses it for
all legitimate application inserts; unset GUC = DBA script = produces `DIRECT_DB_INSERT`.

#### WS-C GUC carve-out — all fire_incidents INSERT paths on this HEAD

| Caller | Session dependency | GUC set after WS-C? |
|---|---|---|
| `encoder_crud.py:119/138` | `get_db_with_rls` (`auth.py:449`) | YES — add there |
| `incidents.py:278` (upload_bundle) | `get_db_with_rls` | YES |
| `incidents.py:863` (create_incident) | `get_db_with_rls` | YES |
| `afor_import/commit.py:165/581` | passed from `afor.py:157` via `get_db_with_rls` | YES |
| `public_dmz.py:216` (anonymous zero-trust) | `get_db` (`database.py:78`) | YES — add there too |
| `suricata_ingestion.py:180` (Celery/Suricata auto-create) | `_SessionLocal()` directly (`suricata_ingestion.py:244`) | Must set explicitly inside `ingest_eve_file` after session creation |

The GUC is `SET LOCAL` (transaction-scoped). For `suricata_ingestion.py`, which may run
multi-transaction loops, add `db.execute(text("SET LOCAL app.audit_source = 'app'"))` inside
the transaction block that wraps the `fire_incidents` INSERT (near line 244, before the
`for line in f:` loop or at the start of each alert-processing transaction).

#### WS-C files to create

1. `src/postgres-init/63_fire_incidents_insert_audit_trigger.sql`:
   ```sql
   CREATE OR REPLACE FUNCTION wims.audit_fire_incidents_insert()
   RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
   BEGIN
     -- Carve-out: legitimate app inserts set app.audit_source = 'app'.
     -- current_setting(…, true) returns NULL (not an error) when unset.
     IF current_setting('app.audit_source', true) = 'app' THEN
       RETURN NEW;
     END IF;
     INSERT INTO wims.system_audit_trails
       (user_id, action_type, table_affected, record_id,
        user_agent, timestamp, result, new_values)
     VALUES
       (NULL, 'DIRECT_DB_INSERT', 'wims.fire_incidents', NEW.incident_id,
        'postgres-trigger', now(), 'success',
        jsonb_build_object(
          'current_user', current_user,
          'session_user', session_user,
          'incident_id',  NEW.incident_id
        ));
     RETURN NEW;
   END $$;

   DROP TRIGGER IF EXISTS trg_fire_incidents_insert_audit
     ON wims.fire_incidents;
   CREATE TRIGGER trg_fire_incidents_insert_audit
     AFTER INSERT ON wims.fire_incidents
     FOR EACH ROW EXECUTE FUNCTION wims.audit_fire_incidents_insert();
   ```

   Note: keep `new_values` minimal (IDs only) — do not log full row contents in the
   trigger because PII fields (`sensitive_details`) may be in the transaction context.

#### WS-C files to change

2. `src/backend/auth.py` — in `get_db_with_rls` at line 449, after `set_rls_context(db, user_id)` (line 467), add:
   ```python
   db.execute(text("SET LOCAL app.audit_source = 'app'"))
   ```

3. `src/backend/database.py` — in `get_db` at line 78, after `db = _AdminSessionLocal()` (line 92), add:
   ```python
   db.execute(text("SET LOCAL app.audit_source = 'app'"))
   ```
   Import `text` from sqlalchemy (already imported at line 8 in database.py — verify).

4. `src/backend/services/suricata_ingestion.py` — in `ingest_eve_file`, after `db = db_session if db_session is not None else _SessionLocal()` (line 244), add:
   ```python
   try:
       db.execute(text("SET LOCAL app.audit_source = 'app'"))
   except Exception:
       pass  # non-fatal; trigger would fire but that's acceptable for Suricata auto-creates
   ```

5. `src/backend/main.py` — add trigger creation to `apply_schema_patches()` using `_apply_postgres_init_sql_patch(db, "63_fire_incidents_insert_audit_trigger.sql", "fire_incidents direct-insert audit trigger")` near the end of the patch list (after the `62_audit_correlation_columns.sql` call at line 452).

#### WS-C files to change (tests)

6. `src/backend/tests/test_direct_insert_audit_trigger.py` — new test file:
   - Insert via `_AdminSessionLocal` without setting `app.audit_source` → assert `DIRECT_DB_INSERT` audit row appears.
   - Insert via `_AdminSessionLocal` with `SET LOCAL app.audit_source = 'app'` → assert **no** `DIRECT_DB_INSERT` row.
   - Verify trigger is idempotent (run the SQL twice, assert single trigger in `pg_trigger`).

#### WS-C CI gates

- Backend: `ruff check . && ruff format --check . && pytest -v`
- SQL replay: `psql -v ON_ERROR_STOP=1 … -f 63_fire_incidents_insert_audit_trigger.sql` against throwaway container — must be idempotent (`DROP TRIGGER IF EXISTS` + `CREATE OR REPLACE FUNCTION`).
- No frontend change.

#### Accepted residual risk

A DB actor with `INSERT` on `wims.fire_incidents` can also `DROP TRIGGER`. This trigger is
defense-in-depth and visibility, not a hard barrier. RP-20 part 1 (the `verified_requires_data_hash`
CHECK) is the real gate — see WS-D.

---

### WS-D — RP-05, RP-06, RP-20 part 1, RP-23 (confirmed OPEN, deferred one sprint)

**Recommendation:** defer these four fixes to a follow-up PR (WS-D) after WS-A/B/C merge.
Rationale: WS-A/B/C close the highest-visibility repudiation gaps (all audit events). WS-D
items are schema integrity fixes (RP-05, RP-06, RP-20 part 1) and a UX export feature
(RP-23) that carry no deployment risk if deferred one sprint.

#### RP-05 — UPDATE block on `incident_verification_history`

**Missing:** `no_update_ivh` rule. `17_immutable_records.sql:54-57` has only `no_delete_ivh`.

Fix: new file `src/postgres-init/64_no_update_ivh.sql`:
```sql
DROP RULE IF EXISTS no_update_ivh ON wims.incident_verification_history;
CREATE RULE no_update_ivh AS
  ON UPDATE TO wims.incident_verification_history
  DO INSTEAD NOTHING;
```
And add `_apply_postgres_init_sql_patch(db, "64_no_update_ivh.sql", "no_update_ivh rule on IVH")` in `main.py`'s `apply_schema_patches()`.

#### RP-06 — `data_hash` must cover NSD fields, not only provenance

**Missing:** `validator.py:460-468` builds `canonical` from only 6 provenance fields. NSD
corrections don't perturb the hash, so an attacker who edits the DB directly after
verification leaves the hash intact.

Fix: extend `canonical` in `validator.py:460-468` to include the same NSD fields that the
`ALLOWED_NSD_FIELDS` set (lines 407-433) controls. Emit a deterministic sorted JSON of both
provenance and the post-correction NSD snapshot. Also fix the initial `data_hash` assignment
at verification time (the verify endpoint, separate from the correction endpoint) to cover
NSD fields from the start — search `validator.py` for the verification transition that sets
the original `data_hash` and apply the same expansion there.

#### RP-20 part 1 — `verified_requires_data_hash` CHECK constraint

**Missing:** no constraint preventing VERIFIED rows without `data_hash`. Fix: new file
`src/postgres-init/65_verified_requires_data_hash.sql`:
```sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'verified_requires_data_hash'
      AND conrelid = 'wims.fire_incidents'::regclass
  ) THEN
    ALTER TABLE wims.fire_incidents
      ADD CONSTRAINT verified_requires_data_hash
      CHECK (verification_status <> 'VERIFIED' OR data_hash IS NOT NULL) NOT VALID;
  END IF;
END $$;
```
Plus `_apply_postgres_init_sql_patch(db, "65_verified_requires_data_hash.sql", "verified_requires_data_hash CHECK")` in `main.py`.

#### RP-23 — audit-log CSV export

**Missing:** no export endpoint in `audit.py` (130 lines); no export button in
`admin/audit/page.tsx` (553 lines).

Backend fix: add `GET /api/admin/export-audit-logs` to `src/backend/api/routes/admin/audit.py`
that streams a CSV using Python's `csv` module. Accept the same filter query params as the
existing `GET /audit-logs` endpoint (lines 22-34). Gate on `get_system_admin`.

Frontend fix: add `handleExportCsv` function and an export button to `admin/audit/page.tsx`
that calls the new endpoint with the current filter state and triggers a `<a download>` blob
save. Add `LOGOUT`, `FAILED_LOGIN`, `PASSWORD_RESET`, `DIRECT_DB_INSERT` to
`KNOWN_ACTION_TYPES` (lines 29-46) once WS-A/B/C ship those event types.

---

## 4. PR Sequencing and Deployment Order

```
PR 1 — WS-A (RP-19)
  Smallest. Frontend-only auth context change + new backend security-event endpoint.
  No env var, no SQL, no infra. Safe to merge and deploy immediately.

PR 2 — WS-C (RP-20 part 2)
  Self-contained SQL trigger + get_db_with_rls patch + get_db patch + suricata patch.
  Idempotent SQL replay on deploy. Verify via: docker compose exec postgres psql … -c
  "INSERT INTO wims.fire_incidents …" without setting GUC → expect DIRECT_DB_INSERT row.

PR 3 — WS-B (RP-08 + RP-18)
  Requires WIMS_KEYCLOAK_EVENT_SECRET on VPS before rollout.
  Set env var → rebuild + deploy Keycloak image → verify FAILED_LOGIN in /admin/audit.

PR 4 — WS-D (RP-05, RP-06, RP-20 part 1, RP-23)
  Schema corrections + export UX. Lower urgency; defer at least one sprint after PR 1-3.
```

### Merge-conflict assessment

| PR | Touches |
|---|---|
| PR 1 (WS-A) | `AuthContext.tsx`, `AuthContext.test.tsx`, new `security_events.py`, `main.py` (add include_router) |
| PR 2 (WS-C) | `auth.py` (get_db_with_rls), `database.py` (get_db), `suricata_ingestion.py`, new SQL, `main.py` (add patch) |
| PR 3 (WS-B) | `security_events.py` (add keycloak-event endpoint), `main.py` (not if already merged), Keycloak files, docker-compose.yml |
| PR 4 (WS-D) | `validator.py`, `audit.py`, `admin/audit/page.tsx`, new SQL files |

PRs 1, 2, 3 can be developed in parallel and merged in order. PR 3 depends on WS-A's
`security_events.py` file existing (adds a second endpoint to it); if WS-B is developed
first, create `security_events.py` in WS-B and merge PR 2 → PR 1 → PR 3 instead.

---

## 5. Pre-commit Local Gate (all PRs)

```bash
# 1. Backend lint + format
cd src/backend && ruff check . && ruff format --check .

# 2. Backend tests
cd src/backend && pytest -v --tb=short

# 3. Frontend (PR 1)
cd src/frontend && npm run lint && npx vitest run && npm run build

# 4. SQL replay (PRs 2 and 4) — throwaway container
docker run --rm -e POSTGRES_PASSWORD=postgres -d --name wims-sql-test \
  -p 5433:5432 postgis/postgis:15-3.4
for f in $(ls src/postgres-init/*.sql | LC_ALL=C sort); do
  PGPASSWORD=postgres psql -v ON_ERROR_STOP=1 -h localhost -p 5433 \
    -U postgres -d postgres -f "$f"
done
docker rm -f wims-sql-test

# 5. Keycloak image (PR 3)
cd src/keycloak && docker build -t wims-kc-precheck .
```

---

## 6. Wiki Updates Required (per AGENTS.md lines 33–34)

For each PR, before final response:

1. `system-wiki/gaps/functional-bug-register.md` — update RP-08, RP-18, RP-19, RP-20, RP-23 status as each WS closes them.
2. `system-wiki/security/security-baseline.md` — add "Auth-Lifecycle Audit" subsection describing both ingest paths (`/security-event` client-reported, `/keycloak-event` SPI-reported) and the `DIRECT_DB_INSERT` trigger.
3. `system-wiki/subsystems/admin-hub.md` — note that `LOGOUT`, `FAILED_LOGIN`, `PASSWORD_RESET`, `DIRECT_DB_INSERT` are now populated `action_type` values in System Audit Trails.
4. `system-wiki/log.md` — append one entry per PR.
5. `system-wiki/gaps/frs-codebase-gap-register.md` — **required by AGENTS.md:34** — update gap status for each RP closed. (v1 omitted this file.)

Do not edit `system-wiki/raw/` (FRS source material).

---

## 7. Corrected Reference File Map

### Already verified present on HEAD `39a2396`

| Item | File | Evidence |
|---|---|---|
| IVH DELETE block | `src/postgres-init/17_immutable_records.sql:54-57` | `no_delete_ivh` rule |
| IVH UPDATE block | **ABSENT** — RP-05 is OPEN | grep: zero matches for `no_update_ivh` |
| data_hash column | `src/backend/api/routes/regional/validator.py:468` | inline `hashlib.sha256(...)` in correction endpoint |
| data_hash canonical (only provenance) | `validator.py:460-467` | 6-field dict: encoder_id, keycloak_id, incident_id, region_id, verification_status, created_at |
| Audit writer | `src/backend/utils/audit.py:227` | `log_system_audit(...)` signature confirmed |
| Audit fail-closed example | `src/backend/api/routes/public_dmz.py:243-252` | `sensitive=True`, commit inside the same try block |
| Email-verification router | `src/backend/api/routes/auth.py:37` | `router = APIRouter(prefix="/api/auth", …)` — handles only change-email / verify-email |
| Router registration | `src/backend/main.py:604-623` | all `app.include_router(…)` calls |
| no_update_verified rule (existing) | `src/backend/main.py:273-289` | `DROP RULE IF EXISTS no_update_verified … CREATE RULE no_update_verified` |
| Keycloak template | `src/keycloak/demo-otp-provider/pom.xml` | EXISTS |
| Both realm JSON paths | `src/keycloak/import/bfp-realm.json`, `src/keycloak/bfp-realm.json` | EXISTS |
| Keycloak Dockerfile | `src/keycloak/Dockerfile` | EXISTS |
| AuthContext logout() | `src/frontend/src/context/AuthContext.tsx:192-232` | confirmed: no security-event call |
| Non-RLS public insert | `src/backend/api/routes/public_dmz.py:163,216` | `Depends(get_db)` at line 163; INSERT at line 216 |
| Suricata raw session | `src/backend/services/suricata_ingestion.py:244` | `_SessionLocal()` directly |
| AFOR commit session | `src/backend/api/routes/regional/afor.py:157` | `Depends(get_db_with_rls)` — session passed to commit function |

### To be created by this plan

| PR | File | Purpose |
|---|---|---|
| WS-A | `src/backend/api/routes/security_events.py` | New router: `POST /api/auth/security-event` + `POST /api/auth/keycloak-event` (WS-B appends) |
| WS-A | `src/backend/tests/test_security_events.py` | Backend tests for both endpoints |
| WS-A | (extend) `src/frontend/src/context/AuthContext.tsx` | Add security-event fetch in `logout()` |
| WS-A | (extend) `src/frontend/src/context/AuthContext.test.tsx` | LOGOUT audit test cases |
| WS-B | `src/keycloak/wims-audit-event-listener/pom.xml` | Maven POM |
| WS-B | `src/keycloak/wims-audit-event-listener/src/main/java/…/WimsAuditEventListenerProvider.java` | SPI provider |
| WS-B | `src/keycloak/wims-audit-event-listener/src/main/java/…/WimsAuditEventListenerProviderFactory.java` | SPI factory |
| WS-B | `src/keycloak/wims-audit-event-listener/src/main/resources/META-INF/services/org.keycloak.events.EventListenerProviderFactory` | Service registration |
| WS-C | `src/postgres-init/63_fire_incidents_insert_audit_trigger.sql` | Trigger + function |
| WS-C | `src/backend/tests/test_direct_insert_audit_trigger.py` | Trigger + GUC carve-out tests |
| WS-D | `src/postgres-init/64_no_update_ivh.sql` | IVH UPDATE block (RP-05) |
| WS-D | `src/postgres-init/65_verified_requires_data_hash.sql` | VERIFIED+data_hash CHECK (RP-20 part 1) |

### To be changed by this plan

| PR | File | Change |
|---|---|---|
| WS-A | `src/backend/main.py` | Add `include_router(security_events_router)` |
| WS-B | `src/keycloak/Dockerfile` | Add second provider build+copy stage |
| WS-B | `src/keycloak/import/bfp-realm.json` | Add `wims-audit-event-listener` to `eventsListeners` |
| WS-B | `src/keycloak/bfp-realm.json` | Same as above |
| WS-B | `src/docker-compose.yml` | Add `WIMS_KEYCLOAK_EVENT_SECRET`, `WIMS_AUDIT_INGEST_URL` env vars |
| WS-B | `src/.env.production.example` | Document new env vars |
| WS-B | `src/backend/tests/integration/test_keycloak_password_reset.py` | Add `eventsListeners` assertion |
| WS-C | `src/backend/auth.py` | Add `SET LOCAL app.audit_source = 'app'` in `get_db_with_rls` (after line 467) |
| WS-C | `src/backend/database.py` | Add `SET LOCAL app.audit_source = 'app'` in `get_db` (after line 92) |
| WS-C | `src/backend/services/suricata_ingestion.py` | Add GUC after `_SessionLocal()` at line 244 |
| WS-C | `src/backend/main.py` | Add `63_*` to `apply_schema_patches()` after line 452 |
| WS-D | `src/backend/api/routes/regional/validator.py` | Extend canonical hash to include NSD fields (lines 460-468) |
| WS-D | `src/backend/api/routes/admin/audit.py` | Add `GET /api/admin/export-audit-logs` CSV endpoint |
| WS-D | `src/frontend/src/app/admin/audit/page.tsx` | Add `handleExportCsv` + export button; add new action types to `KNOWN_ACTION_TYPES` |
| WS-D | `src/backend/main.py` | Add `64_*` and `65_*` to `apply_schema_patches()` |

---

## 8. Explicit Out of Scope

- No immutability rule on `incident_nonsensitive_details` (would block the correction flow; RP-06 fix is the hash expansion, not an UPDATE block).
- No removal of `/api/auth/logout` (session teardown endpoint — unrelated to audit).
- No edits to `system-wiki/raw/` (FRS source material).
- No commits until each PR's pre-commit gate passes end-to-end.

---

## 9. Approval Record

- [x] All 8 gaps re-verified against HEAD `39a2396` — 2026-06-25
- [x] All v1 stale citations identified and corrected
- [ ] PR 1 (WS-A) merged
- [ ] PR 2 (WS-C) merged
- [ ] PR 3 (WS-B) merged
- [ ] PR 4 (WS-D) merged
- [ ] Wiki updates complete
