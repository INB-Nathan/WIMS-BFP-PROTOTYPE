"""Static contracts for the registered-contributor pending-photo attach helper.

Mirrors test_0009/test_0010: the migration (Alembic 0011) and the clean
bootstrap (90_*.sql) must define the identical ``wims.attach_registered_photos``
function with narrow grants and the same all-or-nothing attach semantics.  Each
behavioral branch required by the task is asserted against both sources so a
logic drift in either path is caught without needing a live RLS database.
"""

from __future__ import annotations

import re
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
MIGRATION = BACKEND_ROOT / "alembic" / "versions" / "0011_registered_photo_ownership_helper.py"
BOOTSTRAP = BACKEND_ROOT.parent / "postgres-init" / "90_registered_photo_ownership.sql"


def _sources() -> tuple[str, str]:
    return (
        MIGRATION.read_text(encoding="utf-8"),
        BOOTSTRAP.read_text(encoding="utf-8"),
    )


def _helper_body(source: str) -> str:
    start = source.index("FUNCTION wims.attach_registered_photos")
    return source[start : source.find("$$;", start) + 3]


def _full_function(source: str) -> str:
    start = source.index("CREATE OR REPLACE FUNCTION wims.attach_registered_photos")
    return source[start : source.index("$$;", start) + 3]


def test_revision_follows_0010_head_and_bootstrap_number() -> None:
    migration, bootstrap = _sources()
    assert 'revision: str = "0011"' in migration
    assert 'down_revision: Union[str, None] = "0010"' in migration
    assert "Dependencies: 89_anonymous_pending_photo_insert.sql" in bootstrap


def test_function_is_security_definer_with_fixed_search_path_and_narrow_grant() -> None:
    for source in _sources():
        start = source.index("FUNCTION wims.attach_registered_photos")
        body = source[start : source.find("$$;", start) + 3]
        assert "SECURITY DEFINER" in body
        assert "SET search_path = wims, pg_temp" in body

    for source in _sources():
        assert "REVOKE ALL ON FUNCTION wims.attach_registered_photos" in source
        # Granted to wims_app only; nothing else receives EXECUTE.
        grants = re.findall(r"GRANT EXECUTE ON FUNCTION wims\.attach_registered_photos", source)
        assert grants == ["GRANT EXECUTE ON FUNCTION wims.attach_registered_photos"]
        assert "TO wims_app" in source
        assert "FROM PUBLIC" in source


def test_no_bypassrls_and_no_broad_rls_policy_is_added() -> None:
    # Scope to the function body: descriptive docstrings/comments may mention
    # BYPASSRLS/RLS without implementing them.
    for source in _sources():
        body = _helper_body(source)
        assert "BYPASSRLS" not in body
        assert "WITH CHECK (TRUE)" not in body
        assert "CREATE POLICY" not in body


def test_helper_derives_ownership_from_caller_and_locks_report() -> None:
    for source in _sources():
        helper = _helper_body(source)
        # No bearer/session/device owner inputs: ownership comes from p_user_id.
        assert "p_raw_token" not in helper
        assert "p_anonymous_session_id" not in helper
        assert "p_uploader_device_id" not in helper
        assert "p_user_id UUID" in helper
        # Report row is locked before any photo work.
        assert "FROM wims.citizen_reports" in helper
        assert "WHERE report_id = p_report_id" in helper
        assert "FOR UPDATE" in helper
        assert "contributor_user_id" in helper
        assert "v_report_user IS DISTINCT FROM p_user_id" in helper


def test_terminal_status_report_is_rejected() -> None:
    for source in _sources():
        helper = _helper_body(source)
        assert "SELECT contributor_user_id, status" in helper
        assert "INTO v_report_user, v_report_status" in helper
        assert "v_report_status = 'ACTIONED'" in helper
        assert "v_report_status LIKE 'REJECTED_%'" in helper


def test_empty_and_duplicate_photo_sets_are_rejected() -> None:
    for source in _sources():
        helper = _helper_body(source)
        assert "v_requested_count := cardinality(p_photo_ids)" in helper
        assert "v_requested_count = 0" in helper
        # Duplicate detection on the unnested ids.
        assert "FROM unnest(p_photo_ids) AS requested(photo_id)" in helper
        assert "GROUP BY photo_id" in helper
        assert "HAVING COUNT(*) > 1" in helper


def test_partial_or_cross_owner_or_attached_photos_are_rejected() -> None:
    for source in _sources():
        helper = _helper_body(source)
        # Pending photo set is locked and counted under same-owner predicates.
        assert "FROM wims.report_photos AS p" in helper
        assert "p.photo_id = ANY (p_photo_ids)" in helper
        assert "p.report_id IS NULL" in helper
        assert "p.uploader_user_id = p_user_id" in helper
        assert "MATERIALIZED" in helper
        assert "v_locked_count <> v_requested_count" in helper


def test_all_or_nothing_update_only_for_complete_same_owner_set() -> None:
    for source in _sources():
        helper = _helper_body(source)
        assert "UPDATE wims.report_photos AS p" in helper
        assert "SET report_id = p_report_id" in helper
        assert "attached_at = clock_timestamp()" in helper
        # Final success path is reached only after every guard passes.
        assert "RETURN TRUE" in helper
        # No row is changed on any rejection path.
        assert helper.count("RETURN FALSE") >= 1


def test_migration_and_bootstrap_function_bodies_are_identical() -> None:
    migration, bootstrap = _sources()
    assert _full_function(migration) == _full_function(bootstrap)


def test_migration_and_bootstrap_use_matching_function_signature() -> None:
    migration, bootstrap = _sources()
    signature = re.compile(
        r"(?:REVOKE ALL|GRANT EXECUTE) ON FUNCTION "
        r"wims\.attach_registered_photos\((.*?)\)",
        re.DOTALL,
    )
    for source in (migration, bootstrap):
        matches = signature.findall(source)
        assert len(matches) == 2
        for match in matches:
            parts = [part.strip() for part in match.split(",")]
            assert parts == ["UUID", "INTEGER", "UUID[]"]

    # The function definition itself carries the same signature in both sources.
    for source in (migration, bootstrap):
        assert re.search(
            r"FUNCTION wims\.attach_registered_photos\(UUID, INTEGER, UUID\[\]\)", source
        )
