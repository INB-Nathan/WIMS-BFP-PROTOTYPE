# Code Context

## Files Retrieved

1. **`src/backend/api/routes/admin/audit.py` (full)** — Admin audit oversight routes: list, export, AI analyze
2. **`src/backend/utils/audit.py` (full)** — Core `log_system_audit()` function, IP hashing, audit integrity
3. **`src/frontend/src/app/admin/audit/page.tsx` (full)** — Frontend admin audit page component
4. **`src/frontend/src/lib/api/legacy.ts` (lines 475-515)** — Legacy `fetchAuditLogs()` API call function
5. **`src/frontend/src/lib/api/offlineAdmin.ts` (full)** — Offline-aware wrapper for audit logs
6. **`src/backend/main.py` (lines 68-80, 750-770, 953-1032)** — Middleware registration and router mounting
7. **`src/postgres-init/72_partition_audit_trail.sql`** — `system_audit_trails` partitioning + RLS
8. **`src/postgres-init/17_immutable_records.sql`** — Immutable audit rules (no UPDATE/DELETE)
9. **`src/postgres-init/10_rls_policies.sql` (lines 567-577)** — RLS policies for audit table
10. **`src/frontend/src/app/admin/audit/admin-audit.test.tsx` (full)** — Frontend test for audit page
11. **`docs/red-team-demo-walkthrough.md` (full)** — Penetration test walkthrough

## Key Findings

### 1. Admin Audit Routes

The admin audit router is defined in **`src/backend/api/routes/admin/audit.py`** and exposes three endpoints:

| Method | Path | Function | Auth | Description |
|--------|------|----------|------|-------------|
| GET | `/api/admin/audit-logs` | `get_audit_logs` (line 66) | `get_system_admin` | Paginated list with filters and full-text search |
| GET | `/api/admin/audit-logs/export` | `export_audit_logs` (line 175) | `get_system_admin` | CSV export (RP-23: records the export itself) |
| POST | `/api/admin/audit-logs/analyze` | `analyze_audit_entries` (line 277) | `get_system_admin` | Ollama-based AI analysis |

The router is mounted at `/api/admin` in **`main.py:759`**:
```python
app.include_router(admin.router, prefix="/api/admin")
```

### 2. `log_system_audit()` — The Central Audit Function

Defined in **`src/backend/utils/audit.py:282`**. It writes an INSERT to `wims.system_audit_trails` with columns: `user_id, action_type, table_affected, record_id, ip_address, user_agent, timestamp, old_values, new_values, correlation_id, result, ip_hash`.

**Signature:**
```python
def log_system_audit(
    db, user_id, action_type, table_affected, record_id,
    request=None, old_values=None, new_values=None,
    correlation_id=None, result="success", ip_hash=None, sensitive=False
)
```

**Key behaviors:**
- IP address comes from `trusted_client_ip()` — reads `X-Real-IP` header (set by nginx to socket peer), **never** `X-Forwarded-For` (gap #14 fix)
- `ip_hash` is salted SHA-256 of the client IP (privacy-preserving abuse trace, D5/#394)
- `correlation_id` is resolved from `request.state.correlation_id` (set by `correlation_id_middleware`)
- `sensitive=True` → fail-closed (raises `AuditInsertFailed` on DB error)
- `sensitive=False` (default) → fail-open (logs error, continues)

**Call sites** (manual calls, ~15 locations):

| Caller file | Action types logged |
|---|---|
| `api/routes/admin/audit.py` | `AUDIT_EXPORT` |
| `api/routes/admin/security.py` | `HITL_REVIEW`, `BREACH_DETECTED`, `CREATE_INCIDENT_FROM_ALERT` |
| `api/routes/admin/monitoring.py` | `WORKER_PRUNE` |
| `api/routes/admin/privacy.py` | `PII_ANONYMIZE`, `DATA_EXPORT` |
| `api/routes/admin/rate_limits.py` | `RATE_LIMIT_CONFIG_UPDATE` |
| `api/routes/admin/breach.py` | `BREACH_STATUS_UPDATE` |
| `api/routes/admin/config.py` | `CONFIG_UPDATE` |
| `api/routes/admin/anomalies.py` | `ANOMALY_ACK`, `ANOMALY_RESOLVE` |
| `auth.py` | `JIT_PROVISION`, `JIT_PROVISION_BLOCKED` |
| `main.py` | `JIT_PROVISION_BLOCKED` |
| `api/routes/security_events.py` | Keycloak auth events (LOGIN, LOGOUT, etc.) |
| `api/routes/regional/encoder_crud.py` | `CREATE_INCIDENT` |
| `services/ip_blocklist.py` | `IP_BLOCK`, `IP_UNBLOCK` |
| `tasks/monitoring.py` | `WORKER_PRUNE` |

### 3. No Session-Level Audit Middleware

**There is no middleware that automatically logs every API call to `system_audit_trails`.** The existing middlewares in `main.py` are:

| Middleware | Line | Purpose | Logs to audit? |
|---|---|---|---|
| `csrf_middleware` | 80 | CSRF Origin/Referer check | No |
| `rate_limit_middleware` | 862 | Sliding-window rate limiter | No (returns 429) |
| `blocked_ip_middleware` | 953 | Redis IP blocklist check | No |
| `prometheus_metrics_middleware` | 974 | Prometheus request duration | No |
| `correlation_id_middleware` | 1023 | X-Request-ID propagation | No (sets `request.state.correlation_id` for downstream use) |

Audit logging is **deliberately selective** — only significant state-changing actions get logged. This is by design to avoid audit log flooding.

### 4. Frontend Admin Audit Page

**`src/frontend/src/app/admin/audit/page.tsx`** calls the correct endpoint.

**Call chain:**
1. `page.tsx:141` calls `fetchAuditLogsOfflineAware(params)`
2. `offlineAdmin.ts:67` — offline-aware wrapper calls `legacyFetchAuditLogs(params)`
3. `legacy.ts:480` calls `apiFetch('/admin/audit-logs?...')`
4. `apiFetch` prepends `API_BASE` → hits `GET /api/admin/audit-logs?params`

The frontend passes all supported filter parameters: `q`, `user_id`, `action_type`, `table_affected`, `ip_address`, `date_from`, `date_to`, `limit`, `offset`.

**The export** uses a direct `fetch()` to `${API_BASE}/admin/audit-logs/export?...` with credentials, skipping the offline wrapper.

### 5. Filters and Pagination Analysis

**Filters supported** (in `get_audit_logs`, `audit.py:66`):
- `q` (full-text search via `websearch_to_tsquery`)
- `user_id`, `action_type`, `table_affected`, `ip_address`
- `date_from`, `date_to` (cast to `timestamptz`)
- `limit` (default 50, max 500)
- `offset` (default 0)

**Pagination risk**: Medium

- ORDER BY is hardcoded (`sat.timestamp DESC` for list, `ts_rank DESC` for search) — **no user-controlled sort** (mitigates SQLi, verified by `test_sqli_allowlists.py:201`)
- Since new audit rows are inserted with `now()` timestamp, new entries always appear at the top of page 1. If an admin reads page 1 (rows 1-50), then a new row is inserted, then the admin reads page 2 (rows 51-100 using offset 50), the new row pushes all existing rows down by one — row 50 on page 1 becomes row 51 on page 2, and the admin would see it again (duplicate) while row 100 disappears (skip). This is a standard cursor-based pagination pitfall.
- The `offset` parameter allows skipping more rows than the `limit` cap of 500. For very large datasets, clients could hit performance issues scanning past many rows.

**RLS restriction**: The `audit_trails_read_admin_or_self` policy (from `10_rls_policies.sql:567` and re-applied in `72_partition_audit_trail.sql:132`) restricts SELECT to `SYSTEM_ADMIN`, `NATIONAL_ANALYST`, or `user_id = current_user_uuid()`. This means non-admin users only see their own audit rows — **they cannot see actions performed by other users**.

**Immutable audit**: Rules in `17_immutable_records.sql:74-82` prevent UPDATE and DELETE on `system_audit_trails` — audit rows are truly append-only.

### 6. Red Team Demo Walkthrough

**`docs/red-team-demo-walkthrough.md`** is a penetration test script focused on **information disclosure** for a live demo at `https://wimsbfp.tech`. It covers:

- **Phase 1-3** (network, auth, exploitation): TLS, ciphers, headers, API discovery, CORS, XSS
- **Phase 4** (VPS breach → database): Direct `docker exec psql` as superuser

**Key audit trail relevance**: The demo does **NOT specifically test `system_audit_trails` logging**. It tests:
- PII encryption at rest (passes — AES-256-GCM)
- Schema enumeration (⚠️ Low — table/column names visible)
- RLS bypass via superuser (expected — superuser bypasses all RLS)

**What should have been logged**: During a real penetration test like this, the following actions should appear in `system_audit_trails`:
- Any authentication events via Keycloak (LOGIN/LOGOUT) → `security_events.py`
- Any admin actions if the test used admin credentials (but the demo uses curl without auth for most probes)
- The test's direct `psql` access bypasses the application entirely, so nothing logs to `system_audit_trails` for the VPS breach phase — this is called out in the doc ("no rate limits, no CSRF, no auth middleware")

**Gap**: Unauthenticated probing (curl to `/api/operations` without auth) does NOT generate audit rows. The `401 Unauthorized` response comes from the `get_db_with_rls` dependency chain, but no `log_system_audit` call is made for failed auth attempts. This is by design — logging every unauthenticated probe would flood the audit table.

---

## Architecture

```
Frontend (Next.js)                    Backend (FastAPI)
┌─────────────────────┐              ┌─────────────────────────────┐
│ /admin/audit/page.tsx │ ──GET────▶ │ /api/admin/audit-logs       │
│ fetchAuditLogsOfflineAware()       │   get_audit_logs()          │
│   → legacyFetchAuditLogs()         │   → SELECT wims.system_    │
│     → apiFetch('/admin/audit-logs')│     audit_trails            │
└─────────────────────┘              │                             │
                                      │ Other routes call           │
                                      │ log_system_audit() to       │
                                      │ INSERT audit rows            │
                                      └──────────┬──────────────────┘
                                                 │
                                                 ▼
                                      ┌─────────────────────┐
                                      │ PostgreSQL           │
                                      │ wims.system_audit_   │
                                      │ trails (partitioned  │
                                      │ by year, immutable)  │
                                      │ RLS: admin/self read │
                                      │ INSERT: unrestricted  │
                                      └─────────────────────┘
```

**Data flow**:
1. Backend route handlers call `log_system_audit()` for significant state changes
2. `log_system_audit()` INSERTs into partitioned `wims.system_audit_trails`
3. Admin reads rows via `GET /api/admin/audit-logs` (direct SQL query, not ORM)
4. Frontend calls this endpoint through offline-aware cache wrapper

## Start Here

Open **`src/backend/api/routes/admin/audit.py`** — this is the primary admin audit-log endpoint. It contains the `get_audit_logs()` handler that serves the admin audit page, the `export_audit_logs()` CSV export, and the `analyze_audit_entries()` Ollama integration.