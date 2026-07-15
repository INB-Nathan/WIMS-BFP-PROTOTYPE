"""Tests for services/device_blocklist.py — block/unblock/list + repeat-offender
escalation + self-block prevention + fail-open Redis lookup.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from services.device_blocklist import (
    block_device,
    unblock_device,
    list_blocked_devices,
    is_device_blocked,
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
def threshold_config():
    """Return a scalar mock that returns the default repeat-offender threshold."""
    return MagicMock(scalar=MagicMock(return_value="3"))


# ── block_device ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_block_device_inserts_row_and_redis(db, admin_id):
    """A fresh block inserts a Postgres row and writes the Redis TTL key."""
    db.execute.side_effect = [
        MagicMock(fetchone=MagicMock(return_value=None)),  # already-active check → no existing
        MagicMock(scalar=MagicMock(return_value=0)),  # repeat-offender count = 0
        MagicMock(scalar=MagicMock(return_value="3")),  # threshold = 3
        MagicMock(scalar=MagicMock(return_value=42)),  # INSERT → returning block_id=42
    ]
    with (
        patch("services.device_blocklist._redis_set_block", new=AsyncMock()) as rset,
        patch("services.device_blocklist.log_system_audit"),
    ):
        result = await block_device(db, "abc123", admin_id, "manual", None, 24, "zzz999")

    assert result["device_token_hash"] == "abc123"
    assert result["is_permanent"] is False
    assert result["already_active"] is False
    assert result["repeat_offender"] is False
    assert result["block_count"] == 1
    rset.assert_awaited_once()


@pytest.mark.asyncio
async def test_block_own_device_raises(db, admin_id):
    """Blocking the requester's own device raises ValueError."""
    with pytest.raises(ValueError, match="Cannot block your own device"):
        await block_device(db, "abc123", admin_id, "manual", None, 24, "abc123")


@pytest.mark.asyncio
async def test_block_already_active_noop(db, admin_id):
    """A second block of an already-active device returns already_active=True with no side effects."""
    db.execute.side_effect = [
        MagicMock(fetchone=MagicMock(return_value=("existing",))),  # already-active → found
    ]
    with (
        patch("services.device_blocklist._redis_set_block", new=AsyncMock()) as rset,
        patch("services.device_blocklist.log_system_audit") as audit,
    ):
        result = await block_device(db, "abc123", admin_id, "manual", None, 24, "zzz999")

    assert result["already_active"] is True
    rset.assert_not_awaited()
    audit.assert_not_called()


@pytest.mark.asyncio
async def test_repeat_offender_escalation(db, admin_id):
    """When count >= threshold, the new block is permanent."""
    db.execute.side_effect = [
        MagicMock(fetchone=MagicMock(return_value=None)),  # already-active check → no existing
        MagicMock(scalar=MagicMock(return_value=2)),  # repeat-offender count = 2
        MagicMock(scalar=MagicMock(return_value="3")),  # threshold = 3
        MagicMock(scalar=MagicMock(return_value=99)),  # INSERT → returning block_id=99
    ]
    with (
        patch("services.device_blocklist._redis_set_block", new=AsyncMock()) as rset,
        patch("services.device_blocklist.log_system_audit"),
    ):
        result = await block_device(db, "abc123", admin_id, "manual", None, 24, "zzz999")

    assert result["is_permanent"] is True
    assert result["repeat_offender"] is True
    assert result["block_count"] == 3
    rset.assert_awaited_once()
    # is_permanent was passed as the third positional arg to _redis_set_block
    assert rset.await_args.args[2] is True


@pytest.mark.asyncio
async def test_block_device_no_requester_hash_skips_self_guard(db, admin_id):
    """When requester_device_hash is None (e.g. bulk block from security log), self-guard is skipped."""
    db.execute.side_effect = [
        MagicMock(fetchone=MagicMock(return_value=None)),
        MagicMock(scalar=MagicMock(return_value=0)),
        MagicMock(scalar=MagicMock(return_value="3")),
        MagicMock(scalar=MagicMock(return_value=7)),
    ]
    with (
        patch("services.device_blocklist._redis_set_block", new=AsyncMock()),
        patch("services.device_blocklist.log_system_audit"),
    ):
        result = await block_device(db, "abc123", admin_id, "manual", None, 24, None)

    assert result["already_active"] is False


# ── unblock_device ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_unblock_device_updates_row_and_redis(db, admin_id):
    result_mock = MagicMock()
    result_mock.rowcount = 1
    db.execute.return_value = result_mock

    with (
        patch("services.device_blocklist._redis_del_block", new=AsyncMock()) as rdel,
        patch("services.device_blocklist.log_system_audit"),
    ):
        result = await unblock_device(db, "abc123", admin_id)

    assert result["unblocked_rows"] == 1
    rdel.assert_awaited_once_with("abc123")


@pytest.mark.asyncio
async def test_unblock_device_not_found_returns_zero_rows(db, admin_id):
    result_mock = MagicMock()
    result_mock.rowcount = 0
    db.execute.return_value = result_mock

    with (
        patch("services.device_blocklist._redis_del_block", new=AsyncMock()),
        patch("services.device_blocklist.log_system_audit"),
    ):
        result = await unblock_device(db, "abc123", admin_id)

    assert result["unblocked_rows"] == 0


# ── list_blocked_devices ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_blocked_devices_returns_only_active(db):
    """list_blocked_devices returns rows shaped for the admin panel, with block_count."""
    rows_mock = MagicMock()
    rows_mock.fetchall.return_value = [
        ("abc123", None, None, False, str(uuid4()), "manual", "Mozilla/5.0", None),
    ]
    count_mock = MagicMock(scalar=MagicMock(return_value=2))
    db.execute.side_effect = [rows_mock, count_mock]

    result = await list_blocked_devices(db)

    assert len(result) == 1
    assert result[0]["device_token_hash"] == "abc123"
    assert result[0]["block_count"] == 2
    assert result[0]["user_agent"] == "Mozilla/5.0"


# ── is_device_blocked ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_is_device_blocked_true_when_redis_key_exists():
    fake_redis = AsyncMock()
    fake_redis.exists = AsyncMock(return_value=1)
    fake_redis.aclose = AsyncMock()
    with patch("services.device_blocklist._get_redis", new=AsyncMock(return_value=fake_redis)):
        assert await is_device_blocked("abc123") is True


@pytest.mark.asyncio
async def test_is_device_blocked_false_when_redis_down_fail_open():
    """Redis unavailable → fail-open → returns False rather than raising."""
    with patch("services.device_blocklist._get_redis", new=AsyncMock(return_value=None)):
        assert await is_device_blocked("abc123") is False


@pytest.mark.asyncio
async def test_is_device_blocked_false_on_redis_exception_fail_open():
    fake_redis = AsyncMock()
    fake_redis.exists = AsyncMock(side_effect=Exception("connection reset"))
    fake_redis.aclose = AsyncMock()
    with patch("services.device_blocklist._get_redis", new=AsyncMock(return_value=fake_redis)):
        assert await is_device_blocked("abc123") is False
