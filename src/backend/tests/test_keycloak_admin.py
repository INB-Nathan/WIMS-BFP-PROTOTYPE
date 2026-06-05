"""
Keycloak Admin Unit Tests — create_keycloak_user email path + error handling

Validates that create_keycloak_user calls the correct python-keycloak API
(send_update_account, not send_execute_actions_email) and that email failures
are non-fatal.

Markers: unit (no Docker required — all external calls mocked)
"""

from __future__ import annotations

import logging
from unittest.mock import MagicMock, patch

import pytest
from keycloak.exceptions import KeycloakError

from services.keycloak_admin import create_keycloak_user, generate_temp_password


# ---------------------------------------------------------------------------
# Module-level mock — all tests patch _get_admin_client to return a shared mock
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_adm():
    """Return a MagicMock KeycloakAdmin with all required methods."""
    adm = MagicMock(name="KeycloakAdmin")
    adm.create_user.return_value = "user-uuid-1234"
    adm.set_user_password.return_value = None
    adm.send_update_account.return_value = None
    adm.get_realm_role.return_value = {"id": "role-id", "name": "REGIONAL_ENCODER"}
    adm.assign_realm_roles.return_value = None
    return adm


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_generate_temp_password_length():
    """Temp password must be _PWD_LENGTH characters."""
    pwd = generate_temp_password()
    assert len(pwd) == 14


def test_generate_temp_password_random():
    """Two successive calls should produce different passwords."""
    pwd1 = generate_temp_password()
    pwd2 = generate_temp_password()
    assert pwd1 != pwd2


def test_create_user_calls_send_update_account(mock_adm):
    """Happy path: create_keycloak_user calls send_update_account with correct args."""
    with patch("services.keycloak_admin._get_admin_client", return_value=mock_adm):
        user_id = create_keycloak_user(
            email="test@bfp.gov.ph",
            first_name="Test",
            last_name="User",
            username="testuser",
            role="REGIONAL_ENCODER",
            temp_password="TempP@ssw0rd!",
        )

    assert user_id == "user-uuid-1234"

    # Verify the correct email API was called (not the hallucinated one)
    mock_adm.send_update_account.assert_called_once_with(
        user_id="user-uuid-1234",
        payload=["UPDATE_PASSWORD"],
        redirect_uri="",
        lifespan=604800,
    )

    # Verify the old (hallucinated) method was not called
    assert (
        not hasattr(mock_adm, "send_execute_actions_email")
        or not mock_adm.send_execute_actions_email.called
    )

    # Verify password was set as temporary
    mock_adm.set_user_password.assert_called_once_with(
        user_id="user-uuid-1234",
        password="TempP@ssw0rd!",
        temporary=True,
    )

    # Verify create_user payload
    mock_adm.create_user.assert_called_once()
    create_call_args = mock_adm.create_user.call_args[0][0]
    assert create_call_args["username"] == "testuser"
    assert create_call_args["email"] == "test@bfp.gov.ph"
    assert create_call_args["requiredActions"] == ["UPDATE_PASSWORD"]
    assert create_call_args["enabled"] is True
    assert create_call_args["emailVerified"] is True


def test_create_user_with_contact_number(mock_adm):
    """User payload includes contact_number attribute when provided."""
    with patch("services.keycloak_admin._get_admin_client", return_value=mock_adm):
        create_keycloak_user(
            email="test@bfp.gov.ph",
            first_name="Test",
            last_name="User",
            username="testuser",
            role="REGIONAL_ENCODER",
            temp_password="TempP@ssw0rd!",
            contact_number="09171234567",
        )

    create_call_args = mock_adm.create_user.call_args[0][0]
    assert "attributes" in create_call_args
    assert create_call_args["attributes"]["contact_number"] == ["09171234567"]


def test_send_update_account_keycloakerror_is_non_fatal(mock_adm, caplog):
    """If send_update_account raises KeycloakError, user creation still succeeds."""
    caplog.set_level(logging.WARNING, logger="wims.keycloak_admin")
    mock_adm.send_update_account.side_effect = KeycloakError(
        error_message="SMTP not configured",
    )

    with patch("services.keycloak_admin._get_admin_client", return_value=mock_adm):
        user_id = create_keycloak_user(
            email="test@bfp.gov.ph",
            first_name="Test",
            last_name="User",
            username="testuser",
            role="REGIONAL_ENCODER",
            temp_password="TempP@ssw0rd!",
        )

    # User is still created successfully
    assert user_id == "user-uuid-1234"

    # Warning was logged
    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) >= 1
    assert "SMTP not configured" in warnings[0].message
    assert "Update-account email failed" in warnings[0].message

    # Role assignment still proceeds after email failure
    mock_adm.assign_realm_roles.assert_called_once()


def test_create_user_keycloakerror_is_fatal(mock_adm):
    """If create_user raises KeycloakError, it propagates (fatal)."""
    mock_adm.create_user.side_effect = KeycloakError(
        error_message="User exists: test@bfp.gov.ph",
    )

    with patch("services.keycloak_admin._get_admin_client", return_value=mock_adm):
        with pytest.raises(KeycloakError, match="User exists"):
            create_keycloak_user(
                email="test@bfp.gov.ph",
                first_name="Test",
                last_name="User",
                username="testuser",
                role="REGIONAL_ENCODER",
                temp_password="TempP@ssw0rd!",
            )

    # Password and email should not be called if create_user fails
    mock_adm.set_user_password.assert_not_called()
    mock_adm.send_update_account.assert_not_called()


def test_set_user_password_keycloakerror_cleans_up_and_raises(mock_adm):
    """If set_user_password raises KeycloakError, delete user and propagate."""
    mock_adm.set_user_password.side_effect = KeycloakError(
        error_message="Password policy violation",
    )

    with patch("services.keycloak_admin._get_admin_client", return_value=mock_adm):
        with pytest.raises(KeycloakError, match="Password policy"):
            create_keycloak_user(
                email="test@bfp.gov.ph",
                first_name="Test",
                last_name="User",
                username="testuser",
                role="REGIONAL_ENCODER",
                temp_password="TempP@ssw0rd!",
            )

    # Cleanup should delete the partially-created user
    mock_adm.delete_user.assert_called_once_with("user-uuid-1234")

    # Email should never be reached if password fails
    mock_adm.send_update_account.assert_not_called()


def test_role_assignment_keycloakerror_is_non_fatal(mock_adm, caplog):
    """If role assignment raises KeycloakError, user creation still succeeds."""
    caplog.set_level(logging.WARNING, logger="wims.keycloak_admin")
    mock_adm.get_realm_role.side_effect = KeycloakError(
        error_message="Role not found",
    )

    with patch("services.keycloak_admin._get_admin_client", return_value=mock_adm):
        user_id = create_keycloak_user(
            email="test@bfp.gov.ph",
            first_name="Test",
            last_name="User",
            username="testuser",
            role="NONEXISTENT_ROLE",
            temp_password="TempP@ssw0rd!",
        )

    assert user_id == "user-uuid-1234"

    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    role_warn = [w for w in warnings if "Role assignment failed" in w.message]
    assert len(role_warn) == 1
