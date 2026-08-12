"""Contract tests for nginx-ultimate-bad-bot-blocker edge integration (issue #517).

Tests the vendored bot-blocker include directives, compose mount, zone-name
collision safety, support file existence, and flood zone definition.

The four nginx configs are parameterized so drift in any of them fails the
build, matching the pattern from test_nginx_forwarded_headers.py.
"""

from __future__ import annotations

from pathlib import Path

import pytest

# ---- Paths ----------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parents[2]

NGINX_CONFIGS = [
    REPO_ROOT / "nginx" / "nginx.conf",
    REPO_ROOT / "nginx" / "nginx.ci.conf",
    REPO_ROOT / "nginx" / "nginx.local.conf",
    REPO_ROOT / "nginx" / "nginx.local-demo.conf",
]

BOT_BLOCKER_DIR = REPO_ROOT / "nginx" / "bot-blocker"

DOCKER_COMPOSE = REPO_ROOT / "docker-compose.yml"

# ---- Helpers --------------------------------------------------------------


def _read_text(path: Path) -> str:
    """Read a text file, raising a clear error on failure."""
    return path.read_text(encoding="utf-8")


# ---- Tests ----------------------------------------------------------------


@pytest.mark.parametrize("config_path", NGINX_CONFIGS, ids=lambda p: p.name)
def test_nginx_globalblacklist_include(config_path: Path) -> None:
    """The http {} block must include the global blacklist.

    This single include goes inside http {} and pulls in the big
    generated blacklist file plus its variable definitions.
    """
    conf = _read_text(config_path)
    assert "include /etc/nginx/bot-blocker/conf.d/globalblacklist.conf;" in conf, (
        f"{config_path.name}: missing globalblacklist.conf include in http block"
    )


@pytest.mark.parametrize("config_path", NGINX_CONFIGS, ids=lambda p: p.name)
def test_nginx_blockbots_ddos_in_every_server(config_path: Path) -> None:
    """Every app-serving server {} block must include both blockbots and ddos.

    Carve-out (matching the existing test pattern):
    - HTTP redirect server blocks (only ``return 301``) are exempt.
    - The ``/health`` location inside an app server is NOT exempt because
      the server block still processes requests that first hit the
      server-scope includes.

    What we verify per server block:
      1. ``include /etc/nginx/bot-blocker/bots.d/blockbots.conf;``
      2. ``include /etc/nginx/bot-blocker/bots.d/ddos.conf;``
    """
    conf = _read_text(config_path)
    lines = conf.splitlines()

    in_server = False
    brace_depth = 0  # tracks nesting inside the current server block
    in_redirect_only = False  # server block that only does return 301
    blockbots_found = False
    ddos_found = False
    server_count = 0
    server_blocks_ok = 0

    for i, line in enumerate(lines):
        stripped = line.strip()

        if not in_server:
            # Detect start of a server block
            if stripped == "server {":
                in_server = True
                brace_depth = 1
                in_redirect_only = True
                blockbots_found = False
                ddos_found = False
                server_count += 1
            continue

        # --- We are inside a server block ---

        # Adjust brace depth for braces in this line
        opens = stripped.count("{")
        closes = stripped.count("}")
        brace_depth += opens - closes

        # Check for redirect-only signals at server-scope brace_depth == 1
        if brace_depth == 1:
            # Including location blocks (opening brace) is not a redirect signal.
            # We look only at actual directive content.
            if stripped.startswith("return ") and stripped.endswith(";"):
                pass  # still might be redirect-only — don't clear yet
        else:
            # Inside a nested block (location, if, etc.) — signal is present
            pass

        # Check for non-redirect signals regardless of nesting
        # proxy_pass anywhere means it's an app-serving block
        if "proxy_pass " in stripped:
            in_redirect_only = False
        # return 444 is a blocking action (bad bot), not redirect-only
        if "return 444" in stripped:
            in_redirect_only = False

        # Track includes
        if "include /etc/nginx/bot-blocker/bots.d/blockbots.conf;" in stripped:
            blockbots_found = True
        if "include /etc/nginx/bot-blocker/bots.d/ddos.conf;" in stripped:
            ddos_found = True

        # Detect end of server block when brace depth drops to 0
        if brace_depth <= 0:
            in_server = False
            # A server block that only contains a return 301 (redirect) is exempt
            if not in_redirect_only:
                assert blockbots_found, (
                    f"{config_path.name}: server block #{server_count} "
                    f"(line ~{i}) missing blockbots.conf include"
                )
                assert ddos_found, (
                    f"{config_path.name}: server block #{server_count} "
                    f"(line ~{i}) missing ddos.conf include"
                )
                server_blocks_ok += 1

    assert server_blocks_ok > 0, (
        f"{config_path.name}: no app-serving server blocks found — are there server blocks at all?"
    )


def test_docker_compose_bot_blocker_volume_mount() -> None:
    """The nginx-gateway service must mount the bot-blocker directory."""
    compose_text = _read_text(DOCKER_COMPOSE)
    assert "./nginx/bot-blocker:/etc/nginx/bot-blocker:ro" in compose_text, (
        "docker-compose.yml: nginx-gateway missing bot-blocker volume mount"
    )


def test_globalblacklist_zone_names_no_collision() -> None:
    """No zone names in globalblacklist.conf collide with existing WIMS zones.

    The vendored upstream file defines its own limit_conn_zone and
    limit_req_zone entries. None of those zone names may collide with
    WIMS-owned zone names or the test falls to assert.

    Existing WIMS zones (defined in all 3 configs):
      addr, general_api, public_api, civilian_api, keycloak_api,
      reset_credentials
    Upstream uses ``bot2_connlimit``, ``bot2_reqlimitip``,
    ``bot4_connlimit``, ``bot4_reqlimitip`` (all bot-prefixed — safe).
    """
    gbc = BOT_BLOCKER_DIR / "conf.d" / "globalblacklist.conf"
    text = _read_text(gbc)

    # Collect all zone names defined by the upstream file
    upstream_zones: set[str] = set()
    for line in text.splitlines():
        stripped = line.strip()
        # Match lines like:
        #   limit_conn_zone $bot_iplimit zone=bot2_connlimit:16m;
        if "zone=" not in stripped:
            continue
        if "limit_conn_zone" not in stripped and "limit_req_zone" not in stripped:
            # Ignore any other random zone= references (e.g. proxy_cache_path)
            continue
        # Extract the zone name after 'zone='
        # Format typically: zone=bot2_connlimit:16m
        idx = stripped.find("zone=")
        if idx == -1:
            continue
        rest = stripped[idx + 5 :]  # after "zone="
        colon = rest.find(":")
        zone_name = rest[:colon] if colon != -1 else rest.rstrip(";")
        upstream_zones.add(zone_name)

    assert upstream_zones, (
        "globalblacklist.conf: no limit_conn_zone / limit_req_zone directives found"
    )

    # WIMS-owned zones — do NOT rename these to match upstream; they are
    # our own rate-limit zones defined in the http {} block of each config.
    wims_zones = {
        "addr",
        "general_api",
        "public_api",
        "civilian_api",
        "keycloak_api",
        "reset_credentials",
    }

    collisions = upstream_zones & wims_zones
    assert not collisions, (
        f"globalblacklist.conf zone names collide with existing WIMS zones: {collisions}. "
        f"Upstream zones: {upstream_zones}. "
        f"WIMS zones: {wims_zones}."
    )


def test_bot_blocker_support_files_exist() -> None:
    """All required bot-blocker support files must be present on disk."""
    expected_files = [
        BOT_BLOCKER_DIR / "conf.d" / "globalblacklist.conf",
        BOT_BLOCKER_DIR / "conf.d" / "wims-botblocker-settings.conf",
        BOT_BLOCKER_DIR / "bots.d" / "blockbots.conf",
        BOT_BLOCKER_DIR / "bots.d" / "ddos.conf",
        BOT_BLOCKER_DIR / "bots.d" / "blacklist-user-agents.conf",
        BOT_BLOCKER_DIR / "bots.d" / "blacklist-ips.conf",
        BOT_BLOCKER_DIR / "bots.d" / "bad-referrer-words.conf",
        BOT_BLOCKER_DIR / "bots.d" / "custom-bad-referrers.conf",
        BOT_BLOCKER_DIR / "bots.d" / "whitelist-ips.conf",
        BOT_BLOCKER_DIR / "bots.d" / "whitelist-domains.conf",
    ]

    missing = [str(p.relative_to(REPO_ROOT)) for p in expected_files if not p.exists()]
    assert not missing, f"Missing bot-blocker support files: {missing}"


def test_bot_blocker_no_429_content() -> None:
    """No vendored bot-blocker file may contain GitHub 429 response text.

    If upstream downloads hit GitHub rate limits during development,
    the raw 429 HTML page gets stored instead of the actual .conf file,
    which would cause nginx syntax errors or missing MIT license text.
    """
    all_files = list(BOT_BLOCKER_DIR.rglob("*"))
    all_files = [f for f in all_files if f.is_file() and f.name != ".gitkeep"]

    infected: list[str] = []
    for f in all_files:
        try:
            content = _read_text(f)
            if "429: Too Many Requests" in content:
                infected.append(str(f.relative_to(REPO_ROOT)))
        except Exception:
            infected.append(f"{f.relative_to(REPO_ROOT)} (unreadable)")

    assert not infected, (
        "Bot-blocker files contain GitHub 429 response (rate-limited during download):\n"
        + "\n".join(f"  - {p}" for p in infected)
    )


def test_bot_blocker_include_paths_resolve() -> None:
    """All absolute include paths in vendored .conf files must resolve
    under /etc/nginx/bot-blocker/ to match the compose volume mount.

    The upstream globalblacklist.conf originally references files at
    /etc/nginx/bots.d/*, but WIMS mounts the directory at
    /etc/nginx/bot-blocker/. Any absolute include path must use the
    mounted prefix.
    """
    conf_files = list(BOT_BLOCKER_DIR.rglob("*.conf"))

    violations: list[str] = []
    for f in conf_files:
        content = _read_text(f)
        for line in content.splitlines():
            line = line.strip()
            if line.startswith("include") and "/etc/nginx" in line:
                if "/etc/nginx/bot-blocker/" not in line:
                    violations.append(f"{f.relative_to(REPO_ROOT)}: {line}")

    assert not violations, (
        "Absolute include paths must use /etc/nginx/bot-blocker/ prefix:\n"
        + "\n".join(f"  - {v}" for v in violations)
    )


def test_bot_blocker_flood_zone_defined() -> None:
    """wims-botblocker-settings.conf must define the ``flood`` zone.

    The upstream ddos.conf uses ``limit_req zone=flood burst=200 nodelay;``
    which requires a corresponding ``limit_req_zone`` with zone=flood
    in the http {} scope. The WIMS settings file provides this definition
    without colliding with the upstream generated file.
    """
    settings_path = BOT_BLOCKER_DIR / "conf.d" / "wims-botblocker-settings.conf"
    text = _read_text(settings_path)
    assert "zone=flood" in text, (
        "wims-botblocker-settings.conf must define limit_req_zone with zone=flood "
        "(required by upstream ddos.conf)"
    )
