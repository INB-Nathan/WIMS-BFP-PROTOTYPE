import os
import logging
from typing import Annotated, Optional, Dict, Any
from jose import jwt, JWTError
import httpx
from fastapi import Request, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import text
from sqlalchemy.orm import Session

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
AUDIENCE = os.environ.get("KEYCLOAK_AUDIENCE", "account") # Default Keycloak audience

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
            raise HTTPException(status_code=503, detail="Identity Provider configuration unreachable")

    async def _fetch_jwks(self):
        """Fetch JWKS (Public Keys) from Keycloak."""
        if self.jwks:
            return
            
        if not self.oidc_config:
            raise HTTPException(status_code=503, detail="Identity Provider configuration missing")
            
        jwks_uri = self.oidc_config.get("jwks_uri")
        if not jwks_uri:
            raise HTTPException(status_code=503, detail="JWKS URI missing in Identity Provider configuration")
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(jwks_uri)
                response.raise_for_status()
                self.jwks = response.json()
        except Exception as e:
            logger.error(f"Failed to fetch JWKS from {jwks_uri}: {e}")
            raise HTTPException(status_code=503, detail="Identity Provider public keys unreachable")

    async def validate_token(self, token: str) -> Dict[str, Any]:
        """Validate a JWT access token against Keycloak's public keys."""
        await self._fetch_oidc_config()
        await self._fetch_jwks()
        
        try:
            # We fetch the header to potentially use 'kid' for key selection in JWKS
            # but for now we rely on jose's ability to handle multiple keys if passed as JWKS
            
            payload = jwt.decode(
                token,
                self.jwks,
                algorithms=["RS256"],
                audience=AUDIENCE,
                options={"verify_at_hash": False}
            )
            return payload
        except JWTError as e:
            logger.warning(f"JWT Validation failed: {e}")
            raise HTTPException(status_code=401, detail="Invalid or expired token")
        except Exception as e:
            logger.error(f"Unexpected error during token validation: {e}")
            raise HTTPException(status_code=500, detail="Internal server error during authentication")

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
        raise HTTPException(status_code=401, detail="Authentication credentials missing")
        
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

    row = db.execute(
        text("SELECT user_id, role FROM wims.users WHERE keycloak_id = CAST(:kid AS uuid) AND is_active = TRUE"),
        {"kid": keycloak_sub},
    ).fetchone()

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
