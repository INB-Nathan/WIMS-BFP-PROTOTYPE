---

# Code Context

## Files Retrieved

1. **`src/backend/api/routes/security_events.py`** (lines 1-127) — The FastAPI route `POST /api/auth/keycloak-event` that ingests Keycloak SPI events
2. **`src/backend/main.py`** (lines 778, 869-885) — Router registration and rate-limit middleware with fail-open for KC events
3. **`src/backend/utils/csrf.py`** (lines 31) — CSRF exemption for the KC event route
4. **`src/backend/tests/test_security_events.py`** (lines 120-283) — 8 tests covering auth, mapping, and round-trip
5. **`src/backend/utils/audit.py`** (lines 356-385) — `log_system_audit` INSERT into `wims.system_audit_trails`
6. **`src/keycloak/wims-audit-event-listener/src/main/java/.../WimsAuditEventListenerProvider.java`** (full) — Java SPI that sends events to backend
7. **`src/keycloak/wims-audit-event-listener/src/main/java/.../WimsAuditEventListenerProviderFactory.java`** (full) — SPI factory, reads env vars
8. **`src/keycloak/wims-audit-event-listener/pom.xml`** (full) — Maven build for Keycloak 24.0.0
9. **`src/keycloak/Dockerfile`** (full) — Multi-stage build that compiles and deploys the SPI JAR
10. **`src/keycloak/import/bfp-realm.json`** (lines 1537-1543) — `eventsListeners` config
11. **`src/docker-compose.yml`** (lines 92-93, 229) — Env var wiring
12. **`src/postgres-init/08_security_audit.sql`** (lines 38-48) — Original `system_audit_trails` DDL
13. **`src/postgres-init/72_partition_audit_trail.sql`** (lines 36-100) — Partitioned version with all required columns
14. **`src/backend/tasks/anomaly_detection.py`** (lines 63, 396-434) — PASSWORD_RESET anomaly detector

## Key Code

### Route (`security_events.py`)
```python
_KEYCLOAK_EVENT_MAP: dict[str, tuple[str, str]] = {
    "LOGIN": ("USER_LOGIN", "success"),
    "LOGIN_ERROR": ("FAILED_LOGIN", "failure"),
    "USER_DISABLED_BY_PERMANENT_LOCKOUT": ("FAILED_LOGIN", "failure"),
    "UPDATE_PASSWORD": ("PASSWORD_RESET", "success"),
    "SEND_RESET_PASSWORD": ("PASSWORD_RESET", "success"),
}
# Writes to system_audit_trails via log_system_audit() with user_id=None
```

### SPI Java (`WimsAuditEventListenerProvider.java`)
```java
private static final Set<EventType> CAPTURED_EVENTS = Set.of(
    EventType.LOGIN,
    EventType.LOGIN_ERROR,
    EventType.USER_DISABLED_BY_PERMANENT_LOCKOUT,
    EventType.UPDATE_PASSWORD,
    EventType.SEND_RESET_PASSWORD
);
// Pushes JSON POST to WIMS_AUDIT_INGEST_URL with Bearer auth
```

### Realm config (`bfp-realm.json:1537-1543`)
```json
"eventsEnabled": true,
"eventsListeners": ["jboss-logging", "wims-audit-event-listener"],
"enabledEventTypes": []
```

## Architecture

```
Keycloak auth event (bad-password → LOGIN_ERROR)
  → WimsAuditEventListenerProvider.onEvent()  (Java SPI)
    → HTTP POST http://backend:8000/api/auth/keycloak-event
        Bearer token = WIMS_KEYCLOAK_EVENT_SECRET
    → ingest_keycloak_event() in security_events.py
        → validates Bearer token (hmac.compare_digest)
        → maps LOGIN_ERROR → FAILED_LOGIN/failure
        → log_system_audit(db, None, "FAILED_LOGIN", "wims.auth", ...)
            → INSERT INTO wims.system_audit_trails (...)
```

## Start Here

Open `src/backend/api/routes/security_events.py` — it's the bridge between Keycloak and the WIMS audit system. Trace from there to the SPI Java code or the anomaly detectors depending on the task.

---

# Results by Question

## Q1: Is branch `feat/rp08-rp18-keycloak-event-spi` merged?

**NOT MERGED.** The branch exists as `origin/feat/rp08-rp18-keycloak-event-spi` but `git merge-base --is-ancestor` confirms it is **not an ancestor** of `master` HEAD. **However**, all code from the branch was delivered to master via PR #459 (commit `3fba675`). The branch is stale/stale and can be deleted.

## Q2: Does `src/keycloak/wims-audit-event-listener/` exist?

**YES.** It contains a complete Keycloak 24.0.0 SPI implementation:
- `pom.xml` — Maven build; compiles for Java 17
- `WimsAuditEventListenerProvider.java` — Listens for `LOGIN`, `LOGIN_ERROR`, `USER_DISABLED_BY_PERMANENT_LOCKOUT`, `UPDATE_PASSWORD`, `SEND_RESET_PASSWORD` events
- `WimsAuditEventListenerProviderFactory.java` — Reads `WIMS_AUDIT_INGEST_URL` and `WIMS_KEYCLOAK_EVENT_SECRET` env vars
- `META-INF/services/org.keycloak.events.EventListenerProviderFactory` — SPI registration

The Dockerfile builds the JAR and copies to `/opt/keycloak/providers/`.

## Q3: Is there a `POST /api/auth/keycloak-event` route?

**YES.** In `src/backend/api/routes/security_events.py`:
- Registered in `main.py:778` as `security_events_router`
- CSRF-exempt (`utils/csrf.py:31`)
- Rate-limited with **fail-open** when Redis is down (`main.py:874-885`)
- Authenticated with Bearer token via `hmac.compare_digest` (fail-closed if env var is blank)
- Accepts `event_type`, `username`, `error`, `keycloak_event_id` in JSON body
- Maps 5 Keycloak event types to WIMS actions
- Writes to `wims.system_audit_trails` via `log_system_audit()` with `user_id=None`
- Returns 202 on success, 401 on bad auth, 422 on unknown event type

## Q4: Does bfp-realm.json have `eventsListeners` including `wims-audit`?

**YES.** In `src/keycloak/import/bfp-realm.json:1537-1543`:
```json
"eventsEnabled": true,
"eventsListeners": ["jboss-logging", "wims-audit-event-listener"],
"enabledEventTypes": []
```
The listener is registered and all event types are enabled (empty array = all).

## Q5: Does a bad-password login attempt reach `wims.system_audit_trails`?

**YES, the full chain works end-to-end.** For a bad-password login:

1. **Keycloak** emits `LOGIN_ERROR` event with error `"invalid_user_credentials"`
2. **SPI Java code** catches it (LOGIN_ERROR ∈ CAPTURED_EVENTS) and pushes:
   ```json
   POST http://backend:8000/api/auth/keycloak-event
   {"event_type":"LOGIN_ERROR","username":"someone","error":"invalid_user_credentials","keycloak_event_id":"..."}
   ```
3. **Backend route** validates, maps `LOGIN_ERROR → FAILED_LOGIN/failure`, calls:
   `log_system_audit(db, None, "FAILED_LOGIN", "wims.auth", None, request, new_values={"username":"...","error":"invalid_user_credentials","source":"keycloak_spi","keycloak_event_id":"..."}, result="failure")`
4. **Audit util** does `INSERT INTO wims.system_audit_trails (user_id, action_type, table_affected, ...)` with `user_id=NULL`

Tests confirm this: `test_valid_secret_login_error_returns_202_failed_login` and parametrized `test_four_events_round_trip` cover the full flow.

## What IS Working

| Component | Status | Evidence |
|---|---|---|
| Java SPI source code | ✅ Complete | 4 files in `wims-audit-event-listener/` |
| Maven build | ✅ Configured | `pom.xml` targets Keycloak 24.0.0, Java 17 |
| Dockerfile builds JAR | ✅ | Multi-stage build, JAR copied to `/opt/keycloak/providers/` |
| Realm config enables listener | ✅ | `eventsListeners` includes `wims-audit-event-listener` |
| Backend route exists | ✅ | `POST /api/auth/keycloak-event` in `security_events.py` |
| Bearer auth with hmac | ✅ | `_verify_secret()` with `hmac.compare_digest` |
| Event type mapping | ✅ | 5 KC types → 3 WIMS action types |
| DB write to system_audit_trails | ✅ | Via `log_system_audit()` in `utils/audit.py:356` |
| CSRF exemption | ✅ | `utils/csrf.py:31` |
| Rate limit with fail-open | ✅ | `main.py:874-885` — fails open for KC events when Redis is down |
| Tests | ✅ | 8 test cases covering auth, mapping, 5 event types, round-trip |
| Docker compose env vars | ✅ | `WIMS_AUDIT_INGEST_URL` and `WIMS_KEYCLOAK_EVENT_SECRET` wired |
| Anomaly detection on PASSWORD_RESET | ✅ | `tasks/anomaly_detection.py:396` |

## What IS NOT Working / Gaps

1. **Branch not merged** (housekeeping): The feature branch `feat/rp08-rp18-keycloak-event-spi` is stale — all code is already on master via PR #459.
2. **Dead by default**: `WIMS_KEYCLOAK_EVENT_SECRET` defaults to empty (`${...:-}`) in `docker-compose.yml:93,229`. Until an operator explicitly sets this secret in both Keycloak and backend containers, the backend returns 401 to all events (fail-closed by design). This is **intentional security** — the feature requires explicit operator action to activate.
3. **No FAILED_LOGIN anomaly detector**: The anomaly detection system (`tasks/anomaly_detection.py`) has detectors for PASSWORD_RESET abuse but **no detector for FAILED_LOGIN events**. Repeated bad-password attempts are logged to `system_audit_trails` but not proactively flagged as anomalies. This may be the next gap for RP-08.

## Residual Risks

- `WIMS_KEYCLOAK_EVENT_SECRET` shared between Keycloak and backend; rotation requires updating both env vars
- `user_id` is always NULL in the audit row (by design, to prevent account-existence leakage) — this means the PASSWORD_RESET anomaly detector won't match Keycloak-originated events because it filters on `t2.user_id IS NOT NULL` (line 434). Need to check if the PASSWORD_RESET detector actually works for KC-originated events.