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
    ivh_has_hash_columns,
    _ivh_has_column as _ivh_col_check,
)
from services.kms import get_crypto_provider

router = APIRouter(prefix="/api/regional", tags=["regional"])

# Import field_updates first (no circular deps) so helpers can reference them.
from .field_updates import _apply_incident_field_updates  # noqa: E402


def _get_security_provider():
    """Return the correct crypto provider based on WIMS_CRYPTO_PROVIDER env var."""
    return get_crypto_provider()


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


def _regional_lifecycle_dependencies(
    request_ip: str | None = None,
) -> RegionalIncidentLifecycleDependencies:
    """Build the lifecycle dependency bundle shared by encoder and validator flows."""
    if request_ip:
        def _ivh_with_ip(db, **kwargs):  # type: ignore[no-untyped-def]
            return _insert_incident_verification_history(db, request_ip=request_ip, **kwargs)
        ivh_callable = _ivh_with_ip
    else:
        ivh_callable = _insert_incident_verification_history
    return RegionalIncidentLifecycleDependencies(
        insert_incident_verification_history=ivh_callable,
        apply_incident_field_updates=_apply_incident_field_updates,
        generate_reference_number=_generate_reference_number,
    )


def _incident_verification_history_has_hash_columns(db: Session) -> bool:
    """Return True when IVH table has columns needed for correction hash chaining."""
    return ivh_has_hash_columns(db)


def _ivh_has_client_id_column(db: Session) -> bool:
    """Return True when IVH table has the client_id column (migration 56)."""
    return _ivh_col_check(db, "client_id")


# Import route sub-modules and register their routers
from . import afor, duplicates, stats, encoder, encoder_crud, validator  # noqa: E402

router.include_router(afor.router)
router.include_router(duplicates.router)
router.include_router(stats.router)
router.include_router(encoder.router)
router.include_router(encoder_crud.router)
router.include_router(validator.router)
