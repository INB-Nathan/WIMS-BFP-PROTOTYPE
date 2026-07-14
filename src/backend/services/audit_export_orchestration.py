"""Database orchestration for secure audit-export packages."""

from __future__ import annotations

import os
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from schemas.audit_export import (
    AuditExportCsvDialect,
    AuditExportIdentity,
    AuditExportManifest,
    AuditExportSigningKey,
)
from services.audit_export import (
    MAX_AUDIT_EXPORT_ROWS,
    CanonicalCsvWriter,
    canonical_manifest_bytes,
    compute_csv_hash,
    compute_filter_hash,
    create_export_zip,
    public_key_fingerprint,
)
from services.audit_export_pdf import AuditExportPdfGenerator, compute_pdf_hash
from services.kms.openbao_client import OpenBaoClient
from services.regional_incidents.helpers import build_audit_log_query
from utils.audit import AUDIT_SECURE_EXPORT, log_system_audit


class AuditExportTooLargeError(ValueError):
    """Raised when the secure export exceeds the hard row limit."""


class AuditExportAuditError(RuntimeError):
    """Raised when the fail-closed export audit row cannot be committed."""


@dataclass(frozen=True)
class AuditExportPackage:
    zip_bytes: bytes
    export_uuid: uuid.UUID


ADMIN_COLUMNS = (
    "audit_id",
    "timestamp",
    "username",
    "user_id",
    "action_type",
    "table_affected",
    "record_id",
    "result",
    "ip_address",
    "correlation_id",
    "user_agent",
)
VALIDATOR_COLUMNS = (
    "history_id",
    "incident_id",
    "region_id",
    "region_display",
    "action_by_user_id",
    "actor_username",
    "previous_status",
    "new_status",
    "action_label",
    "notes",
    "action_timestamp",
)


def _admin_where(filters: Mapping[str, Any]) -> tuple[str, dict[str, Any]]:
    clauses: list[str] = []
    params: dict[str, Any] = {}
    if filters.get("user_id") is not None:
        clauses.append("sat.user_id = :user_id")
        params["user_id"] = filters["user_id"]
    if filters.get("action_type") is not None:
        clauses.append("sat.action_type = :action_type")
        params["action_type"] = filters["action_type"]
    if filters.get("table_affected") is not None:
        clauses.append("sat.table_affected = :table_affected")
        params["table_affected"] = filters["table_affected"]
    if filters.get("ip_address") is not None:
        clauses.append("sat.ip_address = :ip_address")
        params["ip_address"] = filters["ip_address"]
    if filters.get("date_from") is not None:
        clauses.append("sat.timestamp >= CAST(:date_from AS timestamptz)")
        params["date_from"] = filters["date_from"]
    if filters.get("date_to") is not None:
        clauses.append("sat.timestamp <= CAST(:date_to AS timestamptz)")
        params["date_to"] = filters["date_to"]
    if filters.get("q"):
        clauses.append("sat.search_vector @@ websearch_to_tsquery('english', :q)")
        params["q"] = str(filters["q"]).strip()
    return ("WHERE " + " AND ".join(clauses)) if clauses else "", params


def _value(row: Any, key: str, index: int) -> Any:
    mapping = getattr(row, "_mapping", None)
    if mapping is not None:
        return mapping.get(key)
    return row[index]


def _timestamp(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    return str(value)


def _actor_identity(actor: Mapping[str, Any]) -> AuditExportIdentity:
    return AuditExportIdentity(
        user_id=actor["user_id"],
        username=actor.get("username") or actor.get("kc_username"),
        role=str(actor["role"]),
    )


def _filters_with_scope(
    filters: Mapping[str, Any], *, export_scope: str, actor_user_id: Any
) -> dict[str, Any]:
    result = {key: filters.get(key) for key in filters}
    result["export_scope"] = export_scope
    result["actor_user_id"] = str(actor_user_id)
    return result


def _fetch_admin_rows(db: Session, filters: Mapping[str, Any]) -> list[dict[str, Any]]:
    where_sql, params = _admin_where(filters)
    rows = db.execute(
        text(
            f"""
            SELECT sat.audit_id, sat.timestamp, u.username, sat.user_id,
                   sat.action_type, sat.table_affected, sat.record_id,
                   sat.result, sat.ip_address, sat.correlation_id, sat.user_agent
            FROM wims.system_audit_trails sat
            LEFT JOIN wims.users u ON sat.user_id = u.user_id
            {where_sql}
            ORDER BY sat.timestamp DESC, sat.audit_id DESC
            LIMIT :row_limit
            """
        ),
        {**params, "row_limit": MAX_AUDIT_EXPORT_ROWS + 1},
    ).fetchall()
    return [
        {
            "audit_id": _value(row, "audit_id", 0),
            "timestamp": _timestamp(_value(row, "timestamp", 1)),
            "username": _value(row, "username", 2) or "",
            "user_id": str(_value(row, "user_id", 3)) if _value(row, "user_id", 3) else "",
            "action_type": _value(row, "action_type", 4) or "",
            "table_affected": _value(row, "table_affected", 5) or "",
            "record_id": _value(row, "record_id", 6),
            "result": _value(row, "result", 7) or "",
            "ip_address": _value(row, "ip_address", 8) or "",
            "correlation_id": _value(row, "correlation_id", 9) or "",
            "user_agent": str(_value(row, "user_agent", 10) or "").replace("\n", " "),
        }
        for row in rows
    ]


def _fetch_validator_rows(
    db: Session, filters: Mapping[str, Any], actor_user_id: Any
) -> list[dict[str, Any]]:
    where_sql, params = build_audit_log_query(
        actor_user_id=str(actor_user_id),
        date_from=filters.get("date_from"),
        date_to=filters.get("date_to"),
        region_id=filters.get("region_id"),
        actor_username=filters.get("actor_username"),
        role=filters.get("role"),
        action=filters.get("action"),
    )
    rows = db.execute(
        text(
            f"""
            SELECT ivh.history_id, ivh.target_id, fi.region_id,
                   ivh.action_by_user_id, ivh.previous_status, ivh.new_status,
                   ivh.notes, ivh.action_timestamp,
                   u.username AS actor_username,
                   rr.region_name AS region_display,
                   ivh.action_label
            FROM wims.incident_verification_history ivh
            JOIN wims.fire_incidents fi ON fi.incident_id = ivh.target_id
            LEFT JOIN wims.users u ON u.user_id = ivh.action_by_user_id
            LEFT JOIN wims.ref_regions rr ON rr.region_id = fi.region_id
            WHERE {where_sql}
            ORDER BY ivh.action_timestamp DESC, ivh.history_id DESC
            LIMIT :row_limit
            """
        ),
        {**params, "row_limit": MAX_AUDIT_EXPORT_ROWS + 1},
    ).fetchall()
    return [
        {
            "history_id": _value(row, "history_id", 0),
            "incident_id": _value(row, "target_id", 1),
            "region_id": _value(row, "region_id", 2),
            "region_display": _value(row, "region_display", 9) or "",
            "action_by_user_id": str(_value(row, "action_by_user_id", 3)),
            "actor_username": _value(row, "actor_username", 8) or "",
            "previous_status": _value(row, "previous_status", 4) or "",
            "new_status": _value(row, "new_status", 5) or "",
            "action_label": _value(row, "action_label", 10) or "",
            "notes": _value(row, "notes", 6) or "",
            "action_timestamp": _timestamp(_value(row, "action_timestamp", 7)),
        }
        for row in rows
    ]


def _build_package(
    *,
    rows: list[dict[str, Any]],
    columns: tuple[str, ...],
    filters: dict[str, Any],
    actor: Mapping[str, Any],
    export_scope: str,
    table_affected: str,
    request: Any,
    db: Session,
    client: OpenBaoClient,
) -> AuditExportPackage:
    if len(rows) > MAX_AUDIT_EXPORT_ROWS:
        raise AuditExportTooLargeError("audit export exceeds the maximum of 50,000 rows")
    exported_at = datetime.now(timezone.utc)
    export_uuid = uuid.uuid4()
    csv_bytes, chain_hash, row_count = CanonicalCsvWriter(columns).write(rows)
    pdf_bytes = AuditExportPdfGenerator(
        rows=rows,
        columns=columns,
        filters=filters,
        exported_at=exported_at,
        export_uuid=str(export_uuid),
        row_count=row_count,
        export_scope=export_scope,
    ).generate()
    key_name = os.environ.get("WIMS_AUDIT_EXPORT_SIGNING_KEY", "audit-export-signer")
    public_key_version = client.metadata(key_name).latest_version
    public_key = client.public_key(key_name, public_key_version)
    signing_key = AuditExportSigningKey(
        provider="openbao_transit",
        key_name=key_name,
        key_version=public_key_version,
        algorithm="sha2-256",
        key_fingerprint=public_key_fingerprint(public_key),
    )
    unsigned = AuditExportManifest(
        version=1,
        export_uuid=export_uuid,
        exported_at=exported_at,
        exported_by=_actor_identity(actor),
        export_scope=export_scope,
        filters=filters,
        filter_hash=compute_filter_hash(filters),
        row_count=row_count,
        csv_hash=compute_csv_hash(csv_bytes),
        csv_chain_final_hash=chain_hash,
        csv_dialect=AuditExportCsvDialect(columns=list(columns)),
        pdf_hash=compute_pdf_hash(pdf_bytes),
        signing_key=signing_key,
        signature="pending",
    )
    signed = client.sign(key_name, canonical_manifest_bytes(unsigned))
    if signed.key_version != public_key_version:
        public_key = client.public_key(key_name, signed.key_version)
        signing_key = signing_key.model_copy(
            update={
                "key_version": signed.key_version,
                "key_fingerprint": public_key_fingerprint(public_key),
            }
        )
        unsigned = unsigned.model_copy(update={"signing_key": signing_key})
        signed = client.sign(key_name, canonical_manifest_bytes(unsigned))
    manifest = unsigned.model_copy(update={"signature": signed.signature})
    manifest_bytes = canonical_manifest_bytes(manifest, include_signature=True)
    package_zip = create_export_zip(csv_bytes, pdf_bytes, manifest_bytes)
    audit_values = {
        "export_uuid": str(export_uuid),
        "export_scope": export_scope,
        "actor_user_id": str(actor["user_id"]),
        "exported_at": exported_at.isoformat().replace("+00:00", "Z"),
        "filter_hash": manifest.filter_hash,
        "row_count": row_count,
        "csv_hash": manifest.csv_hash,
        "csv_chain_final_hash": manifest.csv_chain_final_hash,
        "pdf_hash": manifest.pdf_hash,
        "signing_key_name": key_name,
        "signing_key_version": signed.key_version,
    }
    try:
        log_system_audit(
            db,
            actor["user_id"],
            AUDIT_SECURE_EXPORT,
            table_affected,
            None,
            request,
            new_values=audit_values,
            result="success",
            sensitive=True,
        )
        db.commit()
    except Exception as exc:
        db.rollback()
        raise AuditExportAuditError("secure audit export audit row could not be committed") from exc
    return AuditExportPackage(
        zip_bytes=package_zip,
        export_uuid=export_uuid,
    )


def build_admin_export(
    db: Session,
    actor: Mapping[str, Any],
    filters: Mapping[str, Any],
    request: Any,
    client: OpenBaoClient | None = None,
) -> AuditExportPackage:
    scoped_filters = _filters_with_scope(
        filters, export_scope="admin", actor_user_id=actor["user_id"]
    )
    rows = _fetch_admin_rows(db, filters)
    return _build_package(
        rows=rows,
        columns=ADMIN_COLUMNS,
        filters=scoped_filters,
        actor=actor,
        export_scope="admin",
        table_affected="wims.system_audit_trails",
        request=request,
        db=db,
        client=client or OpenBaoClient(),
    )


def build_validator_export(
    db: Session,
    actor: Mapping[str, Any],
    filters: Mapping[str, Any],
    request: Any,
    client: OpenBaoClient | None = None,
) -> AuditExportPackage:
    scoped_filters = _filters_with_scope(
        filters, export_scope="validator", actor_user_id=actor["user_id"]
    )
    rows = _fetch_validator_rows(db, filters, actor["user_id"])
    return _build_package(
        rows=rows,
        columns=VALIDATOR_COLUMNS,
        filters=scoped_filters,
        actor=actor,
        export_scope="validator",
        table_affected="wims.incident_verification_history",
        request=request,
        db=db,
        client=client or OpenBaoClient(),
    )
