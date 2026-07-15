"""Tests for device blocklist Celery resync + prune (Wayfinder — issue #569):
tasks/device_blocklist.py, services/device_blocklist.resync_device_blocklist_to_redis,
tasks/data_retention._prune_device_blocklist.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from tasks.data_retention import _prune_device_blocklist, _DEFAULT_DAYS


class TestPruneDeviceBlocklist:
    def test_deletes_expired_and_old_rows(self):
        db = MagicMock()
        result = MagicMock()
        result.rowcount = 4
        db.execute.return_value = result

        with patch("tasks.data_retention.get_config", return_value="365"):
            _prune_device_blocklist(db)

        sql_text = str(db.execute.call_args_list[0].args[0])
        assert "DELETE FROM wims.device_blocklist" in sql_text
        assert "expires_at < now()" in sql_text

    def test_default_retention_days_registered(self):
        assert _DEFAULT_DAYS["retention.device_blocklist_days"] == 365


class TestResyncDeviceBlocklistToRedis:
    @pytest.mark.asyncio
    async def test_restores_active_non_permanent_and_permanent_blocks(self):
        import services.device_blocklist as dbl

        dbl._resync_engine = None

        fake_conn = MagicMock()
        fake_conn.execute.return_value.fetchall.return_value = [
            ("hash_permanent", None, True),
        ]
        fake_engine = MagicMock()
        fake_engine.connect.return_value.__enter__.return_value = fake_conn

        fake_redis = AsyncMock()
        fake_redis.set = AsyncMock()
        fake_redis.aclose = AsyncMock()

        with (
            patch("services.device_blocklist.create_engine", return_value=fake_engine),
            patch.object(dbl, "_get_redis", new=AsyncMock(return_value=fake_redis)),
        ):
            count = await dbl.resync_device_blocklist_to_redis()

        assert count == 1
        fake_redis.set.assert_awaited_once_with("device:block:hash_permanent", "1")

    @pytest.mark.asyncio
    async def test_redis_down_returns_zero(self):
        import services.device_blocklist as dbl

        with patch.object(dbl, "_get_redis", new=AsyncMock(return_value=None)):
            count = await dbl.resync_device_blocklist_to_redis()

        assert count == 0


class TestResyncDeviceBlocklistTask:
    def test_task_returns_service_result(self):
        from tasks.device_blocklist import resync_device_blocklist

        with patch(
            "tasks.device_blocklist.resync_device_blocklist_to_redis",
            new=AsyncMock(return_value=3),
        ):
            result = resync_device_blocklist()

        assert result == 3

    def test_task_swallows_exceptions(self):
        from tasks.device_blocklist import resync_device_blocklist

        with patch(
            "tasks.device_blocklist.resync_device_blocklist_to_redis",
            side_effect=Exception("boom"),
        ):
            result = resync_device_blocklist()

        assert result == 0
