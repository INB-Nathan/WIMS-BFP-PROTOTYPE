-- 88_anonymous_photo_ownership.sql
-- Harden anonymous session capabilities and bind pre-upload photos to them.
-- Raw 256-bit bearer tokens are returned once by a SECURITY DEFINER helper;
-- only SHA-256 hashes are stored. Device IDs remain analytics-only.
-- Dependencies: 80_civilian_contributor_tables.sql, 87_photo_preupload_schema.sql
-- Idempotent: YES

BEGIN;

ALTER TABLE wims.anonymous_sessions
    ADD COLUMN IF NOT EXISTS absolute_expires_at TIMESTAMPTZ;
UPDATE wims.anonymous_sessions
SET absolute_expires_at = GREATEST(created_at + interval '90 days', expires_at)
WHERE absolute_expires_at IS NULL;
ALTER TABLE wims.anonymous_sessions
    ALTER COLUMN absolute_expires_at SET DEFAULT (now() + interval '90 days');
ALTER TABLE wims.anonymous_sessions
    ALTER COLUMN absolute_expires_at SET NOT NULL;
ALTER TABLE wims.anonymous_sessions
    ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'anonymous_sessions_token_hash_format'
                     AND conrelid = 'wims.anonymous_sessions'::regclass) THEN
        ALTER TABLE wims.anonymous_sessions ADD CONSTRAINT anonymous_sessions_token_hash_format
            CHECK (token_hash ~ '^[0-9a-f]{64}$');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'anonymous_sessions_absolute_expiry_after_creation'
                     AND conrelid = 'wims.anonymous_sessions'::regclass) THEN
        ALTER TABLE wims.anonymous_sessions ADD CONSTRAINT anonymous_sessions_absolute_expiry_after_creation
            CHECK (absolute_expires_at > created_at);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'anonymous_sessions_revoked_after_creation'
                     AND conrelid = 'wims.anonymous_sessions'::regclass) THEN
        ALTER TABLE wims.anonymous_sessions ADD CONSTRAINT anonymous_sessions_revoked_after_creation
            CHECK (revoked_at IS NULL OR revoked_at >= created_at);
    END IF;
END
$$;

DROP POLICY IF EXISTS anonymous_sessions_insert ON wims.anonymous_sessions;
CREATE POLICY anonymous_sessions_insert ON wims.anonymous_sessions
    FOR INSERT WITH CHECK (FALSE);
REVOKE ALL ON wims.anonymous_sessions FROM wims_app;

ALTER TABLE wims.citizen_reports
    ADD COLUMN IF NOT EXISTS anonymous_session_id UUID
    REFERENCES wims.anonymous_sessions(anonymous_session_id);
CREATE INDEX IF NOT EXISTS idx_citizen_reports_anonymous_session
    ON wims.citizen_reports(anonymous_session_id)
    WHERE anonymous_session_id IS NOT NULL;
COMMENT ON COLUMN wims.citizen_reports.anonymous_session_id IS
    'Validated anonymous bearer session owner; legacy rows remain NULL. '
    'The report submission service must set this from the validated session '
    'before calling attach_anonymous_photos.';

ALTER TABLE wims.report_photos
    ADD COLUMN IF NOT EXISTS anonymous_session_id UUID
    REFERENCES wims.anonymous_sessions(anonymous_session_id);
CREATE INDEX IF NOT EXISTS idx_report_photos_anonymous_session
    ON wims.report_photos(anonymous_session_id)
    WHERE anonymous_session_id IS NOT NULL;

DO $$
BEGIN
    ALTER TABLE wims.report_photos DROP CONSTRAINT IF EXISTS report_photos_owner_xor;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'report_photos_device_owner_attached'
                     AND conrelid = 'wims.report_photos'::regclass) THEN
        ALTER TABLE wims.report_photos ADD CONSTRAINT report_photos_device_owner_attached
            CHECK (uploader_device_id IS NULL OR report_id IS NOT NULL);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'report_photos_owner_xor'
                     AND conrelid = 'wims.report_photos'::regclass) THEN
        ALTER TABLE wims.report_photos ADD CONSTRAINT report_photos_owner_xor CHECK (
            (uploader_user_id IS NOT NULL AND uploader_device_id IS NULL AND anonymous_session_id IS NULL)
            OR (uploader_user_id IS NULL AND uploader_device_id IS NOT NULL AND anonymous_session_id IS NULL)
            OR (uploader_user_id IS NULL AND uploader_device_id IS NULL AND anonymous_session_id IS NOT NULL)
        );
    END IF;
END
$$;

COMMENT ON COLUMN wims.report_photos.anonymous_session_id IS
    'Hash-backed anonymous bearer session owner; client device IDs are analytics-only and do not authorize.';


-- Issue a high-entropy bearer once.  p_device_id_hash is analytics only and is
-- never consulted by any ownership helper.  The raw token is not logged or
-- stored; the caller must retain the one returned value.
CREATE OR REPLACE FUNCTION wims.issue_anonymous_session(
    p_device_id_hash TEXT DEFAULT NULL
)
RETURNS TABLE (
    anonymous_session_id UUID,
    raw_token TEXT
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = wims, pg_temp
AS $$
DECLARE
    v_raw_token TEXT := encode(public.gen_random_bytes(32), 'hex');
    v_session_id UUID;
BEGIN
    INSERT INTO wims.anonymous_sessions (
        token_hash,
        device_id_hash,
        last_seen_at,
        expires_at,
        absolute_expires_at
    ) VALUES (
        encode(public.digest(v_raw_token, 'sha256'), 'hex'),
        p_device_id_hash,
        clock_timestamp(),
        clock_timestamp() + interval '24 hours',
        clock_timestamp() + interval '90 days'
    )
    RETURNING wims.anonymous_sessions.anonymous_session_id
    INTO v_session_id;

    RETURN QUERY SELECT v_session_id, v_raw_token;
END;
$$;

COMMENT ON FUNCTION wims.issue_anonymous_session(TEXT) IS
    'Issues one 256-bit anonymous bearer and returns its raw lowercase-hex token once. '
    'Only its SHA-256 hash is stored; device_id_hash is analytics-only.';

-- Return the session UUID only for a valid, unexpired, unrevoked bearer.  A
-- successful validation advances the idle deadline but never the absolute one.
CREATE OR REPLACE FUNCTION wims.validate_anonymous_session(
    p_raw_token TEXT
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = wims, pg_temp
AS $$
DECLARE
    v_session_id UUID;
    v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
    IF p_raw_token IS NULL OR p_raw_token !~ '^[0-9a-f]{64}$' THEN
        RETURN NULL;
    END IF;

    UPDATE wims.anonymous_sessions
    SET last_seen_at = v_now,
        expires_at = LEAST(v_now + interval '24 hours', absolute_expires_at)
    WHERE token_hash = encode(public.digest(p_raw_token, 'sha256'), 'hex')
      AND revoked_at IS NULL
      AND expires_at > v_now
      AND absolute_expires_at > v_now
    RETURNING anonymous_sessions.anonymous_session_id INTO v_session_id;

    RETURN v_session_id;
END;
$$;

COMMENT ON FUNCTION wims.validate_anonymous_session(TEXT) IS
    'Validates a raw 256-bit lowercase-hex bearer, enforcing idle expiry, absolute '
    'expiry, and revocation; returns only the derived session UUID.';

-- Revoke by bearer without exposing a caller-supplied owner/session ID.
CREATE OR REPLACE FUNCTION wims.revoke_anonymous_session(
    p_raw_token TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = wims, pg_temp
AS $$
    UPDATE wims.anonymous_sessions
    SET revoked_at = COALESCE(revoked_at, clock_timestamp())
    WHERE p_raw_token IS NOT NULL
      AND p_raw_token ~ '^[0-9a-f]{64}$'
      AND token_hash = encode(public.digest(p_raw_token, 'sha256'), 'hex')
      AND revoked_at IS NULL
    RETURNING revoked_at IS NOT NULL
$$;

COMMENT ON FUNCTION wims.revoke_anonymous_session(TEXT) IS
    'Revokes the session represented by the raw bearer; raw tokens are never persisted.';

-- Authorize one pending photo from the session capability.  Device IDs are
-- deliberately absent from this predicate.
CREATE OR REPLACE FUNCTION wims.authorize_anonymous_pending_photo(
    p_raw_token TEXT,
    p_photo_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = wims, pg_temp
AS $$
DECLARE
    v_session_id UUID;
BEGIN
    v_session_id := wims.validate_anonymous_session(p_raw_token);
    IF v_session_id IS NULL OR p_photo_id IS NULL THEN
        RETURN FALSE;
    END IF;

    RETURN EXISTS (
        SELECT 1
        FROM wims.report_photos
        WHERE photo_id = p_photo_id
          AND report_id IS NULL
          AND attached_at IS NULL
          AND anonymous_session_id = v_session_id
    );
END;
$$;

COMMENT ON FUNCTION wims.authorize_anonymous_pending_photo(TEXT, UUID) IS
    'Authorizes only a pending photo owned by the bearer-derived anonymous session; '
    'client device IDs and caller-supplied session IDs are not authorization inputs.';

-- Validate and attach a complete photo set atomically.  The report is locked
-- before the photo set; the MATERIALIZED CTE locks every requested pending row
-- before any update.  A missing, already-attached, foreign, or duplicate photo
-- causes FALSE and no row is changed.  Report creation/audit remain in the
-- application transaction/service; this helper is not a general SQL executor.
CREATE OR REPLACE FUNCTION wims.attach_anonymous_photos(
    p_raw_token TEXT,
    p_report_id INTEGER,
    p_photo_ids UUID[]
)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = wims, pg_temp
AS $$
DECLARE
    v_session_id UUID;
    v_report_session UUID;
    v_requested_count INTEGER;
    v_locked_count INTEGER;
BEGIN
    v_session_id := wims.validate_anonymous_session(p_raw_token);
    IF v_session_id IS NULL OR p_report_id IS NULL OR p_photo_ids IS NULL THEN
        RETURN FALSE;
    END IF;

    v_requested_count := cardinality(p_photo_ids);
    IF v_requested_count = 0 THEN
        RETURN FALSE;
    END IF;

    IF EXISTS (
        SELECT photo_id
        FROM unnest(p_photo_ids) AS requested(photo_id)
        GROUP BY photo_id
        HAVING COUNT(*) > 1
    ) THEN
        RETURN FALSE;
    END IF;

    -- Bind the report to the same session and serialize concurrent attaches.
    SELECT anonymous_session_id
    INTO v_report_session
    FROM wims.citizen_reports
    WHERE report_id = p_report_id
    FOR UPDATE;

    IF v_report_session IS DISTINCT FROM v_session_id THEN
        RETURN FALSE;
    END IF;

    -- Lock the complete requested set before checking cardinality.  MATERIALIZED
    -- prevents the lock-intent CTE from being inlined away by the planner.
    WITH locked AS MATERIALIZED (
        SELECT p.photo_id
        FROM wims.report_photos AS p
        WHERE p.photo_id = ANY (p_photo_ids)
          AND p.report_id IS NULL
          AND p.attached_at IS NULL
          AND p.anonymous_session_id = v_session_id
        ORDER BY p.photo_id
        FOR UPDATE
    )
    SELECT COUNT(*) INTO v_locked_count FROM locked;

    IF v_locked_count <> v_requested_count THEN
        RETURN FALSE;
    END IF;

    UPDATE wims.report_photos AS p
    SET report_id = p_report_id,
        attached_at = clock_timestamp()
    WHERE p.photo_id = ANY (p_photo_ids)
      AND p.report_id IS NULL
      AND p.attached_at IS NULL
      AND p.anonymous_session_id = v_session_id;

    RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION wims.attach_anonymous_photos(TEXT, INTEGER, UUID[]) IS
    'Locks report and complete pending photo set, then atomically attaches only a '
    'same-session complete set; report creation and audit stay in the application service.';


-- Helpers intentionally do not write audit rows: the application service owns
-- report creation and the established append-only audit transaction. The
-- upload/route slice must call these helpers without placing raw tokens in URLs
-- or logs.

REVOKE ALL ON FUNCTION wims.issue_anonymous_session(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION wims.validate_anonymous_session(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION wims.revoke_anonymous_session(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION wims.authorize_anonymous_pending_photo(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION wims.attach_anonymous_photos(TEXT, INTEGER, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wims.issue_anonymous_session(TEXT) TO wims_app;
GRANT EXECUTE ON FUNCTION wims.validate_anonymous_session(TEXT) TO wims_app;
GRANT EXECUTE ON FUNCTION wims.revoke_anonymous_session(TEXT) TO wims_app;
GRANT EXECUTE ON FUNCTION wims.authorize_anonymous_pending_photo(TEXT, UUID) TO wims_app;
GRANT EXECUTE ON FUNCTION wims.attach_anonymous_photos(TEXT, INTEGER, UUID[]) TO wims_app;

COMMIT;
