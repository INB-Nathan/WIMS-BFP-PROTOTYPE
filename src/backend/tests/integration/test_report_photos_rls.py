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

    with app_factory() as app:
        role_row = app.execute(
            text("SELECT usesuper FROM pg_user WHERE usename = current_user")
        ).scalar()
        if role_row:
            pytest.skip("live RLS test requires a non-superuser app connection")

    with admin_factory() as admin:
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
        "anonymous_session_ids": [],
    }
    try:
        yield state
    finally:
        # Best-effort cleanup so a failed assertion cannot leave rows that
        # break later deletions or contaminate the disposable database.
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
            for session_id in state["anonymous_session_ids"]:
                cleanup.execute(
                    text(
                        "DELETE FROM wims.anonymous_sessions "
                        "WHERE anonymous_session_id = :session_id"
                    ),
                    {"session_id": session_id},
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
        # pending rows (report_id IS NULL) keep attached_at NULL;
        # attached rows get a timestamp to satisfy the CHECK constraint.
        "attached_at": None if report_id is None else "2026-07-13T00:00:00+00:00",
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
            metadata_crypto_provider, exif_gps_status, browser_gps_status, gps_consensus,
            attached_at
        ) VALUES (
            :photo, :report, :user, :device, :media, :ext, 8, 8, 10,
            :path1, 10, :sha, :iv, 1, 'env_aesgcm', :path2, 10, :sha,
            :iv, 1, 'env_aesgcm', :blob, :iv, 1, 'env_aesgcm',
            'unavailable', 'unavailable', 'unavailable', :attached_at
        )
        """
    )


def _anonymous_helper_sql():
    return text(
        """
        SELECT photo_id, duplicate, cap_reached
        FROM wims.insert_anonymous_pending_photo(
            :raw, :photo, :client, :media, :ext, :width, :height, :size,
            :path1, :original_size, :sha, :iv, :key_version, :provider, :kms,
            :path2, :sanitized_size, :sha, :iv, :key_version, :provider, :kms,
            :blob, :iv, :key_version, :provider, :kms,
            :exif_status, :browser_status, :consensus, :exif_source
        )
        """
    )


def _anonymous_helper_values(photo_id, raw_token, client_photo_id=None):
    return {
        "raw": raw_token,
        "photo": photo_id,
        "client": client_photo_id,
        "media": "image/jpeg",
        "ext": "jpg",
        "width": 8,
        "height": 8,
        "size": 10,
        "path1": f"/app/storage/civilian-photos/{photo_id.hex}_original.bin",
        "original_size": 10,
        "sha": "a" * 64,
        "iv": "test-iv",
        "key_version": 1,
        "provider": "env_aesgcm",
        "kms": "test",
        "path2": f"/app/storage/civilian-photos/{photo_id.hex}_sanitized.bin",
        "sanitized_size": 10,
        "blob": "encrypted-metadata",
        "exif_status": "unavailable",
        "browser_status": "unavailable",
        "consensus": "unavailable",
        "exif_source": None,
    }


def _attempt_anonymous_helper(factory, raw_token, photo_id, client_photo_id=None):
    with factory() as db:
        row = db.execute(
            _anonymous_helper_sql(),
            _anonymous_helper_values(photo_id, raw_token, client_photo_id),
        ).fetchone()
        if row is None:
            db.rollback()
        else:
            db.commit()
        return row


def _attempt_insert(factory, values, user_id=None):
    with factory() as db:
        db.begin()
        db.execute(text("SET LOCAL app.audit_source = 'app'"))
        if user_id is not None:
            db.execute(text("SET LOCAL wims.current_user_id = :uid"), {"uid": str(user_id)})
        db.execute(_insert_sql(), values)
        db.commit()


def test_anonymous_pending_helper_binds_owner_cap_and_idempotency(live_rls_context):
    state = live_rls_context
    admin_factory = state["admin_factory"]
    app_factory = state["app_factory"]

    with admin_factory() as admin:
        sessions = []
        for _ in range(3):
            session_id, raw_token = admin.execute(
                text(
                    "SELECT anonymous_session_id, raw_token FROM wims.issue_anonymous_session(NULL)"
                )
            ).one()
            sessions.append((session_id, raw_token))
            state["anonymous_session_ids"].append(session_id)
        admin.execute(
            text(
                "UPDATE wims.anonymous_sessions "
                "SET expires_at = clock_timestamp() - interval '1 minute' "
                "WHERE anonymous_session_id = :session_id"
            ),
            {"session_id": sessions[2][0]},
        )
        admin.commit()

    first_photo = uuid.uuid4()
    client_photo = uuid.uuid4()
    inserted = _attempt_anonymous_helper(
        app_factory,
        sessions[0][1],
        first_photo,
        client_photo,
    )
    assert inserted is not None
    assert inserted[0] == first_photo
    assert inserted[1:] == (False, False)
    state["photo_ids"].append(str(first_photo))

    with admin_factory() as admin:
        row = admin.execute(
            text(
                "SELECT report_id, attached_at, uploader_user_id, uploader_device_id, "
                "anonymous_session_id FROM wims.report_photos WHERE photo_id = :photo"
            ),
            {"photo": first_photo},
        ).one()
        assert row.report_id is None
        assert row.attached_at is None
        assert row.uploader_user_id is None
        assert row.uploader_device_id is None
        assert row.anonymous_session_id == sessions[0][0]
        assert admin.execute(
            text(
                "SELECT c.relforcerowsecurity FROM pg_class c "
                "JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE n.nspname = 'wims' AND c.relname = 'report_photos'"
            )
        ).scalar_one()

    duplicate = _attempt_anonymous_helper(
        app_factory,
        sessions[0][1],
        uuid.uuid4(),
        client_photo,
    )
    assert duplicate is not None
    assert tuple(duplicate) == (None, True, False)

    capped = _attempt_anonymous_helper(
        app_factory,
        sessions[0][1],
        uuid.uuid4(),
        uuid.uuid4(),
    )
    assert capped is not None
    assert tuple(capped) == (None, False, True)

    foreign_client_id = _attempt_anonymous_helper(
        app_factory,
        sessions[1][1],
        uuid.uuid4(),
        client_photo,
    )
    assert foreign_client_id is None

    revoked = _attempt_anonymous_helper(
        app_factory,
        sessions[1][1],
        uuid.uuid4(),
        uuid.uuid4(),
    )
    assert revoked is not None
    state["photo_ids"].append(str(revoked[0]))
    with admin_factory() as admin:
        admin.execute(
            text("SELECT wims.revoke_anonymous_session(:raw)"),
            {"raw": sessions[1][1]},
        )
        admin.commit()
    revoked_retry = _attempt_anonymous_helper(
        app_factory,
        sessions[1][1],
        uuid.uuid4(),
        uuid.uuid4(),
    )
    assert revoked_retry is None

    expired = _attempt_anonymous_helper(
        app_factory,
        sessions[2][1],
        uuid.uuid4(),
        uuid.uuid4(),
    )
    assert expired is None


def test_photo_rls_anonymous_registered_staff_matrix(live_rls_context):
    state = live_rls_context
    factory = state["app_factory"]

    # No GUC: no photo rows visible, but anonymous owned device insert succeeds.
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
        # Anonymous owned device insert succeeds via RLS anonymous path
        no_guc_photo = uuid.uuid4()
        db.execute(
            _insert_sql(),
            _photo_values(no_guc_photo, state["anon_report_id"], device=state["anon_device"]),
        )
        db.commit()
    state["photo_ids"].append(str(no_guc_photo))

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


def test_anonymous_attach_binds_owner_and_rejects_cross_owner(live_rls_context):
    state = live_rls_context
    admin_factory = state["admin_factory"]
    app_factory = state["app_factory"]

    with admin_factory() as admin:
        sessions = []
        for _ in range(2):
            session_id, raw_token = admin.execute(
                text(
                    "SELECT anonymous_session_id, raw_token FROM wims.issue_anonymous_session(NULL)"
                )
            ).one()
            sessions.append((session_id, raw_token))
            state["anonymous_session_ids"].append(session_id)
        admin.commit()

    session_a_id, session_a_raw = sessions[0]
    session_b_id, session_b_raw = sessions[1]

    # One pending photo owned by session A.
    photo_id = uuid.uuid4()
    inserted = _attempt_anonymous_helper(
        app_factory,
        session_a_raw,
        photo_id,
        uuid.uuid4(),
    )
    assert inserted is not None
    assert inserted[0] == photo_id
    state["photo_ids"].append(str(photo_id))

    # A second pending photo owned by session B, used for the cross-owner and
    # duplicate-array rejection checks (must stay unattached until those steps).
    photo_b = uuid.uuid4()
    inserted_b = _attempt_anonymous_helper(
        app_factory,
        session_b_raw,
        photo_b,
        uuid.uuid4(),
    )
    assert inserted_b is not None
    assert inserted_b[0] == photo_b
    state["photo_ids"].append(str(photo_b))

    # One citizen report bound to each session (mirrors the report route INSERT).
    with admin_factory() as admin:
        report_a_id = admin.execute(
            text(
                """
                INSERT INTO wims.citizen_reports
                    (location, category, device_id, status, anonymous_session_id)
                VALUES
                    (ST_GeogFromText('SRID=4326;POINT(121 14)'), 'UNSURE', :device,
                     'PENDING', :session)
                RETURNING report_id
                """
            ),
            {"device": uuid.uuid4(), "session": session_a_id},
        ).scalar_one()
        report_b_id = admin.execute(
            text(
                """
                INSERT INTO wims.citizen_reports
                    (location, category, device_id, status, anonymous_session_id)
                VALUES
                    (ST_GeogFromText('SRID=4326;POINT(121 14)'), 'UNSURE', :device,
                     'PENDING', :session)
                RETURNING report_id
                """
            ),
            {"device": uuid.uuid4(), "session": session_b_id},
        ).scalar_one()
        admin.commit()

    try:
        # 1. Same-owner attach returns TRUE and binds the photo.
        with app_factory() as db:
            result = db.execute(
                text("SELECT wims.attach_anonymous_photos(:raw, :report, ARRAY[:photo]::uuid[])"),
                {"raw": session_a_raw, "report": report_a_id, "photo": photo_id},
            ).scalar_one()
            assert result is True
            db.commit()

        with admin_factory() as admin:
            row = admin.execute(
                text(
                    "SELECT report_id, attached_at FROM wims.report_photos WHERE photo_id = :photo"
                ),
                {"photo": photo_id},
            ).one()
            assert row.report_id == report_a_id
            assert row.attached_at is not None

        # 2. Cross-owner attach returns FALSE: a session-B photo cannot attach
        #    to a report bound to session A using session A's token.
        with app_factory() as db:
            result = db.execute(
                text("SELECT wims.attach_anonymous_photos(:raw, :report, ARRAY[:photo]::uuid[])"),
                {"raw": session_a_raw, "report": report_a_id, "photo": photo_b},
            ).scalar_one()
            assert result is False
            db.rollback()

        # 3. Re-attaching an already-attached photo returns FALSE.
        with app_factory() as db:
            result = db.execute(
                text("SELECT wims.attach_anonymous_photos(:raw, :report, ARRAY[:photo]::uuid[])"),
                {"raw": session_a_raw, "report": report_a_id, "photo": photo_id},
            ).scalar_one()
            assert result is False
            db.rollback()

        # 4. A duplicate photo_id in the array returns FALSE (fresh pending
        #    photo, session B, under session B's token/report).
        with app_factory() as db:
            result = db.execute(
                text(
                    "SELECT wims.attach_anonymous_photos("
                    ":raw, :report, ARRAY[:photo, :photo]::uuid[])"
                ),
                {"raw": session_b_raw, "report": report_b_id, "photo": photo_b},
            ).scalar_one()
            assert result is False
            db.rollback()
    finally:
        # Best-effort removal: photos first (they may reference reports),
        # then reports, so the fixture's anonymous-session cleanup does not
        # hit a FK reference.
        with admin_factory() as admin:
            admin.execute(
                text(
                    "DELETE FROM wims.report_photos "
                    "WHERE photo_id IN (:a, :b)"
                ),
                {"a": photo_id, "b": photo_b},
            )
            admin.execute(
                text("DELETE FROM wims.citizen_reports WHERE report_id IN (:a, :b)"),
                {"a": report_a_id, "b": report_b_id},
            )
            admin.commit()


def test_registered_attach_binds_owner_and_rejects_cross_owner(live_rls_context):
    """Mirror of test_anonymous_attach_binds_owner_and_rejects_cross_owner for
    the registered CIVILIAN_REPORTER path (Slice D).

    Same-owner TRUE + bind; cross-owner FALSE; partial set FALSE; duplicate-in-
    array FALSE; already-attached FALSE; wrong-owner report FALSE; terminal
    report FALSE. All checks run against the live wims_app_user RLS context and
    are skipped without RUN_CIVILIAN_PHOTO_RLS_TESTS=1 + non-superuser creds.
    """
    state = live_rls_context
    admin_factory = state["admin_factory"]
    app_factory = state["app_factory"]
    reporter_id = state["reporter_id"]
    other_reporter_id = state["other_reporter_id"]

    # Pending photos (report_id NULL) owned by the reporter or by a different
    # reporter. Inserted through the normal RLS-scoped path.
    photo_a = uuid.uuid4()  # same-owner success + already-attached check
    photo_b = uuid.uuid4()  # cross-owner (owned by other_reporter)
    photo_c = uuid.uuid4()  # second reporter-owned photo for partial/dup/terminal
    _attempt_insert(
        app_factory,
        _photo_values(photo_a, None, user=reporter_id),
        reporter_id,
    )
    _attempt_insert(
        app_factory,
        _photo_values(photo_b, None, user=other_reporter_id),
        other_reporter_id,
    )
    _attempt_insert(
        app_factory,
        _photo_values(photo_c, None, user=reporter_id),
        reporter_id,
    )
    state["photo_ids"].extend(str(p) for p in (photo_a, photo_b, photo_c))

    # Wrong-owner report: the fixture's anonymous report has contributor_user_id
    # NULL, so it can never be owned by the reporter. Also create a terminal
    # report owned by the reporter for the terminal-status check.
    with admin_factory() as admin:
        anon_report_id = state["anon_report_id"]
        terminal_report_id = admin.execute(
            text(
                """
                INSERT INTO wims.citizen_reports
                    (location, category, device_id, status,
                     contributor_user_id, validated_by)
                VALUES
                    (ST_GeogFromText('SRID=4326;POINT(121 14)'), 'UNSURE', :device,
                     'ACTIONED', :contributor, :validator)
                RETURNING report_id
                """
            ),
            {"device": uuid.uuid4(), "contributor": reporter_id, "validator": state["analyst_id"]},
        ).scalar_one()
        admin.commit()

    def _attempt(uid, report_id, photo_id, photo_id2=None):
        with app_factory() as db:
            if photo_id2 is None:
                result = db.execute(
                    text(
                        "SELECT wims.attach_registered_photos(:uid, :report, ARRAY[:photo]::uuid[])"
                    ),
                    {"uid": uid, "report": report_id, "photo": photo_id},
                ).scalar_one()
            else:
                result = db.execute(
                    text(
                        "SELECT wims.attach_registered_photos(:uid, :report, ARRAY[:a, :b]::uuid[])"
                    ),
                    {"uid": uid, "report": report_id, "a": photo_id, "b": photo_id2},
                ).scalar_one()
            db.commit()
            return result

    try:
        # 1. Same-owner attach returns TRUE and binds the photo.
        assert _attempt(reporter_id, state["registered_report_id"], photo_a) is True
        with admin_factory() as admin:
            row = admin.execute(
                text(
                    "SELECT report_id, attached_at FROM wims.report_photos WHERE photo_id = :photo"
                ),
                {"photo": photo_a},
            ).one()
            assert row.report_id == state["registered_report_id"]
            assert row.attached_at is not None
            admin.rollback()

        # 2. Cross-owner attach returns FALSE: a photo owned by a different
        #    reporter cannot attach to this reporter's report.
        assert _attempt(reporter_id, state["registered_report_id"], photo_b) is False

        # 3. Partial set returns FALSE: one valid reporter photo plus one owned
        #    by a different reporter in the same array.
        assert _attempt(reporter_id, state["registered_report_id"], photo_a, photo_b) is False

        # 4. Duplicate photo_id in the array returns FALSE.
        assert _attempt(reporter_id, state["registered_report_id"], photo_c, photo_c) is False

        # 5. Re-attaching an already-attached photo returns FALSE.
        assert _attempt(reporter_id, state["registered_report_id"], photo_a) is False

        # 6. Wrong-owner report returns FALSE: report contributor_user_id (NULL)
        #    is distinct from the reporter identity.
        assert _attempt(reporter_id, anon_report_id, photo_c) is False

        # 7. Terminal report returns FALSE: the report is ACTIONED.
        assert _attempt(reporter_id, terminal_report_id, photo_c) is False
    finally:
        # Best-effort removal of the terminal report so the fixture's photo
        # cleanup does not hit a FK reference.
        with admin_factory() as admin:
            admin.execute(
                text("DELETE FROM wims.citizen_reports WHERE report_id = :rid"),
                {"rid": terminal_report_id},
            )
            admin.commit()
