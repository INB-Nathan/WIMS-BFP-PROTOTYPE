"""Static contracts for anonymous pre-upload ownership groundwork."""

from __future__ import annotations

import re
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
MIGRATION = BACKEND_ROOT / "alembic" / "versions" / "0009_anonymous_photo_ownership_helpers.py"
BOOTSTRAP = BACKEND_ROOT.parent / "postgres-init" / "88_anonymous_photo_ownership.sql"


def _sources() -> tuple[str, str]:
    return (
        MIGRATION.read_text(encoding="utf-8"),
        BOOTSTRAP.read_text(encoding="utf-8"),
    )


def test_revision_follows_photo_preupload_head_and_bootstrap_number() -> None:
    migration, _ = _sources()
    assert 'revision: str = "0009"' in migration
    assert 'down_revision: Union[str, None] = "0008"' in migration


def test_session_hardening_is_present_on_both_migration_paths() -> None:
    for source in _sources():
        assert "absolute_expires_at TIMESTAMPTZ" in source
        assert "revoked_at TIMESTAMPTZ" in source
        assert "anonymous_sessions_token_hash_format" in source
        assert "token_hash ~ '^[0-9a-f]{64}$'" in source
        assert "absolute_expires_at > created_at" in source
        assert "revoked_at IS NULL" in source
        assert "CREATE POLICY anonymous_sessions_insert" in source
        assert "WITH CHECK (FALSE)" in source
        assert "REVOKE ALL ON wims.anonymous_sessions FROM wims_app" in source


def test_report_and_photo_session_fk_indexes_and_legacy_owner_branch_are_preserved() -> None:
    migration, bootstrap = _sources()
    for source in (migration, bootstrap):
        report_start = source.index("ALTER TABLE wims.citizen_reports")
        report_end = source.index("ALTER TABLE wims.report_photos", report_start)
        report_ddl = source[report_start:report_end]
        assert "anonymous_session_id UUID" in report_ddl
        assert "REFERENCES wims.anonymous_sessions(anonymous_session_id)" in report_ddl
        assert "idx_citizen_reports_anonymous_session" in report_ddl
        assert "WHERE anonymous_session_id IS NOT NULL" in report_ddl
        assert "idx_report_photos_anonymous_session" in source
        assert "legacy rows remain NULL" in source
        assert (
            "report submission service must set this from the validated session" in source.lower()
        )
        assert "before calling attach_anonymous_photos" in source
        assert "uploader_device_id IS NOT NULL" in source
        assert "anonymous_session_id IS NULL" in source
        assert "uploader_device_id IS NULL" in source
        assert "report_photos_owner_xor" in source
        assert "report_photos_device_owner_attached" in source
        assert "uploader_device_id IS NULL OR report_id IS NOT NULL" in source


def test_helpers_have_fixed_search_path_narrow_grants_and_hash_only_issue() -> None:
    for source in _sources():
        for function in (
            "issue_anonymous_session",
            "validate_anonymous_session",
            "revoke_anonymous_session",
            "authorize_anonymous_pending_photo",
            "attach_anonymous_photos",
        ):
            start = source.index(f"FUNCTION wims.{function}")
            body = source[start : source.find("$$;", start) + 3]
            assert "SECURITY DEFINER" in body
            assert "SET search_path = wims, pg_temp" in body
            assert "REVOKE ALL ON FUNCTION" in source
            assert f"GRANT EXECUTE ON FUNCTION wims.{function}" in source

        issue = source[source.index("FUNCTION wims.issue_anonymous_session") :]
        assert "gen_random_bytes(32)" in issue
        assert "digest(v_raw_token, 'sha256')" in issue
        assert "raw_token TEXT" in issue
        assert "RETURN QUERY SELECT v_session_id, v_raw_token" in issue


def test_validation_enforces_format_expiry_and_revocation() -> None:
    migration, bootstrap = _sources()
    for source in (migration, bootstrap):
        validate = source[source.index("FUNCTION wims.validate_anonymous_session") :]
        assert "p_raw_token !~ '^[0-9a-f]{64}$'" in validate
        assert "revoked_at IS NULL" in validate
        assert "expires_at > v_now" in validate
        assert "absolute_expires_at > v_now" in validate
        assert "expires_at = LEAST" in validate
        assert "interval '24 hours'" in validate
        assert "interval '90 days'" in source


def test_no_permissive_pending_policy_or_general_rls_bypass_is_added() -> None:
    for source in _sources():
        assert "BYPASSRLS" not in source
        assert "WITH CHECK (TRUE)" not in source
        # Revision 0009 deliberately leaves anonymous pending RLS absent;
        # revision 0010 supplies the capability-bound helper boundary.
        assert "CREATE POLICY report_photos" not in source
        assert "client device IDs are analytics-only" in source


def test_pending_authorization_and_attach_are_session_derived_and_all_or_nothing() -> None:
    for source in _sources():
        authorization = source[source.index("FUNCTION wims.authorize_anonymous_pending_photo") :]
        assert "validate_anonymous_session(p_raw_token)" in authorization
        assert "report_id IS NULL" in authorization
        assert "attached_at IS NULL" in authorization
        assert "anonymous_session_id = v_session_id" in authorization
        assert "p_anonymous_session_id" not in authorization

        attach = source[source.index("FUNCTION wims.attach_anonymous_photos") :]
        assert "FOR UPDATE" in attach
        assert "MATERIALIZED" in attach
        assert "cardinality(p_photo_ids)" in attach
        assert "v_locked_count <> v_requested_count" in attach
        assert "SET report_id = p_report_id" in attach
        assert "report creation" in attach.lower()


def test_bootstrap_and_migration_function_contracts_have_matching_signatures() -> None:
    migration, bootstrap = _sources()
    signatures = (
        r"issue_anonymous_session\(TEXT\)",
        r"validate_anonymous_session\(TEXT\)",
        r"revoke_anonymous_session\(TEXT\)",
        r"authorize_anonymous_pending_photo\(TEXT, UUID\)",
        r"attach_anonymous_photos\(TEXT, INTEGER, UUID\[\]\)",
    )
    for signature in signatures:
        assert re.search(signature, migration)
        assert re.search(signature, bootstrap)
