"""Contract tests for Suricata <-> Redis networking in docker-compose.

Pen-test follow-up 2026-06-29: the wims-suricata service uses
`network_mode: "host"` for AF_PACKET raw-socket capture. With host
networking, the container does NOT participate in the wims_internal bridge
network, so Docker DNS cannot resolve the `redis` hostname for it. The fix
is:

  1. Pin the redis container to 172.18.0.5 via `ipv4_address` on the
     wims_internal network (with explicit `ipam.subnet: 172.18.0.0/16`).
  2. Inject the `redis -> 172.18.0.5` mapping into the Suricata container
     via `extra_hosts: ["redis:172.18.0.5"]`.

This file pins that structure so the pipeline cannot silently regress to
"Suricata writes to its own loopback" or "redis hostname unresolvable".

These are YAML contract tests — they read the compose file and assert the
expected structure. They do NOT require a live DB or running stack.
"""

from __future__ import annotations

from pathlib import Path

import yaml


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _compose() -> dict:
    """Load src/docker-compose.yml (the base compose file)."""
    path = _repo_root() / "src" / "docker-compose.yml"
    with path.open() as f:
        return yaml.safe_load(f)


def _suricata_yaml() -> str:
    path = _repo_root() / "src" / "suricata" / "suricata.yaml"
    return path.read_text()


class TestSuricataRedisHostNetworking:
    """Pin the docker-compose structure that makes Suricata -> Redis work
    even though the container uses network_mode: 'host'."""

    def test_wims_suricata_uses_host_network_mode(self) -> None:
        """The host networking mode is required for AF_PACKET — must stay."""
        compose = _compose()
        assert compose["services"]["wims-suricata"]["network_mode"] == "host", (
            "wims-suricata must use network_mode: host for AF_PACKET capture. "
            "If this changes, the redis extra_hosts workaround is no longer "
            "needed but other capture-related constraints apply."
        )

    def test_wims_suricata_has_redis_extra_host(self) -> None:
        """Pin the extra_hosts entry that injects redis -> 172.18.0.5
        into the container's /etc/hosts. Without it, Suricata cannot
        resolve the `redis` hostname under network_mode: host."""
        compose = _compose()
        extra_hosts = compose["services"]["wims-suricata"].get("extra_hosts")
        assert extra_hosts is not None, (
            "wims-suricata must declare extra_hosts so the `redis` hostname "
            "resolves inside the container. Without this, the redis output "
            "in suricata.yaml (redis-server: 'redis') silently fails."
        )
        # Normalize: extra_hosts entries are typically "host:ip" strings.
        entries = [str(e) for e in extra_hosts]
        redis_entry = next((e for e in entries if e.startswith("redis:")), None)
        assert redis_entry is not None, (
            f"extra_hosts must include a `redis:<ip>` entry; got {entries!r}"
        )
        assert redis_entry == "redis:172.18.0.5", (
            f"redis extra_host must pin to 172.18.0.5 (the static redis IP); "
            f"got {redis_entry!r}. If you change the redis ipv4_address in the "
            f"compose, update this value to match."
        )

    def test_redis_has_static_ipv4_address(self) -> None:
        """Pin that redis is assigned 172.18.0.5 explicitly. The extra_hosts
        mapping in wims-suricata depends on this — if redis's IP changes,
        the mapping breaks silently and no alerts reach Redis."""
        compose = _compose()
        redis_networks = compose["services"]["redis"].get("networks")
        assert isinstance(redis_networks, dict), (
            "redis.networks must be a mapping (long form) so ipv4_address "
            "can be specified; got "
            f"{type(redis_networks).__name__}: {redis_networks!r}"
        )
        wims_net = redis_networks.get("wims_internal")
        assert wims_net is not None, "redis must be on the wims_internal network"
        assert wims_net.get("ipv4_address") == "172.18.0.5", (
            f"redis.ipv4_address must be 172.18.0.5 to match the "
            f"wims-suricata extra_hosts mapping; got {wims_net.get('ipv4_address')!r}"
        )

    def test_wims_internal_network_has_ipam_subnet(self) -> None:
        """The network needs an explicit subnet so the static IP 172.18.0.5
        is valid. Without ipam, Docker picks a random subnet and the static
        IP would be rejected."""
        compose = _compose()
        net = compose["networks"]["wims_internal"]
        ipam = net.get("ipam")
        assert ipam is not None, (
            "wims_internal network must declare ipam so the redis "
            "ipv4_address 172.18.0.5 is within a valid subnet"
        )
        configs = ipam.get("config")
        assert configs, "ipam.config must be a non-empty list"
        subnets = [c.get("subnet") for c in configs]
        assert "172.18.0.0/16" in subnets, (
            f"wims_internal ipam.subnet must include 172.18.0.0/16 to "
            f"contain the static redis IP; got {subnets!r}"
        )

    def test_redis_static_ip_is_inside_ipam_subnet(self) -> None:
        """Cross-check: the redis ipv4_address must be inside the ipam
        subnet. Otherwise docker compose will reject the static IP."""
        import ipaddress

        compose = _compose()
        redis_ip = compose["services"]["redis"]["networks"]["wims_internal"]["ipv4_address"]
        ipam_subnets = [
            ipaddress.IPv4Network(c["subnet"])
            for c in compose["networks"]["wims_internal"]["ipam"]["config"]
        ]
        redis_addr = ipaddress.IPv4Address(redis_ip)
        assert any(redis_addr in sn for sn in ipam_subnets), (
            f"redis ipv4_address {redis_ip} is not inside any of the "
            f"ipam subnets {[str(s) for s in ipam_subnets]}"
        )

    def test_redis_output_in_suricata_yaml_targets_redis_hostname(self) -> None:
        """Pin that suricata.yaml keeps `redis-server: "redis"` (the
        hostname), NOT a raw IP. The hostname is the contract — the
        extra_hosts in wims-suricata is what makes it resolvable."""
        content = _suricata_yaml()
        # The redis-server line must be present and target the hostname
        assert 'redis-server: "redis"' in content, (
            'suricata.yaml must keep `redis-server: "redis"` (hostname, '
            "not IP) — the resolution comes from extra_hosts in the "
            "compose file. If you switch to a raw IP here, the comment "
            "block above the redis stanza is misleading."
        )
        # And it must NOT target 127.0.0.1 (the bug from before the fix)
        assert 'redis-server: "127.0.0.1"' not in content, (
            "suricata.yaml must NOT have redis-server: 127.0.0.1 — that was "
            "the pre-fix bug (Suricata's own loopback, never reached Redis)."
        )


class TestSuricataYamlPenTestComment:
    """Pin the documentation comment that explains the pen-test fix in
    suricata.yaml. Catches accidental deletion of the rationale."""

    def test_pen_test_comment_mentions_extra_hosts(self) -> None:
        content = _suricata_yaml()
        # The pen-test follow-up comment must reference extra_hosts so a
        # future maintainer who removes the docker-compose extra_hosts
        # entry sees the explanation pointing back at the YAML.
        assert "extra_hosts" in content, (
            "suricata.yaml pen-test comment must mention `extra_hosts` so "
            "the dependency on the docker-compose entry is documented"
        )

    def test_pen_test_comment_explains_host_networking(self) -> None:
        content = _suricata_yaml()
        assert "network_mode" in content and "host" in content, (
            "suricata.yaml pen-test comment must explain the network_mode: "
            "host constraint (AF_PACKET requires host networking)"
        )

    def test_pen_test_comment_links_2026_06_29(self) -> None:
        """The date stamp anchors the comment to the PR review that
        produced it. Future maintainers can grep for it."""
        content = _suricata_yaml()
        assert "2026-06-29" in content, (
            "suricata.yaml pen-test comment must include the 2026-06-29 date stamp for traceability"
        )
