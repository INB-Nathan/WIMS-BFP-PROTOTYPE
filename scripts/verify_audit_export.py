#!/usr/bin/env python3
"""Verify WIMS tamper-proof audit exports offline or through the API."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

try:
    import requests
except ImportError:  # pragma: no cover - exercised by installation environments
    requests = None

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = REPO_ROOT / "src" / "backend"
sys.path.insert(0, str(BACKEND_ROOT))

from services.audit_export import create_export_zip  # noqa: E402
from services.audit_export_verifier import (  # noqa: E402
    ArchiveTooLargeError,
    ArchiveValidationError,
    verify_local_package,
)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "paths", nargs="+", help="ZIP, or CSV PDF manifest files in that order"
    )
    parser.add_argument(
        "--offline", action="store_true", help="verify with a local PEM public key"
    )
    parser.add_argument(
        "--public-key-file",
        type=Path,
        help="PEM P-256 public key for offline verification",
    )
    parser.add_argument(
        "--api-url", help="verification API base URL (for online verification)"
    )
    parser.add_argument(
        "--token",
        default=os.environ.get("WIMS_AUDIT_VERIFY_TOKEN"),
        help="Bearer token",
    )
    return parser


def _load_package(paths: list[str]) -> bytes:
    if len(paths) == 1:
        return Path(paths[0]).read_bytes()
    if len(paths) == 3:
        csv_path, pdf_path, sig_path = (Path(item) for item in paths)
        return create_export_zip(
            csv_path.read_bytes(), pdf_path.read_bytes(), sig_path.read_bytes()
        )
    raise ValueError("provide one ZIP or exactly CSV, PDF, and manifest files")


def _print_result(verified: bool, warnings: list[str], checks: dict) -> None:
    print(
        json.dumps(
            {"verified": verified, "warnings": warnings, "checks": checks},
            sort_keys=True,
        )
    )


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.offline:
        if args.api_url or not args.public_key_file:
            print(
                "offline mode requires --public-key-file and does not accept --api-url",
                file=sys.stderr,
            )
            return 2
        try:
            package = _load_package(args.paths)
            verified, warnings, checks, _manifest = verify_local_package(
                package, args.public_key_file.read_bytes()
            )
        except (
            OSError,
            ValueError,
            ArchiveValidationError,
            ArchiveTooLargeError,
        ) as exc:
            print(f"input error: {exc}", file=sys.stderr)
            return 2
        _print_result(
            verified,
            warnings,
            {key: value.model_dump(mode="json") for key, value in checks.items()},
        )
        return 0 if verified else 1

    if not args.api_url or len(args.paths) != 1:
        print("online mode requires --api-url and one ZIP path", file=sys.stderr)
        return 2
    if requests is None:
        print("online mode requires the requests package", file=sys.stderr)
        return 3
    try:
        package = _load_package(args.paths)
        headers = {"Authorization": f"Bearer {args.token}"} if args.token else {}
        response = requests.post(
            args.api_url.rstrip("/") + "/admin/audit-logs/export/verify",
            files={"file": (Path(args.paths[0]).name, package, "application/zip")},
            headers=headers,
            timeout=(10, 60),
            allow_redirects=False,
        )
    except (OSError, requests.RequestException) as exc:
        print(f"network error: {exc}", file=sys.stderr)
        return 3
    if response.status_code in {400, 413, 422}:
        print(
            f"verification input rejected (HTTP {response.status_code})",
            file=sys.stderr,
        )
        return 2
    if response.status_code >= 300:
        print(
            f"verification API unavailable (HTTP {response.status_code})",
            file=sys.stderr,
        )
        return 3
    try:
        result = response.json()
    except ValueError as exc:
        print(f"verification API returned invalid JSON: {exc}", file=sys.stderr)
        return 3
    safe_result = {
        "verified": bool(result.get("verified")),
        "warnings": result.get("warnings", []),
        "checks": result.get("checks", {}),
    }
    print(json.dumps(safe_result, sort_keys=True))
    return 0 if safe_result["verified"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
