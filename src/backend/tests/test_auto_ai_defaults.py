"""Regression tests for production-safe automatic Ollama analysis defaults."""

from __future__ import annotations

from pathlib import Path


def test_auto_ai_analysis_seed_defaults_to_manual_mode():
    """Fresh/replayed SQL bootstrap must keep auto AI opt-in, not default-on."""
    repo_root = Path(__file__).resolve().parents[2]
    sql = (repo_root / "postgres-init" / "75_security_log_rollups.sql").read_text()

    assert "('auto_ai_analysis_enabled', 'false'" in sql
    assert "('auto_ai_analysis_enabled', 'true'" not in sql
