-- 48_log_search_vectors.sql
-- M9b: full-text search on security threat logs and system audit trails.
-- Adds tsvector GENERATED ALWAYS AS STORED columns and GIN indexes.
-- Dependencies: 08_security_audit.sql
-- Idempotent: YES

BEGIN;

ALTER TABLE wims.security_threat_logs
    ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (
        to_tsvector('english',
            coalesce(raw_payload, '') || ' ' ||
            coalesce(xai_narrative, '') || ' ' ||
            coalesce(severity_level, '') || ' ' ||
            coalesce(source_ip, '') || ' ' ||
            coalesce(destination_ip, '')
        )
    ) STORED;

ALTER TABLE wims.system_audit_trails
    ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (
        to_tsvector('english',
            coalesce(action_type, '') || ' ' ||
            coalesce(table_affected, '') || ' ' ||
            coalesce(user_agent, '')
        )
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_security_logs_search
    ON wims.security_threat_logs USING GIN (search_vector);

CREATE INDEX IF NOT EXISTS idx_audit_trails_search
    ON wims.system_audit_trails USING GIN (search_vector);

COMMIT;
