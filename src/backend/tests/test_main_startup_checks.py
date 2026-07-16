"""Unit tests for main.py startup-time config validation (issue #570
criterion 5: "missing env var → startup error", not just a per-request 500).
"""

from __future__ import annotations

import pytest

import main


def test_require_turnstile_secret_key_raises_when_unset(monkeypatch):
    """Missing TURNSTILE_SECRET_KEY must fail fast at boot, not silently
    defer the failure to whichever request first needs CAPTCHA verification."""
    monkeypatch.delenv("TURNSTILE_SECRET_KEY", raising=False)

    with pytest.raises(RuntimeError, match="TURNSTILE_SECRET_KEY"):
        main._require_turnstile_secret_key()


def test_require_turnstile_secret_key_raises_when_empty(monkeypatch):
    monkeypatch.setenv("TURNSTILE_SECRET_KEY", "")

    with pytest.raises(RuntimeError, match="TURNSTILE_SECRET_KEY"):
        main._require_turnstile_secret_key()


def test_require_turnstile_secret_key_passes_when_set(monkeypatch):
    monkeypatch.setenv("TURNSTILE_SECRET_KEY", "1x00000000000000000000000000000000AA")

    main._require_turnstile_secret_key()  # must not raise
