-- 37_audit_fulltext.sql
-- Dependencies: 08_security_audit.sql
-- Idempotent: YES (ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS)
-- Purpose: M9b — Full-text search on system_audit_trails (tsvector + GIN)

ALTER TABLE wims.system_audit_trails
  ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (
      to_tsvector('english',
        coalesce(action_type,   '') || ' ' ||
        coalesce(table_affected,'') || ' ' ||
        coalesce(ip_address,    '') || ' ' ||
        coalesce(user_agent,    '')
      )
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_audit_trails_search
  ON wims.system_audit_trails USING GIN (search_vector);