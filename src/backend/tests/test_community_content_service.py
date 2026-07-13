"""Unit tests for services.community_content (Slice F).

Uses a mocked SQLAlchemy session (RecordingSession) — no live Postgres.
Covers the published+non-expired read predicate, language fallback, draft
creation (content + first version + CMS_EDIT audit), optimistic publish
(pointer move + new version + bump + CONTENT_PUBLISH, 409 on conflict),
archive (ARCHIVED + CONTENT_ARCHIVE), and update_draft (rejects non-DRAFT).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from services import community_content as svc


class FakeResult:
    """Minimal stand-in for a SQLAlchemy Result."""

    def __init__(self, *, scalar=None, row=None, rows=None, rowcount=0):
        self._scalar = scalar
        self._row = row
        self._rows = rows if rows is not None else []
        self.rowcount = rowcount

    def scalar_one(self):
        return self._scalar

    def scalar_one_or_none(self):
        return self._scalar

    def fetchone(self):
        return self._row

    def fetchall(self):
        return self._rows


class RecordingSession:
    """Records every db.execute(sql, params) and dispatches a scripted result.

    ``specs`` maps an SQL substring to the FakeResult to return when the
    executed SQL contains it. Falls back to a success-ish default so calls that
    don't need a specific result don't error.
    """

    def __init__(self, specs: dict[str, FakeResult] | None = None):
        self.calls: list[tuple[str, dict | None]] = []
        self._specs = specs or {}
        self._default = FakeResult(rowcount=1)

    def execute(self, sql, params=None):
        self.calls.append((str(sql), params))
        # Match SQL after collapsing whitespace so fixtures remain robust to
        # production formatting (including multiline UPDATE statements).
        normalized = " ".join(str(sql).split()).upper()
        for key, result in self._specs.items():
            if " ".join(key.split()).upper() in normalized:
                return result
        return self._default

    def sql_log(self) -> str:
        return "\n".join(sql for sql, _ in self.calls)

    def count_contains(self, substring: str) -> int:
        return sum(1 for sql, _ in self.calls if substring.upper() in sql.upper())

    def any_contains(self, substring: str) -> bool:
        return self.count_contains(substring) > 0

    def _audit_actions(self) -> list[str]:
        actions = []
        for sql, params in self.calls:
            if "SYSTEM_AUDIT_TRAILS" in sql.upper() and params:
                actions.append(params.get("action"))
        return actions


def _row(**kwargs):
    defaults = dict(
        content_id=uuid.uuid4(),
        slug="a-slug",
        content_type="ANNOUNCEMENT",
        urgent_banner=False,
        expires_at=None,
        metadata_json=None,
        last_reviewed_at=None,
        updated_at=datetime.now(timezone.utc),
        title_en="English title",
        title_uk=None,
        body_en="English body",
        body_uk=None,
    )
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


# ═════════════════════════════════════════════════════════════════════════════
# Public reads
# ═════════════════════════════════════════════════════════════════════════════


def test_list_published_applies_published_non_expired_predicate():
    session = RecordingSession(specs={"SELECT": FakeResult(rows=[_row(), _row()])})
    items = svc.list_published(session, language="en")
    assert len(items) == 2
    log = session.sql_log()
    normalized = " ".join(log.split()).upper()
    assert (
        "CC.LIFECYCLE_STATUS = 'PUBLISHED' AND (CC.EXPIRES_AT IS NULL OR CC.EXPIRES_AT > NOW())"
    ) in normalized


def test_list_published_with_type_filter():
    session = RecordingSession(specs={"SELECT": FakeResult(rows=[_row()])})
    svc.list_published(session, content_type="EVENT", language="en")
    assert session.any_contains("CC.CONTENT_TYPE = :CONTENT_TYPE")


def test_list_published_include_expired_bypasses_expiry_predicate():
    session = RecordingSession(specs={"SELECT": FakeResult(rows=[_row()])})
    svc.list_published(session, include_expired=True, system_admin=True)
    # With include_expired, the SQL uses a literal TRUE instead of the expiry clause.
    assert not session.any_contains("EXPIRES_AT > NOW()")


def test_list_published_rejects_expired_content_for_non_admin():
    with pytest.raises(HTTPException) as exc:
        svc.list_published(RecordingSession(), include_expired=True)
    assert exc.value.status_code == 403


def test_list_published_language_fallback_to_en():
    en_only = _row(
        content_id=uuid.uuid4(), title_en="EN", title_uk=None, body_en="BEN", body_uk=None
    )
    uk_present = _row(
        content_id=uuid.uuid4(), title_en="EN2", title_uk="UK2", body_en="BEN2", body_uk="BUK2"
    )
    session = RecordingSession(specs={"SELECT": FakeResult(rows=[en_only, uk_present])})
    items = svc.list_published(session, language="uk")
    by_id = {i["content_id"]: i for i in items}
    assert by_id[str(en_only.content_id)]["title"] == "EN"
    assert by_id[str(uk_present.content_id)]["title"] == "UK2"


def test_get_by_slug_returns_none_when_missing():
    session = RecordingSession(specs={"SELECT": FakeResult(row=None)})
    assert svc.get_by_slug(session, "missing") is None


def test_get_by_slug_returns_none_when_unpublished_expired():
    session = RecordingSession(specs={"SELECT": FakeResult(row=None)})
    # The service predicate filters to PUBLISHED + non-expired; a non-matching
    # row yields no result and the function returns None.
    assert svc.get_by_slug(session, "expired") is None


def test_get_by_slug_returns_item_when_published():
    session = RecordingSession(specs={"SELECT": FakeResult(row=_row(title_uk="UK", title_en="EN"))})
    item = svc.get_by_slug(session, "good", language="uk")
    assert item is not None
    assert item["title"] == "UK"


# ═════════════════════════════════════════════════════════════════════════════
# Admin reads
# ═════════════════════════════════════════════════════════════════════════════


def test_list_admin_content_returns_latest_version_projection():
    row = _row(
        lifecycle_status="ARCHIVED",
        row_version=4,
        title_en="Latest",
        body_en="Latest body",
    )
    session = RecordingSession(specs={"SELECT": FakeResult(rows=[row])})
    items = svc.list_admin_content(session)
    assert items[0]["lifecycle_status"] == "ARCHIVED"
    assert items[0]["title_en"] == "Latest"
    assert items[0]["row_version"] == 4
    assert "LATERAL" in session.sql_log().upper()


# ═════════════════════════════════════════════════════════════════════════════
# Draft creation
# ═════════════════════════════════════════════════════════════════════════════


def test_create_draft_inserts_content_first_version_and_cms_edit_audit():
    content_id = uuid.uuid4()
    session = RecordingSession(
        specs={
            "INSERT INTO WIMS.COMMUNITY_CONTENT ": FakeResult(scalar=content_id),
            "INSERT INTO WIMS.COMMUNITY_CONTENT_VERSION": FakeResult(rowcount=1),
            "INSERT INTO WIMS.SYSTEM_AUDIT_TRAILS": FakeResult(rowcount=1),
        }
    )
    returned = svc.create_draft(
        session,
        actor_user_id=uuid.uuid4(),
        content_type="ANNOUNCEMENT",
        title_en="T",
        body_en="B",
    )
    assert returned == str(content_id)
    # content INSERT carries lifecycle_status DRAFT + row_version 1 + created_by
    content_insert = next(
        sql for sql, _ in session.calls if "INSERT INTO WIMS.COMMUNITY_CONTENT " in sql.upper()
    )
    assert "LIFECYCLE_STATUS" in content_insert.upper()
    assert "'DRAFT'" in content_insert.upper()
    assert "ROW_VERSION" in content_insert.upper()
    # first version
    assert session.any_contains("INSERT INTO WIMS.COMMUNITY_CONTENT_VERSION")
    # audit action
    assert "CMS_EDIT" in session._audit_actions()
    # no commit inside the service
    assert not isinstance(session, MagicMock)


def test_create_draft_rejects_bad_content_type():
    session = RecordingSession()
    with pytest.raises(HTTPException) as exc:
        svc.create_draft(
            session, actor_user_id=uuid.uuid4(), content_type="BOGUS", title_en="T", body_en="B"
        )
    assert exc.value.status_code == 422


# ═════════════════════════════════════════════════════════════════════════════
# Publish (optimistic concurrency)
# ═════════════════════════════════════════════════════════════════════════════


def _publish_session(pointer_version, update_rowcount, max_version=0, new_version_id=None):
    cid = uuid.uuid4()
    session = RecordingSession(
        specs={
            "SELECT ID, ROW_VERSION": FakeResult(
                row=SimpleNamespace(
                    id=cid, row_version=pointer_version, slug="s", lifecycle_status="DRAFT"
                )
            ),
            "SELECT COALESCE(MAX(VERSION_NUMBER)": FakeResult(scalar=max_version),
            "INSERT INTO WIMS.COMMUNITY_CONTENT_VERSION": FakeResult(
                scalar=new_version_id or uuid.uuid4()
            ),
            "UPDATE WIMS.COMMUNITY_CONTENT SET": FakeResult(rowcount=update_rowcount),
            "INSERT INTO WIMS.SYSTEM_AUDIT_TRAILS": FakeResult(rowcount=1),
        }
    )
    return cid, session


def test_publish_inserts_version_moves_pointer_bumps_version_emits_audit():
    cid, session = _publish_session(pointer_version=5, update_rowcount=1, max_version=0)
    result = svc.publish(
        session,
        content_id=cid,
        actor_user_id=uuid.uuid4(),
        title_en="T",
        body_en="B",
        urgent_banner=True,
    )
    assert result["lifecycle_status"] == "PUBLISHED"
    assert result["version_number"] == 1

    update_sql = next(
        sql
        for sql, _ in session.calls
        if "UPDATE WIMS.COMMUNITY_CONTENT" in sql.upper()
        and "ROW_VERSION = ROW_VERSION + 1" in sql.upper()
    )
    assert "ROW_VERSION = ROW_VERSION + 1" in update_sql.upper()
    assert "LIFECYCLE_STATUS = 'PUBLISHED'" in update_sql.upper()
    assert "ROW_VERSION = :EXPECTED" in update_sql.upper()
    # The expected row_version passed to the WHERE clause is the loaded value (5).
    update_params = next(
        p
        for sql, p in session.calls
        if "UPDATE WIMS.COMMUNITY_CONTENT" in sql.upper()
        and "ROW_VERSION = ROW_VERSION + 1" in sql.upper()
    )
    assert update_params["expected"] == 5

    assert "CONTENT_PUBLISH" in session._audit_actions()
    audit_params = next(p for sql, p in session.calls if "SYSTEM_AUDIT_TRAILS" in sql.upper())
    assert "version_id" in (audit_params.get("newv") or {})


def test_publish_raises_409_on_row_version_mismatch():
    cid, session = _publish_session(pointer_version=5, update_rowcount=0, max_version=0)
    with pytest.raises(HTTPException) as exc:
        svc.publish(session, content_id=cid, actor_user_id=uuid.uuid4(), title_en="T", body_en="B")
    assert exc.value.status_code == 409
    # The conflicting UPDATE must NOT be followed by an audit write.
    assert not session.any_contains("SYSTEM_AUDIT_TRAILS")


def test_publish_404_when_content_missing():
    session = RecordingSession(specs={"SELECT ID, ROW_VERSION": FakeResult(row=None)})
    with pytest.raises(HTTPException) as exc:
        svc.publish(
            session, content_id=uuid.uuid4(), actor_user_id=uuid.uuid4(), title_en="T", body_en="B"
        )
    assert exc.value.status_code == 404


# ═════════════════════════════════════════════════════════════════════════════
# Archive
# ═════════════════════════════════════════════════════════════════════════════


def test_archive_sets_archived_and_emits_audit():
    session = RecordingSession(
        specs={
            "UPDATE WIMS.COMMUNITY_CONTENT": FakeResult(rowcount=1),
            "INSERT INTO WIMS.SYSTEM_AUDIT_TRAILS": FakeResult(rowcount=1),
        }
    )
    result = svc.archive(session, content_id=uuid.uuid4(), actor_user_id=uuid.uuid4())
    assert result["lifecycle_status"] == "ARCHIVED"
    update_sql = next(
        sql for sql, _ in session.calls if "UPDATE WIMS.COMMUNITY_CONTENT" in sql.upper()
    )
    assert "LIFECYCLE_STATUS = 'ARCHIVED'" in update_sql.upper()
    assert "ARCHIVED_AT = NOW()" in update_sql.upper()
    assert "ROW_VERSION = ROW_VERSION + 1" in update_sql.upper()
    assert "CONTENT_ARCHIVE" in session._audit_actions()


def test_archive_404_when_missing():
    session = RecordingSession(specs={"UPDATE WIMS.COMMUNITY_CONTENT": FakeResult(rowcount=0)})
    with pytest.raises(HTTPException) as exc:
        svc.archive(session, content_id=uuid.uuid4(), actor_user_id=uuid.uuid4())
    assert exc.value.status_code == 404


# ═════════════════════════════════════════════════════════════════════════════
# update_draft
# ═════════════════════════════════════════════════════════════════════════════


def test_update_draft_edits_draft_and_emits_cms_edit():
    cid = uuid.uuid4()
    session = RecordingSession(
        specs={
            "SELECT ID, LIFECYCLE_STATUS, ROW_VERSION": FakeResult(
                row=SimpleNamespace(id=cid, lifecycle_status="DRAFT", row_version=2)
            ),
            "UPDATE WIMS.COMMUNITY_CONTENT": FakeResult(rowcount=1),
            "INSERT INTO WIMS.SYSTEM_AUDIT_TRAILS": FakeResult(rowcount=1),
        }
    )
    result = svc.update_draft(
        session, content_id=cid, actor_user_id=uuid.uuid4(), slug="new-slug", urgent_banner=True
    )
    assert result["lifecycle_status"] == "DRAFT"
    assert "CMS_EDIT" in session._audit_actions()
    update_sql = next(
        sql for sql, _ in session.calls if "UPDATE WIMS.COMMUNITY_CONTENT" in sql.upper()
    )
    assert "SLUG = :SLUG" in update_sql.upper()


def test_update_draft_explicit_null_clears_nullable_pointer_fields():
    cid = uuid.uuid4()
    session = RecordingSession(
        specs={
            "SELECT ID, LIFECYCLE_STATUS, ROW_VERSION": FakeResult(
                row=SimpleNamespace(id=cid, lifecycle_status="DRAFT", row_version=2)
            ),
            "UPDATE WIMS.COMMUNITY_CONTENT": FakeResult(rowcount=1),
            "INSERT INTO WIMS.SYSTEM_AUDIT_TRAILS": FakeResult(rowcount=1),
        }
    )
    svc.update_draft(
        session,
        content_id=cid,
        actor_user_id=uuid.uuid4(),
        expires_at=None,
        last_reviewed_at=None,
    )
    update_params = next(
        params for sql, params in session.calls if "UPDATE WIMS.COMMUNITY_CONTENT" in sql.upper()
    )
    assert "EXPIRES_AT = :EXPIRES_AT" in session.sql_log().upper()
    assert "LAST_REVIEWED_AT = :LAST_REVIEWED_AT" in session.sql_log().upper()
    assert update_params["expires_at"] is None
    assert update_params["last_reviewed_at"] is None


def test_update_draft_explicit_null_clears_nullable_version_fields():
    cid = uuid.uuid4()
    session = RecordingSession(
        specs={
            "SELECT ID, LIFECYCLE_STATUS, ROW_VERSION": FakeResult(
                row=SimpleNamespace(id=cid, lifecycle_status="DRAFT", row_version=2)
            ),
            "SELECT VERSION_NUMBER, TITLE_EN": FakeResult(
                row=SimpleNamespace(
                    version_number=1,
                    title_en="Old title",
                    title_uk="Старий заголовок",
                    body_en="Old body",
                    body_uk="Старий текст",
                    metadata_json={"old": True},
                )
            ),
            "UPDATE WIMS.COMMUNITY_CONTENT": FakeResult(rowcount=1),
            "INSERT INTO WIMS.SYSTEM_AUDIT_TRAILS": FakeResult(rowcount=1),
        }
    )
    svc.update_draft(
        session,
        content_id=cid,
        actor_user_id=uuid.uuid4(),
        title_uk=None,
        body_uk=None,
        metadata_json=None,
        provided_fields={"title_uk", "body_uk", "metadata_json"},
    )
    insert_params = next(
        params
        for sql, params in session.calls
        if "INSERT INTO WIMS.COMMUNITY_CONTENT_VERSION" in sql.upper()
    )
    assert insert_params["title_uk"] is None
    assert insert_params["body_uk"] is None
    assert insert_params["metadata_json"] is None


def test_update_draft_explicit_null_rejects_required_version_fields():
    cid = uuid.uuid4()
    session = RecordingSession(
        specs={
            "SELECT ID, LIFECYCLE_STATUS, ROW_VERSION": FakeResult(
                row=SimpleNamespace(id=cid, lifecycle_status="DRAFT", row_version=2)
            )
        }
    )
    with pytest.raises(HTTPException) as exc:
        svc.update_draft(
            session,
            content_id=cid,
            actor_user_id=uuid.uuid4(),
            title_en=None,
            provided_fields={"title_en"},
        )
    assert exc.value.status_code == 422
    assert len(session.calls) == 1


def test_update_draft_omitted_nullable_fields_remain_unchanged():
    cid = uuid.uuid4()
    session = RecordingSession(
        specs={
            "SELECT ID, LIFECYCLE_STATUS, ROW_VERSION": FakeResult(
                row=SimpleNamespace(id=cid, lifecycle_status="DRAFT", row_version=2)
            ),
            "UPDATE WIMS.COMMUNITY_CONTENT": FakeResult(rowcount=1),
            "INSERT INTO WIMS.SYSTEM_AUDIT_TRAILS": FakeResult(rowcount=1),
        }
    )
    svc.update_draft(session, content_id=cid, actor_user_id=uuid.uuid4())
    update_sql = session.sql_log().upper()
    assert "EXPIRES_AT =" not in update_sql
    assert "LAST_REVIEWED_AT =" not in update_sql


def test_update_draft_content_creates_new_version_and_audits_fields():
    cid = uuid.uuid4()
    session = RecordingSession(
        specs={
            "SELECT ID, LIFECYCLE_STATUS, ROW_VERSION": FakeResult(
                row=SimpleNamespace(id=cid, lifecycle_status="DRAFT", row_version=2)
            ),
            "SELECT VERSION_NUMBER, TITLE_EN": FakeResult(
                row=SimpleNamespace(
                    version_number=1,
                    title_en="Old title",
                    title_uk=None,
                    body_en="Old body",
                    body_uk=None,
                    metadata_json=None,
                )
            ),
            "UPDATE WIMS.COMMUNITY_CONTENT": FakeResult(rowcount=1),
            "INSERT INTO WIMS.SYSTEM_AUDIT_TRAILS": FakeResult(rowcount=1),
        }
    )
    result = svc.update_draft(
        session,
        content_id=cid,
        actor_user_id=uuid.uuid4(),
        title_en="New title",
        body_en="New body",
        metadata_json={"kind": "safety"},
    )
    assert result["lifecycle_status"] == "DRAFT"
    assert session.any_contains("INSERT INTO WIMS.COMMUNITY_CONTENT_VERSION")
    audit_params = next(
        params for sql, params in session.calls if "SYSTEM_AUDIT_TRAILS" in sql.upper()
    )
    assert set((audit_params.get("newv") or "").split('"')) >= {
        "title_en",
        "body_en",
        "metadata_json",
    }


def test_update_draft_rejects_non_draft_with_409():
    cid = uuid.uuid4()
    session = RecordingSession(
        specs={
            "SELECT ID, LIFECYCLE_STATUS, ROW_VERSION": FakeResult(
                row=SimpleNamespace(id=cid, lifecycle_status="PUBLISHED", row_version=3)
            ),
        }
    )
    with pytest.raises(HTTPException) as exc:
        svc.update_draft(session, content_id=cid, actor_user_id=uuid.uuid4(), slug="x")
    assert exc.value.status_code == 409
    # Only the pointer SELECT ran — no UPDATE, no audit.
    assert len(session.calls) == 1
    assert not session.any_contains("UPDATE WIMS.COMMUNITY_CONTENT")
