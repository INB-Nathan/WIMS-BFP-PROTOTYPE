"""
Self-Service User Profile Routes.

These routes are for any authenticated WIMS user to manage their own profile
and password. Role cannot be changed by the user themselves.

Prefix: /api/user  (registered in main.py)
"""

import logging
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from keycloak.exceptions import KeycloakError

from auth import get_current_wims_user
from database import get_db, get_db_with_rls
from sqlalchemy.orm import Session
from sqlalchemy import text
from keycloak import KeycloakOpenID

from services.keycloak_admin import (
    update_user_profile,
    change_user_password,
    get_user_profile,
    _KC_BASE_URL,
    _KC_REALM,
    _get_admin_client,
)

logger = logging.getLogger("wims.user_profile")

router = APIRouter(prefix="/api/user", tags=["user-profile"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class ProfileUpdate(BaseModel):
    """Fields a user is allowed to update on their own profile."""

    first_name: Optional[str] = None
    last_name: Optional[str] = None
    # NOTE: email is intentionally excluded from self-service update.
    # Government email addresses are controlled credentials — only SYSADMIN
    # may change them via the admin user management endpoints.
    contact_number: Optional[str] = None  # Stored in Keycloak AND DB
    # Note: no password required here — the JWT token already confirms identity.
    # Password is only needed when changing the password itself.

    @field_validator("first_name", "last_name")
    @classmethod
    def name_not_empty(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not v.strip():
            raise ValueError("Name must not be blank")
        return v.strip() if v else v

    @field_validator("contact_number")
    @classmethod
    def contact_number_format(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            digits = v.replace("+", "").replace("-", "").replace(" ", "")
            if not digits.isdigit() or len(digits) < 7:
                raise ValueError("contact_number must be a valid phone number")
        return v


class PasswordChange(BaseModel):
    """Payload for self-service password change."""

    current_password: str
    new_password: str
    otp_code: Optional[str] = None  # Required only if user has 2FA/OTP enrolled

    @field_validator("new_password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("new_password must be at least 8 characters long")
        has_upper = any(c.isupper() for c in v)
        has_digit = any(c.isdigit() for c in v)
        special_chars = "!@#$%^&*()-_=+[]{}|;:'\",.<>?/`~"
        has_special = any(c in special_chars for c in v)
        if not (has_upper and has_digit and has_special):
            raise ValueError(
                "new_password must contain at least 1 uppercase, 1 number, and 1 special character"
            )
        return v


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/me/profile")
def get_my_profile(
    current_user: Annotated[dict, Depends(get_current_wims_user)],
    db: Annotated[Session, Depends(get_db)],
):
    """Retrieve full name and contact number (names from Keycloak, number from DB)."""
    keycloak_id = current_user["keycloak_id"]
    profile = get_user_profile(keycloak_id)

    # Sync contact_number from database
    row = db.execute(
        text("SELECT contact_number FROM wims.users WHERE keycloak_id = :kid"),
        {"kid": keycloak_id},
    ).fetchone()
    if row and row[0]:
        profile["contact_number"] = row[0]

    return profile


@router.patch("/me")
def update_my_profile(
    body: ProfileUpdate,
    current_user: Annotated[dict, Depends(get_current_wims_user)],
    db: Annotated[Session, Depends(get_db_with_rls)],
):
    """
    Update the current user's own profile (first_name, last_name, contact_number).
    Authentication is confirmed by the JWT bearer token — no password re-entry needed.
    Role and region cannot be changed here — contact a System Administrator.
    Email is read-only (government-controlled credential — SYSADMIN-managed only).
    Changes are reflected immediately in Keycloak.
    """
    if not any([body.first_name, body.last_name, body.contact_number]):
        raise HTTPException(status_code=400, detail="No fields to update")

    keycloak_id = current_user["keycloak_id"]

    # --- Update Keycloak profile (email excluded — CRIT-0 self-service ban) ---
    try:
        update_user_profile(
            keycloak_id,
            first_name=body.first_name,
            last_name=body.last_name,
            # email intentionally omitted — government email is SYSADMIN-controlled
            contact_number=body.contact_number,
        )
    except KeycloakError as e:
        logger.error(f"Keycloak profile update failed for {keycloak_id}: {e}")
        raise HTTPException(
            status_code=502,
            detail="Failed to update identity provider profile. Try again later.",
        )

    # --- Sync DB fields (contact_number only — email is SYSADMIN-controlled) ---
    if body.contact_number:
        try:
            update_fields = []
            params = {"uid": current_user["user_id"]}
            update_fields.append("contact_number = :cnum")
            params["cnum"] = body.contact_number

            if update_fields:
                db.execute(
                    text(
                        f"UPDATE wims.users SET {', '.join(update_fields)}, updated_at = now() WHERE user_id = :uid"
                    ),
                    params,
                )
                db.commit()
        except Exception:
            db.rollback()
            logger.exception(f"DB sync failed for user {current_user['user_id']}")
            logger.warning("Keycloak updated but DB sync failed")

    return {"status": "ok", "message": "Profile updated successfully"}


@router.patch("/me/password")
def change_my_password(
    body: PasswordChange,
    current_user: Annotated[dict, Depends(get_current_wims_user)],
):
    """
    Change the current user's own password.
    The current password is verified against Keycloak before allowing the change.
    Uses bfp-client (public, DAG-enabled) — the same client the browser uses to authenticate.
    """
    keycloak_id = current_user["keycloak_id"]

    # Fetch the exact username from Keycloak
    try:
        adm = _get_admin_client()
        kc_user_data = adm.get_user(keycloak_id)
        target_username = kc_user_data.get("username")
    except Exception:
        target_username = current_user.get("kc_username") or current_user["username"]

    # Verify current password using bfp-client (public, directAccessGrantsEnabled=true)
    # This matches exactly how the browser authenticates the user
    kc_openid = KeycloakOpenID(
        server_url=_KC_BASE_URL,
        realm_name=_KC_REALM,
        client_id="bfp-client",
        verify=True,
    )
    try:
        # Pass totp code if user has 2FA enrolled — Keycloak's password grant supports this natively
        token_kwargs = {}
        if body.otp_code:
            token_kwargs["totp"] = body.otp_code
        kc_openid.token(
            username=target_username, password=body.current_password, **token_kwargs
        )
    except KeycloakError as e:
        logger.warning(f"Change PW verification failed for {keycloak_id}: {e}")
        raise HTTPException(
            status_code=401, detail="Incorrect current password or OTP code"
        )

    try:
        change_user_password(keycloak_id, body.new_password)
    except KeycloakError as e:
        logger.error(f"Password change failed for {keycloak_id}: {e}")
        raise HTTPException(
            status_code=502,
            detail="Failed to update password in identity provider. Try again later.",
        )

    return {"status": "ok", "message": "Password changed successfully"}
