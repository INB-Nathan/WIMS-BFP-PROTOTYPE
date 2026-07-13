"""Community Safety Hub CMS — content service (Slice F).

Domain logic for the versioned Community Safety Hub content model:

- ``wims.community_content`` — one live pointer row per content item, carrying
  the publication pointer (``published_version_id``), lifecycle status,
  expiry, urgent-banner flag, and an optimistic ``row_version``.
- ``wims.community_content_version`` — immutable, append-only per-item versions.
  Publishing and rollback are *pointer moves* on ``wims.community_content``;
  the application NEVER UPDATEs or DELETEs a historical version row.

Read model
----------
Public reads ALWAYS apply the SQL predicate
``lifecycle_status = 'PUBLISHED' AND (expires_at IS NULL OR expires_at > now())``
as defense-in-depth on top of the public RLS SELECT policy (which already
filters to published, non-expired rows). Expiry is enforced at read time so
public reads remain correct even if the Celery expiry sweep is delayed.

XSS / rendering contract
-------------------------
Content title/body are stored exactly as submitted by a SYSTEM_ADMIN (trusted,
server-authored). The API returns them as plain text fields — **never HTML**.
The frontend MUST render them via React text interpolation (auto-escaped) and
MUST NOT use ``dangerouslySetInnerHTML``. No sanitizer dependency is introduced;
safety relies on plain-text storage + safe client rendering. See
``system-wiki/security/security-baseline.md``.

Audit
-----
Every mutation emits a ``log_system_audit`` row through the caller's session and
transaction. The service never calls ``db.commit()`` — the calling route owns
the commit (matching the report_photos / civilian route pattern). Sensitive
audits (publish/archive) are fail-closed via ``AuditInsertFailed``.

All tables are accessed through raw ``text()`` SQL (no ORM model exists),
consistent with ``services/report_photos.py`` and ``api/routes/civilian.py``.
"""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from utils.audit import log_system_audit

logger = logging.getLogger("wims.community_content")

# Distinguishes an omitted PATCH field from an explicit JSON null.
UNSET = object()

# Canonical content types (mirrors the CHECK constraint in 91_community_content_schema.sql).
CONTENT_TYPES = ("SAFETY_ARTICLE", "ANNOUNCEMENT", "EVENT")

# Authoritative published + non-expired predicate, reused across read queries.
_PUBLISHED_NON_EXPIRED = (
    "cc.lifecycle_status = 'PUBLISHED' AND (cc.expires_at IS NULL OR cc.expires_at > now())"
)


def _canonical_hash(
    title_en: str,
    body_en: str,
    title_uk: str | None = None,
    body_uk: str | None = None,
    metadata_json: dict[str, Any] | None = None,
) -> str:
    """SHA-256 of a canonical JSON of the content payload.

    Stable, order-independent hash used to detect content changes between
    versions and to detect conflicting concurrent edits.
    """
    payload: dict[str, Any] = {
        "title_en": title_en,
        "body_en": body_en,
        "title_uk": title_uk,
        "body_uk": body_uk,
        "metadata_json": metadata_json,
    }
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()


def _jsonb_param(value: dict[str, Any] | None) -> str | None:
    """Serialize a dict to a JSON string for ``::jsonb`` binding, or None."""
    return json.dumps(value, default=str) if value is not None else None


def _row_to_public_dict(row: Any, language: str) -> dict[str, Any]:
    """Project a published content row + joined version into a public dict.

    Applies language selection with fallback to English when the requested
    language (``uk``) variant is missing/empty.
    """
    use_uk = language == "uk"
    title = row.title_uk if (use_uk and getattr(row, "title_uk", None)) else row.title_en
    body = row.body_uk if (use_uk and getattr(row, "body_uk", None)) else row.body_en
    return {
        "content_id": str(row.content_id),
        "slug": row.slug,
        "content_type": row.content_type,
        "title": title,
        "body": body,
        "language": "uk" if use_uk else "en",
        "urgent_banner": bool(row.urgent_banner),
        "expires_at": row.expires_at,
        # Admin metadata is intentionally withheld from public projections.
        "metadata_json": None,
        "last_reviewed_at": row.last_reviewed_at,
        "updated_at": row.updated_at,
    }


def list_published(
    db: Session,
    content_type: str | None = None,
    language: str = "en",
    urgent_first: bool = True,
    include_expired: bool = False,
    system_admin: bool = False,
) -> list[dict[str, Any]]:
    """Return published, non-expired content items.

    Always applies the published + non-expired SQL predicate (defense-in-depth
    even though RLS already filters). ``include_expired`` (admin only) bypasses
    the expiry predicate but still requires ``lifecycle_status = 'PUBLISHED'``.

    Ordering: urgent banner first (when ``urgent_first``), then by
    ``updated_at`` descending.
    """
    if include_expired and not system_admin:
        raise HTTPException(
            status_code=403,
            detail="Expired content is available only to SYSTEM_ADMIN callers",
        )

    if content_type is not None and content_type not in CONTENT_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"content_type must be one of {CONTENT_TYPES}",
        )

    expiry_clause = (
        "TRUE" if include_expired else "(cc.expires_at IS NULL OR cc.expires_at > now())"
    )
    type_clause = "AND cc.content_type = :content_type" if content_type is not None else ""
    order_clause = (
        "ORDER BY (CASE WHEN cc.urgent_banner = TRUE THEN 0 ELSE 1 END), cc.updated_at DESC"
        if urgent_first
        else "ORDER BY cc.updated_at DESC"
    )

    sql = text(
        f"""
        SELECT
            cc.id AS content_id,
            cc.slug,
            cc.content_type,
            cc.urgent_banner,
            cc.expires_at,
            cc.metadata_json,
            cc.last_reviewed_at,
            cc.updated_at,
            v.title_en,
            v.title_uk,
            v.body_en,
            v.body_uk
        FROM wims.community_content cc
        JOIN wims.community_content_version v
            ON v.version_id = cc.published_version_id
        WHERE cc.lifecycle_status = 'PUBLISHED'
          AND {expiry_clause}
          {type_clause}
        {order_clause}
        """
    )
    params: dict[str, Any] = {}
    if content_type is not None:
        params["content_type"] = content_type

    rows = db.execute(sql, params).fetchall()
    return [_row_to_public_dict(r, language) for r in rows]


def get_by_slug(
    db: Session,
    slug: str,
    language: str = "en",
    include_expired: bool = False,
    system_admin: bool = False,
) -> dict[str, Any] | None:
    """Return a single published, non-expired content item by slug.

    Returns ``None`` if not found, unpublished, or (when ``include_expired`` is
    False) expired.
    """
    if include_expired and not system_admin:
        raise HTTPException(
            status_code=403,
            detail="Expired content is available only to SYSTEM_ADMIN callers",
        )

    expiry_clause = (
        "TRUE" if include_expired else "(cc.expires_at IS NULL OR cc.expires_at > now())"
    )
    sql = text(
        f"""
        SELECT
            cc.id AS content_id,
            cc.slug,
            cc.content_type,
            cc.urgent_banner,
            cc.expires_at,
            cc.metadata_json,
            cc.last_reviewed_at,
            cc.updated_at,
            v.title_en,
            v.title_uk,
            v.body_en,
            v.body_uk
        FROM wims.community_content cc
        JOIN wims.community_content_version v
            ON v.version_id = cc.published_version_id
        WHERE cc.lifecycle_status = 'PUBLISHED'
          AND {expiry_clause}
          AND cc.slug = :slug
        LIMIT 1
        """
    )
    row = db.execute(sql, {"slug": slug}).fetchone()
    if row is None:
        return None
    return _row_to_public_dict(row, language)


def list_admin_content(db: Session) -> list[dict[str, Any]]:
    """Return every content item with its latest version for the CMS editor.

    Authorization and RLS session scoping are owned by the route/dependencies;
    this query intentionally does not apply the public lifecycle/expiry filter.
    """
    rows = db.execute(
        text(
            """
            SELECT
                cc.id AS content_id,
                cc.slug,
                cc.content_type,
                cc.lifecycle_status,
                latest.title_en,
                latest.title_uk,
                latest.body_en,
                latest.body_uk,
                latest.metadata_json,
                cc.expires_at,
                cc.urgent_banner,
                cc.last_reviewed_at,
                cc.row_version
            FROM wims.community_content cc
            JOIN LATERAL (
                SELECT title_en, title_uk, body_en, body_uk, metadata_json
                FROM wims.community_content_version v
                WHERE v.content_id = cc.id
                ORDER BY v.version_number DESC
                LIMIT 1
            ) latest ON TRUE
            ORDER BY cc.updated_at DESC, cc.id
            """
        )
    ).fetchall()
    return [
        {
            "content_id": str(row.content_id),
            "slug": row.slug,
            "content_type": row.content_type,
            "lifecycle_status": row.lifecycle_status,
            "title_en": row.title_en,
            "title_uk": row.title_uk,
            "body_en": row.body_en,
            "body_uk": row.body_uk,
            "metadata_json": row.metadata_json,
            "expires_at": row.expires_at,
            "urgent_banner": bool(row.urgent_banner),
            "last_reviewed_at": row.last_reviewed_at,
            "row_version": int(row.row_version),
        }
        for row in rows
    ]


def create_draft(
    db: Session,
    actor_user_id: UUID | str,
    content_type: str,
    title_en: str,
    body_en: str,
    title_uk: str | None = None,
    body_uk: str | None = None,
    metadata_json: dict[str, Any] | None = None,
    slug: str | None = None,
    expires_at: datetime | None = None,
    urgent_banner: bool = False,
    last_reviewed_at: datetime | None = None,
) -> str:
    """Insert a DRAFT content row plus its first version.

    Returns the new content id. Emits a ``CMS_EDIT`` audit (same transaction).
    """
    if content_type not in CONTENT_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"content_type must be one of {CONTENT_TYPES}",
        )

    effective_slug = slug or f"content-{uuid4().hex[:12]}"
    content_hash = _canonical_hash(title_en, body_en, title_uk, body_uk, metadata_json)

    content_id = db.execute(
        text(
            """
            INSERT INTO wims.community_content (
                content_type, slug, lifecycle_status, created_by, row_version,
                expires_at, urgent_banner, last_reviewed_at
            ) VALUES (
                :content_type, :slug, 'DRAFT', :actor_user_id, 1,
                :expires_at, :urgent_banner, :last_reviewed_at
            )
            RETURNING id
            """
        ),
        {
            "content_type": content_type,
            "slug": effective_slug,
            "actor_user_id": str(actor_user_id),
            "expires_at": expires_at,
            "urgent_banner": urgent_banner,
            "last_reviewed_at": last_reviewed_at,
        },
    ).scalar_one()

    db.execute(
        text(
            """
            INSERT INTO wims.community_content_version (
                content_id, version_number, title_en, title_uk, body_en, body_uk,
                metadata_json, content_hash, creator
            ) VALUES (
                :content_id, 1, :title_en, :title_uk, :body_en, :body_uk,
                :metadata_json::jsonb, :content_hash, :actor_user_id
            )
            """
        ),
        {
            "content_id": content_id,
            "title_en": title_en,
            "title_uk": title_uk,
            "body_en": body_en,
            "body_uk": body_uk,
            "metadata_json": _jsonb_param(metadata_json),
            "content_hash": content_hash,
            "actor_user_id": str(actor_user_id),
        },
    )

    log_system_audit(
        db=db,
        user_id=actor_user_id,
        action_type="CMS_EDIT",
        table_affected="wims.community_content",
        record_id=None,
        new_values={
            "content_id": str(content_id),
            "content_type": content_type,
            "slug": effective_slug,
            "lifecycle_status": "DRAFT",
            "version_number": 1,
            "content_hash": content_hash,
        },
        sensitive=False,
    )

    return str(content_id)


def publish(
    db: Session,
    content_id: UUID | str,
    actor_user_id: UUID | str,
    title_en: str,
    body_en: str,
    title_uk: str | None = None,
    body_uk: str | None = None,
    metadata_json: dict[str, Any] | None = None,
    expires_at: datetime | None = None,
    urgent_banner: bool = False,
    last_reviewed_at: datetime | None = None,
) -> dict[str, Any]:
    """Publish (or re-publish) a content item with optimistic concurrency.

    Loads the pointer row + current ``row_version``, inserts a NEW version
    (version_number = max(existing) + 1, fresh content_hash), then moves the
    publication pointer with ``WHERE id = :content_id AND row_version = :expected``.
    If the pointer row changed (0 rows updated), raises ``HTTPException(409)``.

    The historical version row is never updated — publishing is a pointer move
    plus a new version insert. Emits a ``CONTENT_PUBLISH`` audit (sensitive).
    """
    pointer = db.execute(
        text(
            """
            SELECT id, row_version, slug, lifecycle_status
            FROM wims.community_content
            WHERE id = :content_id
            """
        ),
        {"content_id": str(content_id)},
    ).fetchone()
    if pointer is None:
        raise HTTPException(status_code=404, detail="Content not found")

    expected_version = int(pointer.row_version)
    slug = pointer.slug

    max_version = db.execute(
        text(
            """
            SELECT COALESCE(MAX(version_number), 0)
            FROM wims.community_content_version
            WHERE content_id = :content_id
            """
        ),
        {"content_id": str(content_id)},
    ).scalar_one()
    new_version_number = int(max_version) + 1

    content_hash = _canonical_hash(title_en, body_en, title_uk, body_uk, metadata_json)

    new_version_id = db.execute(
        text(
            """
            INSERT INTO wims.community_content_version (
                content_id, version_number, title_en, title_uk, body_en, body_uk,
                metadata_json, content_hash, creator
            ) VALUES (
                :content_id, :new_version_number, :title_en, :title_uk, :body_en, :body_uk,
                :metadata_json::jsonb, :content_hash, :actor_user_id
            )
            RETURNING version_id
            """
        ),
        {
            "content_id": str(content_id),
            "new_version_number": new_version_number,
            "title_en": title_en,
            "title_uk": title_uk,
            "body_en": body_en,
            "body_uk": body_uk,
            "metadata_json": _jsonb_param(metadata_json),
            "content_hash": content_hash,
            "actor_user_id": str(actor_user_id),
        },
    ).scalar_one()

    result = db.execute(
        text(
            """
            UPDATE wims.community_content
            SET published_version_id = :new_version_id,
                lifecycle_status = 'PUBLISHED',
                expires_at = :expires_at,
                urgent_banner = :urgent_banner,
                last_reviewed_at = :last_reviewed_at,
                row_version = row_version + 1,
                updated_at = now()
            WHERE id = :content_id AND row_version = :expected
            """
        ),
        {
            "new_version_id": new_version_id,
            "expires_at": expires_at,
            "urgent_banner": urgent_banner,
            "last_reviewed_at": last_reviewed_at,
            "content_id": str(content_id),
            "expected": expected_version,
        },
    )
    if result.rowcount == 0:
        # Concurrent edit: roll back the uncommitted transaction so the just-
        # inserted version row does not persist as an orphan. The route already
        # wraps this call and will db.rollback() on the raised HTTPException.
        raise HTTPException(
            status_code=409,
            detail="Content was modified concurrently. Reload and retry the publish.",
        )

    log_system_audit(
        db=db,
        user_id=actor_user_id,
        action_type="CONTENT_PUBLISH",
        table_affected="wims.community_content",
        record_id=None,
        new_values={
            "content_id": str(content_id),
            "version_id": str(new_version_id),
            "slug": slug,
            "urgent_banner": urgent_banner,
            "version_number": new_version_number,
        },
        sensitive=True,
    )

    return {
        "content_id": str(content_id),
        "version_id": str(new_version_id),
        "version_number": new_version_number,
        "lifecycle_status": "PUBLISHED",
    }


def archive(
    db: Session,
    content_id: UUID | str,
    actor_user_id: UUID | str,
) -> dict[str, Any]:
    """Soft-archive a content item (lifecycle -> ARCHIVED). No physical delete.

    Emits a ``CONTENT_ARCHIVE`` audit (sensitive).
    """
    result = db.execute(
        text(
            """
            UPDATE wims.community_content
            SET lifecycle_status = 'ARCHIVED',
                archived_at = now(),
                row_version = row_version + 1,
                updated_at = now()
            WHERE id = :content_id
            """
        ),
        {"content_id": str(content_id)},
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Content not found")

    log_system_audit(
        db=db,
        user_id=actor_user_id,
        action_type="CONTENT_ARCHIVE",
        table_affected="wims.community_content",
        record_id=None,
        new_values={
            "content_id": str(content_id),
            "lifecycle_status": "ARCHIVED",
        },
        sensitive=True,
    )

    return {"content_id": str(content_id), "lifecycle_status": "ARCHIVED"}


def update_draft(
    db: Session,
    content_id: UUID | str,
    actor_user_id: UUID | str,
    title_en: str | None = None,
    body_en: str | None = None,
    title_uk: str | None = None,
    body_uk: str | None = None,
    metadata_json: dict[str, Any] | None = None,
    slug: str | None = None,
    expires_at: datetime | None | object = UNSET,
    urgent_banner: bool | None = None,
    last_reviewed_at: datetime | None | object = UNSET,
    provided_fields: set[str] | None = None,
) -> dict[str, Any]:
    """Admin edit of a DRAFT's fields. Raises 409 if the row is not DRAFT.

    Emits a ``CMS_EDIT`` audit (same transaction).

    Title/body edits create a new immutable draft version; pointer fields are
    updated on the live content row. Historical versions are never modified.
    """
    pointer = db.execute(
        text(
            """
            SELECT id, lifecycle_status, row_version
            FROM wims.community_content
            WHERE id = :content_id
            FOR UPDATE
            """
        ),
        {"content_id": str(content_id)},
    ).fetchone()
    if pointer is None:
        raise HTTPException(status_code=404, detail="Content not found")
    if pointer.lifecycle_status != "DRAFT":
        raise HTTPException(
            status_code=409,
            detail=f"Only DRAFT content can be edited; current status is {pointer.lifecycle_status}.",
        )

    set_clauses = ["updated_at = now()", "row_version = row_version + 1"]
    params: dict[str, Any] = {"content_id": str(content_id)}
    # Route callers provide model_fields_set so explicit JSON null is distinct
    # from omission. Direct service callers retain the historical non-None
    # convention (and the pointer sentinel convention) for compatibility.
    fields = (
        set(provided_fields)
        if provided_fields is not None
        else {
            name
            for name, value in {
                "title_en": title_en,
                "body_en": body_en,
                "title_uk": title_uk,
                "body_uk": body_uk,
                "metadata_json": metadata_json,
                "slug": slug,
                "urgent_banner": urgent_banner,
            }.items()
            if value is not None
        }
        | {
            name
            for name, value in {
                "expires_at": expires_at,
                "last_reviewed_at": last_reviewed_at,
            }.items()
            if value is not UNSET
        }
    )
    for required_field, value in (("title_en", title_en), ("body_en", body_en)):
        if required_field in fields and value is None:
            raise HTTPException(
                status_code=422,
                detail=f"{required_field} cannot be null",
            )
    content_fields_changed = bool(
        fields & {"title_en", "body_en", "title_uk", "body_uk", "metadata_json"}
    )
    new_version_number: int | None = None
    if content_fields_changed:
        current = db.execute(
            text(
                """
                SELECT version_number, title_en, title_uk, body_en, body_uk, metadata_json
                FROM wims.community_content_version
                WHERE content_id = :content_id
                ORDER BY version_number DESC
                LIMIT 1
                """
            ),
            {"content_id": str(content_id)},
        ).fetchone()
        if current is None:
            raise HTTPException(status_code=409, detail="Draft has no content version")
        draft_title_en = title_en if "title_en" in fields else current.title_en
        draft_body_en = body_en if "body_en" in fields else current.body_en
        draft_title_uk = title_uk if "title_uk" in fields else current.title_uk
        draft_body_uk = body_uk if "body_uk" in fields else current.body_uk
        draft_metadata = metadata_json if "metadata_json" in fields else current.metadata_json
        new_version_number = int(current.version_number) + 1
        draft_hash = _canonical_hash(
            draft_title_en, draft_body_en, draft_title_uk, draft_body_uk, draft_metadata
        )
        db.execute(
            text(
                """
                INSERT INTO wims.community_content_version (
                    content_id, version_number, title_en, title_uk, body_en, body_uk,
                    metadata_json, content_hash, creator
                ) VALUES (
                    :content_id, :version_number, :title_en, :title_uk, :body_en, :body_uk,
                    :metadata_json::jsonb, :content_hash, :actor_user_id
                )
                """
            ),
            {
                "content_id": str(content_id),
                "version_number": new_version_number,
                "title_en": draft_title_en,
                "title_uk": draft_title_uk,
                "body_en": draft_body_en,
                "body_uk": draft_body_uk,
                "metadata_json": _jsonb_param(draft_metadata),
                "content_hash": draft_hash,
                "actor_user_id": str(actor_user_id),
            },
        )
    if "slug" in fields and slug is not None:
        set_clauses.append("slug = :slug")
        params["slug"] = slug
    if "expires_at" in fields:
        set_clauses.append("expires_at = :expires_at")
        params["expires_at"] = expires_at
    if "urgent_banner" in fields:
        set_clauses.append("urgent_banner = :urgent_banner")
        params["urgent_banner"] = urgent_banner
    if "last_reviewed_at" in fields:
        set_clauses.append("last_reviewed_at = :last_reviewed_at")
        params["last_reviewed_at"] = last_reviewed_at

    result = db.execute(
        text(
            f"""
            UPDATE wims.community_content
            SET {", ".join(set_clauses)}
            WHERE id = :content_id AND lifecycle_status = 'DRAFT'
            """
        ),
        params,
    )
    if result.rowcount == 0:
        raise HTTPException(
            status_code=409,
            detail="Content could not be updated (not DRAFT or concurrently modified).",
        )

    log_system_audit(
        db=db,
        user_id=actor_user_id,
        action_type="CMS_EDIT",
        table_affected="wims.community_content",
        record_id=None,
        new_values={
            "content_id": str(content_id),
            "lifecycle_status": "DRAFT",
            "updated_fields": [
                k
                for k in (
                    "slug" if "slug" in fields and slug is not None else None,
                    "expires_at" if "expires_at" in fields else None,
                    "urgent_banner" if "urgent_banner" in fields else None,
                    "last_reviewed_at" if "last_reviewed_at" in fields else None,
                    "title_en" if "title_en" in fields else None,
                    "body_en" if "body_en" in fields else None,
                    "title_uk" if "title_uk" in fields else None,
                    "body_uk" if "body_uk" in fields else None,
                    "metadata_json" if "metadata_json" in fields else None,
                )
                if k is not None
            ],
        },
        sensitive=False,
    )

    return {"content_id": str(content_id), "lifecycle_status": "DRAFT"}
