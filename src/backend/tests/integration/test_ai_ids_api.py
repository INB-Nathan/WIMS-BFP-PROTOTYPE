# ruff: noqa: E402
"""
IDS-to-SLM AI Analysis Pipeline — TDD Red State.

Test 1: POST /api/admin/security-logs/{log_id}/analyze
- Mock get_system_admin to return SYSTEM_ADMIN
- Insert dummy row into wims.security_threat_logs
- Mock Ollama POST with respx
- Assert 200 OK and DB updated (xai_narrative, xai_confidence)

Run from project root:
  cd src && pytest backend/tests/integration/test_ai_ids_api.py -v
"""

from __future__ import annotations
from auth import get_system_admin
from main import app

import os
import sys
from pathlib import Path

# Ensure backend root is on path when running from src/
_backend_root = Path(__file__).resolve().parent.parent.parent
if str(_backend_root) not in sys.path:
    sys.path.insert(0, str(_backend_root))

import pytest
import respx
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

# ---------------------------------------------------------------------------
# DB Setup
# ---------------------------------------------------------------------------
DATABASE_URL = os.environ.get(
    "SQLALCHEMY_DATABASE_URL",
    os.environ.get("DATABASE_URL", "postgresql://postgres:password@postgres:5432/wims"),
)
_engine = create_engine(DATABASE_URL)
_Session = sessionmaker(autocommit=False, autoflush=False, bind=_engine)


@pytest.fixture
def db_session():
    """Provide a real DB session for integration tests."""
    session = _Session()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture(autouse=True)
def set_ollama_url(monkeypatch):
    """Ensure implementation uses wims-ollama URL so respx mock matches."""
    monkeypatch.setenv("OLLAMA_URL", "http://wims-ollama:11434")


@pytest.fixture
def mock_system_admin():
    """Override get_system_admin to return SYSTEM_ADMIN without auth."""

    async def _mock():
        return {
            "role": "SYSTEM_ADMIN",
            "user_id": "00000000-0000-0000-0000-000000000001",
        }

    app.dependency_overrides[get_system_admin] = _mock
    yield
    app.dependency_overrides.pop(get_system_admin, None)


@pytest.fixture
def threat_log_row(db_session):
    """Insert a dummy security_threat_log row and return log_id. Clean up after."""
    result = db_session.execute(
        text("""
            INSERT INTO wims.security_threat_logs
                (source_ip, destination_ip, suricata_sid, severity_level, raw_payload, xai_narrative, xai_confidence)
            VALUES
                (:source_ip, :destination_ip, :suricata_sid, :severity_level, :raw_payload, NULL, NULL)
            RETURNING log_id
        """),
        {
            "source_ip": "192.168.1.100",
            "destination_ip": "10.0.0.50",
            "suricata_sid": 2000001,
            "severity_level": "HIGH",
            "raw_payload": '{"msg": "ET SCAN Potential SSH Scan"}',
        },
    )
    row = result.fetchone()
    log_id = row[0]
    db_session.commit()
    yield log_id
    db_session.execute(
        text("DELETE FROM wims.security_threat_logs WHERE log_id = :lid"),
        {"lid": log_id},
    )
    db_session.commit()


# ---------------------------------------------------------------------------
# Test
# ---------------------------------------------------------------------------
@respx.mock
def test_analyze_threat_log_success(mock_system_admin, threat_log_row, db_session):
    """
    POST /api/admin/security-logs/{log_id}/analyze:
    - Mock Ollama returning narrative + confidence
    - Assert 200 OK
    - Assert DB has xai_narrative and xai_confidence updated
    """
    log_id = threat_log_row

    # Mock Ollama API
    respx.post("http://wims-ollama:11434/api/generate").respond(
        status_code=200,
        json={
            "response": '{"narrative": "Simulated attack detected.", "confidence": 0.95}'
        },
    )

    with TestClient(app) as client:
        resp = client.post(f"/api/admin/security-logs/{log_id}/analyze")

    assert resp.status_code == 200, (
        f"Expected 200 OK, got {resp.status_code}: {resp.text}"
    )

    # Query DB and assert updated values
    row = db_session.execute(
        text(
            "SELECT xai_narrative, xai_confidence FROM wims.security_threat_logs WHERE log_id = :lid"
        ),
        {"lid": log_id},
    ).fetchone()

    assert row is not None, "Log row not found after analyze"
    assert row[0] == "Simulated attack detected.", (
        f"Expected xai_narrative, got {row[0]!r}"
    )
    assert row[1] == 0.95, f"Expected xai_confidence 0.95, got {row[1]!r}"
