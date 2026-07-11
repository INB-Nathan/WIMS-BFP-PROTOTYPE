"""Prepare report_photos for owner-bound pre-upload rows.

Pending photos have no report yet.  Attached photos retain the existing report
foreign key and must carry ``attached_at``.  Anonymous pending-row access is
intentionally deferred until the application establishes a narrowly scoped
transaction-local owner context; this migration must not create a broad RLS
exception.

Revision ID: 0008
Revises: 0007
Create Date: 2026-07-12
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_ATTACHMENT_CHECK = """
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
"""


def _apply_photo_shape() -> None:
    """Allow pending rows and enforce an explicit pending/attached state."""
    op.execute("ALTER TABLE wims.report_photos ALTER COLUMN report_id DROP NOT NULL")
    op.execute("ALTER TABLE wims.report_photos ADD COLUMN IF NOT EXISTS attached_at TIMESTAMPTZ")

    # Existing rows were necessarily attached under the pre-upload schema.
    # Preserve their historical creation time as the attachment time before
    # adding the consistency constraint.
    op.execute(
        "UPDATE wims.report_photos"
        " SET attached_at = created_at"
        " WHERE report_id IS NOT NULL AND attached_at IS NULL"
    )
    op.execute(_ATTACHMENT_CHECK)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_report_photos_pending_owner"
        " ON wims.report_photos (uploader_user_id, uploader_device_id, created_at)"
        " WHERE report_id IS NULL"
    )

    op.execute(
        "COMMENT ON COLUMN wims.report_photos.report_id IS "
        "'Nullable while a photo is pending pre-upload; attached rows retain the "
        "foreign key to wims.citizen_reports.'"
    )
    op.execute(
        "COMMENT ON COLUMN wims.report_photos.attached_at IS "
        "'NULL for pending pre-upload rows; set atomically with report_id when "
        "the owning report is created or attached.'"
    )


def _apply_photo_rls() -> None:
    """Authorize registered pending rows without widening attached-row access."""
    op.execute("ALTER TABLE wims.report_photos ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE wims.report_photos FORCE ROW LEVEL SECURITY")

    # Staff access to attached rows is unchanged.  A registered owner can see
    # only that owner's pending rows.  Anonymous pending access is deliberately
    # not enabled: no safe device/capability transaction context exists in this
    # schema-only revision.  See the migration TODO below and its contract test.
    op.execute("DROP POLICY IF EXISTS report_photos_select ON wims.report_photos")
    op.execute(
        """
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
            )
        """
    )

    op.execute("DROP POLICY IF EXISTS report_photos_insert ON wims.report_photos")
    op.execute(
        """
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
                -- Existing anonymous attached-row path.  Pending anonymous
                -- access remains blocked until an owner context is defined.
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
            )
        """
    )

    # A registered owner may mutate only a still-pending row, or atomically
    # transition that row to a report owned by the same authenticated user.
    # The state CHECK above requires attached_at for the latter transition.
    op.execute("DROP POLICY IF EXISTS report_photos_update ON wims.report_photos")
    op.execute(
        """
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
            )
        """
    )

    op.execute("DROP POLICY IF EXISTS report_photos_delete ON wims.report_photos")
    op.execute(
        """
        CREATE POLICY report_photos_delete
            ON wims.report_photos FOR DELETE
            USING (
                wims.current_user_role() = 'SYSTEM_ADMIN'
                OR (
                    wims.current_user_role() = 'CIVILIAN_REPORTER'
                    AND report_id IS NULL
                    AND uploader_user_id = wims.current_user_uuid()
                )
            )
        """
    )

    # TODO(photo-preupload): establish a transaction-local, capability/device
    # owner context and add narrowly scoped anonymous pending SELECT/INSERT/
    # UPDATE/DELETE predicates plus live cross-device RLS tests.  Do not replace
    # this with a permissive TRUE policy or a BYPASSRLS session.


def upgrade() -> None:
    _apply_photo_shape()
    _apply_photo_rls()


def downgrade() -> None:
    """Restore the post-submit shape; fail closed if pending rows remain."""
    op.execute(
        "ALTER TABLE wims.report_photos DROP CONSTRAINT IF EXISTS report_photos_attachment_state"
    )
    # SET NOT NULL intentionally fails when pending rows exist instead of
    # silently deleting or attaching them.
    op.execute("ALTER TABLE wims.report_photos ALTER COLUMN report_id SET NOT NULL")
    op.execute("DROP INDEX IF EXISTS idx_report_photos_pending_owner")
    op.execute("ALTER TABLE wims.report_photos DROP COLUMN IF EXISTS attached_at")

    op.execute("DROP POLICY IF EXISTS report_photos_select ON wims.report_photos")
    op.execute(
        """
        CREATE POLICY report_photos_select
            ON wims.report_photos FOR SELECT
            USING (wims.current_user_role() IN (
                'SYSTEM_ADMIN', 'NATIONAL_VALIDATOR', 'NATIONAL_ANALYST'
            ))
        """
    )
    op.execute("DROP POLICY IF EXISTS report_photos_insert ON wims.report_photos")
    op.execute(
        """
        CREATE POLICY report_photos_insert
            ON wims.report_photos FOR INSERT
            WITH CHECK (
                (
                    wims.current_user_role() = 'CIVILIAN_REPORTER'
                    AND uploader_user_id = wims.current_user_uuid()
                    AND EXISTS (
                        SELECT 1 FROM wims.citizen_reports cr
                        WHERE cr.report_id = wims.report_photos.report_id
                          AND cr.contributor_user_id = wims.current_user_uuid()
                    )
                )
                OR (
                    wims.current_user_role() = 'ANONYMOUS'
                    AND uploader_user_id IS NULL
                    AND uploader_device_id IS NOT NULL
                    AND EXISTS (
                        SELECT 1 FROM wims.citizen_reports cr
                        WHERE cr.report_id = wims.report_photos.report_id
                          AND cr.contributor_user_id IS NULL
                          AND cr.device_id = wims.report_photos.uploader_device_id
                    )
                )
            )
        """
    )
    op.execute("DROP POLICY IF EXISTS report_photos_update ON wims.report_photos")
    op.execute(
        """
        CREATE POLICY report_photos_update
            ON wims.report_photos FOR UPDATE
            USING (wims.current_user_role() IN (
                'SYSTEM_ADMIN', 'NATIONAL_VALIDATOR', 'NATIONAL_ANALYST'
            ))
            WITH CHECK (wims.current_user_role() IN (
                'SYSTEM_ADMIN', 'NATIONAL_VALIDATOR', 'NATIONAL_ANALYST'
            ))
        """
    )
    op.execute("DROP POLICY IF EXISTS report_photos_delete ON wims.report_photos")
    op.execute(
        """
        CREATE POLICY report_photos_delete
            ON wims.report_photos FOR DELETE
            USING (wims.current_user_role() = 'SYSTEM_ADMIN')
        """
    )
