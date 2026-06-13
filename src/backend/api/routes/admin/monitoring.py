"""System Admin API — system monitoring routes."""

from typing import Annotated

import httpx
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth import get_system_admin
from database import get_db
from services.ai_service import _ollama_url

router = APIRouter()


@router.get("/health")
def get_system_health(
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db)],
):
    """Fetch health status for all system components."""
    health = {
        "status": "HEALTHY",
        "components": {
            "database": {"status": "UNKNOWN", "latency_ms": 0},
            "redis": {"status": "UNKNOWN", "latency_ms": 0},
            "keycloak": {"status": "UNKNOWN", "latency_ms": 0},
            "suricata": {"status": "UNKNOWN", "latency_ms": 0},
            "ollama": {"status": "UNKNOWN", "latency_ms": 0},
        },
    }

    import time

    try:
        t0 = time.time()
        db.execute(text("SELECT 1"))
        health["components"]["database"] = {
            "status": "HEALTHY",
            "latency_ms": round((time.time() - t0) * 1000),
        }
    except Exception as e:
        health["components"]["database"] = {
            "status": "UNHEALTHY",
            "error": str(e),
            "latency_ms": 0,
        }
        health["status"] = "DEGRADED"

    try:
        import redis
        import os

        r = redis.from_url(os.getenv("REDIS_URL", "redis://redis:6379/0"))
        t0 = time.time()
        r.ping()
        health["components"]["redis"] = {
            "status": "HEALTHY",
            "latency_ms": round((time.time() - t0) * 1000),
        }
    except Exception as e:
        health["components"]["redis"] = {
            "status": "UNHEALTHY",
            "error": str(e),
            "latency_ms": 0,
        }
        health["status"] = "DEGRADED"

    try:
        from services.keycloak_admin import _get_admin_client

        t0 = time.time()
        adm = _get_admin_client()
        adm.users_count()
        health["components"]["keycloak"] = {
            "status": "HEALTHY",
            "latency_ms": round((time.time() - t0) * 1000),
        }
    except Exception as e:
        health["components"]["keycloak"] = {
            "status": "UNHEALTHY",
            "error": str(e),
            "latency_ms": 0,
        }
        health["status"] = "DEGRADED"

    # Suricata: check if pipeline is flowing by probing wims.security_threat_logs
    try:
        t0 = time.time()
        rows = (
            db.execute(
                text(
                    "SELECT COUNT(*) FROM wims.security_threat_logs "
                    "WHERE timestamp > now() - INTERVAL '5 minutes'"
                )
            ).scalar()
            or 0
        )
        latency = round((time.time() - t0) * 1000)
        if rows > 0:
            health["components"]["suricata"] = {
                "status": "HEALTHY",
                "latency_ms": latency,
            }
        else:
            total = db.execute(text("SELECT COUNT(*) FROM wims.security_threat_logs")).scalar() or 0
            if total == 0:
                health["components"]["suricata"] = {
                    "status": "HEALTHY",
                    "latency_ms": latency,
                    "detail": "fresh deployment — no threat logs yet",
                }
            else:
                health["components"]["suricata"] = {
                    "status": "UNHEALTHY",
                    "latency_ms": latency,
                    "detail": f"no recent logs in 5 min ({total} total rows exist)",
                }
                health["status"] = "DEGRADED"
    except Exception as e:
        health["components"]["suricata"] = {
            "status": "UNHEALTHY",
            "error": str(e),
            "latency_ms": 0,
        }
        health["status"] = "DEGRADED"

    # Ollama: check reachability via /api/tags
    try:
        t0 = time.time()
        with httpx.Client(timeout=5.0) as client:
            resp = client.get(f"{_ollama_url()}/api/tags")
        latency = round((time.time() - t0) * 1000)
        if resp.status_code == 200:
            health["components"]["ollama"] = {
                "status": "HEALTHY",
                "latency_ms": latency,
            }
        else:
            health["components"]["ollama"] = {
                "status": "UNHEALTHY",
                "latency_ms": latency,
                "detail": f"Ollama returned HTTP {resp.status_code}",
            }
            health["status"] = "DEGRADED"
    except Exception as e:
        health["components"]["ollama"] = {
            "status": "UNHEALTHY",
            "error": str(e),
            "latency_ms": 0,
        }
        health["status"] = "DEGRADED"

    return health


@router.get("/monitoring/workers")
def get_worker_status(
    current_user: dict = Depends(get_system_admin),
    db: Session = Depends(get_db),
):
    """Return current Celery worker liveness status."""
    rows = db.execute(
        text("""
            SELECT worker_id, hostname, last_seen, active_tasks, status
            FROM wims.worker_heartbeat
            ORDER BY last_seen DESC
        """)
    ).fetchall()

    return [
        {
            "worker_id": r[0],
            "hostname": r[1],
            "last_seen": r[2].isoformat() if r[2] else None,
            "active_tasks": r[3],
            "status": r[4],
        }
        for r in rows
    ]


@router.get("/monitoring/system")
def get_system_metrics(
    current_user: dict = Depends(get_system_admin),
):
    """Return current system resource metrics (CPU, memory, disk, AI inference, network)."""
    import os
    import psutil as _psutil

    cpu = _psutil.cpu_percent(interval=0.1)
    mem = _psutil.virtual_memory()
    disk = _psutil.disk_usage("/")
    _net = _psutil.net_io_counters()  # None on hosts with no active NICs

    # AI inference stats — read from Redis for cross-process accuracy (Celery + web workers).
    # Falls back to count=0/avg=null gracefully when Redis is unreachable.
    ai_inference: dict = {"avg_latency_ms": None, "count": 0}
    try:
        import redis as _redis

        r = _redis.from_url(os.environ.get("REDIS_URL", "redis://redis:6379/0"))
        count_raw = r.get("wims:ai:inference:count")
        sum_ms_raw = r.get("wims:ai:inference:sum_ms")
        count = int(count_raw) if count_raw else 0
        sum_ms = float(sum_ms_raw) if sum_ms_raw else 0.0
        ai_inference = {
            "avg_latency_ms": round(sum_ms / count, 1) if count > 0 else None,
            "count": count,
        }
    except Exception:
        pass

    return {
        "cpu_percent": cpu,
        "memory": {
            "total_mb": round(mem.total / 1024 / 1024),
            "used_mb": round(mem.used / 1024 / 1024),
            "percent": mem.percent,
        },
        "disk": {
            "total_gb": round(disk.total / 1024 / 1024 / 1024, 1),
            "used_gb": round(disk.used / 1024 / 1024 / 1024, 1),
            "percent": disk.percent,
        },
        "ai_inference": ai_inference,
        "network": {
            "bytes_sent": _net.bytes_sent if _net is not None else 0,
            "bytes_recv": _net.bytes_recv if _net is not None else 0,
        },
    }
