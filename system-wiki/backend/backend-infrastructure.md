---
title: Backend Infrastructure — Auth, Database, Entry Point, Models, Schemas, Celery, Event Bus
created: 2026-05-16
updated: 2026-06-05
type: backend
tags: [wims-bfp, backend, auth, database, models, schemas, celery, infrastructure, event-bus, redis]
sources: [src/backend/auth.py, src/backend/database.py, src/backend/main.py, src/backend/models/, src/backend/schemas/, src/backend/celery_config.py, src/backend/services/event_bus.py]
status: draft
---

# Backend Infrastructure

## Auth Module — `src/backend/auth.py`

**Purpose:** Keycloak JWT validation, role-based authorization dependencies, session revocation check, RLS context attachment.

### `class KeycloakAuthenticator`

Cached JWKS + OIDC discovery. Methods:

| Method | Description |
|---|---|
| `_fetch_oidc_config()` | Fetches `{KEYCLOAK_REALM_URL}/.well-known/openid-configuration` via httpx. Caches once per process. Raises 503 if unreachable. |
| `_fetch_jwks(force_refresh=False)` | Fetches JWKS URI from OIDC config. Cached for 60s. Contains Docker networking fix: rewrites `localhost:8080` in JWKS URI. Raises 503 if unreachable. |
| `_get_key_for_kid(kid)` | Finds JWKS key matching kid with RSA, sig use, RS256 alg. |
| `async validate_token(token)` | Full JWT validation: extracts kid, tries matched key then all RSA keys, decodes with RS256, validates aud/iss/azp, checks session revocation. On cached-key failure: one-time force-refresh + retry. Returns decoded payload. Raises 401 (invalid/expired/revoked), 503 (unreachable). |

### FastAPI Dependencies

All return augmented user dicts. All raise `HTTPException` on failure.

| Dependency | Roles Allowed | DB Call? | Augments |
|---|---|---|---|
| `get_current_user(request)` | Any JWT | No | Returns decoded JWT payload |
| `get_current_wims_user(request, token, db)` | Any wims.users row | Yes (role, username) | Adds user_id, keycloak_id, role, username. Attaches to `request.state.wims_user` for RLS |
| `get_incident_viewer(user, db)` | SYSTEM_ADMIN, NATIONAL_ANALYST, NATIONAL_VALIDATOR, REGIONAL_ENCODER | Yes | Adds assigned_region_id |
| `get_analyst_or_admin(user)` | NATIONAL_ANALYST, SYSTEM_ADMIN | No | — |
| `get_system_admin(user)` | SYSTEM_ADMIN | No | — |
| `get_regional_encoder(user, db)` | REGIONAL_ENCODER, ENCODER | Yes | Adds assigned_region_id |
| `get_national_validator(user, db)` | NATIONAL_VALIDATOR | Yes | Adds assigned_region_id (may be None for cross-region) |
| `get_regional_user(user, db)` | Any with assigned_region_id | Yes | Adds assigned_region_id |

### Session Revocation

After JWT decode, calls `session_manager.is_token_revoked(sub, iat)`. If revoked → 401. This is how the Redis-based `SessionManager` enforces force-logout.

### Global Instance

`authenticator = KeycloakAuthenticator()` — singleton.

---

## Database Session Module — `src/backend/database.py`

**Purpose:** SQLAlchemy engine, session factory, FastAPI dependencies, RLS context setting.

### Engine

```python
_engine = create_engine(SQLALCHEMY_DATABASE_URL)
_SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)
```

Connection string from `SQLALCHEMY_DATABASE_URL` or `DATABASE_URL` env var.

### RLS Context

```python
def set_rls_context(session, user_id):
    session.execute(text("SET LOCAL wims.current_user_id = :uid"), {"uid": user_id})
```

Uses `SET LOCAL` (transaction-scoped) — auto-undone on commit/rollback. This is the linchpin for all RLS on `wims.*` tables.

### FastAPI Dependencies

| Dependency | RLS Set? | Usage |
|---|---|---|
| `get_db()` | No | Bare session. For health checks, public DMZ, no-auth endpoints |
| `get_db_with_rls(request)` | Yes, from `request.state.wims_user` | Must be used AFTER `get_current_wims_user` in dependency list |

### Celery Helper

```python
def get_session(user_id=None) -> Session
```

Creates a new session. Sets RLS context if user_id provided. Returns directly (not a generator). Caller must close.

---

## Main App — `src/backend/main.py`

**Purpose:** FastAPI app entry point, middleware, route registration.

### App

```python
app = FastAPI(title="WIMS-BFP Backend")
```

No explicit middleware/lifespan/exception handlers configured in this file.

### Rate Limiter

Lua-based sliding window on `POST /api/auth/callback`. Key: `rate_limit:{client_ip}`. Config: `RATE_LIMIT_THRESHOLD=5`, `WINDOW_SECONDS=900` (15 min). Returns 429 with Retry-After header. Fail-open on Redis down. In the normal browser path, Next.js `/api/auth/sync` forwards nginx-provided client IP headers to preserve per-client limiter granularity before calling the backend callback.

### Route Registration

| Statement | Router | Prefix |
|---|---|---|
| `include_router(incidents.router)` | incidents | (none) |
| `include_router(admin.router)` | admin (package) | `/api/admin` |
| `include_router(sessions.router)` | sessions | `/api/admin` |
| `include_router(user_profile_router)` | user | (none) — PATCH /me, /me/password |
| `include_router(civilian.router)` | civilian | (none) |
| `include_router(triage.router)` | triage | (none) |
| `include_router(regional.router)` | regional (package) | `/api/regional` |
| `include_router(analytics.router)` | analytics | (none) |
| `include_router(ref.router)` | ref | (none) — /regions, /provinces, /cities |
| `include_router(public_dmz_router)` | public_dmz | (none) — /v1/public/report |

**Note:** As of 2025-06-06, `regional` and `admin` are decomposed into packages (sub-module routers). See the route map for sub-module details.

### Endpoints Defined Directly in main.py

**`POST /api/auth/callback`** — PKCE handshake. Exchanges code for tokens via Keycloak token endpoint, validates via `auth.authenticator.validate_token()`, resolves role from JWT, upserts `wims.users`, returns `{access_token, refresh_token, user_id}`.

**`GET /api/user/me`** — Returns merged JWT + wims.users payload. JIT-provisions user if not in database.

**`POST /api/analytics-summary`** — Dashboard summary with total_incidents, by_region, by_alarm_level, by_general_category. Any authenticated WIMS user. Filters: from_date, to_date, region_id, province_id, city_id.

### Celery Re-export

```python
from celery_config import celery_app
import tasks.suricata
import tasks.exports
import tasks.drafts
```

---

## ORM Models — `src/backend/models/`

All models use `wims` schema. No SQLAlchemy relationships defined (raw column-only models).

| File | Model/Class | Table | Key Columns |
|---|---|---|---|
| `base.py` | `Base` | — | `DeclarativeBase` |
| `user.py` | `UserRole` enum | — | CIVILIAN_REPORTER, REGIONAL_ENCODER, NATIONAL_VALIDATOR, NATIONAL_ANALYST, SYSTEM_ADMIN |
| `user.py` | `User` | `wims.users` | user_id (UUID PK gen_random_uuid), keycloak_id (UUID UNIQUE), username, role (Enum UserRole) |
| `fire_incident.py` | `VerificationStatus` enum | — | DRAFT, PENDING, PENDING_VALIDATION, VERIFIED, REJECTED |
| `fire_incident.py` | `FireIncident` | `wims.fire_incidents` | incident_id (PK), location (Geography POINT 4326), encoder_id (FK), verification_status, region_id (FK), import_batch_id, is_archived |
| `citizen_report.py` | `CitizenReportStatus` enum | — | PENDING, VERIFIED, FALSE_ALARM, DUPLICATE |
| `citizen_report.py` | `CitizenReport` | `wims.citizen_reports` | report_id (PK), location, status, trust_score (CHECK -100..100), validated_by, verified_incident_id |
| `incident_verification_history.py` | `TargetType` enum | — | OFFICIAL, CIVILIAN |
| `incident_verification_history.py` | `IncidentVerificationHistory` | `wims.incident_verification_history` | history_id (PK), target_type, target_id, action_by_user_id (FK), previous_status, new_status, notes, action_timestamp |
| `security_threat_log.py` | `SeverityLevel` enum | — | LOW, MEDIUM, HIGH, CRITICAL |
| `security_threat_log.py` | `SecurityThreatLog` | `wims.security_threat_logs` | log_id (PK), timestamp, source_ip, dest_ip, suricata_sid, severity_level, raw_payload, xai_narrative, xai_confidence, reviewed_by |
| `geometry_validation.py` | `InvalidLocationError` | — | Custom ValueError |
| `geometry_validation.py` | `validate_location(value)` | — | Accepts WKT/WKB/tuple. Rejects plain strings. Returns WKTElement/WKBElement |

---

## Pydantic Schemas — `src/backend/schemas/`

| File | Schema | Fields |
|---|---|---|
| `public_incident.py` | `PublicIncidentCreate` | latitude (ge=-90,le=90), longitude (ge=-180,le=180), description (min_length=1,max_length=2000) |
| `public_incident.py` | `PublicIncidentResponse` | incident_id, latitude, longitude, verification_status, created_at |
| `incident.py` | `IncidentCreate` | latitude, longitude, description, verification_status (default "PENDING") |
| `incident.py` | `IncidentResponse` | incident_id, latitude, longitude, encoder_id (UUID\|None), status, created_at |
| `civilian.py` | `CivilianReportCreate` | latitude, longitude, description (min_length=1) |
| `civilian.py` | `CivilianReportResponse` | report_id, latitude, longitude, description, trust_score, status, created_at |

---

## Celery Configuration — `src/backend/celery_config.py`

**Purpose:** Shared Celery app — imported by both main.py and task modules.

```python
celery_app = Celery("wims_worker", broker=REDIS_URL, backend=CELERY_RESULT_BACKEND or REDIS_URL)
```

### Settings

| Setting | Value |
|---|---|
| Name | `wims_worker` |
| Broker | `REDIS_URL` (default `redis://redis:6379/0`) |
| Result Backend | `CELERY_RESULT_BACKEND` or `REDIS_URL` |
| task_serializer | json |
| accept_content | ["json"] |
| result_serializer | json |
| timezone | UTC |

### Periodic Tasks (Celery Beat)

| Name | Task | Schedule | Purpose |
|---|---|---|---|
| `refresh-analytics-mvs` | `analytics.refresh_materialized_views` | Every 6 hours (21600s) | Refresh analytics materialized views CONCURRENTLY |
| `ingest-suricata-eve` | `tasks.suricata.ingest_suricata_eve` | Every 10 seconds | Ingest Suricata EVE log lines |
| `expire-stale-drafts-daily` | `tasks.drafts.expire_old_drafts` | Daily at 02:00 UTC | Auto-archive DRAFT incidents older than 30 days |

### Concurrency

Not configured — relies on Celery CLI defaults (prefork pool, CPU count).

---

## Event Bus — `src/backend/services/event_bus.py`

**Purpose:** Redis pub/sub event bus for real-time SSE notifications. Provides async (EventBus class) and sync (standalone functions) publishers for incident, verification, security, and system events.

### Channels

| Channel Key | Redis Channel |
|---|---|
| incident | `wims:events:incident` |
| verification | `wims:events:verification` |
| security | `wims:events:security` |
| system | `wims:events:system` |

### Connection Pools

Both sync and async connections use module-level `ConnectionPool` objects to prevent per-call `redis.from_url()` connection leaks:

- **Sync pool** (`_SYNC_POOL`): Used by `publish_incident_event_sync()`, `publish_verification_event_sync()`, `publish_security_event_sync()`. Created lazily via `_get_sync_redis()` with `threading.Lock` double-checked locking for thread safety. Configured with `max_connections=5`, `socket_connect_timeout=0.5`, `socket_timeout=0.5`, `health_check_interval=30`.
- **Async pool** (`_async_pool`): Used by `EventBus._ensure_pub()` and `EventBus._ensure_sub()`. Created lazily via `_get_async_pool()`. Configured with `max_connections=20`, `socket_connect_timeout=0.5`, `socket_timeout=0.5`, `health_check_interval=30`.

### Thread Safety

- **Sync pool:** Protected by `_sync_pool_lock` (`threading.Lock`) with double-checked locking. Safe for concurrent Celery task workers and sync API endpoints.
- **Async pool:** Single-threaded async context — no lock needed.

### Async Publishers (FastAPI SSE endpoints)

| Function | Channel |
|---|---|
| `publish_incident_event()` | incident |
| `publish_verification_event()` | verification |
| `publish_security_event()` | security |
| `publish_system_event()` | system |

### Sync Publishers (Celery tasks, sync API endpoints)

| Function | Channel |
|---|---|
| `publish_incident_event_sync()` | incident |
| `publish_verification_event_sync()` | verification |
| `publish_security_event_sync()` | security |

### Singleton

`get_event_bus()` returns the global `EventBus` singleton. Async subscription via `EventBus.subscribe(channels)` yields parsed event dicts for SSE streaming.
