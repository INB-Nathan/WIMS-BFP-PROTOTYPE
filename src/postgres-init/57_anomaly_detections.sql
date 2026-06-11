-- Migration 57: Behavioral anomaly detection store
-- Dedup + status tracking for the anomaly detection Celery task.
-- Detected anomalies are also dual-written to wims.security_threat_logs (suricata_sid=NULL)
-- so they surface in the existing Threat Telemetry table without new UI work.

BEGIN;

CREATE TABLE IF NOT EXISTS wims.anomaly_detections (
    anomaly_id      BIGSERIAL PRIMARY KEY,
    anomaly_type    VARCHAR(64)  NOT NULL,
    subject_user_id UUID         REFERENCES wims.users(user_id) ON DELETE SET NULL,
    severity        VARCHAR(16)  NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    details         JSONB        NOT NULL DEFAULT '{}',
    detected_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    status          VARCHAR(16)  NOT NULL DEFAULT 'NEW'
                        CHECK (status IN ('NEW', 'ACKNOWLEDGED', 'RESOLVED')),
    dedup_key       VARCHAR(255) NOT NULL,
    UNIQUE (anomaly_type, dedup_key)
);

ALTER TABLE wims.anomaly_detections ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.anomaly_detections FORCE ROW LEVEL SECURITY;

-- SYSTEM_ADMIN: full read/update (acknowledge, resolve)
DROP POLICY IF EXISTS anomaly_admin_select ON wims.anomaly_detections;
CREATE POLICY anomaly_admin_select
ON wims.anomaly_detections FOR SELECT
USING (wims.current_user_role() IN ('SYSTEM_ADMIN'));

DROP POLICY IF EXISTS anomaly_admin_update ON wims.anomaly_detections;
CREATE POLICY anomaly_admin_update
ON wims.anomaly_detections FOR UPDATE
USING (wims.current_user_role() IN ('SYSTEM_ADMIN'))
WITH CHECK (wims.current_user_role() IN ('SYSTEM_ADMIN'));

-- INSERT: SYSTEM_ADMIN only (covers svc_task / SYSTEM_TASK_USER_ID which has SYSTEM_ADMIN role)
DROP POLICY IF EXISTS anomaly_task_insert ON wims.anomaly_detections;
CREATE POLICY anomaly_task_insert
ON wims.anomaly_detections FOR INSERT
WITH CHECK (wims.current_user_role() IN ('SYSTEM_ADMIN'));

COMMIT;
