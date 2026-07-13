"""Community Safety Hub API routes (Slice F).

Two routers:

- ``public_router`` (prefix ``/api/community``) — anonymous reads of published,
  non-expired content. No authentication. RLS + the service's SQL predicate
  both enforce the published/non-expired read-time filter.
- ``admin_router`` (prefix ``/community``, mounted under ``/api/admin`` by the
  admin package) — SYSTEM_ADMIN-only CMS lifecycle operations. Writes are
  gated by ``get_system_admin`` and executed under an RLS-scoped session
  (``get_db_with_rls``) so the SYSTEM_ADMIN write policy is satisfied.

All mutation routes own the commit; the service emits audits inside the same
transaction (fail-closed for sensitive actions). See
``services/community_content`` for the write/audit/versioning contract.
"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from auth import get_db_with_rls, get_public_db_with_rls, get_system_admin
from schemas.community import (
    CommunityContentCreate,
    CommunityContentType,
    CommunityContentCreateResponse,
    CommunityContentAdminItem,
    CommunityContentDetailResponse,
    CommunityHubResponse,
    CommunityContentItem,
    CommunityContentPublish,
    CommunityContentActionResponse,
    CommunityContentUpdate,
)
from services import community_content as community_service

logger = logging.getLogger("wims.community_content_routes")

# ── Public (anonymous) Community Safety Hub ──────────────────────────────────
public_router = APIRouter(prefix="/api/community", tags=["community"])


@public_router.get("/hub", response_model=CommunityHubResponse)
def get_community_hub(
    type: CommunityContentType | None = Query(
        default=None, description="SAFETY_ARTICLE | ANNOUNCEMENT | EVENT"
    ),
    language: str = Query(default="en", pattern="^(en|uk)$"),
    urgent_first: bool = Query(default=True),
    db: Annotated[Session, Depends(get_public_db_with_rls)] = None,
) -> CommunityHubResponse:
    """Public hub: published, non-expired content, urgent banner surfaced.

    RLS (public SELECT policy) + the service SQL predicate both restrict the
    result to PUBLISHED, non-expired rows for anonymous readers.
    """
    items_raw = community_service.list_published(
        db,
        content_type=type,
        language=language,
        urgent_first=urgent_first,
    )
    items = [CommunityContentItem(**i) for i in items_raw]
    urgent_banner = next((i for i in items if i.urgent_banner), None)
    return CommunityHubResponse(items=items, urgent_banner=urgent_banner)


@public_router.get("/{slug}", response_model=CommunityContentDetailResponse)
def get_community_content_by_slug(
    slug: str,
    language: str = Query(default="en", pattern="^(en|uk)$"),
    db: Annotated[Session, Depends(get_public_db_with_rls)] = None,
) -> CommunityContentDetailResponse:
    """Public detail: a single published, non-expired item by slug (404 if not)."""
    item_raw = community_service.get_by_slug(db, slug, language=language)
    if item_raw is None:
        raise HTTPException(status_code=404, detail="Content not found")
    return CommunityContentDetailResponse(item=CommunityContentItem(**item_raw))


# ── Admin (SYSTEM_ADMIN) CMS lifecycle ───────────────────────────────────────
admin_router = APIRouter(prefix="/community", tags=["admin-community"])
_PRIVATE_CACHE_CONTROL = "no-store, no-cache, must-revalidate, private"


def _set_private_cache(response: Response) -> None:
    response.headers["Cache-Control"] = _PRIVATE_CACHE_CONTROL


@admin_router.get("", response_model=list[CommunityContentAdminItem])
def list_community_admin_content(
    response: Response,
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
) -> list[CommunityContentAdminItem]:
    """List all lifecycle states with latest version fields for the CMS editor."""
    _set_private_cache(response)
    items = community_service.list_admin_content(db)
    return [CommunityContentAdminItem(**item) for item in items]


@admin_router.post("", status_code=201, response_model=CommunityContentCreateResponse)
def create_community_draft(
    body: CommunityContentCreate,
    response: Response,
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
) -> CommunityContentCreateResponse:
    """Create a DRAFT content item (SYSTEM_ADMIN only)."""
    _set_private_cache(response)
    try:
        content_id = community_service.create_draft(
            db,
            actor_user_id=_admin["user_id"],
            content_type=body.content_type,
            title_en=body.title_en,
            body_en=body.body_en,
            title_uk=body.title_uk,
            body_uk=body.body_uk,
            metadata_json=body.metadata_json,
            slug=body.slug,
            expires_at=body.expires_at,
            urgent_banner=body.urgent_banner,
            last_reviewed_at=body.last_reviewed_at,
        )
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:  # pragma: no cover - defensive
        db.rollback()
        logger.exception("Failed to create community draft")
        raise HTTPException(status_code=500, detail="Failed to create content draft") from exc
    return CommunityContentCreateResponse(content_id=content_id)


@admin_router.patch("/{content_id}", response_model=CommunityContentActionResponse)
def update_community_draft(
    content_id: str,
    body: CommunityContentUpdate,
    response: Response,
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
) -> CommunityContentActionResponse:
    """Edit a DRAFT's pointer fields (SYSTEM_ADMIN only). 409 if not DRAFT."""
    _set_private_cache(response)
    try:
        result = community_service.update_draft(
            db,
            content_id=content_id,
            actor_user_id=_admin["user_id"],
            title_en=body.title_en,
            body_en=body.body_en,
            title_uk=body.title_uk,
            body_uk=body.body_uk,
            metadata_json=body.metadata_json,
            slug=body.slug,
            expires_at=(
                body.expires_at
                if "expires_at" in body.model_fields_set
                else community_service.UNSET
            ),
            urgent_banner=body.urgent_banner,
            last_reviewed_at=(
                body.last_reviewed_at
                if "last_reviewed_at" in body.model_fields_set
                else community_service.UNSET
            ),
            provided_fields=body.model_fields_set,
        )
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:  # pragma: no cover - defensive
        db.rollback()
        logger.exception("Failed to update community draft")
        raise HTTPException(status_code=500, detail="Failed to update content draft") from exc
    return CommunityContentActionResponse(**result)


@admin_router.post("/{content_id}/publish", response_model=CommunityContentActionResponse)
def publish_community_content(
    content_id: str,
    body: CommunityContentPublish,
    response: Response,
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
) -> CommunityContentActionResponse:
    """Publish (pointer move + new version) a content item (SYSTEM_ADMIN only).

    Returns 409 on optimistic-concurrency conflict (row_version changed).
    """
    _set_private_cache(response)
    try:
        result = community_service.publish(
            db,
            content_id=content_id,
            actor_user_id=_admin["user_id"],
            title_en=body.title_en,
            body_en=body.body_en,
            title_uk=body.title_uk,
            body_uk=body.body_uk,
            metadata_json=body.metadata_json,
            expires_at=body.expires_at,
            urgent_banner=body.urgent_banner,
            last_reviewed_at=body.last_reviewed_at,
        )
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:  # pragma: no cover - defensive
        db.rollback()
        logger.exception("Failed to publish community content")
        raise HTTPException(status_code=500, detail="Failed to publish content") from exc
    return CommunityContentActionResponse(**result)


@admin_router.post("/{content_id}/archive", response_model=CommunityContentActionResponse)
def archive_community_content(
    content_id: str,
    response: Response,
    _admin: Annotated[dict, Depends(get_system_admin)],
    db: Annotated[Session, Depends(get_db_with_rls)],
) -> CommunityContentActionResponse:
    """Soft-archive a content item (SYSTEM_ADMIN only). No physical delete."""
    _set_private_cache(response)
    try:
        result = community_service.archive(
            db,
            content_id=content_id,
            actor_user_id=_admin["user_id"],
        )
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:  # pragma: no cover - defensive
        db.rollback()
        logger.exception("Failed to archive community content")
        raise HTTPException(status_code=500, detail="Failed to archive content") from exc
    return CommunityContentActionResponse(**result)
