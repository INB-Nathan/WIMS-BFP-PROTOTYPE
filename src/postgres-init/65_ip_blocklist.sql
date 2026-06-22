-- 65_ip_blocklist.sql
-- IP blocklist for admin threat-response actions. Postgres = durable write-path
-- (repeat-offender count + audit trail); Redis ip:block:{ip} = hot-path lookup.
-- Repeat-offender escalation: 3rd block episode → permanent (confirmed attacker/bot).
-- Idempotent: YES

BEGIN;

CREATE TABLE IF NOT EXISTS wims.ip_blocklist (
    block_id        SERIAL PRIMARY KEY,
    source_ip       TEXT NOT NULL,
    blocked_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ,                      -- NULL = permanent
    is_permanent    BOOLEAN NOT NULL DEFAULT false,
    blocked_by      UUID,                             -- admin user_id
    block_reason    TEXT,                             -- e.g. "HIGH threat filter", "manual row block", "bulk block"
    threat_log_id   INTEGER,                          -- which alert triggered it (nullable for bulk/filter blocks)
    is_active       BOOLEAN NOT NULL DEFAULT true     -- soft unblock (keep history for repeat-offender counting)
);

CREATE INDEX IF NOT EXISTS idx_ip_blocklist_source_ip ON wims.ip_blocklist(source_ip);
CREATE INDEX IF NOT EXISTS idx_ip_blocklist_active ON wims.ip_blocklist(is_active) WHERE is_active = true;

ALTER TABLE wims.ip_blocklist ENABLE ROW LEVEL SECURITY;

-- SYSTEM_ADMIN-only: full access. Mirrors 10_rls_policies.sql pattern.
DROP POLICY IF EXISTS ip_blocklist_admin_all ON wims.ip_blocklist;
CREATE POLICY ip_blocklist_admin_all ON wims.ip_blocklist
    FOR ALL
    USING (wims.current_user_role() IN ('SYSTEM_ADMIN'))
    WITH CHECK (wims.current_user_role() IN ('SYSTEM_ADMIN'));

INSERT INTO wims.system_config (config_key, config_value, description)
VALUES ('ip_blocklist.repeat_offender_threshold', '3', 'Number of distinct block episodes for an IP before it is marked permanent (confirmed attacker/bot).')
ON CONFLICT (config_key) DO NOTHING;

INSERT INTO wims.system_config (config_key, config_value, description)
VALUES ('ip_blocklist.allowlist', '127.0.0.1,::1', 'Comma-separated IPs/CIDRs that must never be blocked (other admins, monitors, VPS egress). Checked by middleware and block endpoints.')
ON CONFLICT (config_key) DO NOTHING;

COMMIT;
