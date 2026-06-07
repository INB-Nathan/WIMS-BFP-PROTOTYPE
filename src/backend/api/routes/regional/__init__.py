"""Regional Office API — decomposed package.

Route handlers are grouped in sub-modules; this file registers them all
under the /api/regional prefix.
"""

from fastapi import APIRouter
from sqlalchemy import text
from sqlalchemy.orm import Session

from services.regional_incidents import RegionalIncidentLifecycleDependencies
from services.regional_incidents.helpers import (
    insert_incident_verification_history as _insert_incident_verification_history,
    generate_reference_number as _generate_reference_number,
    get_security_provider as _get_security_provider_from_helpers,
    ivh_has_hash_columns,
)
from utils.crypto import SecurityProvider

router = APIRouter(prefix="/api/regional", tags=["regional"])

# Import field_updates first (no circular deps) so helpers can reference them.
from .field_updates import _apply_incident_field_updates  # noqa: E402


def _get_security_provider() -> SecurityProvider:
    """Return the SecurityProvider singleton (wraps helpers import)."""
    return _get_security_provider_from_helpers()


def _fi_has_resubmitted_column(db: Session) -> bool:
    """Module-level cache: True once we confirm the column exists."""
    global _fi_resubmitted_col_exists  # noqa: PLW0603
    if _fi_resubmitted_col_exists is None:
        result = db.execute(
            text(
                "SELECT COUNT(*) FROM information_schema.columns "
                "WHERE table_schema = 'wims' AND table_name = 'fire_incidents' AND column_name = 'is_resubmitted'"
            )
        ).scalar()
        _fi_resubmitted_col_exists = bool(result)
    return _fi_resubmitted_col_exists


_fi_resubmitted_col_exists: bool | None = None


def _regional_lifecycle_dependencies() -> RegionalIncidentLifecycleDependencies:
    """Build the lifecycle dependency bundle shared by encoder and validator flows."""
    return RegionalIncidentLifecycleDependencies(
        insert_incident_verification_history=_insert_incident_verification_history,
        apply_incident_field_updates=_apply_incident_field_updates,
        generate_reference_number=_generate_reference_number,
    )


def _incident_verification_history_has_hash_columns(db: Session) -> bool:
    """Return True when IVH table has columns needed for correction hash chaining."""
    return ivh_has_hash_columns(db)


# Import route sub-modules and register their routers
from . import afor, duplicates, stats, encoder, encoder_crud, validator  # noqa: E402

router.include_router(afor.router)
router.include_router(duplicates.router)
router.include_router(stats.router)
router.include_router(encoder.router)
router.include_router(encoder_crud.router)
router.include_router(validator.router)
