"""Community Safety Hub API schemas (Slice F).

Request/response contracts for the public Community Safety Hub and the
SYSTEM_ADMIN CMS management endpoints. Title/body are plain text only — see
the XSS/rendering note in ``services/community_content`` and
``system-wiki/security/security-baseline.md``. The frontend MUST render these
fields as React text (auto-escaped) and MUST NOT use ``dangerouslySetInnerHTML``.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

CommunityContentType = Literal["SAFETY_ARTICLE", "ANNOUNCEMENT", "EVENT"]
CommunityLanguage = Literal["en", "uk"]


class CommunityContentCreate(BaseModel):
    """Request body for POST /api/admin/community (create draft)."""

    content_type: CommunityContentType
    title_en: str = Field(..., min_length=1)
    body_en: str = Field(..., min_length=1)
    title_uk: str | None = None
    body_uk: str | None = None
    metadata_json: dict[str, Any] | None = None
    slug: str | None = Field(default=None, min_length=1, max_length=255)
    expires_at: datetime | None = None
    urgent_banner: bool = False
    last_reviewed_at: datetime | None = None


class CommunityContentUpdate(BaseModel):
    """Request body for PATCH /api/admin/community/{content_id} (edit DRAFT)."""

    title_en: str | None = Field(default=None, min_length=1)
    body_en: str | None = Field(default=None, min_length=1)
    title_uk: str | None = Field(default=None, min_length=1)
    body_uk: str | None = Field(default=None, min_length=1)
    metadata_json: dict[str, Any] | None = None
    slug: str | None = Field(default=None, min_length=1, max_length=255)
    expires_at: datetime | None = None
    urgent_banner: bool | None = None
    last_reviewed_at: datetime | None = None


class CommunityContentPublish(BaseModel):
    """Request body for POST /api/admin/community/{content_id}/publish."""

    title_en: str = Field(..., min_length=1)
    body_en: str = Field(..., min_length=1)
    title_uk: str | None = None
    body_uk: str | None = None
    metadata_json: dict[str, Any] | None = None
    expires_at: datetime | None = None
    urgent_banner: bool = False
    last_reviewed_at: datetime | None = None


class CommunityContentItem(BaseModel):
    """Public projection of one published content item (language-resolved)."""

    content_id: str
    slug: str
    content_type: CommunityContentType
    title: str
    body: str
    language: CommunityLanguage
    urgent_banner: bool
    expires_at: datetime | None = None
    metadata_json: dict[str, Any] | None = None
    last_reviewed_at: datetime | None = None
    updated_at: datetime | None = None


class CommunityHubResponse(BaseModel):
    """Response body for GET /api/community/hub."""

    items: list[CommunityContentItem]
    urgent_banner: CommunityContentItem | None = None


class CommunityContentDetailResponse(BaseModel):
    """Response body for GET /api/community/{slug}."""

    item: CommunityContentItem


class CommunityContentAdminItem(BaseModel):
    """Full latest-version projection for the SYSTEM_ADMIN CMS editor."""

    content_id: str
    slug: str
    content_type: CommunityContentType
    lifecycle_status: str
    title_en: str
    title_uk: str | None = None
    body_en: str
    body_uk: str | None = None
    metadata_json: dict[str, Any] | None = None
    expires_at: datetime | None = None
    urgent_banner: bool
    last_reviewed_at: datetime | None = None
    row_version: int


class CommunityContentCreateResponse(BaseModel):
    """Response body for POST /api/admin/community."""

    content_id: str
    lifecycle_status: str = "DRAFT"


class CommunityContentActionResponse(BaseModel):
    """Generic response for publish/archive/update actions."""

    content_id: str
    lifecycle_status: str
