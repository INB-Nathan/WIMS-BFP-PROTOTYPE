---
title: Login Page + Keycloak SSO - UI/UX Evaluation
created: 2026-05-14
updated: 2026-05-31
type: ui-ux
tags: [wims-bfp, ui-ux, auth, login, keycloak, hci]
sources: [raw/ui-ux/evaluation-loginpage+keycloaksso.md, raw/frs/frs-auth.md, src/frontend/src/app/login/page.tsx, src/frontend/src/app/globals.css, src/keycloak/themes/wims-bfp/login/template.ftl, src/keycloak/themes/wims-bfp/login/login-otp.ftl, src/keycloak/themes/wims-bfp/login/login-config-totp.ftl, src/keycloak/themes/wims-bfp/login/resources/css/wims-custom.css]
status: verified
---

# Login Page + Keycloak SSO - UI/UX Evaluation

Desk-check findings from user evaluation of the login page and Keycloak SSO flow.

## UX Issues Identified

### 1. Sign-In Container Alignment (Keycloak SSO)
The Keycloak SSO sign-in container is correctly centered. The native WIMS sign-in container is offset too far from the side edge, creating asymmetry between the two auth surfaces. The Keycloak container placement should be the reference for alignment consistency.

**Implementation status (2026-05-28):** fixed in `src/frontend/src/app/globals.css` by nudging the desktop `.wims-form-container` left inside the native WIMS `/login` right panel while preserving the mobile stacked layout.

### 2. Hero Line Icon Loss on Keycloak Redirect
The hero line "Secured - Monitored - Explainable" includes a checkmark icon that disappears when the flow redirects to the Keycloak-hosted MFA screen. This breaks the visual continuity of the trust/brand signal. Restore the hero branding elements on the Keycloak MFA page, or ensure the container header retains visual identity during OIDC redirect.

**Implementation status (2026-05-28):** fixed by aligning the native login page to a check-circle trust icon and adding the same inline SVG icon to the Keycloak theme hero tagline in `src/keycloak/themes/wims-bfp/login/template.ftl`, styled by `wims-custom.css`.

### 3. MFA/TOTP Input - Digit-Separated Box UX
The current TOTP input treats the 6-digit code as a single undifferentiated field. The authenticator app produces a grouped display (for example, `640 597`). The input should match this mental model:

- 6 individual boxes: `[0][0][0][0][0][0]` or grouped as `[00][00][00]` (3+3)
- Auto-advance on digit entry (cursor moves right)
- Backspace twice (or backspace on a non-first box) returns focus to previous box
- No submission until all 6 digits entered
- FRS anchor: M1.a.ii - TOTP via authenticator app with option to remember trusted device for 7 days

**Implementation status (2026-05-28):** fixed for Keycloak OTP challenge and TOTP setup screens. `login-otp.ftl` now renders six numeric boxes grouped 3+3 with a hidden `otp` field for Keycloak submission; `login-config-totp.ftl` uses the same 3+3 box pattern with hidden `totp`. Inline page scripts support digit-only input, paste distribution, auto-advance, and backspace-to-previous behavior.

**Responsive containment update (2026-05-31):** fixed MFA setup imbalance by wrapping `login-config-totp.ftl` setup instructions and form in `.wims-totp-setup`, changing the Keycloak right-side container from a fixed `width: 100%` sibling to a `flex: 1` region, and arranging setup steps plus QR/form controls in a wider two-column desktop layout. The OTP setup card now sizes naturally without internal `max-height` or `overflow-y:auto`; QR, OTP boxes, device-name input, warning alert, and submit action remain grouped inside the same onboarding card. Tablet/mobile breakpoints stack the right-side setup content and scale OTP boxes/QR without horizontal overflow.

## FRS Module Alignment
- [[raw/frs/frs-auth]] Module 1.a.ii: MFA via TOTP required for System Administrators and National Validators

## Related
- [[security/security-baseline]]
- [[raw/ui-ux/evaluation-loginpage+keycloaksso]] (raw source)
