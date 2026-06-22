-- 66_security_threat_logs_indexes.sql
-- Performance indexes for wims.security_threat_logs
-- The admin dashboard frequently queries unreviewed threats with severity/date filters.

-- Composite index covering the most common admin dashboard query:
--   SELECT COUNT(*) FROM wims.security_threat_logs WHERE reviewed_by IS NULL ...;
-- Also covers severity-level filtering and date-range filtering.
DROP INDEX IF EXISTS idx_security_threat_logs_reviewed_severity_ts;
CREATE INDEX CONCURRENTLY idx_security_threat_logs_reviewed_severity_ts
    ON wims.security_threat_logs (reviewed_by, severity_level, timestamp);

-- Index for source_ip lookups (used by block_ip and filter-by-IP queries)
DROP INDEX IF EXISTS idx_security_threat_logs_source_ip;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_security_threat_logs_source_ip
    ON wims.security_threat_logs (source_ip);

-- Index for timestamp-only range queries (dashboard date filters)
DROP INDEX IF EXISTS idx_security_threat_logs_timestamp;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_security_threat_logs_timestamp
    ON wims.security_threat_logs (timestamp);
