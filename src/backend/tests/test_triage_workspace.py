"""Tests for validator-only evidence workspace and contact reveal."""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from api.routes import triage
from services.civilian_triage.contact_reveal import reveal_reporter_contact
from services.civilian_triage.workspace_projection import get_workspace
from services.report_photo_read import SanitizedPhotoContent


NOW = datetime.now(timezone.utc)
PHOTO_ID = "12345678-1234-4234-8234-123456789abc"


class _Result:
    def __init__(self, *, one=None, many=None):
        self._one = one
        self._many = many or []

    def fetchone(self):
        return self._one

    def fetchall(self):
        return self._many


def _request() -> Request:
    request = Request({"type": "http", "method": "POST", "path": "/", "headers": []})
    request.state.correlation_id = "corr-1"
    return request


def _workspace_db() -> MagicMock:
    cluster = SimpleNamespace(
        cluster_id=7,
        anchor_report_id=42,
        status="CLUSTER_UNDER_REVIEW",
        status_note=None,
        assigned_to="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        assigned_username="validator",
        review_started_at=NOW,
        updated_at=NOW,
    )
    report = SimpleNamespace(
        report_id=42,
        category="STRUCTURAL",
        sub_category="House fire",
        reporting_context="WITNESS",
        safety_status="I_AM_SAFE",
        status="UNDER_REVIEW",
        status_explanation=None,
        description="Smoke visible",
        trust_score=70,
        created_at=NOW,
        reported_at=NOW,
        previous_report_id=None,
        contributor_user_id="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        report_lat=14.6,
        report_lon=121.0,
        phone_latitude=14.601,
        phone_longitude=121.001,
        device_to_report_m=150.0,
        ip_lat=14.55,
        ip_lon=121.05,
        ip_geo_accuracy_m=20_000,
        ip_to_report_m=7_000.0,
    )
    photo = SimpleNamespace(
        photo_id=PHOTO_ID,
        report_id=42,
        media_type="image/jpeg",
        image_width=800,
        image_height=600,
        exif_datetime_original=NOW,
        exif_gps_status="present",
        gps_consensus="both_match",
        exif_data_source="server_extracted",
        exif_to_report_distance_m=25.0,
        exif_gps_lat=14.6001,
        exif_gps_lon=121.0001,
        device_to_exif_m=140.0,
    )
    followup = SimpleNamespace(
        followup_id=1,
        report_id=42,
        followup_text="Fire is spreading",
        created_at=NOW,
    )
    update = SimpleNamespace(
        update_id=2,
        report_id=42,
        stage="UNDER_REVIEW",
        metadata={"message": "Review started"},
        created_at=NOW,
    )
    db = MagicMock()
    db.execute.side_effect = [
        _Result(one=cluster),
        _Result(many=[report]),
        _Result(many=[photo]),
        _Result(many=[followup]),
        _Result(many=[update]),
    ]
    return db


def test_workspace_projection_contains_safe_evidence_and_server_distances() -> None:
    db = _workspace_db()
    contributor = {
        "trust_score": 80,
        "badge": "GUARDIAN",
        "total_reports": 9,
        "actioned_reports": 6,
        "pending_reports": 1,
        "evidence_quality": 0.8,
        "active_months": 5,
    }
    with (
        patch(
            "services.civilian_triage.workspace_projection.get_contributor_profile",
            return_value=contributor,
        ),
        patch(
            "services.civilian_triage.workspace_projection.get_cluster_activity_command",
            return_value=SimpleNamespace(events=[]),
        ),
    ):
        workspace = get_workspace(db, 7)

    payload = workspace.model_dump(mode="json")
    report = payload["reports"][0]
    assert report["report_location"]["available"] is True
    assert report["device_location"]["distance_to_report_m"] == 150.0
    assert report["ip_location"]["approximate"] is True
    assert report["ip_location"]["accuracy_m"] == 20_000.0
    assert report["photos"][0]["content_url"].endswith(f"/{PHOTO_ID}/content")
    assert report["photos"][0]["device_to_exif_distance_m"] == 140.0
    serialized = str(payload)
    for forbidden in (
        "device_id",
        "ip_hash",
        "original_storage_path",
        "sanitized_storage_path",
        "reporter_pii_blob_enc",
        "encryption_iv",
        "kms_key",
        "reporter_phone",
    ):
        assert forbidden not in serialized

    statements = [" ".join(str(call.args[0]).split()) for call in db.execute.call_args_list]
    assert any(
        "ST_Distance" in statement and "ip_geo_centroid" in statement for statement in statements
    )
    assert any(
        "device_to_exif_m" in statement and "ST_Distance" in statement for statement in statements
    )


def test_workspace_missing_cluster_is_neutral_404() -> None:
    db = MagicMock()
    db.execute.return_value = _Result(one=None)
    with pytest.raises(HTTPException) as exc:
        get_workspace(db, 999)
    assert exc.value.status_code == 404


def test_photo_content_route_sets_non_cacheable_safe_headers() -> None:
    photo = SanitizedPhotoContent(
        content=b"\xff\xd8\xffsafe",
        media_type="image/jpeg",
        image_width=20,
        image_height=10,
    )
    with patch("api.routes.triage.get_sanitized_photo_bytes", return_value=photo):
        response = triage.get_report_photo_content(42, PHOTO_ID, {}, MagicMock())

    assert response.body == photo.content
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["pragma"] == "no-cache"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert "civilian-evidence-" in response.headers["content-disposition"]


def test_evidence_routes_reject_non_national_roles_and_no_original_route_exists() -> None:
    with pytest.raises(HTTPException) as exc:
        triage._require_national_evidence_actor({"role": "REGIONAL_ENCODER"})
    assert exc.value.status_code == 403

    paths = {route.path for route in triage.router.routes}
    assert "/api/triage/clusters/{cluster_id}/workspace" in paths
    assert "/api/triage/reports/{report_id}/photos/{photo_id}/content" in paths
    assert all("original" not in path for path in paths)


def test_contact_reveal_audits_without_raw_request_data_before_return() -> None:
    db = MagicMock()
    db.execute.return_value = _Result(
        one=SimpleNamespace(
            report_id=42,
            reporter_pii_blob_enc="ciphertext",
            reporter_encryption_iv="nonce",
            reporter_crypto_provider="env_aesgcm",
            reporter_key_version=1,
            reporter_kms_key_name=None,
        )
    )
    provider = MagicMock()
    provider.decrypt_json.return_value = {
        "reporter_name": "Ana Reporter",
        "reporter_phone": "09171234567",
    }
    user = {"user_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}

    with (
        patch(
            "services.civilian_triage.contact_reveal.get_crypto_provider",
            return_value=provider,
        ),
        patch("services.civilian_triage.contact_reveal.log_system_audit") as audit,
    ):
        result = reveal_reporter_contact(db, 42, user, _request())

    assert result.reporter_phone == "09171234567"
    audit.assert_called_once()
    kwargs = audit.call_args.kwargs
    assert kwargs["request"] is None
    assert kwargs["sensitive"] is True
    assert kwargs["new_values"] == {"report_id": 42, "outcome": "revealed"}
    db.commit.assert_called_once()


def test_contact_reveal_audit_failure_returns_no_contact() -> None:
    db = MagicMock()
    db.execute.return_value = _Result(
        one=SimpleNamespace(
            report_id=42,
            reporter_pii_blob_enc="ciphertext",
            reporter_encryption_iv="nonce",
            reporter_crypto_provider="env_aesgcm",
            reporter_key_version=1,
            reporter_kms_key_name=None,
        )
    )
    provider = MagicMock()
    provider.decrypt_json.return_value = {
        "reporter_name": "Ana Reporter",
        "reporter_phone": "09171234567",
    }

    with (
        patch(
            "services.civilian_triage.contact_reveal.get_crypto_provider",
            return_value=provider,
        ),
        patch(
            "services.civilian_triage.contact_reveal.log_system_audit",
            side_effect=RuntimeError("audit unavailable"),
        ),
        pytest.raises(HTTPException) as exc,
    ):
        reveal_reporter_contact(
            db,
            42,
            {"user_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"},
            _request(),
        )

    assert exc.value.status_code == 500
    db.rollback.assert_called_once()
    db.commit.assert_not_called()
