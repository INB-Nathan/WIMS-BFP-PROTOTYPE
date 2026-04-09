import os
import time
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
# audience is what Keycloak puts in the token's "aud" claim — must match CLIENT_ID.
# If KEYCLOAK_AUDIENCE is unset, default to the CLIENT_ID so they stay in sync.
AUDIENCE = os.environ.get(
    "KEYCLOAK_AUDIENCE", os.environ.get("KEYCLOAK_CLIENT_ID", "bfp-client")
)
JWKS_CACHE_TTL_SECONDS = 60  # 60 seconds — Keycloak key rotation typically hourly/daily; balance freshness vs latency
# Issuer URL as it appears in JWT `iss` claim — differs from KEYCLOAK_REALM_URL
# when Keycloak is accessed externally (browser → localhost:8080) vs internally
# (container network → keycloak:8080). Set KEYCLOAK_ISSUER so jwt.decode()
# validates the token's iss claim against the browser-visible issuer.
KEYCLOAK_ISSUER = os.environ.get(
    "KEYCLOAK_ISSUER", KEYCLOAK_REALM_URL.rstrip("/") + "/"
)


class KeycloakAuthenticator:
    def __init__(self):
        self.jwks: Optional[Dict[str, Any]] = None
        self.jwks_fetched_at: float = 0.0
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
        """Fetch JWKS (Public Keys) from Keycloak. Cached for JWKS_CACHE_TTL_SECONDS."""
        now = time.time()
        if self.jwks and (now - self.jwks_fetched_at) < JWKS_CACHE_TTL_SECONDS:
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
                self.jwks_fetched_at = now
        except Exception as e:
            logger.error(f"Failed to fetch JWKS from {jwks_uri}: {e}")
            raise HTTPException(
                status_code=503, detail="Identity Provider public keys unreachable"
            )

    def _get_key_for_kid(self, kid: str) -> Optional[Dict[str, Any]]:
        """Return the JWKS key dict matching kid, or None if not found."""
        if not self.jwks or "keys" not in self.jwks:
            return None

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
        return None

    def _get_first_valid_key(self) -> Optional[Dict[str, Any]]:
        """Return the first RSA signing key from JWKS, for fallback when kid is unknown."""
        if not self.jwks or "keys" not in self.jwks:
            return None
        for key_data in self.jwks["keys"]:
            if key_data.get("kty") != "RSA":
                continue
            if key_data.get("use") not in (None, "sig"):
                continue
            if key_data.get("alg") not in (None, "RS256"):
                continue
            return key_data
        return None

    async def validate_token(self, token: str) -> Dict[str, Any]:
        await self._fetch_oidc_config()
        await self._fetch_jwks()

        try:
            unverified_header = jwt.get_unverified_header(token)
            kid = unverified_header.get("kid")

            # Try kid-matched key first, then fall back to trying all JWKS keys.
            # The all-keys loop handles tokens signed with a rotated key whose
            # kid is no longer in the current JWKS cache.
            candidate_keys: list[Optional[Dict[str, Any]]] = []
            if kid:
                key_data = self._get_key_for_kid(kid)
                candidate_keys = [key_data] if key_data else []
            # If kid unknown or key not found, try every RSA signing key
            if not candidate_keys or candidate_keys[0] is None:
                candidate_keys = [
                    k
                    for k in self.jwks.get("keys", [])
                    if k.get("kty") == "RSA"
                    and k.get("use") in (None, "sig")
                    and k.get("alg") in (None, "RS256")
                ]

            last_error: Exception | None = None
            for key_data in candidate_keys:
                try:
                    public_key = jwk.construct(key_data)
                    payload = jwt.decode(
                        token,
                        public_key.to_pem().decode()
                        if hasattr(public_key, "to_pem")
                        else public_key,
                        algorithms=["RS256"],
                        audience=AUDIENCE,
                        issuer=KEYCLOAK_ISSUER,
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
                    last_error = e
                    continue  # try next key

            # All keys exhausted
            if last_error:
                logger.warning(
                    f"JWT Validation failed after trying all keys: {last_error}"
                )
            raise HTTPException(
                status_code=401, detail="Invalid token: JWT validation failed"
            )

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
    Extract and validate the access_token from HttpOnly cookies only.
    The Authorization header is NOT consulted — HttpOnly cookies are the
    sole token transport to prevent XSS-driven token theft (CSRF mitigation).
    """
    token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(
            status_code=401, detail="Authentication credentials missing"
        )

    return await authenticator.validate_token(token)


async def get_current_wims_user(
    request: Request,
    token_payload: Annotated[dict, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> dict:
    """
    Resolve JWT payload to wims.users row. Ensures only authenticated
    Keycloak users present in wims.users can access protected routes.

    Also attaches the resolved user dict to request.state so that
    get_db() can call SET LOCAL wims.current_user_id for RLS enforcement.
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

    user_dict = {"user_id": row[0], "keycloak_id": keycloak_sub, "role": row[1]}

    # Attach to request.state so get_db() can set the RLS GUC for this transaction
    request.state.wims_user = user_dict

    return user_dict


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
    Require NATIONAL_ANALYST or SYSTEM_ADMIN role for analytics endpoints.
    Raise 403 if current_user.role is not one of these.
    """
    role = current_user.get("role")
    if role not in ("NATIONAL_ANALYST", "SYSTEM_ADMIN"):
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
