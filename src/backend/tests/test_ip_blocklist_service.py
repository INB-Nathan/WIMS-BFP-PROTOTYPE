"""Tests for services/ip_blocklist.py — block/unblock/list + repeat-offender escalation.

TDD: these tests are written BEFORE the service module exists. They will fail
with ModuleNotFoundError until the implementation is created.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from services.ip_blocklist import (
    block_ip,
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
