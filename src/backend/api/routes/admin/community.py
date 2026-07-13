"""Admin Community Safety Hub CMS routes (Slice F).

Re-exports the SYSTEM_ADMIN CMS router defined in
``api.routes.community_content`` so it is discoverable by the admin package's
``from . import community`` registry and mounted under ``/api/admin``.
"""

from __future__ import annotations

from api.routes.community_content import admin_router

__all__ = ["admin_router"]
