-- 90_registered_photo_ownership.sql
-- Atomically attach a registered CIVILIAN_REPORTER's own pending photos to one
-- of their reports during report submission.  This is the registered-user
-- counterpart of wims.attach_anonymous_photos (see 88_anonymous_photo_ownership.sql).
-- Ownership is derived entirely inside the SECURITY DEFINER function from the
-- caller-supplied user id and the locked report/photo rows; no broad RLS policy
-- or BYPASSRLS is introduced.  FORCE ROW LEVEL SECURITY on report_photos/
-- citizen_reports is left untouched.
-- Dependencies: 89_anonymous_pending_photo_insert.sql
-- Idempotent: YES

BEGIN;

-- Validate and attach a complete pending photo set that belongs to the same
-- registered user who owns the target report.  The report is locked first and
-- ownership/terminal status are derived.  The MATERIALIZED CTE locks every
-- requested pending row before any update so a missing, already-attached,
-- foreign, partial, or duplicate photo yields FALSE and no row is changed.
-- Report creation/audit remain in the application transaction/service; this
-- helper is not a general SQL executor.
CREATE OR REPLACE FUNCTION wims.attach_registered_photos(
    p_user_id UUID,
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
    v_report_user UUID;
    v_report_status TEXT;
    v_requested_count INTEGER;
    v_locked_count INTEGER;
BEGIN
    IF p_user_id IS NULL OR p_report_id IS NULL OR p_photo_ids IS NULL THEN
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

    -- Lock the report row and derive ownership and terminal status.  A missing
    -- report leaves v_report_user NULL, which fails the ownership check below.
    SELECT contributor_user_id, status
    INTO v_report_user, v_report_status
    FROM wims.citizen_reports
    WHERE report_id = p_report_id
    FOR UPDATE;

    IF v_report_user IS DISTINCT FROM p_user_id THEN
        RETURN FALSE;
    END IF;

    IF v_report_status = 'ACTIONED' OR v_report_status LIKE 'REJECTED_%' THEN
        RETURN FALSE;
    END IF;

    -- Lock the complete requested pending set before checking cardinality.
    -- MATERIALIZED prevents the lock-intent CTE from being inlined away by the
    -- planner.  Only same-owner, still-detached photos are counted.
    WITH locked AS MATERIALIZED (
        SELECT p.photo_id
        FROM wims.report_photos AS p
        WHERE p.photo_id = ANY (p_photo_ids)
          AND p.report_id IS NULL
          AND p.uploader_user_id = p_user_id
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
      AND p.uploader_user_id = p_user_id;

    RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION wims.attach_registered_photos(UUID, INTEGER, UUID[]) IS
    'Locks a registered user''s owned non-terminal report and the complete set of '
    'that user''s pending photos, then atomically attaches only a same-owner complete '
    'set; report creation and audit stay in the application service.';


-- Granted to the application role only, mirroring attach_anonymous_photos.
REVOKE ALL ON FUNCTION wims.attach_registered_photos(UUID, INTEGER, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wims.attach_registered_photos(UUID, INTEGER, UUID[]) TO wims_app;

COMMIT;
