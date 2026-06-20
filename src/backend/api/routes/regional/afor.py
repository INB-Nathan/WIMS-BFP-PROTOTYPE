"""Regional Office API — AFOR import routes."""

from __future__ import annotations

import logging
import os
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
    insert_incident_verification_history as _insert_incident_verification_history,
    region_text_matches as _region_text_matches,
)
from services.kms import get_crypto_provider
from utils.audit import get_client_ip, log_system_audit
from utils.upload_validation import (
    check_magic_bytes,
    check_xlsx_decompression_bomb,
    safe_read_upload,
    sanitize_filename,
    validate_extension,
)

logger = logging.getLogger("wims.regional")
router = APIRouter()


def _get_security_provider():
    """Return the correct crypto provider based on WIMS_CRYPTO_PROVIDER env var."""
    return get_crypto_provider()


@router.post("/afor/import", response_model=AforParseResponse)
async def import_afor_file(
    file: UploadFile = File(...),
    user: dict = Depends(get_regional_encoder),
    db: Session = Depends(get_db_with_rls),
    request: Request = None,
):
    """
    Upload and parse an AFOR file (.xlsx or .csv).
    Returns parsed rows with validation status for preview before commit.
    """
    region_id = user["assigned_region_id"]

    # ── Deep checks (#391): filename, extension, size cap, magic bytes, bomb defense
    safe_name = sanitize_filename(file.filename)
    ext = validate_extension(safe_name, ["xlsx", "csv"])

    # App-level size cap (10 MB for AFOR per issue #391)
    _max_afor_bytes = int(os.getenv("WIMS_MAX_AFOR_BYTES", str(10 * 1024 * 1024)))
    content = await safe_read_upload(file, _max_afor_bytes)

    if not content:
        raise HTTPException(status_code=400, detail="File is empty")

    # Magic byte verification ensures claimed extension matches real content.
    check_magic_bytes(content, ext)

    # Decompression bomb defense (XLSX only — CSVs are plain text).
    if ext == "xlsx":
        check_xlsx_decompression_bomb(content)

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

    # Audit log entry (D20 / issue #394) — preview / parse phase. The actual
    # mutations happen in commit_afor_import, which writes its own audit row.
    # sensitive=False: parse does not mutate any data, so audit gaps are
    # acceptable forensic noise.
    try:
        log_system_audit(
            db=db,
            user_id=user["user_id"],
            action_type="AFOR_IMPORT_PARSE",
            table_affected="wims.afor_imports",
            record_id=None,
            request=request,
            new_values={
                "file_name": file.filename,
                "form_kind": form_kind,
                "total_rows": len(rows),
                "valid_rows": valid_count,
            },
        )
        db.commit()
    except Exception:
        # Audit failures are non-fatal.
        logger.exception("Failed to write AFOR import audit log")

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
    _request_ip = get_client_ip(request)

    def _ivh_with_ip(db, **kwargs):  # type: ignore[no-untyped-def]
        return _insert_incident_verification_history(db, request_ip=_request_ip, **kwargs)

    result = commit_afor_import_command(
        db,
        user,
        body,
        raw_body,
        AforCommitDependencies(
            insert_incident_verification_history=_ivh_with_ip,
            get_security_provider=_get_security_provider,
        ),
    )

    # Audit log entry (D20 / issue #394) — commit phase. The actual
    # mutations are performed by commit_afor_import_command above; we
    # write the audit row after it returns. sensitive=False: this is a
    # batch write, the commit has already succeeded, and the audit gap
    # is acceptable forensic noise (matches the upload_bundle pattern).
    if result.get("status") != "DUPLICATE_CHECK_REQUIRED":
        inserted = (
            result.get("inserted") or result.get("incident_ids") or result.get("imported") or []
        )
        log_system_audit(
            db=db,
            user_id=user["user_id"],
            action_type="AFOR_IMPORT_COMMIT",
            table_affected="wims.afor_imports",
            record_id=None,
            request=request,
            new_values={
                "form_kind": body.form_kind,
                "region_id": user["assigned_region_id"],
                "row_count": len(body.rows) if hasattr(body, "rows") else None,
                "inserted_count": len(inserted) if isinstance(inserted, list) else 0,
                "batch_id": result.get("batch_id"),
            },
        )
        db.commit()

    if result.get("status") == "DUPLICATE_CHECK_REQUIRED":
        return result
    return AforCommitResponse.model_validate(result)
