"""Static contracts for capability-bound anonymous pending photo insertion."""

from __future__ import annotations

import re
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
MIGRATION = BACKEND_ROOT / "alembic" / "versions" / "0010_anonymous_pending_photo_insert.py"
BOOTSTRAP = BACKEND_ROOT.parent / "postgres-init" / "89_anonymous_pending_photo_insert.sql"


def _sources() -> tuple[str, str]:
    return (
        MIGRATION.read_text(encoding="utf-8"),
        BOOTSTRAP.read_text(encoding="utf-8"),
    )


def test_revision_follows_live_0009_head_and_bootstrap_88() -> None:
    migration, bootstrap = _sources()
    assert 'revision: str = "0010"' in migration
    assert 'down_revision: Union[str, None] = "0009"' in migration
    assert "Dependencies: 88_anonymous_photo_ownership.sql" in bootstrap


def test_helper_is_capability_bound_and_has_no_caller_owner_inputs() -> None:
    for source in _sources():
        start = source.index("FUNCTION wims.insert_anonymous_pending_photo")
        helper = source[start : source.find("$$;", start) + 3]
        assert "p_raw_token TEXT" in helper
        assert "p_anonymous_session_id" not in helper
        assert "p_uploader_user_id" not in helper
        assert "p_uploader_device_id" not in helper
        assert "p_report_id" not in helper
        assert "validate_anonymous_session(p_raw_token)" in helper
        assert "anonymous_session_id = v_session_id" in helper
        assert "report_id IS NULL" in helper
        assert "attached_at IS NULL" in helper
        assert "SECURITY DEFINER" in helper
        assert "SET search_path = wims, pg_temp" in helper


def test_helper_enforces_one_pending_row_and_owner_bound_idempotency() -> None:
    for source in _sources():
        start = source.index("FUNCTION wims.insert_anonymous_pending_photo")
        helper = source[start : source.find("$$;", start) + 3]
        assert "pg_advisory_xact_lock" in helper
        assert "v_pending_count >= 1" in helper
        assert "duplicate BOOLEAN" in helper
        assert "cap_reached BOOLEAN" in helper
        assert "RETURN QUERY SELECT NULL::UUID, TRUE, FALSE" in helper
        assert "RETURN QUERY SELECT NULL::UUID, FALSE, TRUE" in helper
        assert (
            "ON CONFLICT (client_photo_id) WHERE client_photo_id IS NOT NULL DO NOTHING" in helper
        )
        assert "RETURNING wims.report_photos.photo_id" in helper


def test_helper_forces_anonymous_pending_owner_and_null_attachment_state() -> None:
    for source in _sources():
        start = source.index("INSERT INTO wims.report_photos")
        insert = source[start : source.find("ON CONFLICT", start)]
        assert "NULL" in insert
        assert "v_session_id" in insert
        assert "p_client_photo_id" in insert
        assert "uploader_user_id" in insert
        assert "uploader_device_id" in insert
        assert "anonymous_session_id" in insert
        assert "report_id" in insert
        assert "attached_at" in insert


def test_helper_has_only_narrow_grant_and_no_bypass_or_permissive_policy() -> None:
    for source in _sources():
        assert "REVOKE ALL ON FUNCTION wims.insert_anonymous_pending_photo" in source
        assert "GRANT EXECUTE ON FUNCTION wims.insert_anonymous_pending_photo" in source
        assert "TO wims_app" in source
        assert "BYPASSRLS" not in source
        assert "WITH CHECK (TRUE)" not in source
        assert "CREATE POLICY report_photos" not in source


def test_migration_and_bootstrap_use_matching_function_signature() -> None:
    migration, bootstrap = _sources()
    expected = [
        "TEXT",
        "UUID",
        "UUID",
        "TEXT",
        "TEXT",
        "INTEGER",
        "INTEGER",
        "INTEGER",
        "TEXT",
        "INTEGER",
        "TEXT",
        "TEXT",
        "INTEGER",
        "TEXT",
        "TEXT",
        "TEXT",
        "INTEGER",
        "TEXT",
        "TEXT",
        "INTEGER",
        "TEXT",
        "TEXT",
        "TEXT",
        "TEXT",
        "INTEGER",
        "TEXT",
        "TEXT",
        "TEXT",
        "TEXT",
        "TEXT",
        "TEXT",
    ]
    signature = re.compile(
        r"(?:REVOKE ALL|GRANT EXECUTE) ON FUNCTION "
        r"wims\.insert_anonymous_pending_photo\((.*?)\)",
        re.DOTALL,
    )
    for source in (migration, bootstrap):
        matches = signature.findall(source)
        assert len(matches) == 2
        assert [[part.strip() for part in match.split(",")] for match in matches] == [
            expected,
            expected,
        ]
