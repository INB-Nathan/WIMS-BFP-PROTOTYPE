"""
Keycloak 'Forgot Password' Flow — Integration Tests

Validates the full password-reset-via-email-link flow:
  1. User clicks "Forgot Password" on Keycloak login page
  2. Keycloak sends a password-reset email with a one-time token link
  3. User clicks link, enters new password
  4. Password is updated, user can login with new password

Prerequisites:
  - Keycloak 26.6.0 running (docker compose up keycloak)
  - SMTP configured on the bfp realm (use MailHog for dev: http://localhost:8025)
  - A test user exists in Keycloak (created by fixture or bfp-realm.json)

Run:
  cd src && docker compose run --rm backend \
    pytest tests/integration/test_keycloak_password_reset.py -v

  Or locally (requires KEYCLOAK_ADMIN_URL reachable):
    KEYCLOAK_ADMIN_URL=http://localhost:8080 \
    KEYCLOAK_ADMIN_USER=admin \
    KEYCLOAK_ADMIN_PASSWORD=admin \
    MAILHOG_API_URL=http://localhost:8025 \
    pytest src/backend/tests/integration/test_keycloak_password_reset.py -v

Related wiki pages:
  - [[concepts/keycloak-mfa-findings]]
  - [[analyses/keycloak-mfa-pkce-debugging]]
"""

from __future__ import annotations

import os
import re
import time
import uuid

import httpx
import pytest

# ---------------------------------------------------------------------------
# Configuration (env-driven, Docker-friendly defaults)
# ---------------------------------------------------------------------------

KEYCLOAK_ADMIN_URL = os.environ.get("KEYCLOAK_ADMIN_URL", "http://localhost:8080")
KEYCLOAK_ADMIN_USER = os.environ.get("KEYCLOAK_ADMIN_USER", "admin")
KEYCLOAK_ADMIN_PASSWORD = os.environ.get("KEYCLOAK_ADMIN_PASSWORD", "admin")
KEYCLOAK_REALM = os.environ.get("KEYCLOAK_REALM", "bfp")
KEYCLOAK_CLIENT_ID = os.environ.get("KEYCLOAK_CLIENT_ID", "bfp-client")

MAILHOG_API_URL = os.environ.get("MAILHOG_API_URL", "http://localhost:8025")

REALM_URL = f"{KEYCLOAK_ADMIN_URL}/auth/realms/{KEYCLOAK_REALM}"
ADMIN_API = f"{KEYCLOAK_ADMIN_URL}/auth/admin/realms/{KEYCLOAK_REALM}"

TEST_USER_EMAIL = "password-reset-test@wims-bfp.local"
TEST_USER_PASSWORD = "InitialPass123!"
TEST_USER_NEW_PASSWORD = "ResetPass456!"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _skip_if_keycloak_unreachable():
    """Skip tests if Keycloak is not running."""
    try:
        r = httpx.get(f"{REALM_URL}/.well-known/openid-configuration", timeout=5)
        r.raise_for_status()
    except Exception as e:
        pytest.skip(f"Keycloak unreachable at {REALM_URL}: {e}")


def _skip_if_mailhog_unreachable():
    """Skip tests if MailHog SMTP is not running."""
    try:
        r = httpx.get(f"{MAILHOG_API_URL}/api/v2/messages", timeout=5)
        r.raise_for_status()
    except Exception as e:
        pytest.skip(f"MailHog unreachable at {MAILHOG_API_URL}: {e}")


def _get_admin_token() -> str:
    """Get a Keycloak admin access token."""
    r = httpx.post(
        f"{KEYCLOAK_ADMIN_URL}/auth/realms/master/protocol/openid-connect/token",
        data={
            "grant_type": "password",
            "client_id": "admin-cli",
            "username": KEYCLOAK_ADMIN_USER,
            "password": KEYCLOAK_ADMIN_PASSWORD,
        },
        timeout=10,
    )
    r.raise_for_status()
    return r.json()["access_token"]


def _admin_headers() -> dict:
    return {"Authorization": f"Bearer {_get_admin_token()}"}


def _get_realm() -> dict:
    """Fetch current realm configuration."""
    r = httpx.get(ADMIN_API, headers=_admin_headers(), timeout=10)
    r.raise_for_status()
    return r.json()


def _update_realm(patch: dict) -> None:
    """PATCH realm configuration."""
    r = httpx.patch(ADMIN_API, json=patch, headers=_admin_headers(), timeout=10)
    r.raise_for_status()


def _get_or_create_test_user() -> str:
    """Create a test user in Keycloak. Returns user ID."""
    headers = _admin_headers()

    # Check if user exists
    r = httpx.get(
        f"{ADMIN_API}/users",
        params={"username": TEST_USER_EMAIL, "exact": True},
        headers=headers,
        timeout=10,
    )
    r.raise_for_status()
    users = r.json()
    if users:
        return users[0]["id"]

    # Create user
    user_payload = {
        "username": TEST_USER_EMAIL,
        "email": TEST_USER_EMAIL,
        "emailVerified": True,
        "enabled": True,
        "firstName": "Test",
        "lastName": "PasswordReset",
        "credentials": [
            {
                "type": "password",
                "value": TEST_USER_PASSWORD,
                "temporary": False,
            }
        ],
    }
    r = httpx.post(
        f"{ADMIN_API}/users",
        json=user_payload,
        headers=headers,
        timeout=10,
    )
    r.raise_for_status()

    # Fetch created user ID
    r = httpx.get(
        f"{ADMIN_API}/users",
        params={"username": TEST_USER_EMAIL, "exact": True},
        headers=headers,
        timeout=10,
    )
    r.raise_for_status()
    return r.json()[0]["id"]


def _delete_test_user(user_id: str) -> None:
    """Delete test user from Keycloak."""
    r = httpx.delete(
        f"{ADMIN_API}/users/{user_id}",
        headers=_admin_headers(),
        timeout=10,
    )
    # 204 = deleted, 404 = already gone
    assert r.status_code in (204, 404), f"Failed to delete user: {r.text}"


def _clear_mailhog() -> None:
    """Clear all messages from MailHog."""
    try:
        httpx.delete(f"{MAILHOG_API_URL}/api/v1/messages", timeout=5)
    except Exception:
        pass  # Non-critical


def _get_mailhog_messages() -> list[dict]:
    """Fetch all messages from MailHog API."""
    r = httpx.get(f"{MAILHOG_API_URL}/api/v2/messages", timeout=10)
    r.raise_for_status()
    return r.json().get("items", [])


def _extract_reset_link_from_email(email_body: str) -> str | None:
    """Extract the password reset URL from an email body (HTML or text)."""
    # Keycloak sends HTML emails with the reset link
    pattern = r'https?://[^\s"<>]+/login-actions/action-token\?token=[^\s"<>]+'
    match = re.search(pattern, email_body)
    return match.group(0) if match else None


def _get_reset_credentials_flow_id() -> str | None:
    """Get the internal ID of the 'reset credentials' flow."""
    r = httpx.get(
        f"{ADMIN_API}/authentication/flows",
        headers=_admin_headers(),
        timeout=10,
    )
    r.raise_for_status()
    for flow in r.json():
        if flow.get("alias") == "reset credentials":
            return flow["id"]
    return None


def _get_flow_executions(flow_alias: str) -> list[dict]:
    """Get executions for a flow by alias."""
    flow_id = _get_reset_credentials_flow_id()
    if not flow_id:
        return []
    r = httpx.get(
        f"{ADMIN_API}/authentication/flows/{flow_id}/executions",
        headers=_admin_headers(),
        timeout=10,
    )
    r.raise_for_status()
    return r.json()


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _check_prerequisites():
    """Skip all tests if Keycloak or MailHog are unreachable."""
    _skip_if_keycloak_unreachable()


@pytest.fixture
def test_user_id():
    """Create a test user, yield its ID, then clean up."""
    user_id = _get_or_create_test_user()
    yield user_id
    _delete_test_user(user_id)


@pytest.fixture(autouse=True)
def _clear_email_after_test():
    """Clear MailHog inbox after each test to prevent cross-test pollution."""
    yield
    _clear_mailhog()


# ---------------------------------------------------------------------------
# Tests: Pre-flight Configuration Checks
# ---------------------------------------------------------------------------


class TestForgotPasswordConfiguration:
    """Verify the Keycloak realm is correctly configured for forgot-password."""

    def test_reset_credentials_flow_exists(self):
        """
        The built-in 'reset credentials' flow must exist in the realm.
        Keycloak 26 provides this by default — it chains:
          1. reset-credentials-choose-user (REQUIRED)
          2. reset-credential-email (REQUIRED)
          3. reset-password (REQUIRED)
        """
        flow_id = _get_reset_credentials_flow_id()
        assert flow_id is not None, (
            "reset credentials flow not found. Keycloak 26 should have this built-in."
        )

    def test_reset_credentials_has_correct_executions(self):
        """
        The reset credentials flow must have all 3 required executions
        in the correct order.
        """
        executions = _get_flow_executions("reset credentials")
        assert len(executions) == 3, (
            f"Expected 3 executions, found {len(executions)}: "
            f"{[e.get('authenticator') for e in executions]}"
        )

        authenticators = [e.get("authenticator") for e in executions]
        assert "reset-credentials-choose-user" in authenticators
        assert "reset-credential-email" in authenticators
        assert "reset-password" in authenticators

        # All must be REQUIRED
        for exe in executions:
            assert exe.get("requirement") == "REQUIRED", (
                f"{exe.get('authenticator')} should be REQUIRED, "
                f"got {exe.get('requirement')}"
            )

    def test_realm_smtp_configured(self):
        """
        SMTP must be configured on the realm for email-based reset to work.
        In dev, use MailHog; in production, use a real SMTP relay.
        """
        realm = _get_realm()
        smtp = realm.get("smtpServer", {})
        assert smtp, (
            "smtpServer is empty. Configure SMTP via Admin Console or API:\n"
            "  PUT /auth/admin/realms/bfp\n"
            '  {"smtpServer": {"host": "mailhog", "port": "1025", '
            '"from": "noreply@wims-bfp.local"}}'
        )

    def test_reset_password_allowed_in_realm(self):
        """
        'resetPasswordAllowed' must be True for the 'Forgot Password?'
        link to appear on the login page.
        """
        realm = _get_realm()
        assert realm.get("resetPasswordAllowed") is True, (
            "resetPasswordAllowed is False. Enable it:\n"
            '  PUT /auth/admin/realms/bfp {"resetPasswordAllowed": true}'
        )

    def test_forgot_password_link_visible_on_login_page(self):
        """
        When resetPasswordAllowed=true, the login page must contain
        a 'Forgot Password?' link pointing to the reset-credentials flow.
        """
        # Fetch the login page for the bfp-client
        r = httpx.get(
            f"{REALM_URL}/protocol/openid-connect/auth",
            params={
                "client_id": KEYCLOAK_CLIENT_ID,
                "redirect_uri": "http://localhost/callback",
                "response_type": "code",
                "scope": "openid",
            },
            follow_redirects=True,
            timeout=10,
        )
        assert r.status_code == 200
        html = r.text.lower()
        assert "forgot" in html or "reset" in html, (
            "Login page does not contain a 'Forgot Password' link. "
            "Check resetPasswordAllowed setting."
        )


# ---------------------------------------------------------------------------
# Tests: Full Forgot Password Flow (requires MailHog)
# ---------------------------------------------------------------------------


class TestForgotPasswordFlow:
    """End-to-end password reset via email link with one-time token."""

    def test_reset_password_via_admin_api(self, test_user_id):
        """
        Verify Admin API can directly reset a user's password
        (baseline — confirms Keycloak is reachable and user exists).
        """
        headers = _admin_headers()
        new_password = "AdminResetPass789!"

        r = httpx.put(
            f"{ADMIN_API}/users/{test_user_id}/reset-password",
            json={
                "type": "password",
                "value": new_password,
                "temporary": False,
            },
            headers=headers,
            timeout=10,
        )
        assert r.status_code == 204, f"Password reset failed: {r.text}"

        # Verify login with new password
        r = httpx.post(
            f"{REALM_URL}/protocol/openid-connect/token",
            data={
                "grant_type": "password",
                "client_id": KEYCLOAK_CLIENT_ID,
                "username": TEST_USER_EMAIL,
                "password": new_password,
            },
            timeout=10,
        )
        assert r.status_code == 200, (
            f"Login with new password failed: {r.status_code} {r.text}"
        )
        assert "access_token" in r.json()

    def test_forgot_password_sends_reset_email(self, test_user_id):
        """
        Full forgot-password flow step 1:
        Submit username to the reset-credentials flow, verify Keycloak
        sends a password-reset email via SMTP.

        Requires: MailHog running, SMTP configured on realm.
        """
        _skip_if_mailhog_unreachable()
        _clear_mailhog()

        # Step 1: Hit the reset-credentials entry point
        # This simulates: user clicks "Forgot Password?", enters username
        reset_url = (
            f"{REALM_URL}/login-actions/reset-credentials"
            f"?client_id={KEYCLOAK_CLIENT_ID}"
        )

        client = httpx.Client(follow_redirects=True, timeout=15)

        try:
            # GET the reset-credentials page
            r = client.get(reset_url)
            assert r.status_code == 200, (
                f"Failed to load reset-credentials page: {r.status_code}"
            )

            # Extract the form action URL
            html = r.text
            action_match = re.search(r'<form[^>]+action="([^"]+)"', html, re.IGNORECASE)
            if not action_match:
                # Keycloak 26 may use different form structure
                # Try to find the login action URL from the page
                action_match = re.search(
                    r'action="([^"]*login-actions[^"]*)"', html, re.IGNORECASE
                )

            assert action_match, (
                "Could not find form action on reset-credentials page. "
                "Keycloak theme may have changed."
            )

            # Build absolute URL if relative
            form_action = action_match.group(1).replace("&amp;", "&")
            if form_action.startswith("/"):
                form_action = f"{KEYCLOAK_ADMIN_URL}{form_action}"

            # Step 2: POST the username to the form
            # Keycloak expects 'username' field in the choose-user step
            r = client.post(
                form_action,
                data={"username": TEST_USER_EMAIL},
            )
            # After successful submission, Keycloak redirects or shows confirmation
            # We expect either a 200 (confirmation page) or a redirect
            assert r.status_code in (200, 302, 303), (
                f"Username submission failed: {r.status_code} {r.text[:500]}"
            )

            # Step 3: Verify email was sent via MailHog
            # Give Keycloak a moment to send the email
            time.sleep(2)
            messages = _get_mailhog_messages()
            assert len(messages) > 0, (
                "No emails received in MailHog. "
                "Check SMTP configuration on Keycloak realm."
            )

            # Find the email addressed to our test user
            reset_email = None
            for msg in messages:
                to_addresses = msg.get("To", [])
                for addr in to_addresses:
                    if TEST_USER_EMAIL in addr.get("Mailbox", "") + "@" + addr.get(
                        "Domain", ""
                    ):
                        reset_email = msg
                        break
                if reset_email:
                    break

            assert reset_email is not None, (
                f"No password-reset email found for {TEST_USER_EMAIL}. "
                f"MailHog has {len(messages)} messages."
            )

            # Step 4: Extract the reset link from the email body
            email_body = reset_email.get("Content", {}).get("Body", "")
            reset_link = _extract_reset_link_from_email(email_body)
            assert reset_link is not None, (
                "Could not extract password reset link from email body. "
                f"Body preview: {email_body[:500]}"
            )

            # Step 5: Follow the reset link (simulates user clicking link)
            r = client.get(reset_link)
            assert r.status_code == 200, (
                f"Reset link returned {r.status_code}: {r.text[:500]}"
            )
            # Should show a password reset form
            assert "password" in r.text.lower(), (
                "Reset link page does not contain a password field."
            )

        finally:
            client.close()

    def test_full_forgot_password_e2e(self, test_user_id):
        """
        Complete end-to-end forgot-password flow:
          1. User submits email on forgot-password page
          2. Keycloak sends reset email
          3. User clicks link, sets new password
          4. User logs in with new password

        Requires: MailHog running, SMTP configured, resetPasswordAllowed=true.
        """
        _skip_if_mailhog_unreachable()
        _clear_mailhog()

        client = httpx.Client(follow_redirects=True, timeout=15)

        try:
            # --- Step 1: Submit username on forgot-password page ---
            reset_url = (
                f"{REALM_URL}/login-actions/reset-credentials"
                f"?client_id={KEYCLOAK_CLIENT_ID}"
            )

            r = client.get(reset_url)
            assert r.status_code == 200

            html = r.text
            action_match = re.search(
                r'action="([^"]*login-actions[^"]*)"', html, re.IGNORECASE
            )
            assert action_match, "Could not find form action"

            form_action = action_match.group(1).replace("&amp;", "&")
            if form_action.startswith("/"):
                form_action = f"{KEYCLOAK_ADMIN_URL}{form_action}"

            r = client.post(form_action, data={"username": TEST_USER_EMAIL})
            assert r.status_code in (200, 302, 303)

            # --- Step 2: Get reset email from MailHog ---
            time.sleep(3)
            messages = _get_mailhog_messages()
            assert len(messages) > 0, "No reset email received"

            reset_email = None
            for msg in messages:
                content_body = msg.get("Content", {}).get("Body", "")
                if "action-token" in content_body or "reset" in content_body.lower():
                    reset_email = msg
                    break

            assert reset_email is not None, "No reset email with action-token found"

            email_body = reset_email.get("Content", {}).get("Body", "")
            reset_link = _extract_reset_link_from_email(email_body)
            assert reset_link, "Could not extract reset link"

            # --- Step 3: Follow link, submit new password ---
            r = client.get(reset_link)
            assert r.status_code == 200

            # Extract the form action for the password reset form
            html = r.text
            action_match = re.search(r'action="([^"]*)"', html, re.IGNORECASE)
            assert action_match, "Could not find password reset form action"

            reset_form_action = action_match.group(1).replace("&amp;", "&")
            if reset_form_action.startswith("/"):
                reset_form_action = f"{KEYCLOAK_ADMIN_URL}{reset_form_action}"

            # POST the new password
            r = client.post(
                reset_form_action,
                data={
                    "password-new": TEST_USER_NEW_PASSWORD,
                    "password-confirm": TEST_USER_NEW_PASSWORD,
                },
            )
            # Keycloak returns 200 on success (or redirects to app)
            assert r.status_code in (200, 302, 303), (
                f"Password reset form submission failed: {r.status_code}"
            )

            # --- Step 4: Verify login with new password ---
            r = httpx.post(
                f"{REALM_URL}/protocol/openid-connect/token",
                data={
                    "grant_type": "password",
                    "client_id": KEYCLOAK_CLIENT_ID,
                    "username": TEST_USER_EMAIL,
                    "password": TEST_USER_NEW_PASSWORD,
                },
                timeout=10,
            )
            assert r.status_code == 200, (
                f"Login with reset password failed: {r.status_code} {r.text}"
            )
            token_data = r.json()
            assert "access_token" in token_data
            assert "refresh_token" in token_data

            # Verify old password no longer works
            r = httpx.post(
                f"{REALM_URL}/protocol/openid-connect/token",
                data={
                    "grant_type": "password",
                    "client_id": KEYCLOAK_CLIENT_ID,
                    "username": TEST_USER_EMAIL,
                    "password": TEST_USER_PASSWORD,
                },
                timeout=10,
            )
            assert r.status_code == 401, (
                "Old password still works after reset — security failure!"
            )

        finally:
            client.close()

    def test_reset_token_is_one_time_use(self, test_user_id):
        """
        The password-reset action token must be single-use.
        After the user submits the new password, reusing the same
        token link must fail.
        """
        _skip_if_mailhog_unreachable()
        _clear_mailhog()

        client = httpx.Client(follow_redirects=True, timeout=15)

        try:
            # Trigger reset email
            reset_url = (
                f"{REALM_URL}/login-actions/reset-credentials"
                f"?client_id={KEYCLOAK_CLIENT_ID}"
            )
            r = client.get(reset_url)
            assert r.status_code == 200

            html = r.text
            action_match = re.search(
                r'action="([^"]*login-actions[^"]*)"', html, re.IGNORECASE
            )
            assert action_match
            form_action = action_match.group(1).replace("&amp;", "&")
            if form_action.startswith("/"):
                form_action = f"{KEYCLOAK_ADMIN_URL}{form_action}"

            client.post(form_action, data={"username": TEST_USER_EMAIL})

            # Get the email
            time.sleep(3)
            messages = _get_mailhog_messages()
            reset_email = None
            for msg in messages:
                if "action-token" in msg.get("Content", {}).get("Body", ""):
                    reset_email = msg
                    break
            assert reset_email, "No reset email received"

            email_body = reset_email.get("Content", {}).get("Body", "")
            reset_link = _extract_reset_link_from_email(email_body)
            assert reset_link

            # First use: reset password (should succeed)
            r = client.get(reset_link)
            assert r.status_code == 200

            html = r.text
            action_match = re.search(r'action="([^"]*)"', html, re.IGNORECASE)
            reset_form_action = action_match.group(1).replace("&amp;", "&")
            if reset_form_action.startswith("/"):
                reset_form_action = f"{KEYCLOAK_ADMIN_URL}{reset_form_action}"

            r = client.post(
                reset_form_action,
                data={
                    "password-new": TEST_USER_NEW_PASSWORD,
                    "password-confirm": TEST_USER_NEW_PASSWORD,
                },
            )
            assert r.status_code in (200, 302, 303)

            # Second use: reuse the SAME token link (should fail)
            r = client.get(reset_link)
            # Keycloak should reject expired/used tokens
            # Common responses: 400, error page, or redirect to login
            assert r.status_code in (200, 400, 403)  # May show error page
            if r.status_code == 200:
                # If 200, it should be an error page, not a password form
                assert (
                    "expired" in r.text.lower()
                    or "invalid" in r.text.lower()
                    or "error" in r.text.lower()
                    or "password-new" not in r.text.lower()  # No password form
                ), "Reused token was accepted — token should be single-use!"

        finally:
            client.close()

    def test_nonexistent_user_does_not_leak_information(self):
        """
        Submitting a non-existent username to forgot-password must NOT
        reveal whether the user exists (OWASP: user enumeration prevention).
        Keycloak should show the same confirmation message regardless.
        """
        _skip_if_mailhog_unreachable()

        client = httpx.Client(follow_redirects=True, timeout=15)

        try:
            reset_url = (
                f"{REALM_URL}/login-actions/reset-credentials"
                f"?client_id={KEYCLOAK_CLIENT_ID}"
            )
            r = client.get(reset_url)
            assert r.status_code == 200

            html = r.text
            action_match = re.search(
                r'action="([^"]*login-actions[^"]*)"', html, re.IGNORECASE
            )
            assert action_match
            form_action = action_match.group(1).replace("&amp;", "&")
            if form_action.startswith("/"):
                form_action = f"{KEYCLOAK_ADMIN_URL}{form_action}"

            # Submit non-existent username
            fake_username = f"nonexistent-{uuid.uuid4().hex[:8]}@wims-bfp.local"
            r = client.post(form_action, data={"username": fake_username})

            # Keycloak should still return 200 with a generic "email sent" message
            # It should NOT return 404 or "user not found"
            assert r.status_code in (200, 302, 303), (
                f"Got {r.status_code} for non-existent user — "
                "this may leak user existence information."
            )

            if r.status_code == 200:
                body_lower = r.text.lower()
                assert "not found" not in body_lower, (
                    "Response contains 'not found' — user enumeration possible!"
                )
                assert "does not exist" not in body_lower, (
                    "Response contains 'does not exist' — user enumeration possible!"
                )

            # Verify NO email was sent to the fake address
            time.sleep(2)
            messages = _get_mailhog_messages()
            for msg in messages:
                to_str = str(msg.get("To", []))
                assert fake_username not in to_str, (
                    "Keycloak sent an email for a non-existent user!"
                )

        finally:
            client.close()
