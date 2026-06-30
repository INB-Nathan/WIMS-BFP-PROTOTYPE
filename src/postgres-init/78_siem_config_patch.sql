-- Gap G-3 fix: ensure store_low_value_raw is enabled so policy-violation alerts
-- (TD-10 rate limit, TD-11 scanner, SID 1000024/1000121) surface in
-- security_threat_logs on existing deployments that pre-date PR #486.
-- Safe to apply multiple times: ON CONFLICT DO UPDATE is idempotent.
INSERT INTO wims.system_config (config_key, config_value)
VALUES ('siem.store_low_value_raw', 'true')
ON CONFLICT (config_key) DO UPDATE SET config_value = 'true';
