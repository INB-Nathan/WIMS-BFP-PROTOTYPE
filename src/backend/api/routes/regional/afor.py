"""Regional Office API — AFOR import routes."""

from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth import get_regional_encoder
from auth import get_db_with_rls
from services.afor_import import (
    AforCommitRequest,
    AforCommitResponse,
    AforParseResponse,
    parse_csv_content,
    parse_xlsx_content,
)
from services.afor_import.commit import (
    AforCommitDependencies,
    commit_afor_import_command,
)
from services.regional_incidents.helpers import (
    get_security_provider as _get_security_provider_from_helpers,
    insert_incident_verification_history as _insert_incident_verification_history,
    region_text_matches as _region_text_matches,
)

logger = logging.getLogger("wims.regional")
router = APIRouter()


def _get_security_provider():
    """Return the SecurityProvider singleton (wraps helpers import)."""
    return _get_security_provider_from_helpers()


@router.post("/afor/import", response_model=AforParseResponse)
async def import_afor_file(
    file: UploadFile = File(...),
    user: dict = Depends(get_regional_encoder),
    db: Session = Depends(get_db_with_rls),
):
    """
    Upload and parse an AFOR file (.xlsx or .csv).
    Returns parsed rows with validation status for preview before commit.
    """
    region_id = user["assigned_region_id"]

    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ("xlsx",):
        raise HTTPException(status_code=400, detail="Only .xlsx files are supported")

    content = await file.read()
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="File is empty")

    try:
        if ext == "csv":
            decoded = content.decode("utf-8-sig")  # Handle BOM
            rows, form_kind = parse_csv_content(decoded, region_id)
        else:
            rows, form_kind = parse_xlsx_content(content, region_id)
    except ValueError as e:
        logger.warning("AFOR type detection failed: %s", e)
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.exception("Failed to parse AFOR file")
        raise HTTPException(status_code=400, detail="Failed to parse file")

    if len(rows) == 0:
        raise HTTPException(status_code=400, detail="No data rows found in file")

    # Region mismatch check: if the XLSX specifies a region, it must match the encoder's assigned region.
    if form_kind == "STRUCTURAL_AFOR":
        first_valid = next((r for r in rows if r.status == "VALID"), None)
        xlsx_region_text = (
            (first_valid.data.get("_region_text") or "") if first_valid else ""
        ).strip()
        if xlsx_region_text:
            encoder_region_row = db.execute(
                text("SELECT region_name FROM wims.ref_regions WHERE region_id = :rid"),
                {"rid": region_id},
            ).fetchone()
            if encoder_region_row:
                if not _region_text_matches(encoder_region_row[0], xlsx_region_text):
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"Region mismatch: this AFOR is for '{xlsx_region_text}', "
                            f"but you are assigned to '{encoder_region_row[0]}'. "
                            "You can only import AFORs within your assigned region."
                        ),
                    )

    valid_count = sum(1 for r in rows if r.status == "VALID")

    return AforParseResponse(
        total_rows=len(rows),
        valid_rows=valid_count,
        invalid_rows=len(rows) - valid_count,
        rows=rows,
        form_kind=form_kind,
    )


@router.post("/afor/commit")
async def commit_afor_import(
    request: Request,
    user: Annotated[dict, Depends(get_regional_encoder)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """Commit validated AFOR rows through the AFOR import command module."""
    try:
        raw_body: dict[str, Any] = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body") from None

    body = AforCommitRequest.model_validate(raw_body)
    result = commit_afor_import_command(
        db,
        user,
        body,
        raw_body,
        AforCommitDependencies(
            insert_incident_verification_history=_insert_incident_verification_history,
            get_security_provider=_get_security_provider,
        ),
    )
    if result.get("status") == "DUPLICATE_CHECK_REQUIRED":
        return result
    return AforCommitResponse.model_validate(result)
