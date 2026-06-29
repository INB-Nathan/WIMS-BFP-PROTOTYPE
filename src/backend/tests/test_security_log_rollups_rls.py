"""Contract tests for the security_threat_log_rollups RLS policies.

Pen-test findings 2026-06-29: the original security_rollups_admin_all
FOR ALL policy blocked the svc_suricata service account (role
NATIONAL_ANALYST) from inserting rollup rows, which caused every
ingest_suricata_eve Celery task to fail. This file pins the policy
structure so regressions are caught early.

These are SQL contract tests — they read the migration files and assert
the expected policy names and operations. They do NOT require a live DB.
"""

from __future__ import annotations

import re
from pathlib import Path


def _repo_root() -> Path:
    for candidate in Path(__file__).resolve().parents:
        if (candidate / "src" / "postgres-init").is_dir():
            return candidate
    raise AssertionError("repository root not found")


def _read(name: str) -> str:
    """Read a SQL bootstrap file by name."""
    return (_repo_root() / "src" / "postgres-init" / name).read_text(encoding="utf-8")


def _extract_policy_blocks(sql: str, table: str) -> list[tuple[str, str]]:
    """Return (policy_name, body) for every CREATE POLICY ... ON <table> block.

    Stops at the closing semicolon. The body is the full CREATE POLICY statement
    so callers can match on FOR INSERT/UPDATE/DELETE and role predicates.
    """
    pattern = re.compile(
        r"CREATE\s+POLICY\s+(\w+)\s+ON\s+" + re.escape(table) + r"\s+(.*?);",
        re.DOTALL | re.IGNORECASE,
    )
    return [(m.group(1), m.group(2)) for m in pattern.finditer(sql)]


def test_75_drops_legacy_for_all_policy():
    """The single FOR ALL policy must be dropped so the granular split wins."""
    sql = _read("75_security_log_rollups.sql")
    assert "DROP POLICY IF EXISTS security_rollups_admin_all" in sql
    # The legacy policy must NOT be re-created in 75.
    assert "CREATE POLICY security_rollups_admin_all" not in sql


def test_75_creates_three_granular_policies():
    """Three policies: insert, update, delete — none FOR ALL."""
    sql = _read("75_security_log_rollups.sql")
    blocks = dict(_extract_policy_blocks(sql, "wims.security_threat_log_rollups"))
    expected = {"security_rollups_insert", "security_rollups_update", "security_rollups_delete"}
    assert expected.issubset(blocks.keys()), (
        f"Missing policies. Found: {sorted(blocks.keys())}, expected subset: {sorted(expected)}"
    )


def test_75_select_policy_still_present():
    """The existing SELECT policy is unchanged and must remain."""
    sql = _read("75_security_log_rollups.sql")
    assert "security_rollups_admin_analyst_select" in sql
    assert "FOR SELECT" in sql
    assert "NATIONAL_ANALYST" in sql


def test_75_insert_policy_allows_national_analyst():
    """INSERT must allow NATIONAL_ANALYST so svc_suricata can write rollups."""
    sql = _read("75_security_log_rollups.sql")
    assert re.search(
        r"CREATE\s+POLICY\s+security_rollups_insert\b.*?FOR\s+INSERT.*?"
        r"WITH\s+CHECK\s*\(\s*wims\.current_user_role\(\)\s*IN\s*\(\s*'SYSTEM_ADMIN'\s*,\s*'NATIONAL_ANALYST'\s*\)",
        sql,
        re.DOTALL | re.IGNORECASE,
    ), "INSERT policy must allow SYSTEM_ADMIN, NATIONAL_ANALYST"


def test_75_update_policy_allows_national_analyst():
    """UPDATE must allow NATIONAL_ANALYST so the upsert ON CONFLICT DO UPDATE succeeds."""
    sql = _read("75_security_log_rollups.sql")
    assert re.search(
        r"CREATE\s+POLICY\s+security_rollups_update\b.*?FOR\s+UPDATE.*?"
        r"USING\s*\(\s*wims\.current_user_role\(\)\s*IN\s*\(\s*'SYSTEM_ADMIN'\s*,\s*'NATIONAL_ANALYST'\s*\)",
        sql,
        re.DOTALL | re.IGNORECASE,
    ), "UPDATE USING clause must allow SYSTEM_ADMIN, NATIONAL_ANALYST"
    assert re.search(
        r"CREATE\s+POLICY\s+security_rollups_update\b.*?FOR\s+UPDATE.*?"
        r"WITH\s+CHECK\s*\(\s*wims\.current_user_role\(\)\s*IN\s*\(\s*'SYSTEM_ADMIN'\s*,\s*'NATIONAL_ANALYST'\s*\)",
        sql,
        re.DOTALL | re.IGNORECASE,
    ), "UPDATE WITH CHECK clause must allow SYSTEM_ADMIN, NATIONAL_ANALYST"


def test_75_delete_policy_is_admin_only():
    """DELETE must remain SYSTEM_ADMIN-only (audit integrity)."""
    sql = _read("75_security_log_rollups.sql")
    assert re.search(
        r"CREATE\s+POLICY\s+security_rollups_delete\b.*?FOR\s+DELETE.*?"
        r"USING\s*\(\s*wims\.current_user_role\(\)\s*=\s*'SYSTEM_ADMIN'\s*\)",
        sql,
        re.DOTALL | re.IGNORECASE,
    ), "DELETE policy must be SYSTEM_ADMIN-only"


def test_75_store_low_value_raw_default_is_true():
    """Pen-test fix 2026-06-29: siem.store_low_value_raw defaults to 'true' so
    admin /admin/monitoring views (which read security_threat_logs, not
    rollups) see scanner/probe/bot traffic during pen-test reviews."""
    sql = _read("75_security_log_rollups.sql")
    assert re.search(
        r"\('siem\.store_low_value_raw'\s*,\s*'true'",
        sql,
        re.IGNORECASE,
    ), "siem.store_low_value_raw must default to 'true' for pen-test visibility"


def test_77_migration_drops_legacy_for_all_and_recreates_granular():
    """The 77 file is the live-DB migration — same three policies, idempotent."""
    sql = _read("77_security_log_rollups_policy_fix.sql")
    assert "DROP POLICY IF EXISTS security_rollups_admin_all" in sql
    assert "CREATE POLICY security_rollups_insert" in sql
    assert "CREATE POLICY security_rollups_update" in sql
    assert "CREATE POLICY security_rollups_delete" in sql


def test_77_migration_updates_store_low_value_raw_to_true():
    """The 77 file flips siem.store_low_value_raw on the live DB."""
    sql = _read("77_security_log_rollups_policy_fix.sql")
    assert "UPDATE wims.system_config" in sql
    assert "'true'" in sql
    assert "'siem.store_low_value_raw'" in sql


def test_77_migration_is_idempotent():
    """77 uses IF EXISTS / IF NOT EXISTS / DROP IF EXISTS everywhere."""
    sql = _read("77_security_log_rollups_policy_fix.sql")
    assert "DROP POLICY IF EXISTS" in sql
    # No CREATE TABLE, no INSERT — only policy and config changes.
    assert "CREATE TABLE" not in sql
    assert "INSERT INTO wims.system_config" not in sql
