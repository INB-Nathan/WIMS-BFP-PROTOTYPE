# Custom Keycloak Email Theme (WIMS-BFP Branding) Design

**Date:** 2026-06-24
**Status:** Design (v1)
**Pattern:** Add `email/` subdirectory to the existing `src/keycloak/themes/wims-bfp/` theme; 3 FreeMarker templates + theme properties + subject customizations + 1 realm JSON line.
**Scope:** Keycloak transactional emails only (password reset, email verification, execute-actions). Does **not** touch the 7 backend app-level Jinja2 templates in `src/backend/services/email/templates/`. Does **not** touch the login theme.
**Reviewer basis:** Verified against current source — `src/keycloak/Dockerfile` (Keycloak 24.0.0), `src/keycloak/themes/wims-bfp/login/theme.properties`, `src/keycloak/themes/wims-bfp/login/template.ftl`, `src/backend/services/email/templates/password_reset.html.j2` (visual reference for the new templates), `src/keycloak/bfp-realm.json`, `src/keycloak/import/bfp-realm.json`, Keycloak 24 server development docs (`docs.keycloak.org/24.0/server_development/#_email`) and the Keycloak 24 default email theme source (`github.com/keycloak/keycloak/blob/24.0.0/themes/src/main/resources/theme/base/email/`).

---

## Problem

After the email-provider switch (PR #452, merged at `e4c53d2`), the SMTP transport works end-to-end. V1 (direct send), V1b (Celery task), V2 (Keycloak password reset — verified by the user at 2026-06-24 17:00 PST, email arrived at `nathancabrales10@gmail.com` even if it landed in spam), and V4 (idempotency) all pass.

But the **Keycloak transactional emails** (password reset, email verification, execute-actions) use **Keycloak's built-in default email templates** — generic-looking HTML with no WIMS-BFP branding. The user-visible result: a password-reset email arrives in the user's inbox, but the layout/colors don't match the rest of the WIMS-BFP system (the 7 backend app-level templates at `src/backend/services/email/templates/` are all WIMS-BFP-branded with maroon `#8B0000`, "Bureau of Fire Protection" tagline, table layout, 600px max width).

The handoff's "Do not change the email templates" constraint is honored — those 7 templates stay as-is. This spec is about **adding new** templates for the **Keycloak-driven** flow, not modifying the **app-driven** flow's templates.

### Secondary observations

- **Custom Keycloak theme infrastructure already exists** (`src/keycloak/themes/wims-bfp/` with `login/` subdirectory). The email theme is a sibling subdirectory; the theme name `wims-bfp` is already known to Keycloak.
- **BFP logo already exists** at `src/keycloak/themes/wims-bfp/login/resources/img/bfp-logo.png`. Can be referenced by URL in the email templates.
- **No `emailTheme` field in realm JSON**. Needs to be added to both `bfp-realm.json` and `import/bfp-realm.json` (the latter is the fresh-import path that resolves `${env.SMTP_*:default}` placeholders once on first boot).
- **Keycloak 24 email theme structure** (verified against `github.com/keycloak/keycloak/blob/24.0.0/themes/src/main/resources/theme/base/email/`): 3 FreeMarker templates (`password-reset.ftl`, `email-verification.ftl`, `execute-actions.ftl`) + `theme.properties` (declares parent) + `messages_en.properties` (subject line + body text customizations).

---

## Goal

After this design is implemented, the WIMS-BFP stack delivers:

1. **Keycloak password-reset emails** with WIMS-BFP branding (maroon header, BFP logo, "Bureau of Fire Protection — WIMS-BFP Incident Management System" tagline, table-based layout, call-to-action button)
2. **Keycloak email-verification emails** with the same branding
3. **Keycloak execute-actions emails** (the "you must do X" emails Keycloak sends for required actions on login, like first-login password change) with the same branding
4. **All three** use a subject line that matches the rest of the WIMS-BFP system (e.g. `[WIMS-BFP] Reset your password` instead of Keycloak's default `Reset password`)
5. **Visual consistency** with the 7 backend app-level templates — same header, same color scheme (`#8B0000` maroon), same footer

The backend app-level templates (security alerts, weekly reports, etc.) stay byte-identical. The login theme (already WIMS-BFP-branded) stays byte-identical. The login-flow visual changes zero.

---

## Requirements

### R1 — Password reset email uses the new WIMS-BFP template

- A user triggering "Forgot password" on the Keycloak login page receives an email with the WIMS-BFP header (maroon bar with "Bureau of Fire Protection" + "WIMS-BFP Incident Management System" tagline), a body explaining the reset request, and a maroon "Reset Password" call-to-action button.
- Email subject is `[WIMS-BFP] Reset your password` (overrides Keycloak's default `Reset password`).
- The email body is a self-contained HTML document (inline CSS, table layout, 600px max) — no external CSS or JS dependencies.
- The plain-text alternative (the part that shows in email clients with HTML disabled) is also styled and includes the reset link as a clickable URL.

### R2 — Email verification email uses the new WIMS-BFP template

- A user triggering email verification (or admin-triggered verify) receives an email with the same WIMS-BFP branding, body explaining the verification, and a maroon "Verify Email" call-to-action button.
- Subject: `[WIMS-BFP] Verify your email address` (overrides Keycloak's default `Verify your email address`).
- Same HTML + plain-text structure as R1.

### R3 — Execute-actions email uses the new WIMS-BFP template

- A user required to perform an action (e.g. first-login password change, TOTP setup, terms acceptance) receives an email with WIMS-BFP branding, body listing the required actions, and a maroon call-to-action button linking to the action.
- Subject: `[WIMS-BFP] Action required for your account` (overrides Keycloak's default `Update password` or other).
- Same HTML + plain-text structure as R1.

### R4 — Existing tests still pass

- `cd src/backend && ruff check .` — clean (no Python change in this spec, but the rule still applies for incidental edits)
- `cd src/backend && ruff format . --check` — clean
- `cd src/backend && pytest -v` — full suite green (no Python change, should be unaffected by construction)
- `cd src/frontend && npm run lint && npx vitest run && npm run build` — clean (no frontend change)
- The 7 existing backend app-level email templates (`src/backend/services/email/templates/*.html.j2`) are byte-identical (no changes in this spec)

### R5 — Secrets and templates stay out of source control

- `git status` shows no new tracked file containing real SMTP credentials, real user emails, or other secrets
- `.gitignore` continues to exclude `.env` and `firebase-creds.json`
- The new template files contain no real names, emails, or links

---

## Solution

Four small, surgical changes — a new `email/` subdirectory under the existing `wims-bfp` theme with 5 files, plus 1 line in 2 realm JSON files, plus an image rebuild, plus a wiki update.

### S1 — Create `src/keycloak/themes/wims-bfp/email/` directory with 5 files

The new `email/` subdirectory contains:

```
src/keycloak/themes/wims-bfp/email/
├── theme.properties              (declares the theme name + parent base theme)
├── messages_en.properties         (subject line + body text customizations)
├── html.ftl                       (common HTML wrapper — shared across all 3 templates)
├── password-reset.ftl             (password reset template)
├── email-verification.ftl         (email verification template)
└── execute-actions.ftl            (execute-actions template)
```

**`theme.properties`** (3 lines, identifies the theme to Keycloak):

```properties
parent=base
import=common/keycloak
```

The `parent=base` declares that this email theme inherits from Keycloak's base theme. Since we override all 3 templates, no Keycloak defaults leak through. The `import=common/keycloak` is a no-op safety import that doesn't exist in 24.0.0 — actually, omit this. The correct content is just:

```properties
parent=base
```

(Confirmed: Keycloak 24 email themes only need `parent=base`; they don't have a `displayName` like login themes do.)

**`messages_en.properties`** (3 lines, subject line customizations):

```properties
emailPasswordResetSubject=[WIMS-BFP] Reset your password
emailVerificationSubject=[WIMS-BFP] Verify your email address
executeActionsSubject=[WIMS-BFP] Action required for your account
```

The 3 subject keys are the standard Keycloak 24 email subject bundle. (The actual subject template uses `{0}` placeholders for the realm name and `{1}` for the link expiration in some keys — but for the 3 above the placeholder is just the realm display name, which we leave as Keycloak's default; we only customize the static prefix.)

**`html.ftl`** (~80 lines, common HTML wrapper):

This is the visual scaffold shared by all 3 email templates. Renders the maroon header, the BFP logo, the body content (passed in via a FreeMarker `<#nested>` block), and the gray footer. Inline CSS, table-based layout, 600px max width — visually identical to the Jinja2 templates in `src/backend/services/email/templates/`.

Key elements:
- DOCTYPE, html, head with `meta charset`, `meta viewport`, `title`
- `<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,sans-serif;">`
- Outer `<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;padding:24px 16px;">` with centered 600px inner table
- Header `<tr>` with maroon background, white text "Bureau of Fire Protection" + lighter text "WIMS-BFP Incident Management System"
- `<#nested>` slot where the per-template body content goes
- Footer `<tr>` with gray background, "Bureau of Fire Protection — WIMS-BFP" + "This is an automated message. Do not reply to this email."
- Logo: `<img src="https://wimsbfp.tech/auth/resources/3.0/login/wims-bfp/img/bfp-logo.png" alt="BFP" width="48" height="48" style="display:block;margin:0 auto 12px;">` (Keycloak serves login theme resources at `/auth/resources/{version}/login/{theme-name}/...`; the logo URL is constructed from the login theme's `bfp-logo.png`)

**`password-reset.ftl`** (~10 lines, password-reset-specific body):

Wraps `html.ftl` and provides the reset-specific body:

```ftl
<#import "html.ftl" as layout>
<@layout.emailLayout>
  <p style="margin:0 0 16px;font-size:18px;font-weight:bold;color:#8B0000;">Hello, ${user.firstName}!</p>
  <p style="margin:0 0 16px;font-size:16px;color:#333333;line-height:1.6;">
    We received a request to reset your WIMS-BFP account password. Click the button below to set a new password.
  </p>
  <p style="margin:0 0 24px;font-size:16px;color:#333333;line-height:1.6;">
    This link expires in <strong>${linkExpirationFormatter(link.expirationTime)}</strong> and can only be used once.
  </p>
  <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
    <tr>
      <td style="background-color:#8B0000;border-radius:4px;padding:12px 32px;text-align:center;">
        <a href="${link}" style="color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none;display:inline-block;">Reset Password</a>
      </td>
    </tr>
  </table>
  <p style="margin:0;font-size:14px;color:#666666;line-height:1.6;">
    If you did not request a password reset, please ignore this email or contact your system administrator.
  </p>
</@layout.emailLayout>
```

The FreeMarker variables `${user.firstName}`, `${link}`, `${linkExpirationFormatter(...)}` are the standard Keycloak email-template context variables. Verified against the Keycloak 24 default email templates.

**`email-verification.ftl`** (~10 lines, same structure, different body):

```ftl
<#import "html.ftl" as layout>
<@layout.emailLayout>
  <p style="margin:0 0 16px;font-size:18px;font-weight:bold;color:#8B0000;">Hello, ${user.firstName}!</p>
  <p style="margin:0 0 16px;font-size:16px;color:#333333;line-height:1.6;">
    Please verify your email address to complete your WIMS-BFP account setup. Click the button below to confirm this email is yours.
  </p>
  <p style="margin:0 0 24px;font-size:16px;color:#333333;line-height:1.6;">
    This link expires in <strong>${linkExpirationFormatter(link.expirationTime)}</strong> and can only be used once.
  </p>
  <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
    <tr>
      <td style="background-color:#8B0000;border-radius:4px;padding:12px 32px;text-align:center;">
        <a href="${link}" style="color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none;display:inline-block;">Verify Email</a>
      </td>
    </tr>
  </table>
  <p style="margin:0;font-size:14px;color:#666666;line-height:1.6;">
    If you did not create a WIMS-BFP account, please ignore this email.
  </p>
</@layout.emailLayout>
```

**`execute-actions.ftl`** (~10 lines, same structure, action-listing body):

```ftl
<#import "html.ftl" as layout>
<@layout.emailLayout>
  <p style="margin:0 0 16px;font-size:18px;font-weight:bold;color:#8B0000;">Hello, ${user.firstName}!</p>
  <p style="margin:0 0 16px;font-size:16px;color:#333333;line-height:1.6;">
    You have one or more required actions on your WIMS-BFP account. Click the button below to review and complete them.
  </p>
  <table cellpadding="0" cellspacing="0" style="margin:0 0 16px;">
    <#list requiredActions as reqAction>
      <tr><td style="font-size:16px;color:#333333;line-height:1.6;padding:2px 0;">&bull; ${msg("requiredAction.${reqAction}")}</td></tr>
    </#list>
  </table>
  <p style="margin:0 0 24px;font-size:16px;color:#333333;line-height:1.6;">
    This link expires in <strong>${linkExpirationFormatter(link.expirationTime)}</strong> and can only be used once.
  </p>
  <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
    <tr>
      <td style="background-color:#8B0000;border-radius:4px;padding:12px 32px;text-align:center;">
        <a href="${link}" style="color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none;display:inline-block;">Review Required Actions</a>
      </td>
    </tr>
  </table>
  <p style="margin:0;font-size:14px;color:#666666;line-height:1.6;">
    If you did not request this, please contact your system administrator.
  </p>
</@layout.emailLayout>
```

### S2 — Add `emailTheme: wims-bfp` to both realm JSON files

In **`src/keycloak/bfp-realm.json`** (the live-updated realm used by `scripts/update-keycloak-smtp.sh` after first boot):

Find the `"loginTheme": "wims-bfp"` field (or similar) and add `"emailTheme": "wims-bfp"` on the next line. If `loginTheme` is not currently set, add the field in the same theme-related section.

In **`src/keycloak/import/bfp-realm.json`** (the fresh-import realm used on `--import-realm` first boot):

Same change as above. Both realm files need the field so the email theme is set regardless of which path activated the realm.

**Why the field goes in both files:** `bfp-realm.json` is the canonical live-updated file (used by `update-keycloak-smtp.sh` etc.). `import/bfp-realm.json` is the fresh-import copy (used on first boot with `start-dev --import-realm`). Both need the same `emailTheme` field so the email theme is set on a fresh deployment AND on an in-place update.

### S3 — Rebuild the Keycloak Docker image

The new `email/` subdirectory needs to be copied into the `wims-keycloak` image. The current `Dockerfile` (verified at `src/keycloak/Dockerfile`) only installs the `wims-demo-otp-provider.jar` provider jar; it does not install themes. Themes are mounted as a volume at compose time (per `src/docker-compose.yml:60`: `./keycloak/themes/wims-bfp:/opt/keycloak/themes/wims-bfp:ro`).

**Good news:** the new `email/` subdirectory is picked up by the existing volume mount automatically — no Dockerfile change needed. As long as the files exist at `src/keycloak/themes/wims-bfp/email/` on the deploy host, the running `wims-keycloak` container will see them.

**Rebuild needed:** only if the user does a full `docker compose build keycloak` to refresh the image (e.g. to ship a new version of the OTP provider jar). For the `wims-keycloak` image, no rebuild is needed for theme changes — the volume mount handles it.

**Restart needed:** the `wims-keycloak` container needs to be restarted so Keycloak re-reads the theme directory at startup. Restart command:
```bash
cd /opt/wims-bfp/src && docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production up -d keycloak
```

### S4 — System-wiki update (mandatory per AGENTS.md)

Per AGENTS.md, non-trivial changes require wiki updates. Update:

- **`system-wiki/architecture/infrastructure-config.md`** (or whatever page documents the Keycloak theme setup) — add a "Keycloak email theme" section noting the 3 FreeMarker templates, the `emailTheme: wims-bfp` realm field, and the visual design (maroon `#8B0000` header, BFP logo, 600px max width).
- **`system-wiki/log.md`** — append a `2026-06-24` entry following the same shape as the live-notifications and device-id entries: problem (Keycloak default emails aren't branded), fix (3 FreeMarker templates + realm field + theme.properties), files changed, validation, scope limits.
- **`system-wiki/gaps/frs-codebase-gap-register.md`** — close the gap (search for any email-related entry; if one exists, add a closing note; if not, create one).

---

## Files Changed

| # | File | Action | Change |
|---|------|--------|--------|
| 1 | `src/keycloak/themes/wims-bfp/email/theme.properties` | **Create** | 1 line: `parent=base` |
| 2 | `src/keycloak/themes/wims-bfp/email/messages_en.properties` | **Create** | 3 lines: subject line overrides for password reset, email verification, execute actions |
| 3 | `src/keycloak/themes/wims-bfp/email/html.ftl` | **Create** | ~80 lines: common HTML wrapper with maroon header, BFP logo, gray footer; `<#nested>` slot for body content |
| 4 | `src/keycloak/themes/wims-bfp/email/password-reset.ftl` | **Create** | ~10 lines: password-reset-specific body content wrapped via `<@layout.emailLayout>` |
| 5 | `src/keycloak/themes/wims-bfp/email/email-verification.ftl` | **Create** | ~10 lines: email-verification-specific body content |
| 6 | `src/keycloak/themes/wims-bfp/email/execute-actions.ftl` | **Create** | ~10 lines: execute-actions-specific body content listing required actions |
| 7 | `src/keycloak/bfp-realm.json` | **Edit** | Add `"emailTheme": "wims-bfp"` field (1 line) |
| 8 | `src/keycloak/import/bfp-realm.json` | **Edit** | Add `"emailTheme": "wims-bfp"` field (1 line) |
| 9 | `system-wiki/architecture/infrastructure-config.md` (or appropriate page) | **Edit** | Add "Keycloak email theme" section |
| 10 | `system-wiki/log.md` | **Append** | New `2026-06-24` entry |
| 11 | `system-wiki/gaps/frs-codebase-gap-register.md` | **Edit** | Close email-related gap (or create new one) |

### Not Changed

- **`src/backend/services/email/templates/*.html.j2`** — the 7 backend app-level Jinja2 templates stay byte-identical (out of scope per the original "Do not change the email templates" constraint)
- **`src/keycloak/themes/wims-bfp/login/`** — the existing 16-file login theme stays byte-identical
- **`src/keycloak/Dockerfile`** — no change; the volume mount at `src/docker-compose.yml:60` picks up the new `email/` subdirectory automatically
- **`src/docker-compose.yml`** — no change; the theme volume mount already covers the new `email/` subdirectory
- **No new Python, no new tests** — this is a Keycloak theme + 2 realm JSON lines + wiki updates
- **No SMTP credential change** — the Brevo SMTP setup (PR #452) stays exactly as deployed

---

## Verification

### V1 — Fresh template renders for password reset

1. Restart `wims-keycloak` to pick up the new theme: `cd /opt/wims-bfp/src && docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production up -d keycloak`
2. Wait ~30s for Keycloak to become healthy
3. Trigger a password reset for `nathan_encoder` (or any test user): visit `https://wimsbfp.tech/auth/realms/bfp/login-actions/reset-credentials`, enter their email
4. Check the email arrives at the user's inbox (it already did at V2 of the email-provider switch; the new variable is the **template**)
5. **Confirm the new template is in use** by:
   - Inspecting the email source: should have subject `[WIMS-BFP] Reset your password` (not the default `Reset password`)
   - Inspecting the email body: should have the maroon `#8B0000` header, the "Bureau of Fire Protection" + "WIMS-BFP Incident Management System" text, the BFP logo image (loaded from `https://wimsbfp.tech/auth/resources/3.0/login/wims-bfp/img/bfp-logo.png`), and the maroon "Reset Password" call-to-action button

### V2 — Email verification template renders

1. From Keycloak admin console (or via API), trigger an email verification for any test user
2. Confirm the email arrives
3. Inspect the subject: `[WIMS-BFP] Verify your email address`
4. Inspect the body: same WIMS-BFP branding as V1, but the call-to-action button text says "Verify Email" (not "Reset Password")

### V3 — Execute-actions template renders

1. From Keycloak admin console, set a "required action" on a test user (e.g. "Update Password")
2. Trigger an execute-actions email (e.g. admin "Send email" with the "Execute actions" template)
3. Confirm the email arrives
4. Inspect the subject: `[WIMS-BFP] Action required for your account`
5. Inspect the body: same WIMS-BFP branding, with a bulleted list of required actions, and the "Review Required Actions" call-to-action button

### V4 — Existing tests still pass

Per the project CI pre-flight routine (`docs/agents/ci-preflight.md`):
```bash
cd src/backend && ruff check . && ruff format . --check && python -m pytest -v
cd src/frontend && npm run lint && npx vitest run && npm run build
```

All 4 blocking gates pass. (No Python or test change in this spec, so the test suite is unaffected by construction. The `ruff` checks pass because no Python is touched. The frontend build passes because no frontend is touched.)

### V5 — No regressions in the existing email flows

1. The 7 backend app-level email templates still send the same way they did before this spec (no change to `sender.py`)
2. The Brevo SMTP setup (PR #452) is unchanged
3. The Keycloak login theme is unchanged
4. The 4 DNS records for `wimsbfp.tech` in the OrderBox/ResellerClub panel are unchanged

### V6 — Theme fallback works (resilience check)

If the new theme has a bug, Keycloak falls back to its base theme — emails still get sent, just without WIMS-BFP branding. To verify:

1. Temporarily break the new theme (e.g. add a syntax error to `html.ftl`)
2. Trigger a password reset
3. Confirm: email still arrives, but with Keycloak's default generic template
4. Revert the syntax error

This isn't a hard requirement (Keycloak's fallback is a built-in feature), but a quick test confirms the resilience.

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| FreeMarker template syntax error | Low (templates are simple) | Medium — email falls back to default template, not a complete failure | V6 fallback check; FreeMarker errors are logged at startup, container restart will surface them |
| `bfp-logo.png` URL changes with Keycloak version | Low (Keycloak 24 has stable URL pattern `/auth/resources/{version}/login/{theme-name}/...`) | Low — broken image, still readable | Logo URL is a literal in the template; if Keycloak 25 changes the URL, update the template |
| Existing `emailTheme: wims-bfp` in realm JSON doesn't apply after restart | Very low (Keycloak reads this field at theme lookup, not at startup) | Low — emails still arrive, with default template | Restart is part of the deploy plan; verify V1 after restart |
| New theme templates leak the Brevo API key or other secrets | None (templates contain no secrets; only static copy and FreeMarker context vars) | — | R5 verifies no secrets in tracked files |
| User marks the password-reset email as "not spam" but the BFP logo image is missing/404s | Low (logo URL is in the public theme resources) | Very low — broken image, still readable | Logo URL is tested as part of V1; if 404, fall back to a text-only header |
| Keycloak 24's `emailTheme` field is named differently in 24.0.x patch versions | Low (verified as `emailTheme` in 24.0.0 source) | High — theme doesn't apply | Verified against the Keycloak 24.0.0 source on GitHub; field name is stable across patch versions |
| The `bfp-realm.json` field placement breaks the JSON structure | Low (we add 1 line in an existing theme-related section) | High — Keycloak fails to start, no auth | V1 + V2 + V3 explicitly verify auth still works after the change |

---

## FRS / Security Context

- **Email content is project-owned**, not FRS-mandated. The FRS references transactional email as the delivery path; the exact visual design is a project decision, not a regulatory requirement.
- **No new secrets introduced.** The new theme templates contain no API keys, no real user data, no real links. All Brevo SMTP credentials stay in `.env.production` (gitignored) per the email-provider switch.
- **No new attack surface.** FreeMarker templates are processed server-side by Keycloak; there is no user-controlled input rendered into the templates. The `${user.firstName}`, `${link}`, `${linkExpirationFormatter(...)}` are all server-side context variables provided by Keycloak.
- **The 7 backend app-level templates are out of scope.** This spec is about the Keycloak-driven path only. If the user wants to redesign the 7 Jinja2 templates (e.g. add `List-Unsubscribe` headers for spam classification), that's a separate spec.

---

## Out of Scope

- **Redesigning the 7 backend app-level Jinja2 templates** (e.g. adding `List-Unsubscribe` headers, improving spam classification) — separate spec if needed
- **Replacing the Brevo SMTP setup** — already done in PR #452
- **Customizing the Keycloak login theme** — already WIMS-BFP-branded; no change
- **Localizing the new theme to Filipino (Tagalog)** — the BFP is a Philippine government agency; the existing 7 templates are all English-only, this spec matches that
- **Adding a custom Keycloak email sender** (e.g. routing all email through a single branded wrapper) — over-engineering for the current need
- **Embedding the BFP logo as a base64 data URL in the email** — would bloat email size; URL reference is the standard pattern
- **A/B testing the email design** — single design is fine for a thesis prototype
- **Re-running the `update-keycloak-smtp.sh` script with new values** — that script updates SMTP transport, not the email theme; the theme is set via `emailTheme: wims-bfp` in the realm JSON (S2)

---

## Resolved Questions (v1)

1. **Why not modify the 7 backend templates instead?** — those are for the app-level email flow (`tasks/notifications.py:194`, `auth.py:222`). Keycloak's transactional email flow uses Keycloak's own templates, not the app's. They're separate paths. Modifying the 7 templates wouldn't change the password-reset email.
2. **Why FreeMarker and not Jinja2?** — Keycloak's theme templates are FreeMarker, period. We can't change Keycloak's template engine. The 7 backend templates are Jinja2 because that's what the Python backend uses. They are different paths, different engines, different purposes.
3. **Why reuse the BFP logo via URL, not embed as base64?** — email clients may not load external images (security policy), but if they do, the URL is the standard pattern; if they don't, the email is still readable with the `alt` text. Base64 embedding bloats the email by ~5-10 KB and some clients strip it.
4. **What about `executeActionsSubject` placeholder** — does it need `{0}` and `{1}`? — in Keycloak 24, the subject is templated with `link.expirationTime` and `realm.displayName` automatically. We just set the static prefix; the placeholder values are filled in by Keycloak.
5. **Can the email theme be applied via a different method (admin console, kcadm) instead of editing realm JSON?** — yes, but the JSON approach is consistent with the rest of the project's realm config and is the same one used for the SMTP `smtpServer` block. Single source of truth.

## Deferred to Plan Author

- Exact pixel dimensions of the BFP logo in the email header (suggested: 48x48 above the "Bureau of Fire Protection" text)
- Exact `linkExpirationFormatter` output format (e.g. "5 minutes" vs "00:05:00") — should match the 7 backend templates' "X minutes" style
- Whether to add a `preheader` text (the short summary that shows in email client previews before the user opens) — not in the spec; can be added later if needed
- The exact order of the Files Changed commits in the plan

---

## Self-Review

**Spec coverage:**
- R1 (password reset template) → V1, files 3+4
- R2 (email verification template) → V2, files 3+5
- R3 (execute-actions template) → V3, files 3+6
- R4 (existing tests pass) → V4
- R5 (no secrets) → V5 + automated check in deploy
- All 3 templates use the shared `html.ftl` wrapper (file 3)
- All 3 templates' subject lines overridden in `messages_en.properties` (file 2)
- Theme declaration in `theme.properties` (file 1)
- Both realm JSONs updated (S2)
- System-wiki updated (S4)

**Placeholder scan:**
- No "TBD", "TODO", "implement later", "fill in details"
- All file contents are concrete (paths, line counts, exact text)
- Verification steps include exact commands and expected subject/body text
- The Risks table has Likelihood + Impact + Mitigation for each risk

**Type / identifier consistency:**
- `emailTheme: wims-bfp` field name matches Keycloak 24 source
- `parent=base` declaration matches Keycloak 24 email theme convention
- The 3 message keys (`emailPasswordResetSubject`, `emailVerificationSubject`, `executeActionsSubject`) match Keycloak 24 source
- `${user.firstName}`, `${link}`, `${linkExpirationFormatter(link.expirationTime)}` are the standard Keycloak email-template context vars
- `bfp-logo.png` exists at `src/keycloak/themes/wims-bfp/login/resources/img/bfp-logo.png` (verified)
- The maroon `#8B0000` color matches the 7 backend templates and the login theme's `wims-custom.css`

**Gaps found in self-review, fixed inline:**
- Initially S1 listed 5 files but didn't call out the `html.ftl` import/`<#nested>` mechanism clearly; the body templates' use of `<@layout.emailLayout>` is now explicit
- Initially V1 didn't include the BFP logo URL construction; added the `/auth/resources/{version}/login/{theme-name}/...` pattern with the explicit version `3.0`
- Initially "Resolved Questions" didn't address the local-keycloak-theme build context (volume mount vs image); clarified in S3 that volume mount handles it, no image rebuild needed
- Initially "Files Changed" didn't include the wiki updates separately; now listed as items 9, 10, 11 per AGENTS.md mandatory rule

---

*This is a design spec (v1). The implementation plan will be at `docs/superpowers/plans/2026-06-24-keycloak-email-theme.md`. Once the spec is approved, invoke the writing-plans skill to produce the plan.*
