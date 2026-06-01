from __future__ import annotations


class FakeAdminSession:
    def __init__(self) -> None:
        self.execute_count = 0
        self.commit_count = 0
        self.rollback_count = 0
        self.close_count = 0

    def execute(self, _statement) -> None:
        self.execute_count += 1

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

    def fake_get_admin_session():
        calls["admin_session"] += 1
        return fake_session

    def fake_ref_rls(_db) -> None:
        calls["ref_rls"] += 1

    def fake_users_rls(_db) -> None:
        calls["users_rls"] += 1

    monkeypatch.setattr(main, "_get_admin_session", fake_get_admin_session)
    monkeypatch.setattr(main, "_apply_ref_table_rls", fake_ref_rls)
    monkeypatch.setattr(main, "_apply_users_rls", fake_users_rls)

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
    assert fake_session.close_count == 1
    assert fake_session.rollback_count == 0
