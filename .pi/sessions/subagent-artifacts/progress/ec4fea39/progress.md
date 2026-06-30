# Scout Progress: Keycloak SPI Event Listener Investigation

## Status: Complete

### Files examined (30+):
- `src/backend/api/routes/security_events.py` — full route
- `src/backend/utils/audit.py` — log_system_audit writes to system_audit_trails
- `src/backend/utils/csrf.py` — CSRF exemption for keycloak-event
- `src/backend/main.py` — router registration, rate limiter
- `src/backend/tests/test_security_events.py` — 8 tests covering flow
- `src/backend/tasks/anomaly_detection.py` — anomaly detectors
- `src/keycloak/wims-audit-event-listener/` — 4 files (Java SPI)
- `src/keycloak/Dockerfile` — builds JAR
- `src/keycloak/import/bfp-realm.json` — eventsListeners config
- `src/docker-compose.yml` — env vars
- `src/postgres-init/08_security_audit.sql` — table DDL
- `src/postgres-init/72_partition_audit_trail.sql` — partitioned table

### Key findings:
1. Branch NOT merged but code IS on master via PR #459
2. Full SPI exists and builds
3. Route exists with auth, mapping, audit write
4. Realm config registers the listener
5. Bad-password LOGIN_ERROR → FAILED_LOGIN → system_audit_trails (full chain working)

### Gaps identified:
- WIMS_KEYCLOAK_EVENT_SECRET defaults empty → dead by default
- No FAILED_LOGIN anomaly detector (separate concern)
- Branch housekeeping needed
