from __future__ import annotations

import json
import re
from pathlib import Path

import pytest


def _repo_root() -> Path:
    for candidate in [Path(__file__).resolve().parent, *Path(__file__).resolve().parents]:
        if (candidate / "scripts").is_dir() and (candidate / "src").is_dir():
            return candidate
    pytest.skip("full repository checkout is required for seed mapping static checks", allow_module_level=True)


REPO_ROOT = _repo_root()

EXPECTED_ENCODERS = {
    "encoder_ncr": (1, "11111111-1111-4111-8111-111111111111"),
    "encoder_car": (2, "ee000002-0000-4002-8002-000000000002"),
    "encoder_r01": (3, "ee000003-0000-4003-8003-000000000003"),
    "encoder_r02": (4, "ee000004-0000-4004-8004-000000000004"),
    "encoder_r03": (5, "ee000005-0000-4005-8005-000000000005"),
    "encoder_r04a": (6, "ee000006-0000-4006-8006-000000000006"),
    "encoder_r04b": (7, "ee000007-0000-4007-8007-000000000007"),
    "encoder_r05": (8, "ee000008-0000-4008-8008-000000000008"),
    "encoder_r06": (9, "ee000009-0000-4009-8009-000000000009"),
    "encoder_r07": (10, "ee000010-0000-4010-8010-000000000010"),
    "encoder_r08": (11, "ee000011-0000-4011-8011-000000000011"),
    "encoder_r09": (12, "ee000012-0000-4012-8012-000000000012"),
    "encoder_r10": (13, "ee000013-0000-4013-8013-000000000013"),
    "encoder_r11": (14, "ee000014-0000-4014-8014-000000000014"),
    "encoder_r12": (15, "ee000015-0000-4015-8015-000000000015"),
    "encoder_r13": (16, "ee000016-0000-4016-8016-000000000016"),
    "encoder_barmm": (17, "ee000017-0000-4017-8017-000000000017"),
    "encoder_nir": (18, "ee000018-0000-4018-8018-000000000018"),
}


def test_seed_scripts_use_canonical_encoder_region_mapping() -> None:
    script_paths = [
        REPO_ROOT / "scripts" / "seed-dev-users.sh",
        REPO_ROOT / "scripts" / "seed-dev-users.ps1",
    ]

    for path in script_paths:
        text = path.read_text(encoding="utf-8")
        for username, (region_id, keycloak_id) in EXPECTED_ENCODERS.items():
            assert username in text
            assert f"region = {region_id}" in text or f"|{region_id}|{keycloak_id}|" in text
            assert keycloak_id in text


def test_postgres_bootstrap_assigns_canonical_encoder_regions() -> None:
    users_sql = (REPO_ROOT / "src" / "postgres-init" / "03_users.sql").read_text(encoding="utf-8")
    regions_sql = (REPO_ROOT / "src" / "postgres-init" / "21_all_regions.sql").read_text(
        encoding="utf-8"
    )

    for username, (region_id, keycloak_id) in EXPECTED_ENCODERS.items():
        assert username in users_sql
        assert keycloak_id in users_sql
        assert f"('{username}', {region_id})" in regions_sql


def test_keycloak_realm_exports_have_login_ready_dev_encoders() -> None:
    for path in [
        REPO_ROOT / "src" / "keycloak" / "bfp-realm.json",
        REPO_ROOT / "src" / "keycloak" / "import" / "bfp-realm.json",
    ]:
        data = json.loads(path.read_text(encoding="utf-8"))
        users = {user["username"]: user for user in data["users"]}

        for username, (_, keycloak_id) in EXPECTED_ENCODERS.items():
            user = users[username]
            assert user["id"] == keycloak_id
            assert user["enabled"] is True
            assert user["emailVerified"] is True
            assert user["firstName"]
            assert user["lastName"]
            assert user["requiredActions"] == []
            assert user["realmRoles"] == ["REGIONAL_ENCODER"]
            assert user["credentials"][0]["value"] == "Password123!"
            assert user["credentials"][0]["temporary"] is False


def test_system_task_user_id_consistent_across_artifacts() -> None:
    """Guard against drift of the svc_task UUID across database.py, 03_users.sql, and main.py.

    If any artifact uses a different UUID, Celery tasks will set the wrong RLS GUC and
    current_user_role() will return ANONYMOUS, silently breaking all analytics syncs.
    """
    _UUID = "00000000-0000-0000-0000-000000000002"

    database_py = (REPO_ROOT / "src" / "backend" / "database.py").read_text(encoding="utf-8")
    users_sql = (REPO_ROOT / "src" / "postgres-init" / "03_users.sql").read_text(encoding="utf-8")
    main_py = (REPO_ROOT / "src" / "backend" / "main.py").read_text(encoding="utf-8")

    assert _UUID in database_py, f"SYSTEM_TASK_USER_ID {_UUID!r} not found in database.py"
    assert _UUID in users_sql, f"svc_task UUID {_UUID!r} not found in 03_users.sql"
    assert _UUID in main_py, f"svc_task upsert UUID {_UUID!r} not found in main.py startup patch"

    # Verify database.py actually assigns it to the constant (not just a comment)
    assert re.search(
        rf"SYSTEM_TASK_USER_ID\s*=.*{re.escape(_UUID)}",
        database_py,
    ), "SYSTEM_TASK_USER_ID constant assignment not found in database.py"
