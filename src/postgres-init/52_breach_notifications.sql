-- M10d: breach_notifications table — NPC 72h tracking (RA 10173)
-- Migration 52

CREATE TABLE IF NOT EXISTS wims.breach_notifications (
    breach_id        SERIAL PRIMARY KEY,
    threat_log_id    INTEGER NOT NULL
                         REFERENCES wims.security_threat_logs(log_id),
    detected_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    npc_deadline_at  TIMESTAMPTZ NOT NULL,
    status           VARCHAR NOT NULL DEFAULT 'DETECTED'
                         CONSTRAINT breach_status_check
                         CHECK (status IN ('DETECTED', 'DPO_NOTIFIED', 'NPC_SUBMITTED', 'CLOSED')),
    affected_systems TEXT,
    data_scope       TEXT,
    notes            TEXT,
    reported_by      UUID REFERENCES wims.users(user_id),
    npc_submitted_at TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE wims.breach_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.breach_notifications FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS breach_admin_select ON wims.breach_notifications;
CREATE POLICY breach_admin_select ON wims.breach_notifications
    FOR SELECT
    USING (wims.current_user_role() = 'SYSTEM_ADMIN');

DROP POLICY IF EXISTS breach_admin_all ON wims.breach_notifications;
CREATE POLICY breach_admin_all ON wims.breach_notifications
    FOR ALL
    USING (wims.current_user_role() = 'SYSTEM_ADMIN')
    WITH CHECK (wims.current_user_role() = 'SYSTEM_ADMIN');
