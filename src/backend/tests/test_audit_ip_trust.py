"""Verify audit-trace call sites use trusted_client_ip (X-Real-IP), not get_client_ip (XFF).

After the Tier 2 sweep, zero production call sites of get_client_ip should
remain. Test files may still import the alias — that is expected.
"""

import subprocess
from pathlib import Path


def test_zero_production_get_client_ip_usage():
    """No production code (non-test) should call get_client_ip after the sweep."""
    backend_root = Path(__file__).resolve().parents[1]

    # Search all .py files EXCEPT tests/ for get_client_ip usage.
    # Exclude the definition/alias lines and the deprecation docstring.
    result = subprocess.run(
        [
            "rg",
            "-n",
            "get_client_ip",
            "--type",
            "py",
            "-g",
            "!tests/**",
            "-g",
            "!test_*",
            str(backend_root),
        ],
        capture_output=True,
        text=True,
    )

    # Filter out the alias definition and the legacy helper definition
    violations = []
    for line in result.stdout.splitlines():
        # Skip the alias assignment and the legacy function definition
        if "get_client_ip = _legacy_get_client_ip_from_xff" in line:
            continue
        if "def _legacy_get_client_ip_from_xff" in line:
            continue
        if "def get_client_ip" in line:
            continue
        # Skip import lines that still import get_client_ip (ruff will catch F401)
        # We care about actual CALL sites: get_client_ip(request)
        if "get_client_ip(request)" in line or "get_client_ip(req" in line:
            violations.append(line)

    assert not violations, (
        "Production code still calls get_client_ip (should use trusted_client_ip):\n"
        + "\n".join(violations)
    )
