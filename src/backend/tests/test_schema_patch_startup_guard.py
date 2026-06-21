from __future__ import annotations


class FakeAdminConnection:
    def __init__(self) -> None:
        self.exec_driver_sql_count = 0

    def exec_driver_sql(self, _statement) -> None:
        self.exec_driver_sql_count += 1


class FakeAdminSession:
    def __init__(self) -> None:
        self.execute_count = 0
        self.commit_count = 0
        self.rollback_count = 0
        self.close_count = 0
        self.connection_obj = FakeAdminConnection()

    def execute(self, _statement) -> None:
        self.execute_count += 1

    def connection(self) -> FakeAdminConnection:
        return self.connection_obj

    def commit(self) -> None:
        self.commit_count += 1

    def rollback(self) -> None:
        self.rollback_count += 1

    def close(self) -> None:
        self.close_count += 1


def test_apply_schema_patches_runs_once_per_process(monkeypatch) -> None:
    import main

    fake_session = FakeAdminSession()
    calls = {
        "admin_session": 0,
        "ref_rls": 0,
        "users_rls": 0,
    }
    sql_patches: list[str] = []

    def fake_get_admin_session():
        calls["admin_session"] += 1
        return fake_session

    def fake_ref_rls(_db) -> None:
        calls["ref_rls"] += 1

    def fake_users_rls(_db) -> None:
        calls["users_rls"] += 1

    def fake_apply_postgres_init_sql_patch(_db, filename: str, _label: str) -> None:
        sql_patches.append(filename)

    monkeypatch.setattr(main, "_get_admin_session", fake_get_admin_session)
    monkeypatch.setattr(main, "_apply_ref_table_rls", fake_ref_rls)
    monkeypatch.setattr(main, "_apply_users_rls", fake_users_rls)
    monkeypatch.setattr(main, "_apply_postgres_init_sql_patch", fake_apply_postgres_init_sql_patch)

    main._reset_schema_patch_state_for_tests()
    try:
        main.apply_schema_patches()
        main.apply_schema_patches()
    finally:
        main._reset_schema_patch_state_for_tests()

    assert calls == {
        "admin_session": 1,
        "ref_rls": 1,
        "users_rls": 1,
    }
    assert "63_ivh_ip_address.sql" in sql_patches
    assert sql_patches.index("62_audit_correlation_columns.sql") < sql_patches.index(
        "63_ivh_ip_address.sql"
    )
    assert fake_session.close_count == 1
    assert fake_session.rollback_count == 0
