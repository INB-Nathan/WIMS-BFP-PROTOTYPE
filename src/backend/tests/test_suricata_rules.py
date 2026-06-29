"""End-to-end tests for Suricata rule loading and alert ingestion pipeline.

Requires Docker services running (suricata container + database).
Marked requires_docker — skipped in CI unless Docker services are available.

Run (from src/):
  docker compose up -d
  docker compose run --rm celery-worker pytest tests/test_suricata_rules.py -v
"""

from __future__ import annotations

import json
import os
import tempfile

import pytest
from sqlalchemy import text

from services.suricata_ingestion import ingest_eve_file

pytestmark = [
    pytest.mark.requires_docker,
    pytest.mark.integration,
    pytest.mark.slow,
]

SKIP_REASON = "Set SKIP_DOCKER_TESTS=1 to skip tests requiring running Docker services"


def _get_db_session():
    from sqlalchemy.exc import OperationalError

    from database import _SessionLocal, set_rls_context
    from tasks.suricata import SYSTEM_SURICATA_USER_ID

    try:
        session = _SessionLocal()
        session.execute(text("SELECT 1"))
        set_rls_context(session, SYSTEM_SURICATA_USER_ID)
        return session
    except OperationalError as exc:
        pytest.skip(f"Database not available: {exc}")
        return None  # unreachable, satisfies type checker


@pytest.fixture
def db_session():
    session = _get_db_session()
    try:
        yield session
    finally:
        if session is not None:
            session.rollback()
            session.close()


def _suricata_exec(cmd: str) -> tuple[int, str]:
    import subprocess

    try:
        result = subprocess.run(
            ["docker", "exec", "wims-suricata"] + cmd.split(),
            capture_output=True,
            timeout=30,
        )
        return result.returncode, (result.stdout + result.stderr).decode(errors="replace")
    except FileNotFoundError:
        return -1, "docker CLI not found"
    except Exception as exc:
        return -1, str(exc)


def _suricata_container_running() -> bool:
    exit_code, _ = _suricata_exec("echo ok")
    return exit_code == 0


class TestSuricataRulesLoaded:
    """Verify Suricata loads all expected rule files at startup."""

    @pytest.fixture(autouse=True)
    def _require_suricata(self):
        if not _suricata_container_running():
            pytest.skip("Suricata container (wims-suricata) not running")

    @pytest.mark.skipif(os.environ.get("SKIP_DOCKER_TESTS") == "1", reason=SKIP_REASON)
    def test_no_missing_rules_warning(self):
        exit_code, output = _suricata_exec("cat /var/log/suricata/suricata.log")
        if exit_code != 0:
            pytest.skip(f"Could not read suricata.log: {output[:200]}")
        assert "No rule files match" not in output, (
            f"Suricata reports missing rule files:\n{output[:2000]}"
        )

    @pytest.mark.skipif(os.environ.get("SKIP_DOCKER_TESTS") == "1", reason=SKIP_REASON)
    def test_rules_count_exceeds_thousand(self):
        exit_code, output = _suricata_exec("suricata --dump-stats")
        if exit_code != 0:
            pytest.skip(f"Could not dump stats: {output[:200]}")
        for line in output.splitlines():
            if "detect.rules_loaded" in line:
                parts = line.split("|")
                count = int(parts[-1].strip())
                assert count > 1000, (
                    f"Expected >1000 loaded rules, got {count}. ET Open rules may not be loading."
                )
                return
        pytest.fail("Could not find detect.rules_loaded in suricata stats")

    @pytest.mark.skipif(os.environ.get("SKIP_DOCKER_TESTS") == "1", reason=SKIP_REASON)
    def test_rule_files_present_in_rules_dir(self):
        exit_code, output = _suricata_exec("ls /var/lib/suricata/rules/")
        if exit_code != 0:
            pytest.skip(f"Could not list rules: {output[:200]}")

        expected = [
            "suricata.rules",
        ]
        for fname in expected:
            assert fname in output, (
                f"Expected rule file {fname} not found in rules directory:\n{output[:1000]}"
            )

    @pytest.mark.skipif(os.environ.get("SKIP_DOCKER_TESTS") == "1", reason=SKIP_REASON)
    def test_suricata_config_loads_suricata_rules(self):
        exit_code, output = _suricata_exec("cat /etc/suricata/suricata.yaml")
        if exit_code != 0:
            pytest.skip(f"Could not read config: {output[:200]}")
        assert "suricata.rules" in output, (
            f"Expected suricata.rules in suricata.yaml rule-files section:\n{output[:2000]}"
        )
        assert "default-rule-path" in output, "Expected default-rule-path in suricata.yaml"


class TestEveToDbPipeline:
    """End-to-end: EVE alert line -> DB row with correct SID."""

    @pytest.mark.skipif(os.environ.get("SKIP_DOCKER_TESTS") == "1", reason=SKIP_REASON)
    def test_custom_owasp_rule_ingest(self, db_session):
        line = json.dumps(
            {
                "event_type": "alert",
                "src_ip": "10.0.0.99",
                "dest_ip": "172.17.0.2",
                "timestamp": "2026-06-07T00:00:00.000000+0000",
                "alert": {"signature_id": 1000005, "severity": 1},
            }
        )
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            f.write(line + "\n")
            path = f.name
        try:
            ingest_eve_file(path, db_session=db_session)
            db_session.commit()

            row = db_session.execute(
                text("""
                    SELECT source_ip, suricata_sid, severity_level, SUM(alert_count)
                    FROM wims.security_threat_log_rollups
                    WHERE suricata_sid = 1000005
                      AND source_ip = '10.0.0.99'
                    GROUP BY source_ip, suricata_sid, severity_level
                    LIMIT 1
                """)
            ).fetchone()

            assert row is not None, (
                "OWASP rule SID 1000005 not found in security_threat_log_rollups after ingestion"
            )
            assert row[0] == "10.0.0.99"
            assert row[1] == 1000005
            assert row[2] == "CRITICAL"  # Suricata priority 1 = most severe
            assert row[3] >= 1
        finally:
            os.unlink(path)

    @pytest.mark.skipif(os.environ.get("SKIP_DOCKER_TESTS") == "1", reason=SKIP_REASON)
    def test_et_open_rule_ingest(self, db_session):
        line = json.dumps(
            {
                "event_type": "alert",
                "src_ip": "192.168.200.1",
                "dest_ip": "10.0.200.1",
                "timestamp": "2026-06-07T01:00:00.000000+0000",
                "alert": {"signature_id": 2010935, "severity": 2},
            }
        )
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            f.write(line + "\n")
            path = f.name
        try:
            ingest_eve_file(path, db_session=db_session)
            db_session.commit()

            row = db_session.execute(
                text("""
                    SELECT source_ip, suricata_sid, severity_level, SUM(alert_count)
                    FROM wims.security_threat_log_rollups
                    WHERE suricata_sid = 2010935
                      AND source_ip = '192.168.200.1'
                    GROUP BY source_ip, suricata_sid, severity_level
                    LIMIT 1
                """)
            ).fetchone()

            assert row is not None, (
                "ET Open SID 2010935 not found in security_threat_log_rollups after ingestion"
            )
            assert row[0] == "192.168.200.1"
            assert row[1] == 2010935
            assert row[2] == "HIGH"  # Suricata priority 2 → HIGH
            assert row[3] >= 1
        finally:
            os.unlink(path)

    @pytest.mark.skipif(os.environ.get("SKIP_DOCKER_TESTS") == "1", reason=SKIP_REASON)
    def test_bfp_custom_rule_ingest(self, db_session):
        line = json.dumps(
            {
                "event_type": "alert",
                "src_ip": "172.16.99.1",
                "dest_ip": "10.0.99.1",
                "timestamp": "2026-06-07T02:00:00.000000+0000",
                "alert": {"signature_id": 1000020, "severity": 1},
            }
        )
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            f.write(line + "\n")
            path = f.name
        try:
            ingest_eve_file(path, db_session=db_session)
            db_session.commit()

            row = db_session.execute(
                text("""
                    SELECT source_ip, suricata_sid, severity_level, SUM(alert_count)
                    FROM wims.security_threat_log_rollups
                    WHERE suricata_sid = 1000020
                      AND source_ip = '172.16.99.1'
                    GROUP BY source_ip, suricata_sid, severity_level
                    LIMIT 1
                """)
            ).fetchone()

            assert row is not None, (
                "BFP custom rule SID 1000020 not found in security_threat_log_rollups after ingestion"
            )
            assert row[0] == "172.16.99.1"
            assert row[1] == 1000020
            assert row[2] == "CRITICAL"  # Suricata priority 1 = most severe
            assert row[3] >= 1
        finally:
            os.unlink(path)
