from pathlib import Path

import yaml

SRC = Path(__file__).resolve().parents[2]


def _load(name: str) -> dict:
    return yaml.safe_load((SRC / name).read_text())


def test_osrm_is_production_only_and_internal():
    base = _load("docker-compose.yml")
    prod = _load("docker-compose.prod.yml")

    assert "osrm" not in base["services"]
    osrm = prod["services"]["osrm"]
    assert osrm["image"] == "osrm/osrm-backend:v5.25.0"
    assert osrm["command"] == [
        "osrm-routed",
        "--algorithm",
        "mld",
        "--verbosity",
        "WARNING",
        "/data/active/metro-manila.osrm",
    ]
    assert "ports" not in osrm
    assert osrm["networks"] == {"wims_internal": {"ipv4_address": "172.18.0.9"}}
    assert osrm["volumes"] == ["${OSRM_DATA_DIR:?set OSRM_DATA_DIR}:/data:ro"]
    assert osrm["healthcheck"]["test"] == [
        "CMD-SHELL",
        "test -f /data/active/metro-manila.osrm.cells && test -f /data/active/metro-manila.osrm.partition",
    ]


def test_production_apps_use_osrm_without_hard_health_dependency():
    prod = _load("docker-compose.prod.yml")

    for service_name in ("backend", "celery-worker"):
        service = prod["services"][service_name]
        assert "OSRM_BASE_URL=http://osrm:5000" in service["environment"]
        assert "osrm" not in service.get("depends_on", {})


def test_osrm_has_dns_fallback_without_enabling_local_routing():
    base = _load("docker-compose.yml")

    for service_name in ("backend", "celery-worker"):
        service = base["services"][service_name]
        assert "osrm:172.18.0.9" in service["extra_hosts"]
        assert not any(str(value).startswith("OSRM_BASE_URL=") for value in service["environment"])
