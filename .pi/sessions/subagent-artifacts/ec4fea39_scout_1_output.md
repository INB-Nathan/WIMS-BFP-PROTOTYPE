# Code Context

## Files Retrieved

1. **`src/suricata/suricata.yaml`** (lines 1-1285) — Suricata config: `default-log-dir: /var/log/suricata/`, `eve.json` output, Redis stream output enabled for alerts (`redis-key: "suricata:alerts"`)
2. **`src/docker-compose.yml`** (lines 219, 232, 263, 281, 355) — Volume mounts: `./suricata/logs:/var/log/suricata`; env `SURICATA_EVE_PATH=/var/log/suricata/eve.json`
3. **`src/backend/tasks/suricata.py`** (full, 174 lines) — File-tail Celery task, runs every 10s, calls `ingest_eve_file()`
4. **`src/backend/tasks/suricata_redis.py`** (full, 133 lines) — Redis stream XREADGROUP consumer, runs every 10s, inserts into `wims.security_threat_logs`
5. **`src/backend/services/suricata_ingestion.py`** (full, 310 lines) — Shared EVE parsing, classification, row insertion
6. **`src/backend/services/security_rollups.py`** (full, 127 lines) — `should_store_raw_security_alert()` suppresses low-value alerts from raw storage
7. **`src/backend/models/security_threat_log.py`** (full, 37 lines) — SQLAlchemy model for `wims.security_threat_logs`
8. **`src/backend/api/routes/admin/security.py`** (lines 1-260) — `GET /security-logs` queries `wims.security_threat_logs` with filters, pagination, full-text search
9. **`src/backend/celery_config.py`** (full, 117 lines) — Beat schedule: both `ingest-suricata-eve` and `subscribe-suricata-alerts` every 10s
10. **`src/frontend/src/app/admin/monitoring/page.tsx`** (full, Security Monitoring page at `/admin/monitoring`) — Calls `fetchAdminSecurityLogsOfflineAware()` → `GET /admin/security-logs`
11. **`src/frontend/src/app/admin/system/page.tsx`** (first 1121 lines) — System Admin Hub at `/admin/system` with Threat Telemetry section
12. **`src/frontend/src/app/admin/system/components/SuricataAlertModal.tsx`** (full, 1498 lines) — Detailed alert modal with AI analysis, HITL decisions
13. **`src/postgres-init/08_security_audit.sql`** — Table creation
14. **`src/postgres-init/10_rls_policies.sql`** — `security_logs_admin_only` policy (SYSTEM_ADMIN/NATIONAL_ANALYST)

## Key Code

### Ingestion Path A — Redis Stream (Primary)
**`tasks/suricata_redis.py`** (lines 74-87): Inserts directly into `wims.security_threat_logs` **without calling `should_store_raw_security_alert()`**. Publishes HIGH/CRITICAL to `ai:queue`.
```python
result = db.execute(
    text("""
        INSERT INTO wims.security_threat_logs
            (source_ip, destination_ip, suricata_sid, severity_level, raw_payload,
             classification, suricata_signature, suricata_category)
        VALUES
            (:source_ip, :destination_ip, :suricata_sid, :severity_level, :raw_payload,
             :classification, :suricata_signature, :suricata_category)
        RETURNING log_id
    """),
    row_data,
)
```

### Ingestion Path B — File-tail (Fallback)
**`services/suricata_ingestion.py`** (lines 257-310): Calls `should_store_raw_security_alert(db, row)` which **may return False** for `scanner`, `internet_background_noise`, `bot_probe` alerts → row not stored raw.
```python
if not should_store_raw_security_alert(db, row):
    continue
log_id = _insert_row(db, row)
```

### Raw Alert Filtering
**`services/security_rollups.py`** (lines 45-77): Low-value alerts skipped unless `siem.store_low_value_raw=true`.
```python
_LOW_VALUE_CLASSIFICATIONS = frozenset({"internet_background_noise", "scanner", "bot_probe"})
if not store_low_value and classification in _LOW_VALUE_CLASSIFICATIONS:
    return False
```

### Admin API
**`api/routes/admin/security.py`** (lines 143-175): `GET /security-logs` queries `FROM wims.security_threat_logs` with all Suricata-specific fields returned.

### Frontend Security Monitoring
**`src/frontend/src/app/admin/monitoring/page.tsx`** (full): Uses `fetchAdminSecurityLogsOfflineAware()` from `@/lib/api/offlineAdmin` → `GET /admin/security-logs`. Displays severity, SID, source IP, HITL actions, blocking, incident creation.

## Architecture

```
Suricata (eve.json + Redis stream "suricata:alerts")
    │
    ├── Redis stream ──→ tasks.suricata_redis.subscribe_alerts (10s)
    │                        ↓
    │                   wims.security_threat_logs  ←── ALL alerts (no raw filter)
    │                        ↓
    │                   HIGH/CRITICAL → ai:queue → ai_forwarding
    │
    └── File-tail ──→ tasks.suricata.ingest_suricata_eve (10s)
                           ↓
                     services.suricata_ingestion.ingest_eve_file()
                           ↓
                     should_store_raw_security_alert()  ←── FILTERS low-value
                           ↓ (if True)
                     wims.security_threat_logs
                           ↓
                     HIGH/CRITICAL → warning only (no auto-incident)
    
    Admin UI:  /admin/monitoring → GET /api/admin/security-logs → wims.security_threat_logs
               /admin/system (Threat Telemetry tab) → GET /api/admin/security-logs
```

## Start Here

Begin with **`src/backend/tasks/suricata_redis.py`** (the primary ingestion path) and **`src/backend/services/security_rollups.py`** (the raw-alert filter that the Redis path bypasses). These two files contain the most significant behavioral discrepancy.

---

## Findings

### 1. EVE Log Location
Suricata writes EVE JSON to `/var/log/suricata/eve.json` inside the container, which maps to the host path `./suricata/logs/eve.json`. Configured in `suricata.yaml` lines 90-94 (`default-log-dir`, `eve-log → filename: eve.json`).

### 2. Backend Ingestion — Dual Path
Both paths exist and run every 10 seconds:
- **Redis stream** (`tasks/suricata_redis.py`): Consumes from Suricata's Redis output (`suricata:alerts` stream). Has dedup via SHA256 fingerprint (300s TTL).
- **File-tail** (`tasks/suricata.py`): Tails `eve.json` from last known offset. No dedup.

Both registered in `celery_config.py` beat schedule (lines 64, 95).

### 3. Are alerts written to `wims.security_threat_logs`?
**Yes, but conditionally.** The file-tail path calls `should_store_raw_security_alert()` in `security_rollups.py`, which suppresses `internet_background_noise`, `scanner`, and `bot_probe` classifications unless config `siem.store_low_value_raw=true`. The Redis stream path **does not** call this filter — it writes all parsed alerts.

### 4. `GET /api/admin/security-logs` queries correctly
Yes — `api/routes/admin/security.py:143-175` directly queries `FROM wims.security_threat_logs` with proper filters, pagination, and full-text search.

### 5. Frontend display
The path `src/frontend/src/app/admin/security/page.tsx` does **not exist**. Security monitoring lives at:
- **`/admin/monitoring`** → `src/frontend/src/app/admin/monitoring/page.tsx` — The Security Monitoring page (calls `fetchAdminSecurityLogsOfflineAware`)
- **`/admin/system`** → `src/frontend/src/app/admin/system/page.tsx` — System Admin Hub with Threat Telemetry tab (calls `fetchAdminSecurityLogs`)
- Both display Suricata SID, severity, source IP, status, and actions.

### 6. Gaps Where Alerts May Be Ingested But Not Visible

| Gap | Severity | Detail |
|-----|----------|--------|
| **Redis stream bypasses raw-alert filter** | **High** | `tasks/suricata_redis.py` inserts all alerts directly without `should_store_raw_security_alert()`. Low-value scanner/background alerts arrive via Redis path are stored raw, while same alerts via file-tail path are suppressed. Inconsistent behavior. |
| **No dedup across paths** | **Medium** | Both paths run simultaneously every 10s. File-tail has no dedup. Redis path dedup only within its own messages. Same alert may be ingested twice → duplicate rows. |
| **File rotation handling** | **Low** | In-memory position tracking (`_eve_file_positions`) resets to 0 when file shrinks, causing full re-read of rotated file. |
| **Model outdated** | **Low** | `models/security_threat_log.py` missing `hitl_decision` and `xai_confidence_breakdown` columns that exist in DB (added by migrations 39, 76). |
| **Default retention 1 day** | **Info** | `retention.security_threat_logs_days = 1` in seed data — raw alerts pruned daily, but rollups preserve weekly/monthly aggregates. Bootstrap `68_data_retention.sql` overrides to 365 days. |