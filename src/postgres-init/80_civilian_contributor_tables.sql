-- 80_civilian_contributor_tables.sql
-- Civilian Contributor Enhancement — anonymous sessions and tracking tokens.
-- See ADR 0003 (civilian-tracking-tokens-and-anonymous-sessions.md) for design rationale.
-- Dependencies: 05_citizen_reports.sql (citizen_reports table), 03_users.sql (users table)
-- Idempotent: YES

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- wims.anonymous_sessions
-- ═══════════════════════════════════════════════════════════════════════════════
-- Hash-only anonymous session tokens used for same-reporter mutation authority.
-- Tokens are per anonymous reporter/session, have 90-day sliding expiry, and
-- are not user-rotatable in this design. device_id_hash is retained only as an
-- analytics/abuse-correlation signal.
CREATE TABLE IF NOT EXISTS wims.anonymous_sessions (
    anonymous_session_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash             TEXT NOT NULL UNIQUE,           -- SHA-256 of the bearer token
    device_id_hash         TEXT,                           -- SHA-256 of device_id (analytics/abuse only)
    last_seen_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at             TIMESTAMPTZ NOT NULL DEFAULT now() + interval '90 days',
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_anonymous_sessions_expires
    ON wims.anonymous_sessions(expires_at);

ALTER TABLE wims.anonymous_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.anonymous_sessions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anonymous_sessions_select ON wims.anonymous_sessions;
CREATE POLICY anonymous_sessions_select
    ON wims.anonymous_sessions FOR SELECT
    USING (wims.current_user_role() = 'SYSTEM_ADMIN');

DROP POLICY IF EXISTS anonymous_sessions_insert ON wims.anonymous_sessions;
CREATE POLICY anonymous_sessions_insert
    ON wims.anonymous_sessions FOR INSERT
    WITH CHECK (TRUE);  -- public DMZ insert allowed (no auth)

DROP POLICY IF EXISTS anonymous_sessions_update ON wims.anonymous_sessions;
CREATE POLICY anonymous_sessions_update
    ON wims.anonymous_sessions FOR UPDATE
    USING (wims.current_user_role() = 'SYSTEM_ADMIN')
    WITH CHECK (wims.current_user_role() = 'SYSTEM_ADMIN');

DROP POLICY IF EXISTS anonymous_sessions_delete ON wims.anonymous_sessions;
CREATE POLICY anonymous_sessions_delete
    ON wims.anonymous_sessions FOR DELETE
    USING (wims.current_user_role() = 'SYSTEM_ADMIN');


-- ═══════════════════════════════════════════════════════════════════════════════
-- wims.report_tracking_tokens
-- ═══════════════════════════════════════════════════════════════════════════════
-- Hash-only public tracking tokens used by /tracking/v2/{report_id}/{tracking_token}
-- and the tracking QR code. One active public tracking token exists per report.
-- Invalid, expired, revoked, or mismatched tokens return neutral 404.
-- Anonymous report tokens expire after 30 days.
-- Registered contributors may regenerate/revoke public tracking links.
CREATE TABLE IF NOT EXISTS wims.report_tracking_tokens (
    tracking_token_id      BIGSERIAL PRIMARY KEY,
    report_id              INTEGER NOT NULL REFERENCES wims.citizen_reports(report_id) ON DELETE CASCADE,
    token_hash             TEXT NOT NULL,                   -- SHA-256 of the bearer token
    token_type             TEXT NOT NULL DEFAULT 'public' CHECK (token_type IN ('public', 'anonymous')),
    is_active              BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at             TIMESTAMPTZ,
    revoked_at             TIMESTAMPTZ,
    regenerated_from_id    BIGINT REFERENCES wims.report_tracking_tokens(tracking_token_id),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partial unique index ensures exactly one active token per report.
-- Using DROP INDEX IF EXISTS before CREATE UNIQUE INDEX IF NOT EXISTS because
-- UNIQUE INDEX IF NOT EXISTS only checks name, not definition, and a stale
-- non-unique index could conflict if previously created without the UNIQUE constraint.
DROP INDEX IF EXISTS idx_uq_active_token_per_report;
CREATE UNIQUE INDEX IF NOT EXISTS idx_uq_active_token_per_report
    ON wims.report_tracking_tokens(report_id) WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_tracking_tokens_report
    ON wims.report_tracking_tokens(report_id);

CREATE INDEX IF NOT EXISTS idx_tracking_tokens_hash
    ON wims.report_tracking_tokens(token_hash) WHERE is_active = TRUE;

ALTER TABLE wims.report_tracking_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.report_tracking_tokens FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tracking_tokens_select ON wims.report_tracking_tokens;
CREATE POLICY tracking_tokens_select
    ON wims.report_tracking_tokens FOR SELECT
    USING (wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_VALIDATOR', 'NATIONAL_ANALYST'));

DROP POLICY IF EXISTS tracking_tokens_insert ON wims.report_tracking_tokens;
CREATE POLICY tracking_tokens_insert
    ON wims.report_tracking_tokens FOR INSERT
    WITH CHECK (TRUE);  -- public DMZ insert from report submission

DROP POLICY IF EXISTS tracking_tokens_update ON wims.report_tracking_tokens;
CREATE POLICY tracking_tokens_update
    ON wims.report_tracking_tokens FOR UPDATE
    USING (wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_VALIDATOR'))
    WITH CHECK (wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_VALIDATOR'));

DROP POLICY IF EXISTS tracking_tokens_delete ON wims.report_tracking_tokens;
CREATE POLICY tracking_tokens_delete
    ON wims.report_tracking_tokens FOR DELETE
    USING (wims.current_user_role() = 'SYSTEM_ADMIN');


-- ── SECURITY DEFINER helper for tracking token validation ──────────────────
-- Public (anonymous) tracking endpoint validates tokens via hash lookup,
-- but the RLS policy on report_tracking_tokens blocks ANONYMOUS reads.
-- This SECURITY DEFINER function bypasses RLS so the endpoint works
-- without weakening the table-level SELECT policy.
-- SET search_path locks the function to wims, pg_temp for injection safety.
-- NOTE: Must be AFTER the report_tracking_tokens table definition because
-- LANGUAGE sql function bodies are checked at creation time.
CREATE OR REPLACE FUNCTION wims.validate_tracking_token(
    p_report_id INTEGER,
    p_token_hash TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = wims, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM wims.report_tracking_tokens
        WHERE report_id = p_report_id
          AND token_hash = p_token_hash
          AND is_active = TRUE
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > now())
    );
$$;

REVOKE ALL ON FUNCTION wims.validate_tracking_token(INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wims.validate_tracking_token(INTEGER, TEXT) TO wims_app;

COMMIT;