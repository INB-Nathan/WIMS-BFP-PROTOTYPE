"""Triage Queue and Promotion Workflow — ENCODER/VALIDATOR only."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth import get_current_wims_user
from auth import get_db_with_rls
from services.civilian_triage import (
    BulkPromoteRequest,
    ClusterActivityRequest,
    ClusterActivityResponse,
    ClusterClaimRequest,
    ClusterClaimResponse,
    ClusterMergeRequest,
    ClusterSplitRequest,
    CorrectionRequest,
    MergeCandidateResponse,
    TerminalActionRequest,
    TriageQueueResponse,
    WorkflowResult,
    apply_terminal_action_command,
    claim_cluster_command,
    correct_terminal_report_command,
    get_cluster_activity_command,
    get_merge_candidates_command,
    get_queue,
    merge_clusters_command,
    refresh_cluster_activity_command,
    role_can_access_queue,
    role_can_work_cluster,
    split_cluster_command,
)

router = APIRouter(prefix="/api/triage", tags=["triage"])


def _require_encoder_or_validator(
    current_user: Annotated[dict, Depends(get_current_wims_user)],
) -> dict:
    role = current_user.get("role")
    if not role_can_access_queue(role):
        raise HTTPException(
            status_code=403,
            detail=f"Role '{role}' does not have permission to access this resource",
        )
    return current_user


def _require_cluster_workflow_actor(
    current_user: Annotated[dict, Depends(get_current_wims_user)],
) -> dict:
    role = current_user.get("role")
    if not role_can_work_cluster(role):
        raise HTTPException(
            status_code=403,
            detail=f"Role '{role}' does not have permission to access this resource",
        )
    return current_user


@router.get("/queue", response_model=TriageQueueResponse)
def get_triage_queue(
    user: Annotated[dict, Depends(_require_encoder_or_validator)],
    db: Annotated[Session, Depends(get_db_with_rls)],
    needs_help: bool = Query(False),
    someone_else_needs_help: bool = Query(False),
    aging: bool = Query(False),
    timeout_risk: bool = Query(False),
    danger: bool = Query(False),
    confidence: str | None = Query(None),
    unreviewed: bool = Query(False),
    claimed_by_me: bool = Query(False),
    actioned_today: bool = Query(False),
    rejected_today: bool = Query(False),
) -> TriageQueueResponse:
    return get_queue(
        user=user,
        db=db,
        needs_help=needs_help,
        someone_else_needs_help=someone_else_needs_help,
        aging=aging,
        timeout_risk=timeout_risk,
        danger=danger,
        confidence=confidence,
        unreviewed=unreviewed,
        claimed_by_me=claimed_by_me,
        actioned_today=actioned_today,
        rejected_today=rejected_today,
    )


@router.post("/clusters/{cluster_id}/claim", response_model=ClusterClaimResponse)
def claim_cluster(
    cluster_id: int,
    body: ClusterClaimRequest,
    request: Request,
    user: Annotated[dict, Depends(_require_cluster_workflow_actor)],
    db: Annotated[Session, Depends(get_db_with_rls)],
) -> ClusterClaimResponse:
    return claim_cluster_command(cluster_id, body, request, user, db)


@router.post("/clusters/{cluster_id}/activity", response_model=ClusterClaimResponse)
def refresh_cluster_activity(
    cluster_id: int,
    body: ClusterActivityRequest,
    request: Request,
    user: Annotated[dict, Depends(_require_cluster_workflow_actor)],
    db: Annotated[Session, Depends(get_db_with_rls)],
) -> ClusterClaimResponse:
    return refresh_cluster_activity_command(cluster_id, body, request, user, db)


@router.get("/clusters/{cluster_id}/activity", response_model=ClusterActivityResponse)
def get_cluster_activity(
    cluster_id: int,
    _user: Annotated[dict, Depends(_require_cluster_workflow_actor)],
    db: Annotated[Session, Depends(get_db_with_rls)],
) -> ClusterActivityResponse:
    return get_cluster_activity_command(cluster_id, db)


@router.get("/clusters/{cluster_id}/merge-candidates", response_model=MergeCandidateResponse)
def get_merge_candidates(
    cluster_id: int,
    _user: Annotated[dict, Depends(_require_cluster_workflow_actor)],
    db: Annotated[Session, Depends(get_db_with_rls)],
) -> MergeCandidateResponse:
    return get_merge_candidates_command(cluster_id, db)


@router.post("/clusters/{cluster_id}/terminal-action", response_model=WorkflowResult)
def apply_cluster_terminal_action(
    cluster_id: int,
    body: TerminalActionRequest,
    request: Request,
    user: Annotated[dict, Depends(_require_cluster_workflow_actor)],
    db: Annotated[Session, Depends(get_db_with_rls)],
) -> WorkflowResult:
    return apply_terminal_action_command(cluster_id, body, request, user, db)


@router.post("/reports/{report_id}/correct", response_model=WorkflowResult)
def correct_terminal_report(
    report_id: int,
    body: CorrectionRequest,
    request: Request,
    user: Annotated[dict, Depends(_require_cluster_workflow_actor)],
    db: Annotated[Session, Depends(get_db_with_rls)],
) -> WorkflowResult:
    return correct_terminal_report_command(report_id, body, request, user, db)


@router.post("/clusters/{cluster_id}/split", response_model=WorkflowResult, status_code=201)
def split_cluster(
    cluster_id: int,
    body: ClusterSplitRequest,
    request: Request,
    user: Annotated[dict, Depends(_require_cluster_workflow_actor)],
    db: Annotated[Session, Depends(get_db_with_rls)],
) -> WorkflowResult:
    return split_cluster_command(cluster_id, body, request, user, db)


@router.post("/clusters/{target_cluster_id}/merge", response_model=WorkflowResult)
def merge_clusters(
    target_cluster_id: int,
    body: ClusterMergeRequest,
    request: Request,
    user: Annotated[dict, Depends(_require_cluster_workflow_actor)],
    db: Annotated[Session, Depends(get_db_with_rls)],
) -> WorkflowResult:
    return merge_clusters_command(target_cluster_id, body, request, user, db)


@router.get("/pending")
def get_pending_reports(
    user: Annotated[dict, Depends(_require_encoder_or_validator)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """
    Return citizen_reports where status == 'PENDING'.
    Requires ENCODER or VALIDATOR role.
    Deprecated: use GET /api/triage/queue instead.
    """
    rows = db.execute(
        text("""
            SELECT report_id, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon,
                   status, description, created_at
            FROM wims.citizen_reports
            WHERE status = 'PENDING'
            ORDER BY created_at ASC
        """),
    ).fetchall()

    return [
        {
            "report_id": r[0],
            "latitude": float(r[1]),
            "longitude": float(r[2]),
            "status": r[3],
            "description": r[4],
            "created_at": r[5].isoformat() if r[5] else None,
        }
        for r in rows
    ]


@router.post("/{report_id}/promote", status_code=201)
def promote_report(
    report_id: int,
    request: Request,
    user: Annotated[dict, Depends(_require_encoder_or_validator)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    raise HTTPException(
        status_code=410,
        detail="Civilian report promotion is disabled. Use /api/triage/queue and cluster terminal actions.",
    )


@router.post("/bulk-promote", status_code=201)
def bulk_promote_reports(
    body: BulkPromoteRequest,
    request: Request,
    user: Annotated[dict, Depends(_require_encoder_or_validator)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    raise HTTPException(
        status_code=410,
        detail="Civilian bulk promotion is disabled. Use cluster terminal actions.",
    )
