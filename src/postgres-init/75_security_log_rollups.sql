-- 75_security_log_rollups.sql
-- Security telemetry rollups + short raw-log retention for Contabo SIEM tuning.
-- Raw threat logs are kept briefly; hourly/daily rollups preserve weekly/time-range views.
-- Dependencies: 08_security_audit.sql, 49_system_config.sql, 62_security_threat_classification.sql
-- Idempotent: YES

BEGIN;

CREATE TABLE IF NOT EXISTS wims.security_threat_log_rollups (
    bucket_start       TIMESTAMPTZ NOT NULL,
    bucket_granularity TEXT        NOT NULL
        CHECK (bucket_granularity IN ('hour', 'day')),
    severity_level     VARCHAR     NOT NULL
        CHECK (severity_level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    classification     TEXT        NOT NULL DEFAULT 'unclassified',
    source_ip          TEXT        NOT NULL DEFAULT '',
    suricata_sid       INTEGER     NOT NULL DEFAULT 0,
    suricata_signature TEXT,
    alert_count        BIGINT      NOT NULL DEFAULT 0 CHECK (alert_count >= 0),
    first_seen         TIMESTAMPTZ NOT NULL,
    last_seen          TIMESTAMPTZ NOT NULL,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (
        bucket_granularity,
        bucket_start,
        severity_level,
        classification,
        source_ip,
        suricata_sid
    )
);

CREATE INDEX IF NOT EXISTS idx_security_rollups_bucket
    ON wims.security_threat_log_rollups (bucket_granularity, bucket_start DESC);

CREATE INDEX IF NOT EXISTS idx_security_rollups_severity_bucket
    ON wims.security_threat_log_rollups (severity_level, bucket_granularity, bucket_start DESC);

ALTER TABLE wims.security_threat_log_rollups ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.security_threat_log_rollups FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS security_rollups_admin_analyst_select ON wims.security_threat_log_rollups;
CREATE POLICY security_rollups_admin_analyst_select
ON wims.security_threat_log_rollups FOR SELECT
USING (wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST'));

DROP POLICY IF EXISTS security_rollups_admin_all ON wims.security_threat_log_rollups;
CREATE POLICY security_rollups_admin_all
ON wims.security_threat_log_rollups FOR ALL
USING (wims.current_user_role() = 'SYSTEM_ADMIN')
WITH CHECK (wims.current_user_role() = 'SYSTEM_ADMIN');

-- Production retention defaults for noisy SIEM telemetry.
INSERT INTO wims.system_config (config_key, config_value, description) VALUES
  ('retention.security_threat_logs_days', '1', '1 day for raw IDS alert logs; weekly/monthly views use rollups'),
  ('retention.security_rollups_hourly_days', '7', '7 days for hourly IDS alert rollups'),
  ('retention.security_rollups_daily_days', '90', '90 days for daily IDS alert rollups'),
  ('siem.raw_dedup_window_minutes', '5', 'Deduplicate raw SIEM alerts by source/SID/severity/classification within this window'),
  ('siem.store_low_value_raw', 'false', 'When false, store background/scanner/bot low-value alerts only in rollups')
ON CONFLICT (config_key) DO UPDATE
SET config_value = EXCLUDED.config_value,
    description = EXCLUDED.description;

-- Seed rollups from any retained raw rows on first deployment. Existing rollups win so
-- repeated deploys do not overwrite historical buckets accumulated after raw pruning.
INSERT INTO wims.security_threat_log_rollups (
    bucket_start,
    bucket_granularity,
    severity_level,
    classification,
    source_ip,
    suricata_sid,
    suricata_signature,
    alert_count,
    first_seen,
    last_seen
)
SELECT
    date_trunc('hour', timestamp) AS bucket_start,
    'hour' AS bucket_granularity,
    severity_level,
    COALESCE(classification, 'unclassified'),
    COALESCE(source_ip, ''),
    COALESCE(suricata_sid, 0),
    max(suricata_signature),
    count(*),
    min(timestamp),
    max(timestamp)
FROM wims.security_threat_logs
GROUP BY 1, 2, 3, 4, 5, 6
ON CONFLICT DO NOTHING;

INSERT INTO wims.security_threat_log_rollups (
    bucket_start,
    bucket_granularity,
    severity_level,
    classification,
    source_ip,
    suricata_sid,
    suricata_signature,
    alert_count,
    first_seen,
    last_seen
)
SELECT
    date_trunc('day', timestamp) AS bucket_start,
    'day' AS bucket_granularity,
    severity_level,
    COALESCE(classification, 'unclassified'),
    COALESCE(source_ip, ''),
    COALESCE(suricata_sid, 0),
    max(suricata_signature),
    count(*),
    min(timestamp),
    max(timestamp)
FROM wims.security_threat_logs
GROUP BY 1, 2, 3, 4, 5, 6
ON CONFLICT DO NOTHING;

COMMIT;
