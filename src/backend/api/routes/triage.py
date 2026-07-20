"""Triage Queue and Promotion Workflow — ENCODER/VALIDATOR only."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth import get_current_wims_user
from auth import get_db_with_rls
from utils.audit import log_system_audit
from schemas.civilian import StatusUpdateRequest, StatusUpdateResponse
from schemas.triage_workspace import ContactRevealResponse, TriageWorkspaceResponse
from services.civilian_triage import (
    BulkPromoteRequest,
    BulkDismissRequest,
    BulkLinkRequest,
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
    apply_status_update_command,
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
from services.civilian_triage.contact_reveal import reveal_reporter_contact
from services.civilian_triage.workspace_projection import get_workspace
from services.report_photo_read import SanitizedPhotoUnavailable, get_sanitized_photo_bytes

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


def _require_national_evidence_actor(
    current_user: Annotated[dict, Depends(get_current_wims_user)],
) -> dict:
    if current_user.get("role") not in ("NATIONAL_VALIDATOR", "SYSTEM_ADMIN"):
        raise HTTPException(status_code=403, detail="National Validator role required")
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
    source: str | None = Query(None, description="registered | anonymous | all"),
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
        source=source,
    )


@router.get("/clusters/{cluster_id}/workspace", response_model=TriageWorkspaceResponse)
def get_cluster_workspace(
    cluster_id: int,
    _user: Annotated[dict, Depends(_require_national_evidence_actor)],
    db: Annotated[Session, Depends(get_db_with_rls)],
) -> TriageWorkspaceResponse:
    return get_workspace(db, cluster_id)


@router.get("/reports/{report_id}/photos/{photo_id}/content")
def get_report_photo_content(
    report_id: int,
    photo_id: str,
    _user: Annotated[dict, Depends(_require_national_evidence_actor)],
    db: Annotated[Session, Depends(get_db_with_rls)],
) -> Response:
    try:
        photo = get_sanitized_photo_bytes(db, report_id, photo_id)
    except SanitizedPhotoUnavailable as exc:
        raise HTTPException(status_code=404, detail="Photo not found") from exc
    extension = "jpg" if photo.media_type == "image/jpeg" else "png"
    return Response(
        content=photo.content,
        media_type=photo.media_type,
        headers={
            "Cache-Control": "no-store",
            "Pragma": "no-cache",
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": (f'inline; filename="civilian-evidence-{photo_id}.{extension}"'),
        },
    )


@router.post(
    "/reports/{report_id}/contact-reveal",
    response_model=ContactRevealResponse,
)
def reveal_report_contact(
    report_id: int,
    request: Request,
    user: Annotated[dict, Depends(_require_national_evidence_actor)],
    db: Annotated[Session, Depends(get_db_with_rls)],
) -> ContactRevealResponse:
    return reveal_reporter_contact(db, report_id, user, request)


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


STATUS_UPDATE_ALLOWED_ROLES = ("NATIONAL_VALIDATOR", "REGIONAL_ENCODER")


def _require_status_update_actor(
    current_user: Annotated[dict, Depends(get_current_wims_user)],
) -> dict:
    """Allow NATIONAL_VALIDATOR (via dedicated dependency) or REGIONAL_ENCODER."""
    role = current_user.get("role")
    if role not in STATUS_UPDATE_ALLOWED_ROLES:
        raise HTTPException(
            status_code=403,
            detail=f"Role '{role}' cannot send civilian status updates",
        )
    return current_user


@router.post(
    "/reports/{report_id}/update-status",
    response_model=StatusUpdateResponse,
    status_code=201,
)
def update_report_status(
    report_id: int,
    body: StatusUpdateRequest,
    request: Request,
    user: Annotated[dict, Depends(_require_status_update_actor)],
    db: Annotated[Session, Depends(get_db_with_rls)],
) -> StatusUpdateResponse:
    """Record a validator-to-civilian status update for a civilian report.

    NATIONAL_VALIDATOR and REGIONAL_ENCODER only. Enforces the forward-only
    stage lifecycle and per-stage metadata requirements, inserts into
    wims.report_status_updates, audits the action, and publishes an SSE event.
    """
    result = apply_status_update_command(
        db=db,
        report_id=report_id,
        stage=body.stage,
        metadata=body.metadata,
        actor_user=user,
        request=request,
    )
    return StatusUpdateResponse(**result)


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
    updated = _bulk_set_status(
        body.report_ids,
        status="ACTIONED",
        extra={"validated_by": user["user_id"]},
        db=db,
        request=request,
        actor=user,
        action_type="CIVILIAN_REPORT_PROMOTE",
    )
    return {"updated": updated, "status": "ACTIONED"}


@router.post("/bulk-dismiss", status_code=200)
def bulk_dismiss_reports(
    body: BulkDismissRequest,
    request: Request,
    user: Annotated[dict, Depends(_require_encoder_or_validator)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    updated = _bulk_set_status(
        body.report_ids,
        status="REJECTED_INSUFFICIENT",
        extra={"status_explanation": body.reason},
        db=db,
        request=request,
        actor=user,
        action_type="CIVILIAN_REPORT_DISMISS",
    )
    return {"updated": updated, "status": "REJECTED_INSUFFICIENT"}


@router.post("/bulk-link", status_code=200)
def bulk_link_reports(
    body: BulkLinkRequest,
    request: Request,
    user: Annotated[dict, Depends(_require_encoder_or_validator)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    # Validate the link target (incident report) exists before touching any rows.
    target = db.execute(
        text("SELECT 1 FROM wims.citizen_reports WHERE report_id = :i"),
        {"i": body.incident_id},
    ).fetchone()
    if not target:
        raise HTTPException(status_code=404, detail="Linked report (incident_id) not found")
    updated = _bulk_set_status(
        body.report_ids,
        status="LINKED",
        extra={"linked_to_report_id": body.incident_id},
        db=db,
        request=request,
        actor=user,
        action_type="CIVILIAN_REPORT_LINK",
    )
    return {"updated": updated, "status": "LINKED", "incident_id": body.incident_id}


MAX_BULK_REPORTS = 100


def _bulk_set_status(
    report_ids: list[int],
    *,
    status: str,
    extra: dict | None,
    db: Session,
    request: Request,
    actor: dict,
    action_type: str,
) -> int:
    """Validate all report_ids, then set status (+ extra columns) for each.

    Rejects the entire batch if any id is missing or the request is malformed.
    Each mutated row is audited individually and the whole batch is committed.
    """
    if not report_ids:
        raise HTTPException(status_code=422, detail="report_ids must not be empty")
    if len(report_ids) > MAX_BULK_REPORTS:
        raise HTTPException(
            status_code=422,
            detail=f"report_ids exceeds max of {MAX_BULK_REPORTS}",
        )

    ids = list(dict.fromkeys(report_ids))  # dedupe, preserve order
    existing = {
        r[0]
        for r in db.execute(
            text("SELECT report_id FROM wims.citizen_reports WHERE report_id = ANY(:ids)"),
            {"ids": ids},
        ).fetchall()
    }
    missing = [i for i in ids if i not in existing]
    if missing:
        # Reject all if any invalid (do not partially apply).
        raise HTTPException(
            status_code=404,
            detail=f"Report(s) not found: {missing[:5]}{'...' if len(missing) > 5 else ''}",
        )

    set_clauses = ["status = :status"]
    params: dict = {"status": status, "ids": ids}
    if extra:
        for col, val in extra.items():
            set_clauses.append(f"{col} = :{col}")
            params[col] = val

    db.execute(
        text(
            f"UPDATE wims.citizen_reports SET {', '.join(set_clauses)} WHERE report_id = ANY(:ids)"
        ),
        params,
    )

    for rid in ids:
        new_values = {"report_id": rid, "status": status}
        if extra:
            new_values.update(extra)
        log_system_audit(
            db=db,
            user_id=actor["user_id"],
            action_type=action_type,
            table_affected="wims.citizen_reports",
            record_id=rid,
            request=request,
            new_values=new_values,
        )

    db.commit()
    return len(ids)
