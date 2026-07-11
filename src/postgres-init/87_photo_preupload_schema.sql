-- 87_photo_preupload_schema.sql
-- Civilian photo pre-upload schema groundwork.
--
-- Pending rows have report_id/attached_at NULL.  Attached rows retain the
-- report foreign key and require attached_at.  This file intentionally does
-- not grant anonymous pending access: the current schema has no safe
-- transaction-local device/capability owner context.
--
-- Dependencies: 82_civilian_report_photos.sql, 83_photo_exif_metadata.sql,
--               84_photo_idempotency_key.sql, 85_citizen_report_idempotency.sql,
--               86_civilian_contributor_snapshot.sql
-- Idempotent: YES

BEGIN;

ALTER TABLE wims.report_photos
    ALTER COLUMN report_id DROP NOT NULL;
ALTER TABLE wims.report_photos
    ADD COLUMN IF NOT EXISTS attached_at TIMESTAMPTZ;

-- Rows created before pre-upload support are attached by definition. Preserve
-- their historical creation time as the attachment timestamp before adding the
-- state constraint.
UPDATE wims.report_photos
SET attached_at = created_at
WHERE report_id IS NOT NULL
  AND attached_at IS NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'report_photos_attachment_state'
          AND conrelid = 'wims.report_photos'::regclass
    ) THEN
        ALTER TABLE wims.report_photos
            ADD CONSTRAINT report_photos_attachment_state CHECK (
                (report_id IS NULL AND attached_at IS NULL)
                OR (report_id IS NOT NULL AND attached_at IS NOT NULL)
            );
    END IF;
END
$$;

-- Pending-owner lookup and stale-row cleanup. The uploader XOR constraint from
-- 82 remains unchanged; both UUID owner branches are covered by this partial
-- index without adding plaintext identity columns.
CREATE INDEX IF NOT EXISTS idx_report_photos_pending_owner
    ON wims.report_photos (uploader_user_id, uploader_device_id, created_at)
    WHERE report_id IS NULL;

COMMENT ON COLUMN wims.report_photos.report_id IS
    'Nullable while a photo is pending pre-upload; attached rows retain the '
    'foreign key to wims.citizen_reports.';
COMMENT ON COLUMN wims.report_photos.attached_at IS
    'NULL for pending pre-upload rows; set atomically with report_id when the '
    'owning report is created or attached.';

ALTER TABLE wims.report_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.report_photos FORCE ROW LEVEL SECURITY;

-- Staff access to attached rows is unchanged. Registered contributors can see
-- only their own pending rows. Anonymous pending access remains denied until a
-- safe transaction-local device/capability context is established.
DROP POLICY IF EXISTS report_photos_select ON wims.report_photos;
CREATE POLICY report_photos_select
    ON wims.report_photos FOR SELECT
    USING (
        wims.current_user_role() IN (
            'SYSTEM_ADMIN', 'NATIONAL_VALIDATOR', 'NATIONAL_ANALYST'
        )
        OR (
            wims.current_user_role() = 'CIVILIAN_REPORTER'
            AND report_id IS NULL
            AND uploader_user_id = wims.current_user_uuid()
        )
    );

DROP POLICY IF EXISTS report_photos_insert ON wims.report_photos;
CREATE POLICY report_photos_insert
    ON wims.report_photos FOR INSERT
    WITH CHECK (
        -- Existing attached-row path for registered contributors.
        (
            wims.current_user_role() = 'CIVILIAN_REPORTER'
            AND uploader_user_id = wims.current_user_uuid()
            AND report_id IS NOT NULL
            AND EXISTS (
                SELECT 1 FROM wims.citizen_reports cr
                WHERE cr.report_id = wims.report_photos.report_id
                  AND cr.contributor_user_id = wims.current_user_uuid()
            )
        )
        OR
        -- New registered pending-row path.
        (
            wims.current_user_role() = 'CIVILIAN_REPORTER'
            AND uploader_user_id = wims.current_user_uuid()
            AND uploader_device_id IS NULL
            AND report_id IS NULL
            AND attached_at IS NULL
        )
        OR
        -- Existing anonymous attached-row path. Pending anonymous access is
        -- intentionally absent; do not replace this with TRUE.
        (
            wims.current_user_role() = 'ANONYMOUS'
            AND uploader_user_id IS NULL
            AND uploader_device_id IS NOT NULL
            AND report_id IS NOT NULL
            AND EXISTS (
                SELECT 1 FROM wims.citizen_reports cr
                WHERE cr.report_id = wims.report_photos.report_id
                  AND cr.contributor_user_id IS NULL
                  AND cr.device_id = wims.report_photos.uploader_device_id
            )
        )
    );

DROP POLICY IF EXISTS report_photos_update ON wims.report_photos;
CREATE POLICY report_photos_update
    ON wims.report_photos FOR UPDATE
    USING (
        wims.current_user_role() IN (
            'SYSTEM_ADMIN', 'NATIONAL_VALIDATOR', 'NATIONAL_ANALYST'
        )
        OR (
            wims.current_user_role() = 'CIVILIAN_REPORTER'
            AND report_id IS NULL
            AND uploader_user_id = wims.current_user_uuid()
        )
    )
    WITH CHECK (
        wims.current_user_role() IN (
            'SYSTEM_ADMIN', 'NATIONAL_VALIDATOR', 'NATIONAL_ANALYST'
        )
        OR (
            wims.current_user_role() = 'CIVILIAN_REPORTER'
            AND uploader_user_id = wims.current_user_uuid()
            AND (
                report_id IS NULL
                OR EXISTS (
                    SELECT 1 FROM wims.citizen_reports cr
                    WHERE cr.report_id = wims.report_photos.report_id
                      AND cr.contributor_user_id = wims.current_user_uuid()
                )
            )
        )
    );

DROP POLICY IF EXISTS report_photos_delete ON wims.report_photos;
CREATE POLICY report_photos_delete
    ON wims.report_photos FOR DELETE
    USING (
        wims.current_user_role() = 'SYSTEM_ADMIN'
        OR (
            wims.current_user_role() = 'CIVILIAN_REPORTER'
            AND report_id IS NULL
            AND uploader_user_id = wims.current_user_uuid()
        )
    );

-- TODO(photo-preupload): establish a transaction-local, capability/device
-- owner context and add narrowly scoped anonymous pending SELECT/INSERT/
-- UPDATE/DELETE predicates plus live cross-device RLS tests. Never use a broad
-- permissive TRUE policy or a BYPASSRLS session for this path.

COMMIT;
