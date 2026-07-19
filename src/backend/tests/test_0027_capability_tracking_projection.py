"""Static contracts for the capability tracking projection migration paths."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def _sources() -> list[str]:
    return [
        (ROOT / "backend/alembic/versions/0027_capability_tracking_projection.py").read_text(),
        (ROOT / "postgres-init/98_capability_tracking_projection.sql").read_text(),
    ]


def test_tracking_projection_migration_and_bootstrap_are_hardened() -> None:
    for source in _sources():
        assert "get_capability_tracking_projection" in source
        assert "SECURITY DEFINER" in source
        assert "SET search_path = wims, pg_temp" in source
        assert "REVOKE ALL ON FUNCTION" in source
        assert "FROM PUBLIC" in source
        assert "GRANT EXECUTE ON FUNCTION" in source
        assert "TO wims_app" in source
        assert "tt.report_id = p_report_id" in source
        assert "tt.token_hash = p_token_hash" in source
        assert "tt.is_active = TRUE" in source
        assert "tt.revoked_at IS NULL" in source
        assert "tt.expires_at IS NULL OR tt.expires_at > now()" in source


def test_tracking_projection_returns_only_tracking_contract_columns() -> None:
    source = _sources()[0]
    for sensitive_column in (
        "witness_name",
        "witness_phone",
        "contributor_user_id",
        "cr.location",
        "description",
        "trust_score",
    ):
        assert sensitive_column not in source


def test_bootstrap_does_not_weaken_anonymous_citizen_report_rls() -> None:
    source = _sources()[1]
    assert "CREATE POLICY" not in source
    assert "ALTER TABLE wims.citizen_reports" not in source
