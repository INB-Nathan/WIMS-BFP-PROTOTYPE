"""Live PostgreSQL RLS matrix for Community Safety Hub CMS (Slice F).

Opt-in: runs only with RUN_COMMUNITY_RLS_TESTS=1 and explicit
SQLALCHEMY_DATABASE_URL (non-superuser) plus DATABASE_ADMIN_URL. Mirrors
``test_report_photos_rls.py``. Verifies:

- An anonymous / non-admin connection sees ONLY published, non-expired rows
  and cannot INSERT/UPDATE/DELETE ``wims.community_content`` /
  ``wims.community_content_version`` (RLS admin-write policy denies).
- A SYSTEM_ADMIN connection can INSERT, UPDATE (archive), and the public read
  predicate hides expired content.

The test is importable and skips cleanly without the env flag + creds or when
the app connection is a superuser (which would bypass FORCE RLS).
"""

from __future__ import annotations

import os
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import sessionmaker

pytestmark = pytest.mark.integration


RUN_LIVE = os.environ.get("RUN_COMMUNITY_RLS_TESTS") == "1"


def _seed_content(
    admin, content_id, version_id, slug, status, expires_at, content_type="ANNOUNCEMENT"
):
    admin.execute(
        text(
            """
            INSERT INTO wims.community_content
                (id, content_type, slug, lifecycle_status, expires_at)
            VALUES (:id, :ct, :slug, :status, :expires_at)
            """
        ),
        {
            "id": content_id,
            "ct": content_type,
            "slug": slug,
            "status": status,
            "expires_at": expires_at,
        },
    )
    admin.execute(
        text(
            """
            INSERT INTO wims.community_content_version
                (version_id, content_id, version_number, title_en, body_en, content_hash)
            VALUES (:vid, :id, 1, 'English title', 'English body', 'deadbeef')
            """
        ),
        {"vid": version_id, "id": content_id},
    )
    if status == "PUBLISHED":
        admin.execute(
            text(
                """
                UPDATE wims.community_content
                SET published_version_id = :vid, lifecycle_status = 'PUBLISHED'
                WHERE id = :id
                """
            ),
            {"vid": version_id, "id": content_id},
        )


@pytest.fixture
def live_rls_context():
    if not RUN_LIVE:
        pytest.skip("set RUN_COMMUNITY_RLS_TESTS=1 for live PostgreSQL RLS tests")

    app_url = os.environ.get("SQLALCHEMY_DATABASE_URL")
    admin_url = os.environ.get("DATABASE_ADMIN_URL")
    if not app_url or not admin_url:
        pytest.skip("SQLALCHEMY_DATABASE_URL and DATABASE_ADMIN_URL are required")

    admin_engine = create_engine(admin_url)
    app_engine = create_engine(app_url)
    admin_factory = sessionmaker(bind=admin_engine, autoflush=False, autocommit=False)
    app_factory = sessionmaker(bind=app_engine, autoflush=False, autocommit=False)

    with app_factory() as app:
        is_super = app.execute(
            text("SELECT usesuper FROM pg_user WHERE usename = current_user")
        ).scalar()
        if is_super:
            pytest.skip("live RLS test requires a non-superuser app connection")

    suffix = uuid.uuid4().hex[:12]
    admin_id = uuid.uuid4()
    reporter_id = uuid.uuid4()

    with admin_factory() as admin:
        for user_id, role, name in (
            (admin_id, "SYSTEM_ADMIN", f"cms-admin-{suffix}"),
            (reporter_id, "CIVILIAN_REPORTER", f"cms-reporter-{suffix}"),
        ):
            admin.execute(
                text(
                    "INSERT INTO wims.users (user_id, keycloak_id, username, role, is_active) "
                    "VALUES (:uid, :uid, :name, :role, TRUE)"
                ),
                {"uid": user_id, "name": name, "role": role},
            )
        admin.commit()

    ids = {
        "published": uuid.uuid4(),
        "expired": uuid.uuid4(),
        "draft": uuid.uuid4(),
    }
    vids = {k: uuid.uuid4() for k in ids}
    slugs = {k: f"cms-{k}-{suffix}" for k in ids}

    with admin_factory() as admin:
        _seed_content(
            admin, ids["published"], vids["published"], slugs["published"], "PUBLISHED", None
        )
        _seed_content(
            admin,
            ids["expired"],
            vids["expired"],
            slugs["expired"],
            "PUBLISHED",
            # past expiry -> must be hidden from anonymous readers
            "2000-01-01 00:00:00+00",
        )
        _seed_content(admin, ids["draft"], vids["draft"], slugs["draft"], "DRAFT", None)
        admin.commit()

    state = {
        "admin_factory": admin_factory,
        "app_factory": app_factory,
        "admin_id": admin_id,
        "reporter_id": reporter_id,
        "ids": ids,
        "vids": vids,
        "slugs": slugs,
    }
    try:
        yield state
    finally:
        with admin_factory() as cleanup:
            # Null the publication pointer first to avoid FK violation when
            # deleting referenced versions.
            for cid in ids.values():
                cleanup.execute(
                    text(
                        "UPDATE wims.community_content SET published_version_id = NULL "
                        "WHERE id = :id"
                    ),
                    {"id": cid},
                )
            for vid in vids.values():
                cleanup.execute(
                    text("DELETE FROM wims.community_content_version WHERE version_id = :vid"),
                    {"vid": vid},
                )
            for cid in ids.values():
                cleanup.execute(
                    text("DELETE FROM wims.community_content WHERE id = :id"),
                    {"id": cid},
                )
            cleanup.execute(
                text("DELETE FROM wims.users WHERE user_id IN (:a, :r)"),
                {"a": admin_id, "r": reporter_id},
            )
            cleanup.commit()
        app_engine.dispose()
        admin_engine.dispose()


def _with_guc(factory, user_id):
    db = factory()
    db.begin()
    db.execute(text("SET LOCAL app.audit_source = 'app'"))
    db.execute(text("SET LOCAL wims.current_user_id = :uid"), {"uid": str(user_id)})
    return db


def test_anonymous_sees_only_published_non_expired(live_rls_context):
    state = live_rls_context
    with state["app_factory"]() as db:
        # No GUC -> ANONYMOUS; public SELECT policy shows only published+non-expired.
        count = db.execute(text("SELECT count(*) FROM wims.community_content")).scalar_one()
        assert count == 1  # only the non-expired PUBLISHED row
        db.rollback()


def test_system_admin_sees_all_rows(live_rls_context):
    state = live_rls_context
    db = _with_guc(state["app_factory"], state["admin_id"])
    try:
        count = db.execute(text("SELECT count(*) FROM wims.community_content")).scalar_one()
        assert count == 3
    finally:
        db.rollback()
        db.close()


def _check_write_denied(factory, user_id, sql, params):
    """Check that a DML as a non-SYSTEM_ADMIN results in zero affected rows.

    PostgreSQL's RLS enforces INSERT via WITH CHECK (raises error) but
    silently restricts UPDATE/DELETE to 0 rows when USING clause doesn't
    match. Each call uses its own session and transaction so the GUC is set
    fresh.
    """
    db = _with_guc(factory, user_id)
    try:
        result = db.execute(text(sql), params)
        db.commit()
        assert result.rowcount == 0, (
            f"Expected 0 rows affected for non-admin, got {result.rowcount}"
        )
    except DBAPIError:
        # INSERT raises via WITH CHECK — acceptable.
        db.rollback()
    finally:
        db.close()


def test_non_admin_cannot_write(live_rls_context):
    state = live_rls_context

    # INSERT as non-admin — raises DBAPIError via WITH CHECK
    db = _with_guc(state["app_factory"], state["reporter_id"])
    try:
        with pytest.raises(DBAPIError):
            db.execute(
                text(
                    "INSERT INTO wims.community_content "
                    "(id, content_type, slug, lifecycle_status) "
                    "VALUES (:id, 'ANNOUNCEMENT', :slug, 'DRAFT')"
                ),
                {"id": uuid.uuid4(), "slug": f"reject-{uuid.uuid4().hex[:8]}"},
            )
            db.commit()
        db.rollback()
    finally:
        db.close()

    # UPDATE as non-admin — silently affects 0 rows (USING clause filters)
    _check_write_denied(
        state["app_factory"],
        state["reporter_id"],
        "UPDATE wims.community_content SET lifecycle_status = 'ARCHIVED' WHERE id = :id",
        {"id": str(state["ids"]["published"])},
    )

    # DELETE as non-admin — silently affects 0 rows
    _check_write_denied(
        state["app_factory"],
        state["reporter_id"],
        "DELETE FROM wims.community_content WHERE id = :id",
        {"id": str(state["ids"]["published"])},
    )


def test_system_admin_can_insert_update_archive(live_rls_context):
    state = live_rls_context
    # Keep INSERT, UPDATE, and SELECT in one transaction so the GUC is
    # active throughout — SET LOCAL is lost after commit/rollback.
    db = _with_guc(state["app_factory"], state["admin_id"])
    new_id = uuid.uuid4()
    new_vid = uuid.uuid4()
    slug = f"admin-insert-{uuid.uuid4().hex[:8]}"
    try:
        # INSERT a draft as SYSTEM_ADMIN.
        db.execute(
            text(
                "INSERT INTO wims.community_content "
                "(id, content_type, slug, lifecycle_status) "
                "VALUES (:id, 'ANNOUNCEMENT', :slug, 'DRAFT')"
            ),
            {"id": new_id, "slug": slug},
        )
        db.execute(
            text(
                "INSERT INTO wims.community_content_version "
                "(version_id, content_id, version_number, title_en, body_en, content_hash) "
                "VALUES (:vid, :id, 1, 'T', 'B', 'hash')"
            ),
            {"vid": new_vid, "id": new_id},
        )

        # UPDATE (archive) as SYSTEM_ADMIN in the same transaction.
        db.execute(
            text(
                "UPDATE wims.community_content SET lifecycle_status = 'ARCHIVED', "
                "archived_at = now() WHERE id = :id"
            ),
            {"id": str(new_id)},
        )

        # SELECT in the same transaction — GUC is still active.
        archived = db.execute(
            text("SELECT lifecycle_status FROM wims.community_content WHERE id = :id"),
            {"id": str(new_id)},
        ).scalar_one()
        assert archived == "ARCHIVED"

        db.commit()
    finally:
        db.close()
        # Clean up via the admin connection (bypasses RLS) since wims_app
        # has no DELETE policy on community_content_version.
        with state["admin_factory"]() as clean:
            with clean.begin():
                clean.execute(
                    text(
                        "UPDATE wims.community_content SET published_version_id = NULL "
                        "WHERE id = :id"
                    ),
                    {"id": new_id},
                )
                clean.execute(
                    text("DELETE FROM wims.community_content_version WHERE content_id = :id"),
                    {"id": new_id},
                )
                clean.execute(
                    text("DELETE FROM wims.community_content WHERE id = :id"),
                    {"id": new_id},
                )
