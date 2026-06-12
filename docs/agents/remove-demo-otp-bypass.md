# Remove Temporary Demo OTP Bypass

This repository temporarily allows browser MFA OTP code `123123` for presentation/testing. Remove it before opening a PR unless the PR is explicitly for demo-only infrastructure.

## Removal Steps

1. Remove the custom Keycloak demo OTP provider.
   - Delete `src/keycloak/demo-otp-provider/`.
   - Delete `src/keycloak/Dockerfile` if it only exists to build/copy this provider.

2. Restore the Keycloak image/config.
   - In `src/docker-compose.yml`, restore the `keycloak` service to use `image: quay.io/keycloak/keycloak:24.0.0`.
   - Remove `build: ./keycloak` and `image: wims-keycloak-demo-otp:local`.
   - Keep the existing realm import and theme volume mounts unchanged.

3. Restore the browser OTP execution provider.
   - In `src/keycloak/import/bfp-realm.json`, change the browser OTP execution authenticator from `wims-demo-otp-form` back to `auth-otp-form`.
   - In `src/keycloak/bfp-realm.json`, make the same change.
   - Do not change Direct Grant OTP, role-conditional OTP, trusted-device settings, TOTP policy, or MFA setup templates.

4. Remove bypass-specific tests.
   - Delete tests asserting the browser OTP flow uses `wims-demo-otp-form`.
   - Keep tests that assert normal OTP policy remains configured.
   - Keep or add a test asserting browser OTP has returned to `auth-otp-form`.

5. Update documentation/wiki.
   - Remove temporary-bypass notes from `system-wiki/security/security-baseline.md`.
   - Restore `system-wiki/architecture/infrastructure-config.md` Keycloak image notes to the base Keycloak image.
   - Append a `system-wiki/log.md` entry stating the demo OTP bypass was removed.
   - Update `system-wiki/gaps/frs-codebase-gap-register.md` only if a temporary FRS/security gap entry was added for the bypass.

## Verification

Run the focused policy checks before PR:

```powershell
cd src/backend
pytest -v tests/integration/test_auth_otp_policy.py
```

Then smoke test Keycloak login:

- A real authenticator OTP still works for MFA accounts.
- `123123` no longer works unless it happens to be the real current TOTP.
- Non-MFA roles are not newly prompted for OTP.
- Authenticated app sessions still produce normal Keycloak JWT-backed `/api/auth/session` responses.

## Search Checklist

Before finishing, run:

```powershell
rg -n "123123|wims-demo-otp|demo otp|OTP bypass|bypass" src docs system-wiki
```

Only intentional historical notes or this removal guide should remain.
