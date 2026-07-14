"""Create information CMS tables for announcements and emergencies.

Adds two public-read tables for the civilian Information page:
  wims.information_announcements  — public advisories with optional pubmat
  wims.information_emergencies    — active emergencies, including those
                                    promoted from the incident system

Both tables are readable by all authenticated roles and writable by
SYSTEM_ADMIN (and NATIONAL_VALIDATOR for promote-from-incident).

Revision ID: 0016
Revises: 0015
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "0016"
down_revision: Union[str, None] = "0015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS wims.information_announcements (
            id            SERIAL PRIMARY KEY,
            title         TEXT NOT NULL,
            body          TEXT NOT NULL,
            urgency       TEXT NOT NULL DEFAULT 'general'
                          CHECK (urgency IN ('urgent', 'advisory', 'general')),
            image_path    TEXT,
            published     BOOLEAN NOT NULL DEFAULT false,
            published_at  TIMESTAMPTZ,
            created_by    TEXT NOT NULL,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS wims.information_emergencies (
            id                        SERIAL PRIMARY KEY,
            title                     TEXT NOT NULL,
            location                  TEXT NOT NULL,
            description               TEXT NOT NULL,
            severity                  TEXT NOT NULL DEFAULT 'moderate'
                                      CHECK (severity IN ('critical', 'high', 'moderate', 'low')),
            status                    TEXT NOT NULL DEFAULT 'ongoing'
                                      CHECK (status IN ('ongoing', 'contained', 'monitoring', 'resolved')),
            promoted_from_incident_id INTEGER,
            published                 BOOLEAN NOT NULL DEFAULT false,
            published_at              TIMESTAMPTZ,
            created_by                TEXT NOT NULL,
            created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        GRANT SELECT, INSERT, UPDATE, DELETE
            ON wims.information_announcements TO wims_app;
        GRANT SELECT, INSERT, UPDATE, DELETE
            ON wims.information_emergencies TO wims_app;
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS wims.information_announcements CASCADE")
    op.execute("DROP TABLE IF EXISTS wims.information_emergencies CASCADE")
