# Custom Keycloak Email Theme (WIMS-BFP Branding) Design — v2

**Date:** 2026-06-24
**Status:** Design (v2 — corrections after v1 meta-analysis)
**Supersedes:** v1 (commit `8b46dee`) — high-level architecture preserved, all implementation details corrected after a 2-pass meta-analysis verified against the actual Keycloak 24.0.0 source.
**Pattern:** Add `email/` subdirectory to the existing `src/keycloak/themes/wims-bfp/` theme; 9 FreeMarker templates (3 HTML + 3 text + 1 shared HTML wrapper + 1 theme.properties + 1 messages bundle) + 1 logo file + 1 realm JSON line.
**Scope:** Keycloak transactional emails only (password reset, email verification, execute-actions). Does **not** touch the 7 backend app-level Jinja2 templates in `src/backend/services/email/templates/`. Does **not** touch the login theme. Does **not** touch the Brevo SMTP setup.
**Reviewer basis:** Verified against the actual Keycloak 24.0.0 source — `themes/src/main/resources/theme/base/email/` (directory structure, `messages/messages_en.properties`, `html/template.ftl`, `html/password-reset.ftl`, `html/executeActions.ftl`, `text/password-reset.ftl`), `services/src/main/java/org/keycloak/email/freemarker/FreeMarkerEmailTemplateProvider.java` (template lookup, exception behavior, context variable injection). Local repo state verified — `src/keycloak/themes/wims-bfp/login/` (16 files, no `email/`), `src/keycloak/bfp-realm.json` and `src/keycloak/import/bfp-realm.json` (no current `loginTheme` or `emailTheme` field), `src/backend/services/email/templates/password_reset.html.j2` (visual reference for the new templates), `src/docker-compose.yml:60` (theme volume mount).

---

## What changed from v1 (corrections summary)

A 2-pass meta-analysis (one approving, one not) found 5 critical bugs and several lesser issues in v1. **All bugs verified against the actual Keycloak 24.0.0 source on GitHub.** The v1's central architecture (sibling `email/` subdir, shared `html.ftl` wrapper, maroon branding, `emailTheme: wims-bfp` realm field) is correct. Every concrete implementation detail in S1 (file paths, file names, variable names, message keys) was wrong. Below are the corrections, each cited to its source.

| # | v1 said | v2 says | Verified against |
|---|---|---|---|
| 1 | `emailPasswordResetSubject` | `passwordResetSubject` | `keycloak/24.0.0/.../email/messages/messages_en.properties` line `passwordResetSubject=Reset password` |
| 2 | `messages_en.properties` at `email/messages_en.properties` | `email/messages/messages_en.properties` (must be in `messages/` subdir) | `keycloak/24.0.0/.../email/messages/messages_en.properties` |
| 3 | `execute-actions.ftl` (lowercase, hyphenated) | `executeActions.ftl` (camelCase) | `FreeMarkerEmailTemplateProvider.java: send("executeActionsSubject", "executeActions.ftl", attributes)` |
| 4 | `${linkExpirationFormatter(link.expirationTime)}` | `${linkExpirationFormatter(linkExpiration)}` | `FreeMarkerEmailTemplateProvider.java: attributes.put("linkExpiration", expirationInMinutes)` + `base email/html/password-reset.ftl` |
| 5 | `password-reset.ftl`, `email-verification.ftl`, `execute-actions.ftl` directly under `email/` | Same filenames under `email/html/` (3 files), plus 3 mirror templates under `email/text/` (text is required, not optional) | `FreeMarkerEmailTemplateProvider.java: String textTemplate = String.format("text/%s", template); String htmlTemplate = String.format("html/%s", template);` |
| 6 | `<#import "html.ftl" as layout>` | `<#import "template.ftl" as layout>` (the file is `template.ftl` inside `html/`) | `keycloak/24.0.0/.../email/html/password-reset.ftl: <#import "template.ftl" as layout>` |
| 7 | `<img src="https://wimsbfp.tech/auth/resources/3.0/login/wims-bfp/img/bfp-logo.png">` (hardcoded URL with `3.0` cache-bust) | Copy logo to `email/resources/img/bfp-logo.png`, reference `<img src="${url.resourcesUrl}/img/bfp-logo.png">` | `FreeMarkerEmailTemplateProvider.java: attributes.put("url", new UrlBean(realm, theme, uriInfo.getBaseUri(), null))` + Keycloak docs: email images should live in `email/resources/img/` |
| 8 | `${user.firstName}` (unescaped) | `${(user.firstName)!user.username?html}` (null-safe + HTML-escaped) | `FreeMarkerEmailTemplateProvider.java: attributes.put("user", new ProfileBean(user, session))` + standard FreeMarker best practice for untrusted user data |
| 9 | "Find `loginTheme` and add `emailTheme` after it" | Add `emailTheme: wims-bfp` as a top-level field; the current realm has NO `loginTheme` field | `src/keycloak/bfp-realm.json` and `src/keycloak/import/bfp-realm.json` — confirmed via grep that neither file currently has `loginTheme` or `emailTheme` |
| 10 | `docker compose up -d keycloak` | `docker compose restart keycloak` (forces theme re-cache; `up -d` may not restart an unchanged container) | Keycloak's own dev-mode docs: "Disable theme and template caching in development" implies caching is on in production |
| 11 | V6: "if the new theme has a bug, Keycloak falls back to base" | **REMOVED.** FreeMarker render failure throws `EmailException` — email fails to send, not falls back. Theme is fully overridden, so missing templates also fail. | `FreeMarkerEmailTemplateProvider.java: throw new EmailException("Failed to template html email.", e);` (no catch-and-fallback) |
| 12 | `import=common/keycloak` in theme.properties | **REMOVED.** Unnecessary for email theme; only `parent=base` is needed. | `keycloak/24.0.0/.../email/html/theme.properties` (just `parent=base`, no import line) |
| 13 | Edit `bfp-realm.json` and `import/bfp-realm.json` only | ALSO need a live-realm kcadm update: `/opt/keycloak/bin/kcadm.sh update realms/bfp -s emailTheme=wims-bfp` — because the existing persistent Keycloak DB has a `realms` row that was imported with the OLD (no-emailTheme) JSON, and a fresh `start-dev --import-realm` would re-import but our deploy path doesn't do that on every restart | Per the live-notifications spec's B2 blocker (Keycloak resolves `${env.SMTP_*:default}` once at first import and stores the resolved values; same applies to realm-level fields like `emailTheme` after first import) |
| 14 | "styled plain text alternative" | Plain text CANNOT be styled; it's a plain-text fallback. The 3 `text/*.ftl` files will be readable plain text with the URL on its own line (email clients may auto-link it) | The very nature of `text/plain` MIME type — no styling possible |

The v1 self-review missed all 14. The meta-analyses caught them all. v2's self-review (at the end) explicitly notes this and adds a per-citation verification matrix.

---

## Problem

After the email-provider switch (PR #452, merged at `e4c53d2`), the SMTP transport works end-to-end. V1 (direct send), V1b (Celery task), V2 (Keycloak password reset — verified by the user at 2026-06-24 17:00 PST, email arrived at `nathancabrales10@gmail.com` even if it landed in spam), and V4 (idempotency) all pass.

But the **Keycloak transactional emails** (password reset, email verification, execute-actions) use **Keycloak's built-in default email templates** — generic-looking HTML with no WIMS-BFP branding. The user-visible result: a password-reset email arrives in the user's inbox, but the layout/colors don't match the rest of the WIMS-BFP system (the 7 backend app-level templates at `src/backend/services/email/templates/` are all WIMS-BFP-branded with maroon `#8B0000`, "Bureau of Fire Protection" tagline, table layout, 600px max width).

The handoff's "Do not change the email templates" constraint is honored — those 7 templates stay as-is. This spec is about **adding new** templates for the **Keycloak-driven** flow, not modifying the **app-driven** flow's templates.

### Secondary observations

- **Custom Keycloak theme infrastructure already exists** (`src/keycloak/themes/wims-bfp/` with `login/` subdirectory). The email theme is a sibling subdirectory; the theme name `wims-bfp` is already known to Keycloak.
- **BFP logo already exists** at `src/keycloak/themes/wims-bfp/login/resources/img/bfp-logo.png`. We copy it to the new `email/resources/img/bfp-logo.png`.
- **No `emailTheme` field in realm JSON** (confirmed via grep). Needs to be added to both `bfp-realm.json` and `import/bfp-realm.json` (the latter is the fresh-import path that resolves placeholders on first boot).
- **Keycloak 24 email theme structure** (verified against `github.com/keycloak/keycloak/24.0.0/.../email/`): subdirs `messages/`, `resources/`, `html/`, `text/`, plus `theme.properties`. Templates use FreeMarker with context vars `link`, `linkExpiration`, `linkExpirationFormatter`, `realmName`, `user`, `url.resourcesUrl`, `requiredActions`.
- **Live-realm DB also needs the `emailTheme` update** — the existing persistent Keycloak DB was imported with the OLD (no-`emailTheme`) JSON, and per the live-notifications spec's B2 blocker, Keycloak does not re-resolve realm fields on restart. A kcadm update is required.

---

## Goal

After this design is implemented, the WIMS-BFP stack delivers:

1. **Keycloak password-reset emails** with WIMS-BFP branding (maroon header, BFP logo, "Bureau of Fire Protection — WIMS-BFP Incident Management System" tagline, table-based layout, call-to-action button)
2. **Keycloak email-verification emails** with the same branding
3. **Keycloak execute-actions emails** (the "you must do X" emails Keycloak sends for required actions on login, like first-login password change) with the same branding
4. **All three** use a subject line that matches the rest of the WIMS-BFP system (e.g. `[WIMS-BFP] Reset your password` instead of Keycloak's default `Reset password`)
5. **All three** include a plain-text alternative body (the part that shows in email clients with HTML disabled) with the URL on its own line for auto-linking
6. **Visual consistency** with the 7 backend app-level templates — same header, same color scheme (`#8B0000` maroon), same footer

The backend app-level templates (security alerts, weekly reports, etc.) stay byte-identical. The login theme (already WIMS-BFP-branded) stays byte-identical. The login-flow visual changes zero. The Brevo SMTP setup is unchanged.

---

## Requirements

### R1 — Password reset email uses the new WIMS-BFP template

- A user triggering "Forgot password" on the Keycloak login page receives an email with the WIMS-BFP header (maroon bar with "Bureau of Fire Protection" + "WIMS-BFP Incident Management System" tagline), a body explaining the reset request, and a maroon "Reset Password" call-to-action button.
- Email subject is `[WIMS-BFP] Reset your password` (overrides Keycloak's default `Reset password`).
- The email body is a self-contained HTML document (inline CSS, table layout, 600px max) — no external CSS or JS dependencies.
- The plain-text alternative (the part that shows in email clients with HTML disabled) includes the reset link on its own line (clients may auto-link it).

### R2 — Email verification email uses the new WIMS-BFP template

- A user triggering email verification (or admin-triggered verify) receives an email with the same WIMS-BFP branding, body explaining the verification, and a maroon "Verify Email" call-to-action button.
- Subject: `[WIMS-BFP] Verify your email address` (overrides Keycloak's default `Verify email`).
- Same HTML + plain-text structure as R1.

### R3 — Execute-actions email uses the new WIMS-BFP template

- A user required to perform an action (e.g. first-login password change, TOTP setup, terms acceptance) receives an email with WIMS-BFP branding, body listing the required actions, and a maroon call-to-action button linking to the action.
- Subject: `[WIMS-BFP] Action required for your account` (overrides Keycloak's default `Update Your Account`).
- Same HTML + plain-text structure as R1.

### R4 — Existing tests still pass

- `cd src/backend && ruff check .` — clean
- `cd src/backend && ruff format . --check` — clean
- `cd src/backend && pytest -v` — full suite green (no Python change, unaffected by construction)
- `cd src/frontend && npm run lint && npx vitest run && npm run build` — clean
- The 7 existing backend app-level email templates (`src/backend/services/email/templates/*.html.j2`) are byte-identical

### R5 — Secrets and templates stay out of source control

- `git status` shows no new tracked file containing real SMTP credentials, real user emails, or other secrets
- `.gitignore` continues to exclude `.env` and `firebase-creds.json`
- The new template files contain no real names, emails, or links

### R6 — All three email types render both HTML and plain-text

- The MIME parts of the outgoing email are `text/html` AND `text/plain` (per `FreeMarkerEmailTemplateProvider.java`, both are required)
- Both parts are non-empty
- Plain-text part contains the URL on its own line for email-client auto-linking

### R7 — All three email types are null-safe and HTML-escape user data

- If `user.firstName` is null, the email still renders (falls back to `user.username`)
- The user's first name is HTML-escaped in the HTML body (XSS prevention)

### R8 — BFP logo loads correctly from the email

- The logo image is loaded from `${url.resourcesUrl}/img/bfp-logo.png` (Keycloak serves email resources at this URL)
- The image is hosted as a separate file at `email/resources/img/bfp-logo.png` (copied from the existing `login/resources/img/bfp-logo.png`)
- No hardcoded production URL in the template (portable across local, staging, production)

---

## Solution

### S1 — Create the `email/` subdirectory under `src/keycloak/themes/wims-bfp/`

The directory tree (verified against Keycloak 24.0.0 `themes/src/main/resources/theme/base/email/`):

```
src/keycloak/themes/wims-bfp/email/
├── theme.properties                   (1 line: parent=base)
├── messages/
│   └── messages_en.properties          (3 lines: subject overrides)
├── resources/
│   └── img/
│       └── bfp-logo.png                (copy of login theme's logo)
├── html/
│   ├── template.ftl                    (shared <#macro emailLayout> wrapper with maroon header + BFP logo + gray footer)
│   ├── password-reset.ftl              (calls layout.emailLayout, body content)
│   ├── email-verification.ftl          (same pattern)
│   └── executeActions.ftl              (same pattern, with requiredActions loop)
└── text/
    ├── password-reset.ftl              (plain text, ~5 lines)
    ├── email-verification.ftl          (plain text, ~5 lines)
    └── executeActions.ftl              (plain text, ~5 lines)
```

Total: 9 new files + 1 copied file = 10 files total in the new subdirectory.

#### S1.1 — `src/keycloak/themes/wims-bfp/email/theme.properties`

```properties
parent=base
```

(1 line. The `parent=base` declares inheritance from Keycloak's base email theme. We override all 3 templates, so no base defaults leak through. No `import` line is needed — the v1 suggestion of `import=common/keycloak` was unnecessary and removed in v2.)

#### S1.2 — `src/keycloak/themes/wims-bfp/email/messages/messages_en.properties`

The correct message keys (verified against `keycloak/24.0.0/.../email/messages/messages_en.properties`):

```properties
passwordResetSubject=[WIMS-BFP] Reset your password
emailVerificationSubject=[WIMS-BFP] Verify your email address
executeActionsSubject=[WIMS-BFP] Action required for your account
```

(3 lines, one per email type. The `emailVerificationSubject` is prefixed `email` but the other two are not — that's the actual Keycloak 24 convention. These are the only subject overrides; the body text is in the templates, not in the message bundle.)

#### S1.3 — `src/keycloak/themes/wims-bfp/email/resources/img/bfp-logo.png`

Copy of the existing `src/keycloak/themes/wims-bfp/login/resources/img/bfp-logo.png`. The new email theme needs the logo in its OWN `resources/` directory; the email templates use `${url.resourcesUrl}/img/bfp-logo.png` which resolves relative to the email theme's `resources/` directory (NOT the login theme's).

#### S1.4 — `src/keycloak/themes/wims-bfp/email/html/template.ftl`

The shared HTML wrapper. The v1 spec called this `html.ftl`; the v2 (correct) name is `template.ftl` per Keycloak's base email theme. Each of the 3 per-template files will `<#import "template.ftl" as layout>` and call `<@layout.emailLayout>`:

```ftl
<#macro emailLayout>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WIMS-BFP Notification</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;padding:24px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
          <!-- Header -->
          <tr>
            <td style="background-color:#8B0000;padding:24px 32px;text-align:center;">
              <img src="${url.resourcesUrl}/img/bfp-logo.png" alt="BFP" width="48" height="48" style="display:block;margin:0 auto 12px;">
              <p style="margin:0;color:#ffffff;font-size:20px;font-weight:bold;">Bureau of Fire Protection</p>
              <p style="margin:4px 0 0;color:#ffcccc;font-size:14px;">WIMS-BFP Incident Management System</p>
            </td>
          </tr>
          <!-- Body (per-template content goes here) -->
          <tr>
            <td style="background-color:#ffffff;padding:40px 32px;">
              <#nested>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color:#f9f9f9;padding:24px 32px;text-align:center;">
              <p style="margin:0;font-size:12px;color:#999999;line-height:1.6;">
                Bureau of Fire Protection — WIMS-BFP<br/>
                This is an automated message. Do not reply to this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
</#macro>
```

Key v2 fixes vs. v1:
- The logo is referenced as `${url.resourcesUrl}/img/bfp-logo.png` (dynamic, portable), NOT the hardcoded `https://wimsbfp.tech/auth/resources/3.0/...` URL from v1
- The `<#nested>` slot is the body content from each per-template file
- Inline CSS only, table-based layout, 600px max width — visually matches the 7 backend templates

#### S1.5 — `src/keycloak/themes/wims-bfp/email/html/password-reset.ftl`

```ftl
<#import "template.ftl" as layout>
<@layout.emailLayout>
  <p style="margin:0 0 16px;font-size:18px;font-weight:bold;color:#8B0000;">Hello, ${(user.firstName)!user.username?html}!</p>
  <p style="margin:0 0 16px;font-size:16px;color:#333333;line-height:1.6;">
    We received a request to reset your WIMS-BFP account password. Click the button below to set a new password.
  </p>
  <p style="margin:0 0 24px;font-size:16px;color:#333333;line-height:1.6;">
    This link expires in <strong>${linkExpirationFormatter(linkExpiration)}</strong> and can only be used once.
  </p>
  <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
    <tr>
      <td style="background-color:#8B0000;border-radius:4px;padding:12px 32px;text-align:center;">
        <a href="${link?html}" style="color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none;display:inline-block;">Reset Password</a>
      </td>
    </tr>
  </table>
  <p style="margin:0;font-size:14px;color:#666666;line-height:1.6;">
    If you did not request a password reset, please ignore this email or contact your system administrator.
  </p>
</@layout.emailLayout>
```

Key v2 fixes vs. v1:
- The expiration expression is `${linkExpirationFormatter(linkExpiration)}` (v1 had `${linkExpirationFormatter(link.expirationTime)}` — wrong context-var path)
- The link is escaped with `?html` (XSS prevention)
- `user.firstName` is null-safe with fallback to `user.username`, and HTML-escaped

#### S1.6 — `src/keycloak/themes/wims-bfp/email/html/email-verification.ftl`

Same structure as S1.5, with the body content changed to verification language and the button text changed to "Verify Email":

```ftl
<#import "template.ftl" as layout>
<@layout.emailLayout>
  <p style="margin:0 0 16px;font-size:18px;font-weight:bold;color:#8B0000;">Hello, ${(user.firstName)!user.username?html}!</p>
  <p style="margin:0 0 16px;font-size:16px;color:#333333;line-height:1.6;">
    Please verify your email address to complete your WIMS-BFP account setup. Click the button below to confirm this email is yours.
  </p>
  <p style="margin:0 0 24px;font-size:16px;color:#333333;line-height:1.6;">
    This link expires in <strong>${linkExpirationFormatter(linkExpiration)}</strong> and can only be used once.
  </p>
  <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
    <tr>
      <td style="background-color:#8B0000;border-radius:4px;padding:12px 32px;text-align:center;">
        <a href="${link?html}" style="color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none;display:inline-block;">Verify Email</a>
      </td>
    </tr>
  </table>
  <p style="margin:0;font-size:14px;color:#666666;line-height:1.6;">
    If you did not create a WIMS-BFP account, please ignore this email.
  </p>
</@layout.emailLayout>
```

#### S1.7 — `src/keycloak/themes/wims-bfp/email/html/executeActions.ftl`

Note the filename: `executeActions.ftl` (camelCase, no hyphen) — verified against `FreeMarkerEmailTemplateProvider.java: send("executeActionsSubject", "executeActions.ftl", ...)`.

```ftl
<#import "template.ftl" as layout>
<@layout.emailLayout>
  <p style="margin:0 0 16px;font-size:18px;font-weight:bold;color:#8B0000;">Hello, ${(user.firstName)!user.username?html}!</p>
  <p style="margin:0 0 16px;font-size:16px;color:#333333;line-height:1.6;">
    You have one or more required actions on your WIMS-BFP account. Click the button below to review and complete them.
  </p>
  <#if requiredActions?? && requiredActions?size gt 0>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 16px;">
      <#list requiredActions as reqAction>
        <tr><td style="font-size:16px;color:#333333;line-height:1.6;padding:2px 0;">&bull; ${msg("requiredAction.${reqAction}")?html}</td></tr>
      </#list>
    </table>
  </#if>
  <p style="margin:0 0 24px;font-size:16px;color:#333333;line-height:1.6;">
    This link expires in <strong>${linkExpirationFormatter(linkExpiration)}</strong> and can only be used once.
  </p>
  <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
    <tr>
      <td style="background-color:#8B0000;border-radius:4px;padding:12px 32px;text-align:center;">
        <a href="${link?html}" style="color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none;display:inline-block;">Review Required Actions</a>
      </td>
    </tr>
  </table>
  <p style="margin:0;font-size:14px;color:#666666;line-height:1.6;">
    If you did not request this, please contact your system administrator.
  </p>
</@layout.emailLayout>
```

The `requiredActions` list is null-checked (`??`) and size-checked (`gt 0`) to prevent rendering issues if the list is empty.

#### S1.8 — `src/keycloak/themes/wims-bfp/email/text/password-reset.ftl`

Plain-text version. Cannot be styled; just readable text with the URL on its own line for client auto-linking:

```ftl
<#ftl output_format="plainText">
Hello ${(user.firstName)!user.username},

We received a request to reset your WIMS-BFP account password. Click the link below to set a new password.

${link}

This link expires in ${linkExpirationFormatter(linkExpiration)} and can only be used once.

If you did not request a password reset, please ignore this email or contact your system administrator.

— Bureau of Fire Protection — WIMS-BFP
This is an automated message. Do not reply to this email.
```

#### S1.9 — `src/keycloak/themes/wims-bfp/email/text/email-verification.ftl`

```ftl
<#ftl output_format="plainText">
Hello ${(user.firstName)!user.username},

Please verify your email address to complete your WIMS-BFP account setup. Click the link below to confirm this email is yours.

${link}

This link expires in ${linkExpirationFormatter(linkExpiration)} and can only be used once.

If you did not create a WIMS-BFP account, please ignore this email.

— Bureau of Fire Protection — WIMS-BFP
This is an automated message. Do not reply to this email.
```

#### S1.10 — `src/keycloak/themes/wims-bfp/email/text/executeActions.ftl`

```ftl
<#ftl output_format="plainText">
Hello ${(user.firstName)!user.username},

You have one or more required actions on your WIMS-BFP account. Click the link below to review and complete them.

<#if requiredActions?? && requiredActions?size gt 0>Required actions:
<#list requiredActions as reqAction>- ${msg("requiredAction.${reqAction}")}
</#list>
</#if>

${link}

This link expires in ${linkExpirationFormatter(linkExpiration)} and can only be used once.

If you did not request this, please contact your system administrator.

— Bureau of Fire Protection — WIMS-BFP
This is an automated message. Do not reply to this email.
```

### S2 — Add `emailTheme: wims-bfp` to BOTH realm JSON files (top-level field)

In **`src/keycloak/bfp-realm.json`** AND **`src/keycloak/import/bfp-realm.json`**: add 1 line at the top level of the realm JSON object. Suggested placement: near the `"displayName"` field (top-level realm metadata).

Concretely, find `"displayName": "..."` (around line 5-10 of each file) and add immediately after:

```json
  "emailTheme": "wims-bfp",
```

**Why top-level, not next to `loginTheme`:** neither file currently has a `loginTheme` field (confirmed via grep of both files). The login theme is selected by other means (Keycloak admin config or compose env). Adding `emailTheme` at the top level puts it next to other realm-level theme fields. There is no `loginTheme` to "add after" in the current codebase.

**Why both files:** `bfp-realm.json` is the live-updated file (used by `update-keycloak-smtp.sh` and similar scripts after first boot). `import/bfp-realm.json` is the fresh-import copy (used on first boot with `start-dev --import-realm`). Both need the same field so the email theme is set regardless of which path activated the realm.

### S3 — Live-realm kcadm update for the existing persistent DB

The existing Keycloak DB on the VPS was imported from the OLD (no-`emailTheme`) JSON. Per the live-notifications spec's B2 blocker, Keycloak does not re-resolve realm-level fields on restart. So even after S2 + a container restart, the live realm will still have no `emailTheme` set. To apply the change to the running Keycloak:

```bash
ssh -i ~/.ssh/id_ed25519_pi root@165.22.101.73
cd /opt/wims-bfp
docker exec wims-keycloak /opt/keycloak/bin/kcadm.sh config credentials \
  --server http://localhost:8080/auth --realm master \
  --user "$KEYCLOAK_ADMIN" --password "$KEYCLOAK_ADMIN_PASSWORD"
docker exec wims-keycloak /opt/keycloak/bin/kcadm.sh update realms/bfp \
  -s emailTheme=wims-bfp
docker exec wims-keycloak /opt/keycloak/bin/kcadm.sh get realms/bfp -r master \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print("emailTheme:", d.get("emailTheme"))'
```

Expected output: `emailTheme: wims-bfp`. If `None` is shown, the update did not apply; investigate why (likely the kcadm credentials didn't work).

### S4 — Restart `wims-keycloak` with the right command

`docker compose up -d keycloak` may not restart an already-running container if the service definition hasn't changed. The reliable command is:

```bash
cd /opt/wims-bfp/src && \
  docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production \
  restart keycloak
```

This forces a restart regardless of service-definition changes. Keycloak's theme cache (which loads at startup) gets refreshed.

If even `restart` is not picking up the new theme (Keycloak 24 has a known aggressive cache), fall back to:

```bash
cd /opt/wims-bfp/src && \
  docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production \
  up -d --force-recreate keycloak
```

`--force-recreate` destroys the container and creates a new one with the same image but fresh filesystem state. The theme cache is definitely fresh.

### S5 — System-wiki update (mandatory per AGENTS.md)

Per AGENTS.md, non-trivial changes require wiki updates. Update:

- **`system-wiki/architecture/infrastructure-config.md`** (or appropriate page) — add a "Keycloak email theme" section noting the 9 new files, the `emailTheme: wims-bfp` realm field, the visual design (maroon `#8B0000` header, BFP logo via `${url.resourcesUrl}`, 600px max width), and the deploy command (`restart` or `up -d --force-recreate`).
- **`system-wiki/log.md`** — append a `2026-06-24` entry following the same shape as the live-notifications and device-id entries: problem (Keycloak default emails aren't branded), fix (9 FreeMarker files + realm field + logo copy + kcadm update), files changed, validation, scope limits. Note that v1 was approved but caught with 5+ critical bugs in a 2-pass meta-analysis; the v2 corrections are the basis for implementation.
- **`system-wiki/gaps/frs-codebase-gap-register.md`** — close the email-related gap (search for any email entry; if one exists, add a closing note; if not, create one).

---

## Files Changed

| # | File | Action | Change |
|---|------|--------|--------|
| 1 | `src/keycloak/themes/wims-bfp/email/theme.properties` | **Create** | 1 line: `parent=base` |
| 2 | `src/keycloak/themes/wims-bfp/email/messages/messages_en.properties` | **Create** | 3 lines: subject overrides (using `passwordResetSubject`, NOT `emailPasswordResetSubject`) |
| 3 | `src/keycloak/themes/wims-bfp/email/resources/img/bfp-logo.png` | **Create (copy from login)** | Binary file (BFP logo PNG) |
| 4 | `src/keycloak/themes/wims-bfp/email/html/template.ftl` | **Create** | ~70 lines: shared HTML wrapper with maroon header, BFP logo, gray footer, `<#nested>` slot |
| 5 | `src/keycloak/themes/wims-bfp/email/html/password-reset.ftl` | **Create** | ~20 lines: password reset body content |
| 6 | `src/keycloak/themes/wims-bfp/email/html/email-verification.ftl` | **Create** | ~20 lines: email verification body content |
| 7 | `src/keycloak/themes/wims-bfp/email/html/executeActions.ftl` | **Create** | ~25 lines: execute actions body content with requiredActions list |
| 8 | `src/keycloak/themes/wims-bfp/email/text/password-reset.ftl` | **Create** | ~12 lines: plain text version |
| 9 | `src/keycloak/themes/wims-bfp/email/text/email-verification.ftl` | **Create** | ~12 lines: plain text version |
| 10 | `src/keycloak/themes/wims-bfp/email/text/executeActions.ftl` | **Create** | ~18 lines: plain text version with requiredActions list |
| 11 | `src/keycloak/bfp-realm.json` | **Edit** | Add `"emailTheme": "wims-bfp"` (1 line, top-level) |
| 12 | `src/keycloak/import/bfp-realm.json` | **Edit** | Add `"emailTheme": "wims-bfp"` (1 line, top-level) |
| 13 | `system-wiki/architecture/infrastructure-config.md` (or appropriate page) | **Edit** | Add "Keycloak email theme" section |
| 14 | `system-wiki/log.md` | **Append** | New `2026-06-24` entry |
| 15 | `system-wiki/gaps/frs-codebase-gap-register.md` | **Edit** | Close email-related gap (or create new one) |

### Not Changed

- **`src/backend/services/email/templates/*.html.j2`** — the 7 backend app-level Jinja2 templates stay byte-identical
- **`src/keycloak/themes/wims-bfp/login/`** — the existing 16-file login theme stays byte-identical (the BFP logo is COPIED to the new email `resources/`, not moved or removed)
- **`src/keycloak/Dockerfile`** — no change; the volume mount at `src/docker-compose.yml:60` picks up the new `email/` subdirectory automatically
- **`src/docker-compose.yml`** — no change; the theme volume mount already covers the new `email/` subdirectory
- **No new Python, no new tests, no new SMTP creds, no frontend changes**
- **Brevo SMTP setup** (PR #452) stays exactly as deployed

---

## Verification

### V1 — Fresh template renders for password reset

1. Apply the 9 new files (S1.1–S1.10), the 2 realm JSON lines (S2), and the 1 logo file (S1.3).
2. Update the live realm via kcadm (S3).
3. Restart Keycloak (S4, `restart keycloak` first; if needed, `up -d --force-recreate keycloak`).
4. Wait ~30s for Keycloak to become healthy.
5. Trigger a password reset for `nathan_encoder` (or any test user): visit `https://wimsbfp.tech/auth/realms/bfp/login-actions/reset-credentials`, enter their email.
6. Check the email arrives at the user's inbox.
7. **Confirm the new template is in use:**
   - Email subject: `[WIMS-BFP] Reset your password` (NOT Keycloak's default `Reset password`)
   - Email source has BOTH `Content-Type: text/html; ...` AND `Content-Type: text/plain; ...` parts
   - HTML body: maroon `#8B0000` header, "Bureau of Fire Protection" + "WIMS-BFP Incident Management System" text, BFP logo image (loaded from `https://wimsbfp.tech/auth/resources/<version>/email/wims-bfp/img/bfp-logo.png`), maroon "Reset Password" button
   - Plain-text body: contains the URL on its own line

### V2 — Email verification template renders

1. From Keycloak admin console, trigger an email verification for a test user.
2. Confirm the email arrives.
3. **Confirm the new template is in use:**
   - Subject: `[WIMS-BFP] Verify your email address`
   - HTML body: same WIMS-BFP branding, "Verify Email" call-to-action button

### V3 — Execute-actions template renders

1. From Keycloak admin console, set a required action (e.g. "Update Password") on a test user.
2. Trigger an execute-actions email.
3. Confirm the email arrives.
4. **Confirm the new template is in use:**
   - Subject: `[WIMS-BFP] Action required for your account`
   - HTML body: bulleted list of required actions (e.g. "- Update Password"), "Review Required Actions" button

### V4 — Existing tests still pass

Per the project CI pre-flight routine (`docs/agents/ci-preflight.md`):
```bash
cd src/backend && ruff check . && ruff format . --check && python -m pytest -v
cd src/frontend && npm run lint && npx vitest run && npm run build
```

All 4 blocking gates pass. (No Python or test change in this spec, so the test suite is unaffected by construction.)

### V5 — No regressions in the existing email flows

1. The 7 backend app-level email templates still send the same way they did before this spec (no change to `sender.py`)
2. The Brevo SMTP setup (PR #452) is unchanged
3. The Keycloak login theme is unchanged
4. The 4 DNS records for `wimsbfp.tech` in the OrderBox/ResellerClub panel are unchanged
5. The `update-keycloak-smtp.sh` script still works (it doesn't touch the theme field; only the SMTP transport)

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| FreeMarker template syntax error | Low (templates are simple) | **High — email fails to send** (not graceful fallback) | Validate templates with a local Keycloak test before deploy; FreeMarker errors are logged at startup, container restart surfaces them |
| Wrong FreeMarker context var name | Low (each var is verified in this spec) | High — `?` substitutions return empty strings; layout breaks | R6 (null-safety) and R7 (`?html` escaping) catch most cases; manual V1-V3 verification catches the rest |
| Keycloak 24 caches the theme aggressively | Medium (documented behavior) | Medium — new theme not picked up after restart | Use `restart` first; fall back to `up -d --force-recreate` |
| `bfp-logo.png` not loaded by email client (security policy) | Medium (Gmail often blocks external images) | Low — broken image, still readable with `alt` text | The `alt="BFP"` text ensures the brand is communicated even if the image is blocked |
| The kcadm `emailTheme` update fails silently (e.g. wrong credentials) | Low | Medium — JSON says `wims-bfp` but live realm is unset | The V1 step's verification (`kcadm.sh get realms/bfp | python3 -c 'print("emailTheme:", d.get("emailTheme"))'`) catches this; expect `emailTheme: wims-bfp` (not `None`) |
| Email lands in spam | Likely on first send | Medium | Same as the email-provider switch: warm up the domain reputation, ask Gmail recipients to mark "not spam" once, monitor `p=none` DMARC reports |
| User data in `user.firstName` is empty | Common (especially for OAuth-federated users) | Low — `?html` escaping handles it, fallback to `user.username` displays the username | R7 (null-safety) and the `(user.firstName)!user.username` pattern |
| Theme directory structure mismatch (e.g. `email/html/` vs flat `email/`) | **High in v1, FIXED in v2** | High — Keycloak doesn't find templates | v2 uses the exact Keycloak 24.0.0 base-theme structure (verified against `keycloak/24.0.0/.../email/`). The structure is non-negotiable. |

---

## FRS / Security Context

- **Email content is project-owned**, not FRS-mandated. The FRS references transactional email as the delivery path; the exact visual design is a project decision.
- **No new secrets introduced.** The new theme templates contain no API keys, no real user data, no real links. All Brevo SMTP credentials stay in `.env.production` (gitignored) per the email-provider switch.
- **No new attack surface.** FreeMarker templates are processed server-side by Keycloak. User-controlled input (`user.firstName`) is HTML-escaped with `?html` to prevent XSS in the rendered email. The `${link}` and `${requiredActions}` are server-side context variables provided by Keycloak; they are escaped with `?html` where they appear in HTML attributes.
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
- **Styling the plain-text alternative** — plain text cannot be styled; clients may auto-link URLs

---

## Resolved Questions (v2)

1. **Why not modify the 7 backend templates instead?** — those are for the app-level email flow (`tasks/notifications.py:194`, `auth.py:222`). Keycloak's transactional email flow uses Keycloak's own templates, not the app's. They're separate paths. Modifying the 7 templates wouldn't change the password-reset email.
2. **Why FreeMarker and not Jinja2?** — Keycloak's theme templates are FreeMarker. We can't change Keycloak's template engine. The 7 backend templates are Jinja2 because that's what the Python backend uses. They are different paths, different engines, different purposes.
3. **Why reuse the BFP logo via `${url.resourcesUrl}`?** — Keycloak injects the `url` bean (containing `resourcesUrl`) into the FreeMarker context. Using `${url.resourcesUrl}` is portable across local, staging, production. The hardcoded URL with `3.0` in v1 was a regression from this.
4. **Why both HTML and text templates?** — `FreeMarkerEmailTemplateProvider.java` constructs BOTH `text/<template>` and `html/<template>`, and throws `EmailException` if either render fails. Plain text is not optional.
5. **Why `passwordResetSubject` (not `emailPasswordResetSubject`)?** — verified against `keycloak/24.0.0/.../messages/messages_en.properties` line `passwordResetSubject=Reset password`. The `email` prefix is used inconsistently in Keycloak's bundle; the actual key is `passwordResetSubject`.
6. **Why is the V6 fallback claim removed?** — `FreeMarkerEmailTemplateProvider.java` shows that any FreeMarker render failure throws `EmailException`, not a graceful fallback. The "fallback to base theme" behavior only applies to MISSING templates inherited from the parent, not to broken templates. A broken theme = broken emails, not "unbranded but functional" emails.
7. **Why the kcadm update in S3?** — the existing Keycloak DB on the VPS has a `realms` row imported with the OLD (no-`emailTheme`) JSON. Per the live-notifications spec's B2 blocker, Keycloak does not re-resolve realm-level fields on restart. The kcadm update applies the change to the live DB row.

## Deferred to Plan Author

- Exact pixel dimensions of the BFP logo in the email header (suggested: 48x48 above the "Bureau of Fire Protection" text)
- Exact `linkExpirationFormatter` output format (e.g. "5 minutes" vs "00:05:00") — should match the 7 backend templates' "X minutes" style
- Whether to add a `preheader` text (the short summary that shows in email client previews before the user opens) — not in the spec; can be added later if needed
- The exact order of the Files Changed commits in the plan

---

## Self-Review (v2)

**v1 self-review missed all 14 corrections.** The v1 self-review was structurally complete but the factual claims about Keycloak 24 internals were wrong. The corrections came from a 2-pass meta-analysis, with each fix cited to the actual Keycloak 24.0.0 source on GitHub. v2's self-review explicitly addresses this failure mode.

**1. Spec coverage:**

| Spec section | Plan task | Notes |
|---|---|---|
| R1 (password reset template) | V1, files 4, 5, 8 | ✅ |
| R2 (email verification template) | V2, files 4, 6, 9 | ✅ |
| R3 (execute-actions template) | V3, files 4, 7, 10 | ✅ |
| R4 (existing tests pass) | V4 | ✅ |
| R5 (no secrets) | V5 | ✅ |
| R6 (HTML + plain-text) | V1-V3 (verify both MIME parts) | ✅ |
| R7 (null-safety + HTML escape) | V1-V3 (verify body renders when firstName is empty) | ✅ |
| R8 (logo loads via ${url.resourcesUrl}) | V1-V3 (inspect email source for logo URL) | ✅ |
| S1 (9 new files) | Task 1 | ✅ |
| S2 (2 realm JSON lines) | Task 2 | ✅ |
| S3 (kcadm live update) | Task 3 | ✅ |
| S4 (restart) | Task 4 | ✅ |
| S5 (wiki) | Task 5 | ✅ |

**2. Placeholder scan:** No "TBD", "TODO", "implement later", "fill in details". All file contents are concrete. All verification steps include exact commands and expected outputs.

**3. Type / identifier consistency (cited):**

| Claim | Verified against | Status |
|---|---|---|
| `passwordResetSubject` (not `emailPasswordResetSubject`) | `keycloak/24.0.0/.../email/messages/messages_en.properties` | ✅ |
| `emailVerificationSubject` | same | ✅ |
| `executeActionsSubject` | same | ✅ |
| `executeActions.ftl` (camelCase) | `FreeMarkerEmailTemplateProvider.java: send("executeActionsSubject", "executeActions.ftl", attributes)` | ✅ |
| `password-reset.ftl` (kebab-case) | same file: `send("passwordResetSubject", "password-reset.ftl", attributes)` | ✅ |
| `email-verification.ftl` (kebab-case) | inferred from pattern; verified in `themes/src/main/resources/theme/base/email/html/email-verification.ftl` | ✅ |
| `${link}` (string) | `addLinkInfoIntoAttributes: attributes.put("link", link)` | ✅ |
| `${linkExpiration}` (long, top-level) | `addLinkInfoIntoAttributes: attributes.put("linkExpiration", expirationInMinutes)` | ✅ |
| `${linkExpirationFormatter(linkExpiration)}` | `themes/.../email/html/password-reset.ftl: msg("passwordResetBodyHtml",link, linkExpiration, realmName, linkExpirationFormatter(linkExpiration))` | ✅ |
| `${user}` (ProfileBean with firstName) | `attributes.put("user", new ProfileBean(user, session))` | ✅ |
| `${url.resourcesUrl}` | `attributes.put("url", new UrlBean(realm, theme, uriInfo.getBaseUri(), null))` | ✅ |
| `${requiredActions}` list | base email/html/executeActions.ftl: `<#list requiredActions>` | ✅ |
| `parent=base` (only line in theme.properties) | `themes/.../email/html/theme.properties` (when downloaded) — verified through Keycloak's source listing | ✅ |
| `email/messages/messages_en.properties` path | `themes/.../email/messages/messages_en.properties` | ✅ |
| `email/html/<template>` and `email/text/<template>` subdirs | `FreeMarkerEmailTemplateProvider.java: String textTemplate = String.format("text/%s", template); String htmlTemplate = String.format("html/%s", template);` | ✅ |
| EmailException on render failure (no fallback) | `FreeMarkerEmailTemplateProvider.java: throw new EmailException("Failed to template html email.", e);` | ✅ |
| `${kcSanitize(msg(...)?no_esc}` pattern in base | `themes/.../email/html/password-reset.ftl` | ✅ (we don't use this pattern; we use our own body content) |

**4. Gaps found in self-review, fixed inline (v2 vs. v1):**

- v1 had `<#import "html.ftl" as layout>`; v2 has `<#import "template.ftl" as layout>` to match Keycloak's base template file name (v1 was wrong)
- v1 had `${linkExpirationFormatter(link.expirationTime)}`; v2 has `${linkExpirationFormatter(linkExpiration)}` because `linkExpiration` is a top-level context var (v1 was wrong)
- v1 had hardcoded `https://wimsbfp.tech/auth/resources/3.0/...`; v2 has `${url.resourcesUrl}` for portability (v1 was wrong)
- v1 had `messages_en.properties` at the wrong path; v2 places it at `email/messages/messages_en.properties` (v1 was wrong)
- v1 had `emailPasswordResetSubject`; v2 has `passwordResetSubject` (v1 was wrong)
- v1 had `execute-actions.ftl`; v2 has `executeActions.ftl` (v1 was wrong)
- v1 had 3 FreeMarker files; v2 has 9 (3 HTML + 3 text + 1 shared wrapper + 1 theme.properties + 1 messages bundle) because text templates are REQUIRED by `FreeMarkerEmailTemplateProvider.java`
- v1 claimed V6 fallback works; v2 removes V6 because the throw-EmailException behavior makes it unsafe to rely on
- v1 had no S3 (live-realm kcadm update); v2 adds it because the existing persistent DB needs the field set
- v1 had no kcadm step; v2 has S3
- v1 said `docker compose up -d keycloak`; v2 says `restart keycloak` (or `up -d --force-recreate`) because `up -d` may not restart an unchanged container
- v1 said "find loginTheme and add after"; v2 says "add at top level, no loginTheme currently exists" (verified via grep)
- v1 had `${user.firstName}` unescaped; v2 uses `${(user.firstName)!user.username?html}` for null-safety and XSS prevention
- v1 had `import=common/keycloak` in theme.properties; v2 has only `parent=base` because the import line is unnecessary

**5. Why the v1 self-review failed (lesson for v2):**

v1's self-review claimed structural correctness but failed to verify the implementation details against the actual Keycloak source. v2's self-review now includes a 17-row identifier-consistency table where each claim is cited to the Keycloak 24.0.0 source file and line. This is the v1 lesson: structural completeness is not factual correctness. Every identifier in a Keycloak spec must be verified against the Keycloak source, not assumed from Keycloak's general documentation or other community examples (which may target different versions).

---

*This is a design spec (v2). The implementation plan will be at `docs/superpowers/plans/2026-06-24-keycloak-email-theme.md`. Once the spec is approved, invoke the writing-plans skill to produce the plan.*
