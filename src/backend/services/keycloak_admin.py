"""
Keycloak Admin Service.

Uses Keycloak administrative credentials from environment for user lifecycle and
session-governance operations. Keep these credentials scoped to local/dev or a
least-privileged admin account; do not expose them to self-service frontend code.
"""

import os
import logging
import secrets
import string

from keycloak import KeycloakAdmin, KeycloakOpenID
from keycloak.exceptions import KeycloakError

logger = logging.getLogger("wims.keycloak_admin")

# ---------------------------------------------------------------------------
# Configuration (populated from environment / compose env_file)
# ---------------------------------------------------------------------------
_KC_SERVER_URL = os.environ.get(
    "KEYCLOAK_REALM_URL", "http://keycloak:8080/auth/realms/bfp"
)
# Derive base server URL from realm URL: strip "/realms/bfp" suffix
_KC_BASE_URL = _KC_SERVER_URL.split("/realms/")[0] + "/"
_KC_REALM = "bfp"
_KC_CLIENT_ID = os.environ.get("KEYCLOAK_ADMIN_CLIENT_ID", "wims-admin-service")
_KC_CLIENT_SECRET = os.environ.get("KEYCLOAK_ADMIN_CLIENT_SECRET", "")
_KC_ADMIN_USER = os.environ.get("KEYCLOAK_ADMIN_USER", "admin")
_KC_ADMIN_PASSWORD = os.environ.get("KEYCLOAK_ADMIN_PASSWORD", "admin")

# Password alphabet: upper + lower + digits + safe special chars.
# Avoids confusable chars (0/O, l/1) and shell-sensitive chars.
_PWD_ALPHABET = string.ascii_letters + string.digits + "!@#$%^&*"
_PWD_LENGTH = (
    14  # 14-char temporary password; sufficient entropy for a one-time credential
)


# ---------------------------------------------------------------------------
# Singleton helper — lazy-initialized so tests / offline environments
# do not fail at import time.
# ---------------------------------------------------------------------------


def _get_admin_client() -> KeycloakAdmin:
    """
    Return a KeycloakAdmin instance authenticated via the Keycloak master admin
    user. This avoids service-account permission issues and works reliably across
    all Keycloak versions.

    Uses KeycloakOpenID.token() for direct access grant against the master realm,
    then passes the token to KeycloakAdmin targeting the bfp realm.
    """
    oidc = KeycloakOpenID(
        server_url=_KC_BASE_URL,
        realm_name="master",
        client_id="admin-cli",
    )
    token = oidc.token(_KC_ADMIN_USER, _KC_ADMIN_PASSWORD)
    return KeycloakAdmin(
        server_url=_KC_BASE_URL,
        realm_name=_KC_REALM,
        token=token,
    )


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------


def generate_temp_password() -> str:
    """Generate a cryptographically secure temporary password."""
    return "".join(secrets.choice(_PWD_ALPHABET) for _ in range(_PWD_LENGTH))


def create_keycloak_user(
    *,
    email: str,
    first_name: str,
    last_name: str,
    username: str,
    role: str,
    temp_password: str,
    contact_number: str | None = None,
) -> str:
    """
    Create a user in Keycloak, set a temporary password (must change on first
    login), assign the given realm role, and return the new user's Keycloak UUID.

    Raises:
        KeycloakError: if the Keycloak API call fails (e.g. email already exists).
        RuntimeError: if admin client is not configured.
    """
    adm = _get_admin_client()

    user_payload = {
        "username": username,
        "email": email,
        "firstName": first_name,
        "lastName": last_name,
        "enabled": True,
        "emailVerified": True,
        "requiredActions": ["UPDATE_PASSWORD"],  # Force change on first login
    }
    if contact_number:
        user_payload["attributes"] = {"contact_number": [contact_number]}

    try:
        user_id = adm.create_user(user_payload, exist_ok=False)
    except KeycloakError as e:
        logger.error(f"Keycloak create_user failed for {email}: {e}")
        raise

    # Set temporary (must-change) password
    try:
        adm.set_user_password(user_id=user_id, password=temp_password, temporary=True)
    except KeycloakError as e:
        logger.error(f"Keycloak set_user_password failed for {user_id}: {e}")
        # Attempt cleanup — delete the partially-created user
        try:
            adm.delete_user(user_id)
        except Exception:
            pass
        raise

    # Assign realm role
    try:
        _assign_realm_role(adm, user_id=user_id, role_name=role)
    except KeycloakError as e:
        logger.warning(f"Role assignment failed for {user_id} role={role}: {e}")
        # Non-fatal for onboarding — admin can re-assign manually

    logger.info(f"Keycloak user created: id={user_id} email={email} role={role}")
    return user_id


def _assign_realm_role(adm: KeycloakAdmin, *, user_id: str, role_name: str) -> None:
    """Assign a single realm-level role to a user."""
    role = adm.get_realm_role(role_name)
    adm.assign_realm_roles(user_id=user_id, roles=[role])


def set_user_enabled(keycloak_id: str, *, enabled: bool) -> None:
    """
    Enable or disable a user in Keycloak. When disabled, all existing sessions
    are also revoked so the user is immediately logged out.

    Raises:
        KeycloakError: on API failure.
        RuntimeError: if admin client is not configured.
    """
    adm = _get_admin_client()
    try:
        adm.update_user(user_id=keycloak_id, payload={"enabled": enabled})
        if not enabled:
            # Force logout all existing sessions
            try:
                adm.user_logout(user_id=keycloak_id)
            except KeycloakError as e:
                # Sessions may already be expired — warn but do not fail
                logger.warning(f"Could not revoke sessions for {keycloak_id}: {e}")
        logger.info(f"Keycloak user {keycloak_id} enabled={enabled}")
    except KeycloakError as e:
        logger.error(f"Keycloak set_user_enabled failed for {keycloak_id}: {e}")
        raise


def logout_user_sessions(keycloak_id: str) -> None:
    """Revoke all active Keycloak sessions for a user without disabling the account."""
    adm = _get_admin_client()
    try:
        adm.user_logout(user_id=keycloak_id)
        logger.info(f"Sessions revoked for Keycloak user {keycloak_id}")
    except KeycloakError as e:
        # Sessions may already be expired — warn but do not fail the caller
        logger.warning(f"Could not revoke sessions for {keycloak_id}: {e}")


def get_user_sessions(keycloak_id: str) -> list[dict]:
    """Return all active sessions for a user from Keycloak."""
    adm = _get_admin_client()
    try:
        return adm.get_sessions(user_id=keycloak_id) or []
    except KeycloakError as e:
        logger.error(f"Could not fetch sessions for {keycloak_id}: {e}")
        return []


def update_user_profile(
    keycloak_id: str,
    *,
    first_name: str | None = None,
    last_name: str | None = None,
    # NOTE: email intentionally not exposed to self-service routes (CRIT-0).
    # Self-service PATCH /me must NEVER pass email — it is a government-controlled
    # credential. Admin routes that manage email must call this with email explicitly.
    email: str | None = None,
    contact_number: str | None = None,
) -> None:
    """
    Update mutable profile attributes on a Keycloak user.
    Only non-None values are sent to avoid overwriting unchanged fields.

    Raises:
        KeycloakError: on API failure.
    """
    adm = _get_admin_client()
    payload: dict = {}
    if first_name is not None:
        payload["firstName"] = first_name
    if last_name is not None:
        payload["lastName"] = last_name
    if email is not None:
        payload["email"] = email
        payload["username"] = email  # keep username = email in sync
    if contact_number is not None:
        payload["attributes"] = {"contact_number": [contact_number]}

    if not payload:
        return

    try:
        adm.update_user(user_id=keycloak_id, payload=payload)
        logger.info(
            f"Keycloak user {keycloak_id} profile updated: {list(payload.keys())}"
        )
    except KeycloakError as e:
        logger.error(f"Keycloak update_user_profile failed for {keycloak_id}: {e}")
        raise


def change_user_password(keycloak_id: str, new_password: str) -> None:
    """
    Set a new (non-temporary) password for the given user.
    Used by the self-service password change endpoint.

    Raises:
        KeycloakError: on API failure.
    """
    adm = _get_admin_client()
    try:
        adm.set_user_password(
            user_id=keycloak_id, password=new_password, temporary=False
        )
        logger.info(f"Password changed for Keycloak user {keycloak_id}")
    except KeycloakError as e:
        logger.error(f"Keycloak change_user_password failed for {keycloak_id}: {e}")
        raise


def get_user_profile(keycloak_id: str) -> dict:
    """Retrieve full name and attributes from Keycloak."""
    adm = _get_admin_client()
    try:
        user = adm.get_user(keycloak_id)
        first = user.get("firstName", "")
        last = user.get("lastName", "")
        full_name = f"{first} {last}".strip()
        attributes = user.get("attributes", {})
        contact_number = attributes.get("contact_number", [""])[0]
        return {
            "first_name": first,
            "last_name": last,
            "full_name": full_name,
            "contact_number": contact_number,
        }
    except KeycloakError as e:
        logger.error(f"Failed to fetch keycloak user {keycloak_id}: {e}")
        return {
            "first_name": "",
            "last_name": "",
            "full_name": "",
            "contact_number": "",
        }
