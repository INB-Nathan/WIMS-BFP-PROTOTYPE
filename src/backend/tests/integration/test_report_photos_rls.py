"""Live PostgreSQL RLS matrix for civilian report photos.

The test is opt-in because it creates temporary users/reports in the configured
PostgreSQL database. Run with RUN_CIVILIAN_PHOTO_RLS_TESTS=1 and explicit
SQLALCHEMY_DATABASE_URL (non-superuser) plus DATABASE_ADMIN_URL.
"""

from __future__ import annotations

import os
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import sessionmaker

pytestmark = pytest.mark.integration


RUN_LIVE = os.environ.get("RUN_CIVILIAN_PHOTO_RLS_TESTS") == "1"


@pytest.fixture
def live_rls_context():
    if not RUN_LIVE:
        pytest.skip("set RUN_CIVILIAN_PHOTO_RLS_TESTS=1 for live PostgreSQL RLS tests")

    app_url = os.environ.get("SQLALCHEMY_DATABASE_URL")
    admin_url = os.environ.get("DATABASE_ADMIN_URL")
    if not app_url or not admin_url:
        pytest.skip("SQLALCHEMY_DATABASE_URL and DATABASE_ADMIN_URL are required")

    admin_engine = create_engine(admin_url)
    app_engine = create_engine(app_url)
    admin_factory = sessionmaker(bind=admin_engine, autoflush=False, autocommit=False)
    app_factory = sessionmaker(bind=app_engine, autoflush=False, autocommit=False)

    with admin_factory() as admin:
        role_row = admin.execute(
            text("SELECT usesuper FROM pg_user WHERE usename = current_user")
        ).scalar()
        if role_row:
            pytest.skip("live RLS test requires a non-superuser app connection")

        suffix = uuid.uuid4().hex[:12]
        reporter_id = uuid.uuid4()
        other_reporter_id = uuid.uuid4()
        analyst_id = uuid.uuid4()
        anon_device = uuid.uuid4()
        for user_id, role, name in (
            (reporter_id, "CIVILIAN_REPORTER", f"photo-reporter-{suffix}"),
            (other_reporter_id, "CIVILIAN_REPORTER", f"photo-other-{suffix}"),
            (analyst_id, "NATIONAL_ANALYST", f"photo-analyst-{suffix}"),
        ):
            admin.execute(
                text(
                    """
                    INSERT INTO wims.users (user_id, keycloak_id, username, role, is_active)
                    VALUES (:uid, :uid, :name, :role, TRUE)
                    """
                ),
                {"uid": user_id, "name": name, "role": role},
            )
        anon_report_id = admin.execute(
            text(
                """
                INSERT INTO wims.citizen_reports
                    (location, category, device_id, status, contributor_user_id)
                VALUES
                    (ST_GeogFromText('SRID=4326;POINT(121 14)'), 'UNSURE', :device,
                     'PENDING', NULL)
                RETURNING report_id
                """
            ),
            {"device": anon_device},
        ).scalar_one()
        registered_report_id = admin.execute(
            text(
                """
                INSERT INTO wims.citizen_reports
                    (location, category, device_id, status, contributor_user_id)
                VALUES
                    (ST_GeogFromText('SRID=4326;POINT(121 14)'), 'UNSURE', :device,
                     'PENDING', :contributor)
                RETURNING report_id
                """
            ),
            {"device": uuid.uuid4(), "contributor": reporter_id},
        ).scalar_one()
        other_report_id = admin.execute(
            text(
                """
                INSERT INTO wims.citizen_reports
                    (location, category, device_id, status, contributor_user_id)
                VALUES
                    (ST_GeogFromText('SRID=4326;POINT(121 14)'), 'UNSURE', :device,
                     'PENDING', :contributor)
                RETURNING report_id
                """
            ),
            {"device": uuid.uuid4(), "contributor": other_reporter_id},
        ).scalar_one()
        admin.commit()

    state = {
        "admin_engine": admin_engine,
        "app_factory": app_factory,
        "admin_factory": admin_factory,
        "reporter_id": reporter_id,
        "other_reporter_id": other_reporter_id,
        "analyst_id": analyst_id,
        "anon_device": anon_device,
        "anon_report_id": anon_report_id,
        "registered_report_id": registered_report_id,
        "other_report_id": other_report_id,
        "photo_ids": [],
    }
    try:
        yield state
    finally:
        with admin_factory() as cleanup:
            for photo_id in state["photo_ids"]:
                cleanup.execute(
                    text("DELETE FROM wims.report_photos WHERE photo_id = :photo"),
                    {"photo": photo_id},
                )
            cleanup.execute(
                text(
                    "DELETE FROM wims.citizen_reports WHERE report_id IN (:anon, :registered, :other)"
                ),
                {
                    "anon": anon_report_id,
                    "registered": registered_report_id,
                    "other": other_report_id,
                },
            )
            cleanup.execute(
                text("DELETE FROM wims.users WHERE user_id IN (:reporter, :other, :analyst)"),
                {
                    "reporter": reporter_id,
                    "other": other_reporter_id,
                    "analyst": analyst_id,
                },
            )
            cleanup.commit()
        app_engine.dispose()
        admin_engine.dispose()


def _photo_values(photo_id, report_id, *, device=None, user=None):
    return {
        "photo": photo_id,
        "report": report_id,
        "user": user,
        "device": device,
        "media": "image/jpeg",
        "ext": "jpg",
        "path1": f"/app/storage/civilian-photos/{photo_id.hex}_original.bin",
        "path2": f"/app/storage/civilian-photos/{photo_id.hex}_sanitized.bin",
        "sha": "a" * 64,
        "iv": "test-iv",
        "blob": "encrypted-metadata",
    }


def _insert_sql():
    return text(
        """
        INSERT INTO wims.report_photos (
            photo_id, report_id, uploader_user_id, uploader_device_id,
            media_type, file_extension, image_width, image_height, file_size_bytes,
            original_storage_path, original_file_size_bytes, original_sha256,
            orig_encryption_iv, orig_key_version, orig_crypto_provider,
            sanitized_storage_path, sanitized_file_size_bytes, sanitized_sha256,
            sanitized_encryption_iv, sanitized_key_version, sanitized_crypto_provider,
            sensitive_metadata_blob_enc, metadata_encryption_iv, metadata_key_version,
            metadata_crypto_provider, exif_gps_status, browser_gps_status, gps_consensus
        ) VALUES (
            :photo, :report, :user, :device, :media, :ext, 8, 8, 10,
            :path1, 10, :sha, :iv, 1, 'env_aesgcm', :path2, 10, :sha,
            :iv, 1, 'env_aesgcm', :blob, :iv, 1, 'env_aesgcm',
            'unavailable', 'unavailable', 'unavailable'
        )
        """
    )


def _attempt_insert(factory, values, user_id=None):
    with factory() as db:
        db.begin()
        db.execute(text("SET LOCAL app.audit_source = 'app'"))
        if user_id is not None:
            db.execute(text("SET LOCAL wims.current_user_id = :uid"), {"uid": str(user_id)})
        db.execute(_insert_sql(), values)
        db.commit()


def test_photo_rls_anonymous_registered_staff_matrix(live_rls_context):
    state = live_rls_context
    factory = state["app_factory"]

    # No GUC: no photo rows visible and insert denied.
    with factory() as db:
        assert (
            db.execute(
                text(
                    "SELECT count(*) FROM wims.report_photos "
                    "WHERE report_id IN (:anon, :registered, :other)"
                ),
                {
                    "anon": state["anon_report_id"],
                    "registered": state["registered_report_id"],
                    "other": state["other_report_id"],
                },
            ).scalar_one()
            == 0
        )
        with pytest.raises(DBAPIError):
            db.execute(
                _insert_sql(),
                _photo_values(uuid.uuid4(), state["anon_report_id"], device=state["anon_device"]),
            )
        db.rollback()

    # Anonymous owned device succeeds; wrong device is denied.
    owned_photo = uuid.uuid4()
    _attempt_insert(
        factory,
        _photo_values(owned_photo, state["anon_report_id"], device=state["anon_device"]),
    )
    state["photo_ids"].append(str(owned_photo))
    with pytest.raises(DBAPIError):
        _attempt_insert(
            factory,
            _photo_values(uuid.uuid4(), state["anon_report_id"], device=uuid.uuid4()),
        )

    # Registered owner succeeds; wrong registered user is denied.
    registered_photo = uuid.uuid4()
    _attempt_insert(
        factory,
        _photo_values(registered_photo, state["registered_report_id"], user=state["reporter_id"]),
        state["reporter_id"],
    )
    state["photo_ids"].append(str(registered_photo))
    with pytest.raises(DBAPIError):
        _attempt_insert(
            factory,
            _photo_values(uuid.uuid4(), state["other_report_id"], user=state["reporter_id"]),
            state["reporter_id"],
        )

    # Staff can select; system task/admin can delete.  Analyst has SELECT only.
    with factory() as db:
        db.execute(text("SET LOCAL wims.current_user_id = :uid"), {"uid": str(state["analyst_id"])})
        assert (
            db.execute(
                text(
                    "SELECT count(*) FROM wims.report_photos "
                    "WHERE report_id IN (:anon, :registered, :other)"
                ),
                {
                    "anon": state["anon_report_id"],
                    "registered": state["registered_report_id"],
                    "other": state["other_report_id"],
                },
            ).scalar_one()
            >= 2
        )
        db.rollback()

    with factory() as db:
        db.execute(text("SET LOCAL wims.current_user_id = '00000000-0000-0000-0000-000000000002'"))
        db.execute(
            text("DELETE FROM wims.report_photos WHERE photo_id = :photo"),
            {"photo": str(owned_photo)},
        )
        db.commit()
    state["photo_ids"].remove(str(owned_photo))
