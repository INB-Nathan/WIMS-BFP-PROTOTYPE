import os
import uuid
import logging
from typing import Annotated, Optional, Dict, Any
from jose import jwt, jwk, JWTError
import httpx
from fastapi import Request, HTTPException, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session
from sqlalchemy.exc import DataError

from database import get_db

logger = logging.getLogger("wims.auth")

# ---------------------------------------------------------------------------
# Keycloak Configuration
# ---------------------------------------------------------------------------
KEYCLOAK_REALM_URL = os.environ.get(
    "KEYCLOAK_REALM_URL",
    os.environ.get("KEYCLOAK_URL", "http://localhost:8080/auth/realms/bfp"),
)
KEYCLOAK_URL = os.environ.get("NEXT_PUBLIC_AUTH_API_URL", KEYCLOAK_REALM_URL)
CLIENT_ID = os.environ.get("KEYCLOAK_CLIENT_ID", "bfp-client")
AUDIENCE = os.environ.get("KEYCLOAK_AUDIENCE", "account")  # Default Keycloak audience


class KeycloakAuthenticator:
    def __init__(self):
        self.jwks: Optional[Dict[str, Any]] = None
        self.oidc_config: Optional[Dict[str, Any]] = None

    async def _fetch_oidc_config(self):
        """Fetch OIDC configuration from Keycloak."""
        if self.oidc_config:
            return

        config_url = f"{KEYCLOAK_REALM_URL}/.well-known/openid-configuration"
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(config_url)
                response.raise_for_status()
                self.oidc_config = response.json()
        except Exception as e:
            logger.error(f"Failed to fetch OIDC config from {config_url}: {e}")
            raise HTTPException(
                status_code=503, detail="Identity Provider configuration unreachable"
            )

    async def _fetch_jwks(self):
        """Fetch JWKS (Public Keys) from Keycloak."""
        if self.jwks:
            return

        if not self.oidc_config:
            raise HTTPException(
                status_code=503, detail="Identity Provider configuration missing"
            )

        jwks_uri = self.oidc_config.get("jwks_uri")
        if not jwks_uri:
            raise HTTPException(
                status_code=503,
                detail="JWKS URI missing in Identity Provider configuration",
            )

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(jwks_uri)
                response.raise_for_status()
                self.jwks = response.json()
        except Exception as e:
            logger.error(f"Failed to fetch JWKS from {jwks_uri}: {e}")
            raise HTTPException(
                status_code=503, detail="Identity Provider public keys unreachable"
            )

    def _get_key_for_kid(self, kid: str) -> Dict[str, Any]:
        if not self.jwks or "keys" not in self.jwks:
            raise HTTPException(
                status_code=503, detail="Identity Provider public keys unavailable"
            )

        for key_data in self.jwks["keys"]:
            if key_data.get("kid") != kid:
                continue
            if key_data.get("kty") != "RSA":
                continue
            if key_data.get("use") not in (None, "sig"):
                continue
            if key_data.get("alg") not in (None, "RS256"):
                continue
            return key_data

        raise HTTPException(status_code=401, detail="Invalid token: kid mismatch")

    async def validate_token(self, token: str) -> Dict[str, Any]:
        await self._fetch_oidc_config()
        await self._fetch_jwks()

        try:
            unverified_header = jwt.get_unverified_header(token)
            kid = unverified_header.get("kid")
            if not kid:
                raise HTTPException(
                    status_code=401, detail="Invalid token: kid missing"
                )

            key_data = self._get_key_for_kid(kid)
            public_key = jwk.construct(key_data)

            payload = jwt.decode(
                token,
                public_key.to_pem().decode()
                if hasattr(public_key, "to_pem")
                else public_key,
                algorithms=["RS256"],
                audience=CLIENT_ID,
                issuer=KEYCLOAK_REALM_URL.rstrip("/") + "/",
                options={
                    "verify_at_hash": False,
                    "require": ["exp", "iat", "iss", "aud"],
                },
            )

            azp = payload.get("azp")
            if azp != CLIENT_ID:
                logger.warning(
                    f"Token issued for client {azp} but expected {CLIENT_ID}"
                )
                raise HTTPException(
                    status_code=401, detail="Invalid token: client mismatch"
                )

            return payload

        except HTTPException:
            raise
        except JWTError as e:
            logger.warning(f"JWT Validation failed: {e}")
            raise HTTPException(
                status_code=401, detail="Invalid token: JWT validation failed"
            )
        except Exception as e:
            logger.error(f"Unexpected error during token validation: {e}")
            raise HTTPException(
                status_code=500, detail="Internal server error during authentication"
            )


# Dependency for FastAPI routes
authenticator = KeycloakAuthenticator()


async def get_current_user(request: Request):
    """
    Extract and validate the access_token from HttpOnly cookies.
    """
    token = request.cookies.get("access_token")
    if not token:
        # Fallback to Authorization header for testing/tools
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ")[1]

    if not token:
        raise HTTPException(
            status_code=401, detail="Authentication credentials missing"
        )

    return await authenticator.validate_token(token)


async def get_current_wims_user(
    token_payload: Annotated[dict, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    """
    Resolve JWT payload to wims.users row. Ensures only authenticated
    Keycloak users present in wims.users can access protected routes.
    """
    keycloak_sub = token_payload.get("sub")
    if not keycloak_sub:
        raise HTTPException(status_code=401, detail="Invalid token: missing sub")

    # Validate keycloak_sub is UUID-format BEFORE hitting the database
    try:
        uuid.UUID(keycloak_sub)
    except ValueError:
        logger.warning(f"Invalid keycloak_sub format: {keycloak_sub}")
        raise HTTPException(status_code=401, detail="Invalid token: malformed sub")

    try:
        row = db.execute(
            text(
                "SELECT user_id, role FROM wims.users WHERE keycloak_id = :kid AND is_active = TRUE"
            ),
            {"kid": keycloak_sub},
        ).fetchone()
    except DataError as e:
        logger.error(f"DB error validating keycloak_id {keycloak_sub}: {e}")
        raise HTTPException(status_code=500, detail="Authentication system error")

    if row is None:
        raise HTTPException(status_code=403, detail="User not found in WIMS")

    return {"user_id": row[0], "keycloak_id": keycloak_sub, "role": row[1]}


async def get_system_admin(
    current_user: Annotated[dict, Depends(get_current_wims_user)],
) -> dict:
    """
    Require SYSTEM_ADMIN role. Raise 403 if current_user.role != 'SYSTEM_ADMIN'.
    """
    if current_user.get("role") != "SYSTEM_ADMIN":
        raise HTTPException(status_code=403, detail="SYSTEM_ADMIN privileges required")
    return current_user


async def get_regional_encoder(
    current_user: Annotated[dict, Depends(get_current_wims_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    """
    Require REGIONAL_ENCODER role with an assigned region.
    Returns user dict augmented with assigned_region_id.
    """
    if current_user.get("role") != "REGIONAL_ENCODER":
        raise HTTPException(
            status_code=403, detail="REGIONAL_ENCODER privileges required"
        )

    try:
        row = db.execute(
            text("SELECT assigned_region_id FROM wims.users WHERE user_id = :uid"),
            {"uid": current_user["user_id"]},
        ).fetchone()
        if row is None:
            raise HTTPException(
                status_code=403, detail="User not found or region assignment missing"
            )
        region_id = row[0]
        if region_id is None:
            raise HTTPException(
                status_code=403, detail="No region assigned to this user"
            )
        current_user["assigned_region_id"] = region_id
        return current_user
    except DataError as e:
        logger.error(
            f"DB error fetching region for user {current_user['user_id']}: {e}"
        )
        raise HTTPException(status_code=500, detail="Authentication system error")


async def get_analyst_or_admin(
    current_user: Annotated[dict, Depends(get_current_wims_user)],
) -> dict:
    """
    Require NATIONAL_ANALYST, ANALYST, or SYSTEM_ADMIN role for analytics endpoints.
    ANALYST is accepted as alias for NATIONAL_ANALYST (legacy seed compatibility).
    Raise 403 if current_user.role is not one of these.
    """
    role = current_user.get("role")
    if role not in ("NATIONAL_ANALYST", "ANALYST", "SYSTEM_ADMIN"):
        raise HTTPException(
            status_code=403,
            detail="NATIONAL_ANALYST or SYSTEM_ADMIN privileges required",
        )
    return current_user


async def get_regional_user(
    current_user: Annotated[dict, Depends(get_current_wims_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    """
    Any authenticated user with an assigned_region_id.
    Useful for shared region-scoped endpoints.
    """
    try:
        row = db.execute(
            text("SELECT assigned_region_id FROM wims.users WHERE user_id = :uid"),
            {"uid": current_user["user_id"]},
        ).fetchone()
        if row is None:
            raise HTTPException(
                status_code=403, detail="User not found or region assignment missing"
            )
        region_id = row[0]
        if region_id is None:
            raise HTTPException(
                status_code=403, detail="No region assigned to this user"
            )
        current_user["assigned_region_id"] = region_id
        return current_user
    except DataError as e:
        logger.error(
            f"DB error fetching region for user {current_user['user_id']}: {e}"
        )
        raise HTTPException(status_code=500, detail="Authentication system error")
