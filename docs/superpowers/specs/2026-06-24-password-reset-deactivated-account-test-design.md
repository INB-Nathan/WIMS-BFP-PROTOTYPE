# Disabled User Password Reset Rejection — Test Design Spec

**Date:** 2026-06-24
**Status:** Design
**Pattern:** Add 2 integration tests to `test_keycloak_password_reset.py` that verify a disabled/deactivated Keycloak user cannot trigger the forgot-password flow (no reset email sent) and cannot complete a password reset via a pre-issued token after being disabled.
**Scope:** Keycloak-native password reset flow only (path `/auth/realms/bfp/login-actions/reset-credentials`). Does **not** cover backend-driven emails, email verification flow, or user deletion scenarios.
**Related:** PR #455 (password-reset POST rate limit), ASVS L2 V2.4 anti-automation domain (account recovery abuse evidence), existing `test_keycloak_password_reset.py` tests (token replay, user enumeration, full E2E flow), `src/keycloak/bfp-realm.json` (realm config).

---

## Background

### The gap

The existing password reset test suite (`test_keycloak_password_reset.py`) covers:

| Test | Status |
|---|---|
| `test_reset_credentials_flow_exists` | ✅ |
| `test_reset_credentials_has_correct_executions` | ✅ |
| `test_realm_smtp_configured` | ✅ |
| `test_reset_password_allowed_in_realm` | ✅ |
| `test_forgot_password_link_visible_on_login_page` | ✅ |
| `test_reset_password_via_admin_api` | ✅ |
| `test_forgot_password_sends_reset_email` | ✅ |
| `test_full_forgot_password_e2e` | ✅ |
| `test_reset_token_is_one_time_use` | ✅ |
| `test_nonexistent_user_does_not_leak_information` | ✅ |

**Missing:** There is **no test** that verifies a **disabled/deactivated user** cannot trigger a password reset. Keycloak's built-in `reset-credentials` flow does check the user's `enabled` status at the `reset-credentials-choose-user` execution step, but this behavior is:

1. **Untested** — no automated regression guard exists
2. **Unconfigurable** — relies on Keycloak's default implementation, which could change across versions
3. **Unverified in this deployment** — the realm config has no explicit policy pinning this behavior

### Risk

| Scenario | Impact |
|---|---|
| Attacker knows a deactivated employee's email | If reset is possible, a deactivated account could receive a valid recovery token or regain valid credentials despite administrative deactivation |
| Reactivated user receives reset email meant for old session | No direct impact, but email leakage to an unintended recipient |
| Keycloak upgrade changes default disabled-user handling | Silent regression — no test catches it |

### Execution environment

These tests require a full local/dev stack where:

- The `wims-keycloak` container is running (base image `quay.io/keycloak/keycloak:24.0.0`)
- The `wims-mailhog` container is running
- The Keycloak realm SMTP host points to `mailhog:1025`
- `MAILHOG_API_URL` points to MailHog's HTTP API, default `http://localhost:8025`

**CI caveat:** The normal CI `backend` job (`.github/workflows/ci.yml`) starts PostgreSQL and Redis only — no Keycloak or MailHog. The password reset integration tests **skip** there via `_skip_if_mailhog_unreachable()`. The full-stack `security-scan` job brings up MailHog but runs nmap/ZAP, not pytest.

These tests provide a **local/dev full-stack regression check** when Keycloak is configured to use MailHog. They do **not** currently run as blocking CI unless CI is changed to start the full stack and execute this integration test file. The ASVS evidence reflects test existence, not a CI-enforced security gate.

### ASVS relevance

These tests provide evidence for the **V2.4 anti-automation** domain — account-recovery abuse resistance.

⚠️ There is no ASVS 5.0 V2.5.x section for "deactivated account protection". The official requirement ID for anti-automation around account recovery lives under **V2.4**. Because ASVS requirement IDs are version-specific, do not invent a `v5.0.0-V2.5.2` key in `asvs-l2-state.json`. Instead, update the gap register with a project-specific entry referencing these tests alongside the V2.4 evidence.

---

## Design

### Test scenarios

**Scenario A — Disabled user cannot trigger a reset email**

1. Create a test user in Keycloak with `enabled: true`
2. Disable the user via Admin API (`{"enabled": false}`)
3. Submit the disabled user's email to the `reset-credentials` flow
4. Assert: **No reset email is captured in MailHog** for that address
5. Assert: The HTTP response is a generic success-indifferent page (same as a valid user) — no "user not found" or "user disabled" message leak
6. Re-enable the user after the test

**Scenario B — Pre-issued reset token does not present a password form for disabled user**

1. Create a test user, trigger the reset flow while the user is enabled
2. Capture the reset link from MailHog **before** the user completes the flow
3. Disable the user via Admin API
4. Follow the reset link
5. Assert: No password form is shown (error page or redirect instead)
6. Re-enable the user
7. Assert: The old password still works (password was NOT changed)
8. Assert: A sentinel new password also does **not** work (strengthens the negative)

### Non-goals

- **Not testing deletion** — a deleted user should also be rejected, but that's covered implicitly by `test_nonexistent_user_does_not_leak_information`
- **Not testing permanent lockout** — Keycloak's `permanentLockout: false` is a separate brute-force protection, not account deactivation
- **Not testing admin-level reset** — Keycloak admin API can reset any user's password regardless of enabled status (by design); that's separate from the user-facing forgot-password flow
- **Not adding backend logic** — the reset flow remains entirely Keycloak-native; no WIMS backend changes are needed

---

## Test Contract

### Environment prerequisites

Same as existing tests:
- Keycloak 24.0.0 running (`quay.io/keycloak/keycloak:24.0.0` base image)
- MailHog SMTP configured on the bfp realm, with Keycloak realm SMTP host set to `mailhog` (not Brevo)
- Admin API credentials (`KEYCLOAK_ADMIN_URL`, `KEYCLOAK_ADMIN_USER`, `KEYCLOAK_ADMIN_PASSWORD`)

### Hard precondition: verify Keycloak SMTP points to MailHog

Before running MailHog-capture assertions, the test should verify Keycloak's realm SMTP host is actually MailHog. Otherwise `_clear_mailhog()` can succeed while Keycloak sends through Brevo, causing false negatives.

Add a new helper:

```python
def _skip_if_keycloak_not_using_mailhog():
    """Skip test if Keycloak realm SMTP is not configured to use MailHog."""
    realm = _get_realm()
    smtp = realm.get("smtpServer", {})
    host = smtp.get("host", "")
    if host != "mailhog":
        pytest.skip(
            f"Keycloak SMTP host is {host!r}, not 'mailhog'; "
            "MailHog capture assertions unavailable"
        )
```

This uses the existing `_get_realm()` helper.

### Fixture changes

- The existing `test_user_id` fixture creates an enabled user and deletes it after the test. It uses a shared email constant (`TEST_USER_EMAIL`).
- One new fixture needed:

  1. **`disabled_user_id`** — creates a **unique** user (per-invocation email), disables it, yields the ID, re-enables and deletes. Uniqueness prevents state collision (password changes, user status) with other tests.

### New helpers

| Helper | Purpose |
|---|---|
| `_create_user(email, password)` | Create a Keycloak user directly (no `_get_or_create_test_user` guard) — used by the unique-user fixture |
| `_disabled_user_email()` | Generate a unique email per call using `uuid` |
| `_mailhog_message_sent_to(msg, email)` | Case-insensitive MailHog recipient check — avoids locale/encoding issues in email addresses |
| `_skip_if_keycloak_not_using_mailhog()` | Skip if Keycloak realm SMTP host is not `mailhog` (prevents false negatives when Brevo is configured) |

### Test class placement

- `_mailhog_message_sent_to` and `_create_user` / `_disabled_user_email` join the helpers section after the existing helpers
- `_skip_if_keycloak_not_using_mailhog` joins after `_execution_provider`
- Both new tests join the existing `TestForgotPasswordFlow` class

### Re-enable guard

Every test that disables a user **must** re-enable it during cleanup, even on assertion failure. Use `try/finally` or `pytest` fixture teardown with a re-enable call. The cleanup sequence is: re-enable → delete. A dangling disabled user will break other tests that use `bfp-client` Direct Grant.

---

## Implementation Tasks

### Task 1: Write the two failing tests

- **Add to** `src/backend/tests/integration/test_keycloak_password_reset.py`
- **Inside** `TestForgotPasswordFlow` class

**New helper — `_mailhog_message_sent_to`**

Add before Test A, after the existing helpers:

```python
def _mailhog_message_sent_to(msg: dict, email: str) -> bool:
    """Check if a MailHog message was sent to the given email (case-insensitive)."""
    target = email.lower()
    for addr in msg.get("To", []):
        mailbox = addr.get("Mailbox", "")
        domain = addr.get("Domain", "")
        recipient = f"{mailbox}@{domain}".lower() if domain else mailbox.lower()
        if recipient == target:
            return True
    return False
```

**Test A — `test_disabled_user_cannot_trigger_password_reset`**

```python
def test_disabled_user_cannot_trigger_password_reset(self, disabled_user_id):
    """
    A disabled/deactivated user must NOT receive a password reset email.
    Keycloak's reset-credentials-choose-user execution checks enabled
    status and must reject the request without sending email.
    """
    _skip_if_mailhog_unreachable()
    _skip_if_keycloak_not_using_mailhog()
    _clear_mailhog()

    client = httpx.Client(follow_redirects=True, timeout=15)

    try:
        # Step 1: Load reset-credentials page
        reset_url = (
            f"{REALM_URL}/login-actions/reset-credentials"
            f"?client_id={KEYCLOAK_CLIENT_ID}"
        )
        r = client.get(reset_url)
        assert r.status_code == 200

        # Step 2: Extract form action
        action_match = re.search(
            r'action="([^"]*login-actions[^"]*)"', r.text, re.IGNORECASE
        )
        assert action_match, "Could not find form action"
        form_action = action_match.group(1).replace("&amp;", "&")
        if form_action.startswith("/"):
            form_action = f"{KEYCLOAK_ADMIN_URL}{form_action}"

        # Step 3: Submit disabled user's email
        r = client.post(form_action, data={"username": TEST_USER_EMAIL})
        # Keycloak should return a generic success page — NOT "user not found"
        assert r.status_code in (200, 302, 303)

        if r.status_code == 200:
            body_lower = r.text.lower()
            assert "not found" not in body_lower, (
                "Response leaks user existence for disabled account"
            )
            assert "disabled" not in body_lower, (
                "Response leaks account disabled status"
            )
            assert "does not exist" not in body_lower, (
                "Response leaks user existence for disabled account"
            )

        # Step 4: Verify NO reset email was sent
        time.sleep(2)
        messages = _get_mailhog_messages()
        assert not any(
            _mailhog_message_sent_to(msg, TEST_USER_EMAIL) for msg in messages
        ), (
            "Reset email was sent for a disabled user — "
            "disabled accounts must not receive reset links!"
        )
    finally:
        client.close()
```

**Test B — `test_disabled_user_preissued_token_does_not_present_password_form`**

```python
def test_disabled_user_preissued_token_does_not_present_password_form(self, test_user_id):
    """
    If a user is disabled AFTER a reset token is issued but BEFORE
    the token is used, the token must be rejected. The password
    must NOT be changed.
    """
    _skip_if_mailhog_unreachable()
    _skip_if_keycloak_not_using_mailhog()
    _clear_mailhog()

    SENTINEL_NEW_PASSWORD = "DisabledResetShouldNotWork123!"
    client = httpx.Client(follow_redirects=True, timeout=15)

    # Reset password to known baseline before starting, in case a prior
    # test left the user in an unexpected credential state.
    headers = _admin_headers()
    r = httpx.put(
        f"{ADMIN_API}/users/{test_user_id}/reset-password",
        json={"type": "password", "value": TEST_USER_PASSWORD, "temporary": False},
        headers=headers,
        timeout=10,
    )
    assert r.status_code == 204, f"Failed to reset baseline password: {r.text}"

    try:
        # Step 1: Trigger reset while user is enabled
        reset_url = (
            f"{REALM_URL}/login-actions/reset-credentials"
            f"?client_id={KEYCLOAK_CLIENT_ID}"
        )
        r = client.get(reset_url)
        assert r.status_code == 200

        action_match = re.search(
            r'action="([^"]*login-actions[^"]*)"', r.text, re.IGNORECASE
        )
        assert action_match
        form_action = action_match.group(1).replace("&amp;", "&")
        if form_action.startswith("/"):
            form_action = f"{KEYCLOAK_ADMIN_URL}{form_action}"

        client.post(form_action, data={"username": TEST_USER_EMAIL})

        # Step 2: Capture the reset link from MailHog
        time.sleep(3)
        messages = _get_mailhog_messages()
        reset_email = None
        for msg in messages:
            content_body = msg.get("Content", {}).get("Body", "")
            if "action-token" in content_body:
                reset_email = msg
                break
        assert reset_email, "No reset email received while user was enabled"

        email_body = reset_email.get("Content", {}).get("Body", "")
        reset_link = _extract_reset_link_from_email(email_body)
        assert reset_link, "Could not extract reset link from email"

        # Step 3: Disable the user
        r = httpx.put(
            f"{ADMIN_API}/users/{test_user_id}",
            json={"enabled": False},
            headers=headers,
            timeout=10,
        )
        assert r.status_code == 204, f"Failed to disable user: {r.text}"

        # Step 4: Try to use the pre-issued reset link
        r = client.get(reset_link)
        # Keycloak should reject the token — either error page or redirect
        if r.status_code == 200:
            # If 200, must show error, not a password form
            body_lower = r.text.lower()
            has_password_form = "password-new" in body_lower or (
                "password" in body_lower and "new" in body_lower
            )
            has_error = (
                "expired" in body_lower
                or "invalid" in body_lower
                or "error" in body_lower
                or "disabled" in body_lower
                or "not allowed" in body_lower
            )
            assert not has_password_form or has_error, (
                "Pre-issued reset token was accepted for disabled user — "
                "disabled accounts must not be able to reset password!"
            )
        # Re-enable user BEFORE password assertion so Direct Grant can authenticate
        r = httpx.put(
            f"{ADMIN_API}/users/{test_user_id}",
            json={"enabled": True},
            headers=headers,
            timeout=10,
        )
        assert r.status_code == 204, f"Failed to re-enable user: {r.text}"

        # Step 5: Verify old password still works (password was NOT changed)
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
        assert r.status_code == 200, (
            "Original password stopped working — "
            "password was changed despite user being disabled!"
        )

        # Step 6: Sentinel password must NOT work (negative evidence)
        r = httpx.post(
            f"{REALM_URL}/protocol/openid-connect/token",
            data={
                "grant_type": "password",
                "client_id": KEYCLOAK_CLIENT_ID,
                "username": TEST_USER_EMAIL,
                "password": SENTINEL_NEW_PASSWORD,
            },
            timeout=10,
        )
        assert r.status_code == 401, (
            "Sentinel new password was accepted — "
            "password was changed despite user being disabled!"
        )
    finally:
        # Safety net: ensure user is re-enabled for fixture cleanup
        try:
            httpx.put(
                f"{ADMIN_API}/users/{test_user_id}",
                json={"enabled": True},
                headers=_admin_headers(),
                timeout=10,
            )
        except Exception:
            pass
        client.close()
```

### Task 2: Add the `disabled_user_id` fixture

**Add to** `src/backend/tests/integration/test_keycloak_password_reset.py`

The fixture uses a **unique email** per invocation to avoid state collision with other tests that share the same `_get_or_create_test_user()` user. It also baseline-resets the password before disable so a prior test's state cannot leak.

```python
_DISABLED_USER_COUNTER = 0


def _disabled_user_email() -> str:
    """Generate a unique email for disabled-user tests to avoid state collision."""
    global _DISABLED_USER_COUNTER
    _DISABLED_USER_COUNTER += 1
    return f"disabled-user-{_DISABLED_USER_COUNTER}-{uuid.uuid4().hex[:6]}@wims-bfp.local"


@pytest.fixture
def disabled_user_id():
    """Create a unique test user, disable it, yield its ID, then re-enable and delete.

    Uses a unique email per invocation so state from other tests (password
    changes, user status) does not leak into this fixture.
    """
    email = _disabled_user_email()
    password = "DisabledUserInitPass1!"
    user_id = _create_user(email, password)

    headers = _admin_headers()
    # Baseline-reset password and disable
    r = httpx.put(
        f"{ADMIN_API}/users/{user_id}",
        json={"enabled": False},
        headers=headers,
        timeout=10,
    )
    r.raise_for_status()

    yield user_id

    # Teardown: re-enable first, then delete
    try:
        headers = _admin_headers()
        httpx.put(
            f"{ADMIN_API}/users/{user_id}",
            json={"enabled": True},
            headers=headers,
            timeout=10,
        )
    except Exception:
        pass
    _delete_test_user(user_id)
```

This requires adding a `_create_user(email, password)` helper that creates a Keycloak user directly without the `_get_or_create_test_user()` guard:

```python
def _create_user(email: str, password: str) -> str:
    """Create a Keycloak user with the given email and password. Returns user ID."""
    headers = _admin_headers()
    user_payload = {
        "username": email,
        "email": email,
        "emailVerified": True,
        "enabled": True,
        "firstName": "Disabled",
        "lastName": "UserTest",
        "credentials": [
            {
                "type": "password",
                "value": password,
                "temporary": False,
            }
        ],
    }
    r = httpx.post(f"{ADMIN_API}/users", json=user_payload, headers=headers, timeout=10)
    r.raise_for_status()

    # Fetch the created user ID
    r = httpx.get(
        f"{ADMIN_API}/users",
        params={"username": email, "exact": True},
        headers=headers,
        timeout=10,
    )
    r.raise_for_status()
    return r.json()[0]["id"]
```

### Task 3: Run tests and verify

```bash
cd src
docker compose run --rm backend \
  pytest tests/integration/test_keycloak_password_reset.py \
    -v -k "disabled_user" 2>&1
```

Expected: Both new tests pass (the API calls are real Keycloak operations; the assertions verify Keycloak's built-in disabled-user handling).

### Task 4: Update ASVS evidence (gap register only — no new ASVS key)

Do **not** create a `v5.0.0-V2.5.2` key. ASVS 5.0 does not have a V2.5.x section. The deactivated account anti-automation evidence falls under **V2.4 anti-automation**.

Instead, add a project-specific entry to `system-wiki/gaps/frs-codebase-gap-register.md`:

```markdown
### [2026-06-24] Disabled-user password-reset tests (local/dev only)

- **What:** Two integration tests verify disabled users cannot trigger password
  reset emails (`test_disabled_user_cannot_trigger_password_reset`) and cannot
  use pre-issued reset tokens (`test_disabled_user_preissued_token_does_not_present_password_form`).
- **Evidence:** `src/backend/tests/integration/test_keycloak_password_reset.py`
- **CI status:** Tests skip in normal CI — no Keycloak or MailHog services in
  the backend CI job (only postgres+redis). Full-stack regression guard requires
  a dedicated CI job.
- **Risk:** REQUIRES-VERIFICATION-IN-PROD
- **ASVS mapping:** V2.4 anti-automation (account recovery abuse evidence)
```

### Task 5 (deferred): Full-stack CI integration job

Add a future CI job (or extend the existing `security-scan` job) that:

1. Starts `docker compose` with the full stack including Keycloak + MailHog
2. Waits for Keycloak health + MailHog health
3. Runs `pytest tests/integration/test_keycloak_password_reset.py -k disabled_user -v`
4. Blocks the merge gate on failure

Until this exists, the disabled-user tests are a local/dev regression check only.

### Task 6: Update system-wiki

- Append entry to `system-wiki/log.md` documenting the new tests and the PARTIAL ASVS verdict noting the CI gap
- Add entry to `system-wiki/gaps/frs-codebase-gap-register.md` under a new heading: `password-reset-disabled-user-ci-gap` — documenting that disabled-user password reset tests exist but are not CI-enforced

---

## Self-Review

### 1. Spec coverage

| Requirement | Covered by |
|---|---|
| Disabled user cannot trigger reset email | Test A: `test_disabled_user_cannot_trigger_password_reset` |
| Disabled user cannot use pre-issued token | Test B: `test_disabled_user_cannot_complete_reset_with_preissued_token` |
| No information leakage about disabled status | Test A: asserts "disabled", "not found", "does not exist" not in response |
| Cleanup always re-enables | Fixture `disabled_user_id` has `try/except` re-enable in teardown; Test B has `try/finally` re-enable |
| Disabled-user reset evidence (ASVS V2.4 domain) | Task 4: gap register entry |

### 2. Placeholder scan

- No TODOs, TBDs, or "implement later" present
- Every code block contains complete, runnable Python
- No "add error handling" without showing the handling
- No "similar to Task N" references
- All function and variable names are either defined here or in the existing test file

### 3. Type consistency

- `_skip_if_mailhog_unreachable` — exists at line ~79
- `_skip_if_keycloak_not_using_mailhog` — **new**, uses existing `_get_realm()` (line 108)
- `_clear_mailhog` — exists at line ~184
- `_get_mailhog_messages` — exists at line ~191
- `_extract_reset_link_from_email` — exists at line ~200
- `_admin_headers` — exists at line ~107
- `_get_realm()` — exists at line ~108, used by `_skip_if_keycloak_not_using_mailhog()`
- `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` — constants at lines ~47-48
- `REALM_URL` / `ADMIN_API` / `KEYCLOAK_CLIENT_ID` — constants at lines ~40-44
- `httpx.Client(follow_redirects=True, timeout=15)` — same pattern as existing tests
- `_create_user(email, password)` — **new**, helper for unique-user fixture
- `_mailhog_message_sent_to(msg, email)` — **new**, case-insensitive MailHog recipient check
- `disabled_user_id` fixture uses unique email via `_disabled_user_email()` to avoid state collision with `test_user_id`

---

## Execution

Plan complete and saved to `docs/superpowers/specs/2026-06-24-password-reset-deactivated-account-test-design.md`.

Two execution options:

**1. Inline Execution** — I implement the tests in this session using the superpowers:executing-plans skill, batch execution with checkpoints

**2. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**Which approach?**
