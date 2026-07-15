from __future__ import annotations

import io
import importlib.util
import json
from pathlib import Path
from zipfile import ZipFile

from services.audit_export import create_export_zip, EXPORT_ZIP_NAMES
from services.audit_export_verifier import verify_local_package
from tests.test_audit_export_verifier import _package


def _cli_module():
    script = Path(__file__).parents[3] / "scripts" / "verify_audit_export.py"
    spec = importlib.util.spec_from_file_location("verify_audit_export_cli", script)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def test_offline_cli_round_trip_redacts_manifest(capsys, tmp_path):
    package, public_key_pem = _package()
    archive = tmp_path / "export.zip"
    public_key = tmp_path / "audit-export-signer.pem"
    archive.write_bytes(package)
    public_key.write_bytes(public_key_pem)

    result = _cli_module().main(["--offline", "--public-key-file", str(public_key), str(archive)])

    output = capsys.readouterr().out
    assert result == 0
    assert json.loads(output)["verified"] is True
    assert "filters" not in output


def test_online_cli_uses_bearer_token_and_redacts_manifest(monkeypatch, capsys, tmp_path):
    package, _public_key = _package()
    archive = tmp_path / "export.zip"
    archive.write_bytes(package)
    module = _cli_module()
    calls = {}

    class _Response:
        status_code = 200

        @staticmethod
        def json():
            return {
                "verified": True,
                "warnings": [],
                "checks": {"signature": {"status": "pass"}},
                "manifest": {"filters": {"sensitive": "must-not-print"}},
            }

    def fake_post(url, *, files, headers, timeout, allow_redirects):
        calls.update(
            url=url,
            files=files,
            headers=headers,
            timeout=timeout,
            allow_redirects=allow_redirects,
        )
        return _Response()

    monkeypatch.setattr(module.requests, "post", fake_post)
    result = module.main(
        ["--api-url", "https://wims.example/api", "--token", "secret-token", str(archive)]
    )

    output = capsys.readouterr().out
    assert result == 0
    assert calls["url"] == "https://wims.example/api/admin/audit-logs/export/verify"
    assert calls["headers"] == {"Authorization": "Bearer secret-token"}
    assert calls["allow_redirects"] is False
    assert "must-not-print" not in output


def test_offline_cli_rejects_tampered_package():
    package, public_key_pem = _package()

    parts = {}
    with ZipFile(io.BytesIO(package)) as archive:
        for name in EXPORT_ZIP_NAMES:
            parts[name] = archive.read(name)
    parts["export.csv"] = parts["export.csv"].replace(b"LOGIN", b"LOGOUT", 1)
    tampered = create_export_zip(
        parts["export.csv"], parts["export.pdf"], parts["export.audit.sig"]
    )

    verified, _warnings, _checks, _manifest = verify_local_package(tampered, public_key_pem)
    assert verified is False


def test_online_cli_reports_authorization_failures(monkeypatch, capsys, tmp_path):
    package, _public_key = _package()
    archive = tmp_path / "export.zip"
    archive.write_bytes(package)
    module = _cli_module()

    class _Response:
        status_code = 401

    monkeypatch.setattr(module.requests, "post", lambda *_args, **_kwargs: _Response())
    result = module.main(["--api-url", "https://wims.example/api", str(archive)])

    assert result == 3
    assert "verification API unavailable (HTTP 401)" in capsys.readouterr().err
