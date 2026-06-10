-- 49_system_config.sql
-- M9c: System configuration table — admin-tunable thresholds and timeouts.
-- SELECT: open to all authenticated sessions (non-sensitive; Celery consumers read without GUC).
-- INSERT/UPDATE/DELETE: SYSTEM_ADMIN only.
-- Idempotent: YES

BEGIN;

CREATE TABLE IF NOT EXISTS wims.system_config (
  config_key   VARCHAR PRIMARY KEY,
  config_value TEXT        NOT NULL,
  description  TEXT,
  updated_by   UUID        REFERENCES wims.users(user_id),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

INSERT INTO wims.system_config (config_key, config_value, description) VALUES
  (
    'alert_severity_threshold',
    '3',
    'Suricata severity integer >= this value is mapped to HIGH. 1=LOW, 2=MEDIUM, default 3=HIGH. Lower to 2 to treat MEDIUM Suricata alerts as HIGH in WIMS.'
  ),
  (
    'session_timeout_minutes',
    '30',
    'Session idle timeout in minutes. Read by the frontend for an idle-warning UI. Actual JWT expiry is enforced at the Keycloak realm level (ssoSessionIdleTimeout) — changing this value does NOT affect token lifetimes without a Keycloak Admin API update.'
  ),
  (
    'offline_storage_mb',
    '50',
    'Advisory cap on the IndexedDB offline incident queue size in MB. Enforced client-side in offlineStore.ts — queueIncident warns and throws once the estimated queue bytes exceed this limit.'
  ),
  (
    'ai_timeout_seconds',
    '60',
    'Ollama inference HTTP timeout in seconds. Consumed by ai_service.py analyze_threat_log and generate_incident_narrative. Increase for slow GPU nodes; decrease to fail fast.'
  )
ON CONFLICT (config_key) DO NOTHING;

-- ── Row Level Security ────────────────────────────────────────────────────────
ALTER TABLE wims.system_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.system_config FORCE ROW LEVEL SECURITY;

-- SELECT: open to all DB sessions (config is non-sensitive; Celery consumers
-- read via _SessionLocal() without a GUC, so we cannot restrict by role here).
DROP POLICY IF EXISTS system_config_select ON wims.system_config;
CREATE POLICY system_config_select
  ON wims.system_config FOR SELECT
  USING (TRUE);

-- INSERT: SYSTEM_ADMIN only (seed rows use superuser during bootstrap).
DROP POLICY IF EXISTS system_config_insert ON wims.system_config;
CREATE POLICY system_config_insert
  ON wims.system_config FOR INSERT
  WITH CHECK (wims.current_user_role() = 'SYSTEM_ADMIN');

-- UPDATE: SYSTEM_ADMIN only.
DROP POLICY IF EXISTS system_config_update ON wims.system_config;
CREATE POLICY system_config_update
  ON wims.system_config FOR UPDATE
  USING (wims.current_user_role() = 'SYSTEM_ADMIN')
  WITH CHECK (wims.current_user_role() = 'SYSTEM_ADMIN');

-- DELETE: SYSTEM_ADMIN only.
DROP POLICY IF EXISTS system_config_delete ON wims.system_config;
CREATE POLICY system_config_delete
  ON wims.system_config FOR DELETE
  USING (wims.current_user_role() = 'SYSTEM_ADMIN');

COMMIT;
