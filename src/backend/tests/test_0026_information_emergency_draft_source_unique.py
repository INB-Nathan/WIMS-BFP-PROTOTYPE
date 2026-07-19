from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_upgrade_adds_unpublished_source_draft_uniqueness() -> None:
    source = (
        ROOT / "backend/alembic/versions/0026_information_emergency_draft_source_unique.py"
    ).read_text()

    assert "uq_information_emergencies_unpublished_source_incident" in source
    assert "WHERE promoted_from_incident_id IS NOT NULL AND published = FALSE" in source


def test_clean_bootstrap_adds_unpublished_source_draft_uniqueness() -> None:
    source = (ROOT / "postgres-init/97_information_emergency_draft_source_unique.sql").read_text()

    assert "uq_information_emergencies_unpublished_source_incident" in source
    assert "WHERE promoted_from_incident_id IS NOT NULL AND published = FALSE" in source
