-- 94_device_blocklist.sql
-- Device blocklist for admin threat-response actions, keyed by device_token_hash
-- (SHA-256 of the signed device token) instead of source IP. Independent from
-- wims.ip_blocklist — see docs/superpowers/specs/2026-07-06-device-token-abuse-controls-design.md
-- section 5. Postgres = durable write-path (repeat-offender count + audit trail);
-- Redis device:block:{hash} = hot-path lookup.
-- Repeat-offender escalation: 3rd block episode → permanent (confirmed attacker/bot).
-- Idempotent: YES

BEGIN;

CREATE TABLE IF NOT EXISTS wims.device_blocklist (
    block_id                SERIAL PRIMARY KEY,
    device_token_hash       TEXT NOT NULL,
    blocked_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at              TIMESTAMPTZ,                      -- NULL = permanent
    is_permanent            BOOLEAN NOT NULL DEFAULT false,
    blocked_by              UUID,                             -- admin user_id
    block_reason            TEXT,
    threat_log_id           INTEGER,                          -- which alert triggered it
    user_agent              TEXT,                             -- captured at block time
    authenticated_user_id   UUID,                             -- from JWT, if logged in
    is_active               BOOLEAN NOT NULL DEFAULT true     -- soft unblock (keep history for repeat-offender counting)
);

CREATE INDEX IF NOT EXISTS idx_device_blocklist_hash ON wims.device_blocklist(device_token_hash);
CREATE INDEX IF NOT EXISTS idx_device_blocklist_active ON wims.device_blocklist(is_active) WHERE is_active = true;

ALTER TABLE wims.device_blocklist ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.device_blocklist FORCE ROW LEVEL SECURITY;

-- SYSTEM_ADMIN-only: full access. Mirrors 65_ip_blocklist.sql pattern.
DROP POLICY IF EXISTS device_blocklist_admin_all ON wims.device_blocklist;
CREATE POLICY device_blocklist_admin_all ON wims.device_blocklist
    FOR ALL
    USING (wims.current_user_role() IN ('SYSTEM_ADMIN'))
    WITH CHECK (wims.current_user_role() IN ('SYSTEM_ADMIN'));

INSERT INTO wims.system_config (config_key, config_value, description)
VALUES ('device_blocklist.repeat_offender_threshold', '3', 'Number of distinct block episodes for a device token before it is marked permanent (confirmed attacker/bot).')
ON CONFLICT (config_key) DO NOTHING;

COMMIT;
