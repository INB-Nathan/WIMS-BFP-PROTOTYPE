from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock

from api.routes.incidents import create_incident
from schemas.incident import IncidentCreate


def test_create_incident_accepts_uuid_encoder_id_from_db(monkeypatch):
    user_id = uuid.uuid4()
    created_at = datetime.now(timezone.utc)

    region_result = MagicMock()
    region_result.fetchone.return_value = (1,)

    insert_result = MagicMock()
    insert_result.fetchone.return_value = (123, "ignored", user_id, "PENDING", created_at)

    coord_result = MagicMock()
    coord_result.fetchone.return_value = (14.5995, 120.9842)

    db = MagicMock()
    db.execute.side_effect = [region_result, insert_result, coord_result]

    monkeypatch.setattr("api.routes.incidents.sync_incident_to_analytics", lambda *_args: None)

    response = create_incident(
        IncidentCreate(latitude=14.5995, longitude=120.9842, description="Test fire in Manila"),
        {"user_id": user_id},
        db,
    )

    assert response.incident_id == 123
    assert str(response.encoder_id) == str(user_id)
    assert response.status == "PENDING"
    assert db.commit.call_count == 2
