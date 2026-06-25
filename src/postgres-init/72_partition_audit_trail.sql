-- 72_partition_audit_trail.sql
-- M4b #144: Convert wims.system_audit_trails to a range-partitioned table.
--
-- Strategy (safe for existing data):
--   1. Rename the plain table to a backup name.
--   2. Create a new partitioned parent with the same full column set
--      (including all columns added by migrations 48, 60, 62).
--   3. Create yearly child partitions for 2024-2027 plus a DEFAULT catch-all.
--   4. Copy all existing rows into the partitioned table.
--   5. Drop the backup table.
--   6. Re-apply RLS (ENABLE + FORCE + policies) on the new parent.
--   7. Re-create non-PK indexes (correlation, result, GIN search_vector).
--
-- Primary key note:
--   PostgreSQL requires the partition key (timestamp) to be part of the
--   primary key on a partitioned table. The PK is therefore (audit_id, timestamp).
--   No other table holds a FK to system_audit_trails, so this is safe.
--
-- Sequence note:
--   BIGSERIAL is shorthand for BIGINT + sequence. Because we define the
--   partitioned parent explicitly, we declare the sequence manually and attach
--   it via DEFAULT nextval(...) so all partitions share the same sequence.
--
-- Idempotent: NO — run exactly once on a fresh bootstrap.
--   (The bootstrap already runs migrations in order; this runs after 71.)

BEGIN;

-- ── 1. Rename existing plain table ───────────────────────────────────────────

ALTER TABLE wims.system_audit_trails
    RENAME TO system_audit_trails_pre_partition;

-- ── 2. Dedicated sequence (shared across all partitions) ──────────────────────

CREATE SEQUENCE IF NOT EXISTS wims.system_audit_trails_audit_id_seq
    AS BIGINT
    START 1
    INCREMENT 1
    NO CYCLE;

-- Advance the sequence past the current max to avoid collisions with copied rows.
SELECT setval(
    'wims.system_audit_trails_audit_id_seq',
    COALESCE((SELECT MAX(audit_id) FROM wims.system_audit_trails_pre_partition), 0) + 1,
    false
);

-- ── 3. Create partitioned parent ──────────────────────────────────────────────

CREATE TABLE wims.system_audit_trails (
    audit_id         BIGINT
                         NOT NULL
                         DEFAULT nextval('wims.system_audit_trails_audit_id_seq'),
    user_id          UUID REFERENCES wims.users(user_id),
    action_type      VARCHAR,
    table_affected   VARCHAR,
    record_id        INTEGER,
    ip_address       VARCHAR,
    user_agent       TEXT,
    timestamp        TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- forensic columns (migration 60)
    old_values       JSONB,
    new_values       JSONB,
    -- correlation columns (migration 62)
    correlation_id   VARCHAR(64),
    result           VARCHAR(16) NOT NULL DEFAULT 'success',
    ip_hash          VARCHAR(128),
    -- full-text search vector (migration 48)
    search_vector    tsvector GENERATED ALWAYS AS (
                         to_tsvector('english',
                             coalesce(action_type,    '') || ' ' ||
                             coalesce(table_affected, '') || ' ' ||
                             coalesce(user_agent,     '')
                         )
                     ) STORED,
    PRIMARY KEY (audit_id, timestamp)
)
PARTITION BY RANGE (timestamp);

ALTER SEQUENCE wims.system_audit_trails_audit_id_seq
    OWNED BY wims.system_audit_trails.audit_id;

-- ── 4. Create child partitions ────────────────────────────────────────────────

CREATE TABLE wims.system_audit_trails_2024
    PARTITION OF wims.system_audit_trails
    FOR VALUES FROM ('2024-01-01 00:00:00+00') TO ('2025-01-01 00:00:00+00');

CREATE TABLE wims.system_audit_trails_2025
    PARTITION OF wims.system_audit_trails
    FOR VALUES FROM ('2025-01-01 00:00:00+00') TO ('2026-01-01 00:00:00+00');

CREATE TABLE wims.system_audit_trails_2026
    PARTITION OF wims.system_audit_trails
    FOR VALUES FROM ('2026-01-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');

CREATE TABLE wims.system_audit_trails_2027
    PARTITION OF wims.system_audit_trails
    FOR VALUES FROM ('2027-01-01 00:00:00+00') TO ('2028-01-01 00:00:00+00');

-- Catch-all for rows outside the pre-defined year ranges.
CREATE TABLE wims.system_audit_trails_default
    PARTITION OF wims.system_audit_trails
    DEFAULT;

-- ── 5. Copy existing rows ─────────────────────────────────────────────────────

INSERT INTO wims.system_audit_trails (
    audit_id, user_id, action_type, table_affected, record_id,
    ip_address, user_agent, timestamp,
    old_values, new_values,
    correlation_id, result, ip_hash
)
SELECT
    audit_id, user_id, action_type, table_affected, record_id,
    ip_address, user_agent, timestamp,
    old_values, new_values,
    correlation_id, result, ip_hash
FROM wims.system_audit_trails_pre_partition;

-- ── 6. Drop the plain backup table ───────────────────────────────────────────

DROP TABLE wims.system_audit_trails_pre_partition;

-- ── 7. Re-apply Row Level Security ───────────────────────────────────────────
-- RLS must be re-declared on the new parent; child partitions inherit it.

ALTER TABLE wims.system_audit_trails ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.system_audit_trails FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_trails_read_admin_or_self ON wims.system_audit_trails;
CREATE POLICY audit_trails_read_admin_or_self
    ON wims.system_audit_trails FOR SELECT
    USING (
        wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST')
        OR user_id = wims.current_user_uuid()
    );

DROP POLICY IF EXISTS audit_trails_insert_service ON wims.system_audit_trails;
CREATE POLICY audit_trails_insert_service
    ON wims.system_audit_trails FOR INSERT
    WITH CHECK (TRUE);

-- ── 8. Re-create non-PK indexes ──────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS system_audit_trails_correlation_idx
    ON wims.system_audit_trails (correlation_id);

CREATE INDEX IF NOT EXISTS system_audit_trails_result_idx
    ON wims.system_audit_trails (result);

CREATE INDEX IF NOT EXISTS idx_audit_trails_search
    ON wims.system_audit_trails USING GIN (search_vector);

-- Timestamp index for partition-pruning efficiency and range queries.
CREATE INDEX IF NOT EXISTS system_audit_trails_timestamp_idx
    ON wims.system_audit_trails (timestamp DESC);

COMMIT;
