"""Route tests for Community Safety Hub (Slice F).

Uses FastAPI TestClient with dependency overrides that stub the service
functions (no live Postgres). Verifies:

- Public /api/community/hub and /api/community/{slug} return 200 with the
  expected shape and 404 for missing content.
- Admin routes require SYSTEM_ADMIN (403 for a non-admin override) and 200
  with a SYSTEM_ADMIN override.
- Publish returns 409 on the concurrency path.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import auth
from auth import get_db_with_rls, get_public_db_with_rls
from main import app
from services import community_content as svc

ADMIN_ID = "00000000-0000-0000-0000-000000000001"


@pytest.fixture(autouse=True)
def _reset_overrides():
    """Clear dependency overrides after every test so cases stay isolated."""
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def client():
    # Always override the DB dependencies so the routes never open a real
    # connection; the service functions are stubbed per-test via patch().
    def _fake_db():
        yield MagicMock()

    app.dependency_overrides[get_public_db_with_rls] = _fake_db
    app.dependency_overrides[get_db_with_rls] = _fake_db
    return TestClient(app)


def _set_auth(role: str | None):
    """Override get_current_wims_user to act as a given role (or anonymous)."""
    if role is None:
        # No token -> get_current_user raises 401 (unauthenticated).
        async def _anon():
            raise HTTPException(status_code=401, detail="missing token")

        app.dependency_overrides[auth.get_current_wims_user] = _anon
        return

    async def _user():
        return {"user_id": ADMIN_ID, "role": role, "username": "tester"}

    app.dependency_overrides[auth.get_current_wims_user] = _user


# ── Public reads ─────────────────────────────────────────────────────────────


def test_public_hub_returns_expected_shape(client: TestClient):
    item = {
        "content_id": "c1",
        "slug": "slug-1",
        "content_type": "ANNOUNCEMENT",
        "title": "Title",
        "body": "Body",
        "language": "en",
        "urgent_banner": False,
        "expires_at": None,
        "metadata_json": None,
        "last_reviewed_at": None,
        "updated_at": None,
    }
    with patch.object(svc, "list_published", return_value=[item]):
        r = client.get("/api/community/hub")
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body["items"], list)
    assert body["items"][0]["title"] == "Title"
    assert body["urgent_banner"] is None


def test_public_hub_rejects_invalid_content_type_filter(client: TestClient):
    response = client.get("/api/community/hub?type=INVALID")
    assert response.status_code == 422


def test_public_hub_surfaces_urgent_banner(client: TestClient):
    banner = {
        "content_id": "b1",
        "slug": "urgent",
        "content_type": "ANNOUNCEMENT",
        "title": "Urgent",
        "body": "Now",
        "language": "en",
        "urgent_banner": True,
        "expires_at": None,
        "metadata_json": None,
        "last_reviewed_at": None,
        "updated_at": None,
    }
    with patch.object(svc, "list_published", return_value=[banner]):
        r = client.get("/api/community/hub")
    assert r.status_code == 200
    assert r.json()["urgent_banner"]["content_id"] == "b1"


def test_public_detail_returns_200(client: TestClient):
    item = {
        "content_id": "c1",
        "slug": "slug-1",
        "content_type": "EVENT",
        "title": "T",
        "body": "B",
        "language": "en",
        "urgent_banner": False,
        "expires_at": None,
        "metadata_json": None,
        "last_reviewed_at": None,
        "updated_at": None,
    }
    with patch.object(svc, "get_by_slug", return_value=item):
        r = client.get("/api/community/slug-1")
    assert r.status_code == 200
    assert r.json()["item"]["slug"] == "slug-1"


def test_public_detail_404_when_missing(client: TestClient):
    with patch.object(svc, "get_by_slug", return_value=None):
        r = client.get("/api/community/does-not-exist")
    assert r.status_code == 404


# ── A10: language filtering + expired/unpublished exclusion ─────────────────


@pytest.mark.unit
def test_public_hub_language_uk_filter_passed_to_service(client: TestClient):
    """?language=uk must route to list_published and return uk-labelled items."""
    item_uk = {
        "content_id": "c_uk",
        "slug": "slug-uk",
        "content_type": "ANNOUNCEMENT",
        "title": "UK Title",
        "body": "UK Body",
        "language": "uk",
        "urgent_banner": False,
        "expires_at": None,
        "metadata_json": None,
        "last_reviewed_at": None,
        "updated_at": None,
    }
    with patch.object(svc, "list_published", return_value=[item_uk]) as mock_list:
        r = client.get("/api/community/hub?language=uk")
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body["items"], list)
    assert body["items"][0]["language"] == "uk"
    # The route forwarded language=uk to the service layer.
    assert mock_list.call_args.kwargs.get("language") == "uk"


@pytest.mark.unit
def test_public_hub_invalid_language_returns_422(client: TestClient):
    """language outside the ^(en|uk)$ pattern must be rejected with 422."""
    r = client.get("/api/community/hub?language=fr")
    assert r.status_code == 422


@pytest.mark.unit
def test_expired_or_unpublished_item_is_omitted_or_404(client: TestClient):
    """When the service returns no published/non-expired item, the detail route
    returns 404 and the hub route omits it (stub service return)."""
    # Detail route: service returns None -> 404 (expired/unpublished).
    with patch.object(svc, "get_by_slug", return_value=None):
        r = client.get("/api/community/expired-slug")
    assert r.status_code == 404

    # Hub route: service returns empty list -> no items surfaced.
    with patch.object(svc, "list_published", return_value=[]):
        r = client.get("/api/community/hub")
    assert r.status_code == 200
    assert r.json()["items"] == []


# ── Admin writes ──────────────────────────────────────────────────────────────


def test_admin_list_requires_system_admin_and_returns_latest_fields(client: TestClient):
    _set_auth("REGIONAL_ENCODER")
    assert client.get("/api/admin/community").status_code == 403

    _set_auth("SYSTEM_ADMIN")
    item = {
        "content_id": "c1",
        "slug": "draft-1",
        "content_type": "ANNOUNCEMENT",
        "lifecycle_status": "DRAFT",
        "title_en": "Title",
        "title_uk": None,
        "body_en": "Body",
        "body_uk": None,
        "metadata_json": None,
        "expires_at": None,
        "urgent_banner": False,
        "last_reviewed_at": None,
        "row_version": 2,
    }
    with patch.object(svc, "list_admin_content", return_value=[item]):
        response = client.get("/api/admin/community")
    assert response.status_code == 200
    assert response.json()[0]["lifecycle_status"] == "DRAFT"
    assert response.json()[0]["row_version"] == 2


def test_admin_create_requires_system_admin_403_for_encoder(client: TestClient):
    _set_auth("REGIONAL_ENCODER")
    r = client.post(
        "/api/admin/community",
        json={"content_type": "ANNOUNCEMENT", "title_en": "T", "body_en": "B"},
    )
    assert r.status_code == 403


def test_admin_create_returns_201_for_system_admin(client: TestClient):
    _set_auth("SYSTEM_ADMIN")
    with patch.object(svc, "create_draft", return_value="cid-123"):
        r = client.post(
            "/api/admin/community",
            json={"content_type": "ANNOUNCEMENT", "title_en": "T", "body_en": "B"},
        )
    assert r.status_code == 201
    assert r.json()["content_id"] == "cid-123"


def test_admin_update_passes_explicit_nullable_clears(client: TestClient):
    _set_auth("SYSTEM_ADMIN")
    with patch.object(
        svc,
        "update_draft",
        return_value={"content_id": "cid-123", "lifecycle_status": "DRAFT"},
    ) as update:
        response = client.patch(
            "/api/admin/community/cid-123",
            json={"expires_at": None, "last_reviewed_at": None},
        )
    assert response.status_code == 200
    assert update.call_args.kwargs["expires_at"] is None
    assert update.call_args.kwargs["last_reviewed_at"] is None
    assert {"expires_at", "last_reviewed_at"} <= update.call_args.kwargs["provided_fields"]


def test_admin_publish_returns_200_for_system_admin(client: TestClient):
    _set_auth("SYSTEM_ADMIN")
    with patch.object(
        svc,
        "publish",
        return_value={
            "content_id": "cid-123",
            "version_id": "v1",
            "version_number": 1,
            "lifecycle_status": "PUBLISHED",
        },
    ):
        r = client.post(
            "/api/admin/community/cid-123/publish",
            json={"title_en": "T", "body_en": "B"},
        )
    assert r.status_code == 200
    assert r.json()["lifecycle_status"] == "PUBLISHED"


def test_admin_publish_returns_409_on_concurrency_conflict(client: TestClient):
    _set_auth("SYSTEM_ADMIN")

    def _raise_409(*args, **kwargs):
        raise HTTPException(status_code=409, detail="concurrent edit")

    with patch.object(svc, "publish", side_effect=_raise_409):
        r = client.post(
            "/api/admin/community/cid-123/publish",
            json={"title_en": "T", "body_en": "B"},
        )
    assert r.status_code == 409


def test_admin_archive_returns_200_for_system_admin(client: TestClient):
    _set_auth("SYSTEM_ADMIN")
    with patch.object(
        svc, "archive", return_value={"content_id": "cid-123", "lifecycle_status": "ARCHIVED"}
    ):
        r = client.post("/api/admin/community/cid-123/archive")
    assert r.status_code == 200
    assert r.json()["lifecycle_status"] == "ARCHIVED"
