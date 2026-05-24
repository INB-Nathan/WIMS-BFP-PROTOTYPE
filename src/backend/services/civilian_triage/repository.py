"""Repository helpers for civilian triage workflow commands."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from services.civilian_triage.models import ClusterClaimResponse
from services.civilian_triage.policies import is_cluster_claim_stale


def cluster_claim_response(row) -> ClusterClaimResponse:
    return ClusterClaimResponse(
        cluster_id=row[0],
        status=row[1],
        assigned_to=row[6],
        assigned_to_user_id=str(row[2]) if row[2] else None,
        review_started_at=(
            row[3].replace(tzinfo=timezone.utc) if row[3] and row[3].tzinfo is None else row[3]
        ),
        updated_at=(
            row[4].replace(tzinfo=timezone.utc) if row[4] and row[4].tzinfo is None else row[4]
        ),
        claim_is_stale=is_cluster_claim_stale(row[4]),
    )


def fetch_cluster_for_update(db: Session, cluster_id: int):
    return db.execute(
        text("""
            SELECT c.cluster_id, c.status, c.assigned_to, c.review_started_at,
                   c.updated_at, c.internal_note, u.username AS assigned_username
            FROM wims.citizen_report_clusters c
            LEFT JOIN wims.users u ON u.user_id = c.assigned_to
            WHERE c.cluster_id = :cid
            FOR UPDATE OF c
        """),
        {"cid": cluster_id},
    ).fetchone()


def fetch_cluster(db: Session, cluster_id: int):
    return db.execute(
        text("""
            SELECT c.cluster_id, c.status, c.assigned_to, c.review_started_at,
                   c.updated_at, c.internal_note, u.username AS assigned_username
            FROM wims.citizen_report_clusters c
            LEFT JOIN wims.users u ON u.user_id = c.assigned_to
            WHERE c.cluster_id = :cid
        """),
        {"cid": cluster_id},
    ).fetchone()


def append_internal_note(existing: str | None, user_id: str, action: str, note: str) -> str:
    timestamp = datetime.now(timezone.utc).isoformat()
    entry = f"[{timestamp}] {action} by {user_id}: {note}"
    return f"{existing}\n{entry}" if existing else entry


def ensure_cluster_claim(db: Session, cluster_id: int, user: dict) -> object:
    cluster = fetch_cluster_for_update(db, cluster_id)
    if cluster is None:
        raise HTTPException(status_code=404, detail="Cluster not found")
    if cluster[1] == "CLUSTER_CLOSED":
        raise HTTPException(status_code=409, detail="Cluster is closed")
    if str(cluster[2]) != str(user["user_id"]):
        raise HTTPException(status_code=409, detail="Cluster must be claimed by the current user")
    if is_cluster_claim_stale(cluster[4]):
        raise HTTPException(
            status_code=409, detail="Cluster claim is stale; refresh or reclaim before acting"
        )
    return cluster
