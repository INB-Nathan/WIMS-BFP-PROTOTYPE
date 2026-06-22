"""Tests for services/ip_blocklist.py — block/unblock/list + repeat-offender escalation.

TDD: these tests are written BEFORE the service module exists. They will fail
with ModuleNotFoundError until the implementation is created.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from services.ip_blocklist import (
    block_ip,
    block_ips_by_filter,
    _get_request_client_ip,
)


@pytest.fixture
def db():
    m = MagicMock()
    m.execute = MagicMock()
    m.commit = MagicMock()
    return m


@pytest.fixture
def admin_id():
    return uuid4()


@pytest.fixture
def allowlist_config():
    """Return a scalar mock that returns the default allowlist."""
    return MagicMock(scalar=MagicMock(return_value="127.0.0.1,::1"))


# ── block_ip ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_block_ip_inserts_row_and_redis(db, admin_id, allowlist_config):
    """A fresh block inserts a Postgres row and writes the Redis TTL key."""
    db.execute.side_effect = [
        allowlist_config,  # _is_allowlisted → not allowlisted
        MagicMock(fetchone=MagicMock(return_value=None)),  # already-active check → no existing
        MagicMock(scalar=MagicMock(return_value=0)),  # repeat-offender count = 0
        MagicMock(scalar=MagicMock(return_value="3")),  # threshold = 3
        MagicMock(scalar=MagicMock(return_value=42)),  # INSERT → returning block_id=42
    ]
    with (
        patch("services.ip_blocklist._redis_set_block", new=AsyncMock()) as rset,
        patch("services.ip_blocklist.log_system_audit"),
    ):
        result = await block_ip(db, "1.2.3.4", admin_id, "manual", None, 24, "9.9.9.9")

    assert result["ip"] == "1.2.3.4"
    assert result["is_permanent"] is False
    assert result["already_active"] is False
    assert result["repeat_offender"] is False
    assert result["block_count"] == 1
    rset.assert_awaited_once()


@pytest.mark.asyncio
async def test_block_self_ip_raises(db, admin_id):
    """Blocking the requester's own IP raises ValueError."""
    with pytest.raises(ValueError, match="Cannot block your own IP"):
        await block_ip(db, "1.2.3.4", admin_id, "manual", None, 24, "1.2.3.4")


@pytest.mark.asyncio
async def test_block_allowlisted_ip_raises(db, admin_id):
    """Blocking an IP on the never-block allowlist raises ValueError."""
    db.execute.side_effect = [
        MagicMock(scalar=MagicMock(return_value="127.0.0.1,::1,1.2.3.4")),
    ]
    with pytest.raises(ValueError, match="never-block allowlist"):
        await block_ip(db, "1.2.3.4", admin_id, "manual", None, 24, "9.9.9.9")


@pytest.mark.asyncio
async def test_block_already_active_noop(db, admin_id, allowlist_config):
    """A second block of an already-active IP returns already_active=True with no side effects."""
    db.execute.side_effect = [
        allowlist_config,  # _is_allowlisted → not allowlisted
        MagicMock(fetchone=MagicMock(return_value=("existing",))),  # already-active → found
    ]
    with (
        patch("services.ip_blocklist._redis_set_block", new=AsyncMock()) as rset,
        patch("services.ip_blocklist.log_system_audit") as audit,
    ):
        result = await block_ip(db, "1.2.3.4", admin_id, "manual", None, 24, "9.9.9.9")

    assert result["already_active"] is True
    rset.assert_not_awaited()
    audit.assert_not_called()


@pytest.mark.asyncio
async def test_repeat_offender_escalation(db, admin_id, allowlist_config):
    """When count >= threshold, the new block is permanent."""
    db.execute.side_effect = [
        allowlist_config,  # _is_allowlisted → not allowlisted
        MagicMock(fetchone=MagicMock(return_value=None)),  # already-active check → no existing
        MagicMock(scalar=MagicMock(return_value=2)),  # repeat-offender count = 2
        MagicMock(scalar=MagicMock(return_value="3")),  # threshold = 3
        MagicMock(scalar=MagicMock(return_value=99)),  # INSERT → returning block_id=99
    ]
    with (
        patch("services.ip_blocklist._redis_set_block", new=AsyncMock()) as rset,
        patch("services.ip_blocklist.log_system_audit"),
    ):
        result = await block_ip(db, "1.2.3.4", admin_id, "manual", None, 24, "9.9.9.9")

    assert result["is_permanent"] is True
    assert result["repeat_offender"] is True
    assert result["block_count"] == 3
    rset.assert_awaited_once()
    # is_permanent was passed as the third positional arg to _redis_set_block
    assert rset.await_args.args[2] is True


# ── block_ips_by_filter ─────────────────────────────────────────────────────────


def _make_filter_side_effect(
    distinct_ips: list[str],
    allowlist_value: str = "127.0.0.1,::1",
    threshold: str = "3",
    count_value: int = 0,
):
    """Create a SQL-text-aware side_effect for db.execute in filter tests."""

    def _side_effect(*args, **kwargs):
        sql_text = str(args[0]) if args else ""
        if "SELECT DISTINCT source_ip" in sql_text:
            m = MagicMock()
            m.fetchall.return_value = [(ip,) for ip in distinct_ips]
            return m
        if "ip_blocklist.allowlist" in sql_text and "repeat_offender" not in sql_text:
            m = MagicMock()
            m.scalar.return_value = allowlist_value
            return m
        if "ip_blocklist.repeat_offender_threshold" in sql_text:
            m = MagicMock()
            m.scalar.return_value = threshold
            return m
        if "COUNT(*) FROM wims.ip_blocklist" in sql_text:
            m = MagicMock()
            m.scalar.return_value = count_value
            return m
        m = MagicMock()
        return m

    return _side_effect


@pytest.mark.asyncio
async def test_block_by_filter_dry_run_returns_counts(db, admin_id):
    """Dry-run returns aggregate counts without calling block_ip."""
    db.execute.side_effect = _make_filter_side_effect(["1.1.1.1", "2.2.2.2", "3.3.3.3"])
    with patch("services.ip_blocklist.block_ip", new=AsyncMock()) as blk:
        result = await block_ips_by_filter(
            db,
            {"severity": "HIGH"},
            admin_id,
            dry_run=True,
            requester_ip="9.9.9.9",
        )
    assert result["dry_run"] is True
    assert result["total_distinct_ips"] == 3
    assert result["would_block"] == 3
    assert result["capped_at"] == 500
    assert result["skipped_self"] == 0
    assert result["skipped_allowlist"] == 0
    blk.assert_not_awaited()


@pytest.mark.asyncio
async def test_block_by_filter_execute_caps_at_500(db, admin_id):
    """With 600 distinct IPs, only the first 500 are blocked."""
    ips = [f"10.0.0.{i}" for i in range(600)]
    db.execute.side_effect = _make_filter_side_effect(ips)
    with patch(
        "services.ip_blocklist.block_ip",
        new=AsyncMock(return_value={"already_active": False, "is_permanent": False}),
    ) as blk:
        result = await block_ips_by_filter(
            db,
            {"severity": "HIGH"},
            admin_id,
            dry_run=False,
            requester_ip="9.9.9.9",
        )
    assert result["capped"] is True
    assert result["blocked_count"] == 500
    assert result["total_distinct_ips"] == 600
    assert result["skipped_self"] == 0
    assert result["skipped_allowlist"] == 0
    assert blk.await_count == 500


@pytest.mark.asyncio
async def test_block_by_filter_skips_self_and_allowlisted(db, admin_id):
    """Requester IP and allowlisted IPs are excluded from the block."""
    db.execute.side_effect = _make_filter_side_effect(
        ["9.9.9.9", "1.2.3.4", "127.0.0.1"],
        allowlist_value="127.0.0.1,::1",
    )
    with patch(
        "services.ip_blocklist.block_ip",
        new=AsyncMock(return_value={"already_active": False, "is_permanent": False}),
    ) as blk:
        result = await block_ips_by_filter(
            db,
            {},
            admin_id,
            dry_run=False,
            requester_ip="9.9.9.9",
        )
    assert result["skipped_self"] == 1
    assert result["skipped_allowlist"] == 1
    assert result["blocked_count"] == 1
    assert result["total_distinct_ips"] == 3
    assert result["capped"] is False
    assert blk.await_count == 1


# ── _get_request_client_ip ────────────────────────────────────────────────────


def test_get_request_client_ip_uses_xreal_ip():
    """X-Real-IP is preferred over X-Forwarded-For and client.host."""
    req = MagicMock()
    req.headers = {"x-real-ip": "5.5.5.5", "x-forwarded-for": "9.9.9.9, 5.5.5.5"}
    assert _get_request_client_ip(req) == "5.5.5.5"


def test_get_request_client_ip_falls_back_to_client_host():
    """When no X-Real-IP header is present, fall back to request.client.host."""
    req = MagicMock()
    req.headers = {}
    req.client.host = "7.7.7.7"
    assert _get_request_client_ip(req) == "7.7.7.7"
