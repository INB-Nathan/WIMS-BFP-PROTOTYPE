"""Unit coverage for anonymous capability tracking of any contributor ownership."""

from datetime import datetime, timezone
import hashlib
import os
import secrets
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from api.routes import civilian
from auth import get_public_db_with_rls
from main import app


@pytest.fixture(autouse=True)
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def projection() -> dict:
    return {
        "report_id": 571,
        "category": "STRUCTURAL",
        "sub_category": None,
        "safety_status": "I_AM_SAFE",
        "status": "PENDING",
        "created_at": datetime(2026, 7, 19, tzinfo=timezone.utc),
        "routing_distance_m": None,
        "routing_duration_s": None,
        "routing_data_source": None,
        "routing_geometry": None,
        "nearest_station_name": "BFP Central",
        "nearest_station_phone": "123",
        "photo_count": 0,
    }


def _override_public_db(db):
    def _fake_db():
        yield db

    app.dependency_overrides[get_public_db_with_rls] = _fake_db


@pytest.mark.parametrize("ownership", ["anonymous", "registered contributor"])
def test_valid_capability_returns_safe_projection_anonymously(
    client: TestClient, monkeypatch, projection: dict, ownership: str
):
    db = MagicMock()
    _override_public_db(db)
    helper = MagicMock(return_value=projection)
    monkeypatch.setattr(civilian, "get_capability_tracking_projection", helper)
    monkeypatch.setattr(civilian, "get_public_status_updates", lambda _db, _rid: [])

    response = client.get("/api/civilian/reports/571/track/valid-token")

    assert response.status_code == 200, ownership
    assert helper.call_args.args[:2] == (db, 571)
    assert response.json()["report_id"] == 571
    assert (
        not {
            "latitude",
            "longitude",
            "witness_name",
            "witness_phone",
            "contributor_user_id",
            "description",
        }
        & response.json().keys()
    )


@pytest.mark.parametrize("reason", ["wrong report pairing", "revoked", "expired"])
def test_invalid_capability_variants_remain_neutral_404(
    client: TestClient, monkeypatch, reason: str
):
    _override_public_db(MagicMock())
    monkeypatch.setattr(civilian, "get_capability_tracking_projection", lambda *_args: None)

    response = client.get("/api/civilian/reports/571/track/invalid-token")

    assert response.status_code == 404, reason
    assert response.json() == {"detail": "Report not found"}


@pytest.fixture(scope="module")
def disposable_tracking_engines():
    """Use only an explicitly designated disposable PostGIS database."""
    if os.environ.get("WIMS_DISPOSABLE_TEST_DATABASE") != "1":
        pytest.skip("set WIMS_DISPOSABLE_TEST_DATABASE=1 for the disposable PostGIS suite")
    admin_url = os.environ.get("DATABASE_ADMIN_URL")
    app_url = os.environ.get("DATABASE_URL")
    if not admin_url or not app_url:
        pytest.skip("DATABASE_ADMIN_URL and DATABASE_URL must target the disposable database")
    admin_engine, app_engine = create_engine(admin_url), create_engine(app_url)
    try:
        with admin_engine.connect() as connection:
            connection.execute(text("SELECT postgis_version()"))
        with app_engine.connect() as connection:
            assert connection.execute(text("SELECT current_user")).scalar() == "wims_app_user"
    except Exception as exc:
        admin_engine.dispose()
        app_engine.dispose()
        pytest.skip(f"disposable PostGIS database unavailable: {exc}")
    yield admin_engine, app_engine
    admin_engine.dispose()
    app_engine.dispose()


def _seed_tracking_capabilities(admin_engine):
    """Seed generated capabilities only; no PII or token literals are persisted in test code."""
    nonce = os.urandom(8).hex()
    tokens = {
        name: secrets.token_urlsafe(32)
        for name in ("contributor", "anonymous", "revoked", "expired")
    }
    with admin_engine.begin() as connection:
        contributor_id = connection.execute(
            text(
                "INSERT INTO wims.users (keycloak_id, username, role) VALUES "
                "(gen_random_uuid(), :username, 'CIVILIAN_REPORTER') RETURNING user_id"
            ),
            {"username": f"task1_tracking_{nonce}"},
        ).scalar_one()

        def insert_report(contributor_id=None):
            return connection.execute(
                text(
                    "INSERT INTO wims.citizen_reports "
                    "(location, category, reporting_context, safety_status, contributor_user_id) VALUES "
                    "(ST_GeogFromText('SRID=4326;POINT(121 14)'), 'STRUCTURAL', 'WITNESS', "
                    "'I_AM_SAFE', :contributor_id) RETURNING report_id"
                ),
                {"contributor_id": contributor_id},
            ).scalar_one()

        report_ids = {
            "contributor": insert_report(contributor_id),
            "anonymous": insert_report(),
            "revoked": insert_report(),
            "expired": insert_report(),
        }
        for name, token in tokens.items():
            connection.execute(
                text(
                    "INSERT INTO wims.report_tracking_tokens "
                    "(report_id, token_hash, token_type, revoked_at, expires_at) VALUES "
                    "(:report_id, :token_hash, 'public', :revoked_at, :expires_at)"
                ),
                {
                    "report_id": report_ids[name],
                    "token_hash": hashlib.sha256(token.encode("utf-8")).hexdigest(),
                    "revoked_at": "2030-01-01T00:00:00+00:00" if name == "revoked" else None,
                    "expires_at": "2000-01-01T00:00:00+00:00" if name == "expired" else None,
                },
            )
    return report_ids, tokens


@pytest.mark.integration
def test_anonymous_capability_projection_enforces_acl_rls_and_neutral_failures(
    disposable_tracking_engines,
):
    """Exercise the SECURITY DEFINER projection via the anonymous HTTP dependency."""
    admin_engine, app_engine = disposable_tracking_engines
    report_ids, tokens = _seed_tracking_capabilities(admin_engine)

    with admin_engine.connect() as connection:
        acl = connection.execute(
            text(
                "SELECT p.prosecdef, has_function_privilege('public', p.oid, 'EXECUTE'), "
                "has_function_privilege('wims_app', p.oid, 'EXECUTE') "
                "FROM pg_proc p WHERE p.oid = "
                "'wims.get_capability_tracking_projection(integer, text)'::regprocedure"
            )
        ).one()
    assert acl == (True, False, True)

    with app_engine.connect() as connection:
        assert (
            connection.execute(
                text("SELECT count(*) FROM wims.citizen_reports WHERE report_id = :report_id"),
                {"report_id": report_ids["contributor"]},
            ).scalar_one()
            == 0
        )

    session_factory = sessionmaker(bind=app_engine)

    def public_db():
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_public_db_with_rls] = public_db
    with TestClient(app) as live_client:
        for ownership in ("contributor", "anonymous"):
            response = live_client.get(
                f"/api/civilian/reports/{report_ids[ownership]}/track/{tokens[ownership]}"
            )
            assert response.status_code == 200, response.text
            assert response.json()["report_id"] == report_ids[ownership]

        invalid_requests = (
            (report_ids["anonymous"], tokens["contributor"]),
            (report_ids["revoked"], tokens["revoked"]),
            (report_ids["expired"], tokens["expired"]),
            (report_ids["anonymous"], "malformed"),
        )
        for report_id, token in invalid_requests:
            response = live_client.get(f"/api/civilian/reports/{report_id}/track/{token}")
            assert response.status_code == 404
            assert response.json() == {"detail": "Report not found"}
