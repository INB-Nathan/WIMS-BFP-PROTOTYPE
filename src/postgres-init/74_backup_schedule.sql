-- 74_backup_schedule.sql
-- Single-row config table for automated backup scheduling.

CREATE TABLE IF NOT EXISTS wims.backup_schedule (
    id            INTEGER PRIMARY KEY DEFAULT 1,
    enabled       BOOLEAN NOT NULL DEFAULT FALSE,
    cron_expr     TEXT NOT NULL DEFAULT '0 2 * * *',
    last_run_at   TIMESTAMPTZ,
    last_backup_filename TEXT,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT single_row CHECK (id = 1)
);

-- SYSTEM_ADMIN has full access; other roles have no access (RLS default-deny).
ALTER TABLE wims.backup_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.backup_schedule FORCE ROW LEVEL SECURITY;

CREATE POLICY backup_schedule_admin_all ON wims.backup_schedule
    FOR ALL
    USING (wims.current_user_role() = 'SYSTEM_ADMIN')
    WITH CHECK (wims.current_user_role() = 'SYSTEM_ADMIN');
