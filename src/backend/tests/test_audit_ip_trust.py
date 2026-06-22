"""Verify audit-trace call sites use trusted_client_ip (X-Real-IP), not get_client_ip (XFF).

After the Tier 2 sweep, zero production call sites of get_client_ip should
remain. Test files may still import the alias — that is expected.
"""

from pathlib import Path


def test_zero_production_get_client_ip_usage():
    """No production code (non-test) should call get_client_ip after the sweep."""
    backend_root = Path(__file__).resolve().parents[1]

    # Pure-Python scan: walk the backend tree, skip the tests/ subtree,
    # and collect every line mentioning ``get_client_ip`` in a non-test
    # .py file. This replaces an earlier ``subprocess.run(["rg", ...])``
    # call that depended on ripgrep being installed on the CI runner.
    violations: list[str] = []
    for path in sorted(backend_root.rglob("*.py")):
        rel = path.relative_to(backend_root)
        if rel.parts and rel.parts[0] == "tests":
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for lineno, line in enumerate(text.splitlines(), start=1):
            if "get_client_ip" not in line:
                continue
            # Skip the alias assignment and the legacy function definition
            if "get_client_ip = _legacy_get_client_ip_from_xff" in line:
                continue
            if "def _legacy_get_client_ip_from_xff" in line:
                continue
            if "def get_client_ip" in line:
                continue
            # We care about actual CALL sites: get_client_ip(request)
            if "get_client_ip(request)" in line or "get_client_ip(req" in line:
                violations.append(f"{rel}:{lineno}:{line}")

    assert not violations, (
        "Production code still calls get_client_ip (should use trusted_client_ip):\n"
        + "\n".join(violations)
    )
