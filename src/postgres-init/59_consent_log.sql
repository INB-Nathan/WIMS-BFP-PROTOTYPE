-- 59_consent_log.sql
-- RA 10173 (DPA) consent logging — M6 privacy rights
-- Idempotent: YES
-- Dependencies: 01_extensions_roles.sql, 03_users.sql

BEGIN;

CREATE TABLE IF NOT EXISTS wims.consent_log (
    consent_id    BIGSERIAL PRIMARY KEY,
    subject_type  VARCHAR(16)  NOT NULL CHECK (subject_type IN ('USER', 'REPORT')),
    subject_id    TEXT         NOT NULL,   -- user_id (UUID) or report_id (int) as text
    consent_type  VARCHAR(64)  NOT NULL,   -- e.g. 'DATA_PROCESSING', 'INCIDENT_REPORT_SUBMISSION'
    action        VARCHAR(16)  NOT NULL CHECK (action IN ('GRANTED', 'WITHDRAWN')),
    actor_user_id UUID         REFERENCES wims.users(user_id),
    request_ip    INET,
    user_agent    TEXT,
    recorded_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consent_log_subject
    ON wims.consent_log (subject_type, subject_id);

CREATE INDEX IF NOT EXISTS idx_consent_log_recorded_at
    ON wims.consent_log (recorded_at DESC);

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE wims.consent_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.consent_log FORCE ROW LEVEL SECURITY;

-- Public submissions (unauthenticated civilian) may record their own consent.
-- Mirrors citizen_reports_insert: WITH CHECK (TRUE).
DROP POLICY IF EXISTS consent_log_insert ON wims.consent_log;
CREATE POLICY consent_log_insert
ON wims.consent_log FOR INSERT WITH CHECK (TRUE);

-- Only SYSTEM_ADMIN may read consent records.
DROP POLICY IF EXISTS consent_log_select ON wims.consent_log;
CREATE POLICY consent_log_select
ON wims.consent_log FOR SELECT USING (
    wims.current_user_role() IN ('SYSTEM_ADMIN')
);

DROP POLICY IF EXISTS consent_log_update ON wims.consent_log;
CREATE POLICY consent_log_update
ON wims.consent_log FOR UPDATE USING (
    wims.current_user_role() IN ('SYSTEM_ADMIN')
);

DROP POLICY IF EXISTS consent_log_delete ON wims.consent_log;
CREATE POLICY consent_log_delete
ON wims.consent_log FOR DELETE USING (
    wims.current_user_role() IN ('SYSTEM_ADMIN')
);

COMMIT;
