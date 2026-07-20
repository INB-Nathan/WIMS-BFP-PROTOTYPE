"""Resolve privacy-minimized city/municipality GeoIP evidence."""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from schemas.geoip import CoarseIpEvidence, CoarseIpResult, CoarseIpUnavailable

logger = logging.getLogger(__name__)


def _open_reader() -> Any | None:
    db_path = os.environ.get("GEOIP_DB_PATH", "")
    if not db_path or not Path(db_path).is_file():
        return None
    try:
        import geoip2.database  # type: ignore[import-untyped]

        return geoip2.database.Reader(db_path)
    except Exception:
        logger.info("Coarse GeoIP database is unavailable")
        return None


def resolve_coarse_ip_evidence(client_ip: str) -> CoarseIpResult:
    """Resolve approved coarse fields without returning or logging ``client_ip``."""

    reader = _open_reader()
    if reader is None:
        return CoarseIpUnavailable(reason="database_unavailable")

    try:
        record = reader.city(client_ip)
        latitude = record.location.latitude
        longitude = record.location.longitude
        if latitude is None or longitude is None:
            return CoarseIpUnavailable(reason="coordinates_unavailable")

        accuracy_km = record.location.accuracy_radius
        accuracy_m = None if accuracy_km is None else max(0, round(float(accuracy_km) * 1000))
        try:
            provider = reader.metadata().database_type or "MaxMind-City"
        except Exception:
            provider = "MaxMind-City"

        return CoarseIpEvidence(
            city=record.city.name,
            province=record.subdivisions.most_specific.name,
            latitude=float(latitude),
            longitude=float(longitude),
            accuracy_m=accuracy_m,
            provider=provider,
            lookup_at=datetime.now(timezone.utc),
        )
    except Exception:
        logger.info("Coarse GeoIP lookup unavailable")
        return CoarseIpUnavailable(reason="lookup_unavailable")
    finally:
        reader.close()


def persist_coarse_ip_evidence(
    db: Session,
    report_id: int,
    evidence: CoarseIpResult,
) -> None:
    """Persist only approved coarse fields; unavailable evidence writes nothing."""

    if not isinstance(evidence, CoarseIpEvidence):
        return
    db.execute(
        text("""
            UPDATE wims.citizen_reports
            SET ip_geo_city = :city,
                ip_geo_province = :province,
                ip_geo_centroid = ST_SetSRID(
                    ST_MakePoint(:longitude, :latitude), 4326
                )::geography,
                ip_geo_accuracy_m = :accuracy_m,
                ip_geo_provider = :provider,
                ip_geo_lookup_at = :lookup_at
            WHERE report_id = :report_id
        """),
        {
            "report_id": report_id,
            "city": evidence.city,
            "province": evidence.province,
            "latitude": evidence.latitude,
            "longitude": evidence.longitude,
            "accuracy_m": evidence.accuracy_m,
            "provider": evidence.provider,
            "lookup_at": evidence.lookup_at,
        },
    )
