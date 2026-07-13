"""Add Community Safety Hub CMS content schema.

Creates the append-only versioned CMS model for the Community Safety Hub:
``wims.community_content`` (one live pointer row per content item, carrying the
publication pointer and lifecycle/urgent-banner state) and
``wims.community_content_version`` (immutable, append-only per-item versions).

Publication and rollback are pointer moves on ``wims.community_content``
(``published_version_id``), never edits to historical version rows.  Historical
``community_content_version`` rows are protected by the append-only design and
the SYSTEM_ADMIN-only write RLS policy; the application must never UPDATE/DELETE
them.

RLS: public/anonymous/authenticated read is limited to PUBLISHED, non-expired
rows (``now()`` is allowed in RLS predicates).  All writes are SYSTEM_ADMIN-only
via the established ``wims.current_user_role()`` convention.  ``FORCE ROW LEVEL
SECURITY`` is enabled on both tables; no new auth/role check is introduced and no
grant is made to PUBLIC.

This revision also reconciles the contributor snapshot cache
(``wims.civilian_contributors``): it adds ``formula_version`` and removes the
retired ``opt_in_leaderboard`` flag.  The canonical clean-volume bootstrap for
those column changes already lives in ``86_civilian_contributor_snapshot.sql``;
the ALTERs below are idempotent no-ops on a fresh volume and converge databases
upgraded through earlier revisions.

The table/index/RLS/grant bodies in this revision are byte-identical to the
canonical clean bootstrap ``91_community_content_schema.sql``.

Revision ID: 0012
Revises: 0011
Create Date: 2026-07-12
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "0012"
down_revision: Union[str, None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Canonical CMS DDL.  This exact text is mirrored in
# src/postgres-init/91_community_content_schema.sql (between BEGIN; and COMMIT;)
# so a fresh bootstrap and an Alembic upgrade converge on the same schema.
_COMMUNITY_CONTENT_DDL = """
-- wims.community_content: one published/non-expired pointer row per content item.
CREATE TABLE IF NOT EXISTS wims.community_content (
    id                UUID        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    content_type      TEXT        NOT NULL
                      CHECK (content_type IN ('SAFETY_ARTICLE', 'ANNOUNCEMENT', 'EVENT')),
    slug              TEXT        NOT NULL,
    lifecycle_status  TEXT        NOT NULL DEFAULT 'DRAFT'
                      CHECK (lifecycle_status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
    published_version_id UUID,
    expires_at        TIMESTAMPTZ,
    last_reviewed_at  TIMESTAMPTZ,
    urgent_banner     BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at       TIMESTAMPTZ,
    created_by        UUID,
    row_version       INTEGER     NOT NULL DEFAULT 1
);

-- wims.community_content_version: immutable, append-only per-item versions.
-- Historical rows are NEVER updated or deleted by the application; publishing
-- and rollback are pointer moves on wims.community_content, never version edits.
CREATE TABLE IF NOT EXISTS wims.community_content_version (
    version_id     UUID        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    content_id     UUID        NOT NULL REFERENCES wims.community_content(id),
    version_number INTEGER     NOT NULL,
    title_en       TEXT        NOT NULL,
    title_uk       TEXT,
    body_en        TEXT        NOT NULL,
    body_uk        TEXT,
    metadata_json  JSONB,
    content_hash   TEXT        NOT NULL,
    creator        UUID,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Publication pointer: published_version_id references the active version.
-- Guarded so a fresh bootstrap (91) and an Alembic upgrade (0012) converge
-- without colliding on an already-existing constraint (PostgreSQL has no
-- ADD CONSTRAINT IF NOT EXISTS).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_community_content_published_version'
    ) THEN
        ALTER TABLE wims.community_content
            ADD CONSTRAINT fk_community_content_published_version
            FOREIGN KEY (published_version_id)
            REFERENCES wims.community_content_version(version_id);
    END IF;
END $$;

-- Globally unique slug (one canonical URL per content item).
CREATE UNIQUE INDEX IF NOT EXISTS uq_community_content_slug
    ON wims.community_content (slug);

-- Public listing index (content_type, lifecycle_status, expires_at).
CREATE INDEX IF NOT EXISTS idx_community_content_public_list
    ON wims.community_content (content_type, lifecycle_status, expires_at);

-- At most one PUBLISHED urgent banner.  PostgreSQL partial index predicates
-- require IMMUTABLE functions, so the volatile expires_at > now() clause is NOT
-- included here; expiry is enforced at read time by the application/service
-- (Slice F) via the SQL predicate, matching the rest of the codebase.
-- DROP IF EXISTS keeps a fresh bootstrap (91) and an Alembic upgrade (0012)
-- idempotent when both run; the literal CREATE UNIQUE INDEX is preserved.
DROP INDEX IF EXISTS wims.uq_community_content_active_urgent_banner;
CREATE UNIQUE INDEX uq_community_content_active_urgent_banner
    ON wims.community_content ((1))
    WHERE urgent_banner = TRUE AND lifecycle_status = 'PUBLISHED';

-- One monotonic version_number per content_id; plus a version-desc lookup.
DROP INDEX IF EXISTS wims.uq_community_content_version_content_id_version_number;
CREATE UNIQUE INDEX uq_community_content_version_content_id_version_number
    ON wims.community_content_version (content_id, version_number);
CREATE INDEX IF NOT EXISTS idx_community_content_version_content_id_version_desc
    ON wims.community_content_version (content_id, version_number DESC);

-- ─── RLS ───────────────────────────────────────────────────────────────
ALTER TABLE wims.community_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.community_content FORCE ROW LEVEL SECURITY;
ALTER TABLE wims.community_content_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.community_content_version FORCE ROW LEVEL SECURITY;

-- Public read: only published and not-yet-expired content (now() is allowed in
-- RLS predicates; it is only forbidden inside partial index WHERE clauses).
DROP POLICY IF EXISTS community_content_public_select ON wims.community_content;
CREATE POLICY community_content_public_select
    ON wims.community_content FOR SELECT
    USING (
        lifecycle_status = 'PUBLISHED'
        AND (expires_at IS NULL OR expires_at > now())
    );

DROP POLICY IF EXISTS community_content_version_public_select ON wims.community_content_version;
CREATE POLICY community_content_version_public_select
    ON wims.community_content_version FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM wims.community_content cc
            WHERE cc.id = wims.community_content_version.content_id
              AND cc.lifecycle_status = 'PUBLISHED'
              AND (cc.expires_at IS NULL OR cc.expires_at > now())
        )
    );

-- Pointer-row writes are SYSTEM_ADMIN-only. Version history is append-only:
-- SYSTEM_ADMIN may INSERT versions, but UPDATE/DELETE are intentionally absent.
-- Reuses the established wims.current_user_role() convention.
DROP POLICY IF EXISTS community_content_admin_write ON wims.community_content;
CREATE POLICY community_content_admin_write
    ON wims.community_content FOR ALL
    USING (wims.current_user_role() = 'SYSTEM_ADMIN')
    WITH CHECK (wims.current_user_role() = 'SYSTEM_ADMIN');

DROP POLICY IF EXISTS community_content_version_admin_select ON wims.community_content_version;
CREATE POLICY community_content_version_admin_select
    ON wims.community_content_version FOR SELECT
    USING (wims.current_user_role() = 'SYSTEM_ADMIN');

DROP POLICY IF EXISTS community_content_version_admin_write ON wims.community_content_version;
CREATE POLICY community_content_version_admin_write
    ON wims.community_content_version FOR INSERT
    WITH CHECK (wims.current_user_role() = 'SYSTEM_ADMIN');

-- ─── Grants ────────────────────────────────────────────────────────────
-- No UPDATE/DELETE privilege or RLS policy exists for version history.
-- No grant to PUBLIC (schema-level PUBLIC revoke in 10_rls_policies.sql).
GRANT SELECT, INSERT, UPDATE, DELETE ON wims.community_content TO wims_app;
GRANT SELECT, INSERT ON wims.community_content_version TO wims_app;
"""


def _create_community_content_schema() -> None:
    """Create the CMS tables, indexes, RLS, and grants (mirrored in bootstrap 91)."""
    op.execute(_COMMUNITY_CONTENT_DDL)


def _reconcile_contributor_snapshot() -> None:
    """Add formula_version and drop the retired opt_in_leaderboard flag.

    The canonical clean-volume bootstrap for these column changes already lives
    in 86_civilian_contributor_snapshot.sql.  These ALTERs are idempotent on a
    fresh volume and converge databases upgraded through earlier revisions.
    """
    op.execute(
        "ALTER TABLE wims.civilian_contributors ADD COLUMN IF NOT EXISTS formula_version TEXT"
    )
    op.execute("ALTER TABLE wims.civilian_contributors DROP COLUMN IF EXISTS opt_in_leaderboard")


def upgrade() -> None:
    _create_community_content_schema()
    _reconcile_contributor_snapshot()


def _drop_community_content_schema() -> None:
    """Remove the CMS tables (version first, then the pointer row)."""
    op.execute("DROP TABLE IF EXISTS wims.community_content_version CASCADE")
    op.execute("DROP TABLE IF EXISTS wims.community_content CASCADE")


def _revert_contributor_snapshot() -> None:
    """Restore the 0006 leaderboard flag and remove the formula marker."""
    op.execute(
        "ALTER TABLE IF EXISTS wims.civilian_contributors"
        " ADD COLUMN IF NOT EXISTS opt_in_leaderboard BOOLEAN NOT NULL DEFAULT FALSE"
    )
    op.execute(
        "ALTER TABLE IF EXISTS wims.civilian_contributors DROP COLUMN IF EXISTS formula_version"
    )


def downgrade() -> None:
    _drop_community_content_schema()
    _revert_contributor_snapshot()
