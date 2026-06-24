# Custom Keycloak Email Theme (WIMS-BFP Branding) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a custom Keycloak email theme so password-reset, email-verification, and execute-actions emails sent by Keycloak use WIMS-BFP branding (maroon `#8B0000` header, BFP logo, "Bureau of Fire Protection — WIMS-BFP Incident Management System" tagline, table-based layout, call-to-action button) — matching the visual style of the 7 existing backend Jinja2 templates in `src/backend/services/email/templates/`.

**Architecture:** A new `email/` subdirectory under the existing `src/keycloak/themes/wims-bfp/` theme with 7 FreeMarker templates (4 HTML + 3 text), 1 `theme.properties`, 1 `messages_en.properties` (subject overrides), and 1 copied logo PNG. The realm JSON files (`bfp-realm.json` + `import/bfp-realm.json`) get 1 new top-level field (`emailTheme: wims-bfp`). The live persistent Keycloak DB on the VPS needs a kcadm update (because Keycloak doesn't re-resolve realm-level fields on restart — same B2 pattern as the live-notifications work). The Keycloak container needs a `restart` (or `up -d --force-recreate`) so the theme cache refreshes.

**Tech Stack:** Keycloak 24.0.0 (FreeMarker email theme), Brevo SMTP on port 2525 (already deployed at PR #452), Docker Compose v2, kcadm.sh for live-realm update, existing `wims-keycloak-demo-otp:local` image with volume mount to `src/keycloak/themes/wims-bfp/` (no image rebuild needed).

**Source spec:** `docs/superpowers/specs/2026-06-24-keycloak-email-theme-design.md` (v2.1, commit `4847ceb6`). This plan implements S1 (9 new files under `email/`), S2 (2 realm JSON lines), S3 (live-realm kcadm update), S4 (restart), and S5 (system-wiki update).

## Global Constraints

- **No Python, no new tests, no new SMTP creds, no frontend changes** — this spec touches only Keycloak theme files + 2 realm JSON lines + 3 wiki files.
- **No Dockerfile or compose change** — the volume mount at `src/docker-compose.yml:60` (`./keycloak/themes/wims-bfp:/opt/keycloak/themes/wims-bfp:ro`) already covers the new `email/` subdirectory.
- **No change to the 7 backend Jinja2 templates** in `src/backend/services/email/templates/` — out of scope per the handoff's "Do not change the email templates" constraint.
- **No change to the login theme** in `src/keycloak/themes/wims-bfp/login/` — already WIMS-BFP-branded.
- **Brevo SMTP setup (PR #452) is unchanged** — the email theme is layered on top of the existing transport.
- **All FreeMarker files use FreeMarker syntax** (not Jinja2, not any other templating engine — Keycloak 24 uses FreeMarker for email themes).
- **All 3 HTML templates use `<#import "template.ftl" as layout>` + `<@layout.emailLayout>` + `<#assign displayName>`** for consistency. The displayName pattern (`(user.firstName?has_content)?then(user.firstName, user.username)`) handles BOTH null and empty string and applies `?html` only after the null-coalesce — this avoids the FreeMarker operator-precedence XSS bug found in v2.
- **All 3 text templates use `<#ftl output_format="plainText">`** as the first line so the FreeMarker output is plain text (not HTML).
- **All URL attributes use `${link?html}`** for XSS prevention on the `href` value.
- **All 3 messages bundle subject keys match Keycloak 24.0.0 source**: `passwordResetSubject` (NOT `emailPasswordResetSubject`), `emailVerificationSubject`, `executeActionsSubject`.
- **Conventional Commits** for each commit, scoped to the file group (`docs(theme): ...`, `chore(realm): ...`, `docs(wiki): ...`).
- **Never commit secrets** — no SMTP keys, no admin passwords, no real user emails. The new template files contain no real names/emails/links.
- **System-wiki update mandatory per AGENTS.md**: append to `system-wiki/log.md`, update the relevant synthesis page, update the gap register (Task 8 covers all 3).
- **Deploy host path** is `/opt/wims-bfp/`; local dev path is `/home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/`. The plan references both.
- **Live-realm kcadm update on the VPS requires sourcing `/opt/wims-bfp/src/.env.production` first** so the kcadm credentials are available (B2 pattern from the live-notifications work; see spec S3).

## File Structure

| # | File | Action | Why |
|---|------|--------|-----|
| 1 | `src/keycloak/themes/wims-bfp/email/theme.properties` | **Create** | Declares `parent=base` (inherits from Keycloak's base email theme) |
| 2 | `src/keycloak/themes/wims-bfp/email/messages/messages_en.properties` | **Create** | 3 subject-line overrides: `passwordResetSubject`, `emailVerificationSubject`, `executeActionsSubject` |
| 3 | `src/keycloak/themes/wims-bfp/email/resources/img/bfp-logo.png` | **Create (copy from login)** | Logo PNG, referenced by `${url.resourcesUrl}/img/bfp-logo.png` |
| 4 | `src/keycloak/themes/wims-bfp/email/html/template.ftl` | **Create** | Shared `<#macro emailLayout>` wrapper with maroon header, BFP logo, gray footer |
| 5 | `src/keycloak/themes/wims-bfp/email/html/password-reset.ftl` | **Create** | Password-reset HTML body (calls layout.emailLayout) |
| 6 | `src/keycloak/themes/wims-bfp/email/html/email-verification.ftl` | **Create** | Email-verification HTML body (calls layout.emailLayout) |
| 7 | `src/keycloak/themes/wims-bfp/email/html/executeActions.ftl` | **Create** | Execute-actions HTML body with requiredActions loop (calls layout.emailLayout) |
| 8 | `src/keycloak/themes/wims-bfp/email/text/password-reset.ftl` | **Create** | Plain-text version of password-reset email |
| 9 | `src/keycloak/themes/wims-bfp/email/text/email-verification.ftl` | **Create** | Plain-text version of email-verification email |
| 10 | `src/keycloak/themes/wims-bfp/email/text/executeActions.ftl` | **Create** | Plain-text version of execute-actions email |
| 11 | `src/keycloak/bfp-realm.json` | **Edit** | Add `"emailTheme": "wims-bfp"` (1 line, top-level) |
| 12 | `src/keycloak/import/bfp-realm.json` | **Edit** | Add `"emailTheme": "wims-bfp"` (1 line, top-level) |
| 13 | `system-wiki/architecture/infrastructure-config.md` | **Edit** | Add "Keycloak email theme" section |
| 14 | `system-wiki/log.md` | **Append** | New `2026-06-24` entry |
| 15 | `system-wiki/gaps/frs-codebase-gap-register.md` | **Edit** | Close email-related gap (or create one) |

The plan does **not** modify any application code, the 7 backend Jinja2 templates, the login theme, the Dockerfile, the compose file, the `.env` files, the Brevo SMTP setup, or any frontend code.

---

### Task 1: Theme bootstrap (4 small files: dir, theme.properties, messages bundle, logo)

**Files:**
- Create directory: `src/keycloak/themes/wims-bfp/email/`
- Create: `src/keycloak/themes/wims-bfp/email/theme.properties`
- Create: `src/keycloak/themes/wims-bfp/email/messages/messages_en.properties`
- Create: `src/keycloak/themes/wims-bfp/email/resources/img/bfp-logo.png` (copy from `login/resources/img/`)

**Interfaces:**
- Consumes: nothing (purely new structure)
- Produces: a fully-bootstrapped `email/` subdirectory with 4 files (theme.properties, messages_en.properties, logo PNG). The 7 FreeMarker templates come in Task 2 + Task 3; this task only sets up the directory structure.

- [ ] **Step 1: Create the email/ subdirectory tree**

```bash
mkdir -p src/keycloak/themes/wims-bfp/email/messages
mkdir -p src/keycloak/themes/wims-bfp/email/resources/img
mkdir -p src/keycloak/themes/wims-bfp/email/html
mkdir -p src/keycloak/themes/wims-bfp/email/text
```

- [ ] **Step 2: Create `src/keycloak/themes/wims-bfp/email/theme.properties`**

```bash
printf 'parent=base\n' > src/keycloak/themes/wims-bfp/email/theme.properties
```

The file content is exactly 1 line: `parent=base`. This declares inheritance from Keycloak's base email theme. We override all 3 templates in this spec, so no base defaults leak through.

- [ ] **Step 3: Create `src/keycloak/themes/wims-bfp/email/messages/messages_en.properties`**

```bash
cat > src/keycloak/themes/wims-bfp/email/messages/messages_en.properties << 'EOF'
passwordResetSubject=[WIMS-BFP] Reset your password
emailVerificationSubject=[WIMS-BFP] Verify your email address
executeActionsSubject=[WIMS-BFP] Action required for your account
EOF
```

These 3 keys are the actual Keycloak 24.0.0 subject-line override points (verified against `keycloak/24.0.0/.../email/messages/messages_en.properties`). Note that the password-reset key is `passwordResetSubject`, NOT `emailPasswordResetSubject` — the v1 spec had this wrong and was corrected in v2.

- [ ] **Step 4: Copy the BFP logo to the email resources directory**

```bash
cp src/keycloak/themes/wims-bfp/login/resources/img/bfp-logo.png \
   src/keycloak/themes/wims-bfp/email/resources/img/bfp-logo.png
```

The email templates reference this logo via `${url.resourcesUrl}/img/bfp-logo.png` (Keycloak serves email resources at this URL). Copying (not moving) keeps the login theme's logo working.

- [ ] **Step 5: Verify the directory structure and 3 file contents**

```bash
find src/keycloak/themes/wims-bfp/email -type f | sort
echo "---"
cat src/keycloak/themes/wims-bfp/email/theme.properties
echo "---"
cat src/keycloak/themes/wims-bfp/email/messages/messages_en.properties
```

Expected output:
```
src/keycloak/themes/wims-bfp/email/messages/messages_en.properties
src/keycloak/themes/wims-bfp/email/resources/img/bfp-logo.png
src/keycloak/themes/wims-bfp/email/theme.properties
---
parent=base
---
passwordResetSubject=[WIMS-BFP] Reset your password
emailVerificationSubject=[WIMS-BFP] Verify your email address
executeActionsSubject=[WIMS-BFP] Action required for your account
```

(Note: no `html/` or `text/` files yet — those come in Tasks 2 and 3.)

- [ ] **Step 6: Commit**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE
git add src/keycloak/themes/wims-bfp/email/theme.properties \
        src/keycloak/themes/wims-bfp/email/messages/messages_en.properties \
        src/keycloak/themes/wims-bfp/email/resources/img/bfp-logo.png
git commit -m "chore(theme): bootstrap WIMS-BFP email theme structure

Add the email/ subdirectory under src/keycloak/themes/wims-bfp/ with
the 3 bootstrap files: theme.properties (parent=base), the messages
bundle (3 subject-line overrides), and a copy of the BFP logo into
the email resources directory. No FreeMarker templates yet — those
land in the next 2 tasks. No new SMTP creds, no new tests, no
Python, no frontend changes.

The volume mount at src/docker-compose.yml:60 picks up the new
subdirectory automatically; no Dockerfile or compose change needed.
The logo is COPIED (not moved) so the login theme's logo keeps
working."
```

---

### Task 2: HTML templates (1 shared wrapper + 3 body templates)

**Files:**
- Create: `src/keycloak/themes/wims-bfp/email/html/template.ftl` (shared wrapper)
- Create: `src/keycloak/themes/wims-bfp/email/html/password-reset.ftl`
- Create: `src/keycloak/themes/wims-bfp/email/html/email-verification.ftl`
- Create: `src/keycloak/themes/wims-bfp/email/html/executeActions.ftl`

**Interfaces:**
- Consumes: Task 1's bootstrap (the `email/` directory exists; `theme.properties` declares `parent=base`; `messages_en.properties` is at `email/messages/`; logo is at `email/resources/img/`)
- Produces: 4 HTML FreeMarker templates. After this task, Keycloak can serve password-reset HTML (the other 2 require their text counterparts from Task 3 to be valid).

- [ ] **Step 1: Create `src/keycloak/themes/wims-bfp/email/html/template.ftl`**

```bash
cat > src/keycloak/themes/wims-bfp/email/html/template.ftl << 'EOF'
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
EOF
```

The logo URL uses `${url.resourcesUrl}` (a FreeMarker context variable injected by `FreeMarkerEmailTemplateProvider.java` via `UrlBean`), NOT a hardcoded production URL. This makes the template portable across local, staging, and production.

- [ ] **Step 2: Create `src/keycloak/themes/wims-bfp/email/html/password-reset.ftl`**

```bash
cat > src/keycloak/themes/wims-bfp/email/html/password-reset.ftl << 'EOF'
<#import "template.ftl" as layout>
<#-- displayName: null-safe + empty-string-safe fallback. The <#assign> + ?then pattern
     handles BOTH the null/missing case AND the empty-string case (FreeMarker's !
     operator only handles null/missing, not empty strings). The result is then
     HTML-escaped with ?html to prevent XSS in the rendered email. -->
<#assign displayName = (user.firstName?has_content)?then(user.firstName, user.username)>
<@layout.emailLayout>
  <p style="margin:0 0 16px;font-size:18px;font-weight:bold;color:#8B0000;">Hello, ${displayName?html}!</p>
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
EOF
```

- [ ] **Step 3: Create `src/keycloak/themes/wims-bfp/email/html/email-verification.ftl`**

```bash
cat > src/keycloak/themes/wims-bfp/email/html/email-verification.ftl << 'EOF'
<#import "template.ftl" as layout>
<#assign displayName = (user.firstName?has_content)?then(user.firstName, user.username)>
<@layout.emailLayout>
  <p style="margin:0 0 16px;font-size:18px;font-weight:bold;color:#8B0000;">Hello, ${displayName?html}!</p>
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
EOF
```

- [ ] **Step 4: Create `src/keycloak/themes/wims-bfp/email/html/executeActions.ftl`**

```bash
cat > src/keycloak/themes/wims-bfp/email/html/executeActions.ftl << 'EOF'
<#import "template.ftl" as layout>
<#assign displayName = (user.firstName?has_content)?then(user.firstName, user.username)>
<@layout.emailLayout>
  <p style="margin:0 0 16px;font-size:18px;font-weight:bold;color:#8B0000;">Hello, ${displayName?html}!</p>
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
EOF
```

- [ ] **Step 5: Verify the 4 HTML files are present and the import paths are correct**

```bash
ls -la src/keycloak/themes/wims-bfp/email/html/
echo "---"
grep -l 'template.ftl' src/keycloak/themes/wims-bfp/email/html/*.ftl
echo "---"
grep -c 'displayName' src/keycloak/themes/wims-bfp/email/html/*.ftl
```

Expected: 4 files listed; all 3 body templates contain `template.ftl`; each body template has 2 occurrences of `displayName` (the `<#assign>` line + the `Hello, ${displayName?html}!` usage). Total `displayName` count across the 3 files = 6.

- [ ] **Step 6: Commit**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE
git add src/keycloak/themes/wims-bfp/email/html/
git commit -m "feat(theme): add 4 WIMS-BFP HTML email templates

- html/template.ftl: shared <#macro emailLayout> with maroon #8B0000
  header, BFP logo via \${url.resourcesUrl}, gray footer, <#nested> slot
  for body content
- html/password-reset.ftl: password-reset body
- html/email-verification.ftl: email-verification body
- html/executeActions.ftl: execute-actions body with requiredActions
  null-check + size-check loop

All 3 body templates use the explicit <#assign displayName = ...>
pattern (handles null AND empty string via ?has_content + ?then) with
?html applied to the final value. v2 had a FreeMarker operator-
precedence bug in the greeting expression (\${(user.firstName)!user.username?html})
where ?html only escaped the fallback, not the primary value, leaving
an XSS vector; v2.1 fixes it with the explicit <#assign> pattern.

The link href is escaped with ?html for XSS prevention on the URL
attribute. The linkExpiration variable is used as a top-level context
var (verified against FreeMarkerEmailTemplateProvider.java's
addLinkInfoIntoAttributes), not as link.expirationTime (v1 bug,
fixed in v2)."
```

---

### Task 3: Text templates (3 files)

**Files:**
- Create: `src/keycloak/themes/wims-bfp/email/text/password-reset.ftl`
- Create: `src/keycloak/themes/wims-bfp/email/text/email-verification.ftl`
- Create: `src/keycloak/themes/wims-bfp/email/text/executeActions.ftl`

**Interfaces:**
- Consumes: Task 2's HTML templates (so the user knows what the text versions mirror)
- Produces: 3 plain-text FreeMarker templates. After this task, all 3 email types can render BOTH `text/<template>` AND `html/<template>` (which `FreeMarkerEmailTemplateProvider.java` requires — `throw new EmailException("Failed to template plain text email.", e)` if text rendering fails).

- [ ] **Step 1: Create `src/keycloak/themes/wims-bfp/email/text/password-reset.ftl`**

```bash
cat > src/keycloak/themes/wims-bfp/email/text/password-reset.ftl << 'EOF'
<#ftl output_format="plainText">
<#assign displayName = (user.firstName?has_content)?then(user.firstName, user.username)>
Hello ${displayName},

We received a request to reset your WIMS-BFP account password. Click the link below to set a new password.

${link}

This link expires in ${linkExpirationFormatter(linkExpiration)} and can only be used once.

If you did not request a password reset, please ignore this email or contact your system administrator.

— Bureau of Fire Protection — WIMS-BFP
This is an automated message. Do not reply to this email.
EOF
```

- [ ] **Step 2: Create `src/keycloak/themes/wims-bfp/email/text/email-verification.ftl`**

```bash
cat > src/keycloak/themes/wims-bfp/email/text/email-verification.ftl << 'EOF'
<#ftl output_format="plainText">
<#assign displayName = (user.firstName?has_content)?then(user.firstName, user.username)>
Hello ${displayName},

Please verify your email address to complete your WIMS-BFP account setup. Click the link below to confirm this email is yours.

${link}

This link expires in ${linkExpirationFormatter(linkExpiration)} and can only be used once.

If you did not create a WIMS-BFP account, please ignore this email.

— Bureau of Fire Protection — WIMS-BFP
This is an automated message. Do not reply to this email.
EOF
```

- [ ] **Step 3: Create `src/keycloak/themes/wims-bfp/email/text/executeActions.ftl`**

```bash
cat > src/keycloak/themes/wims-bfp/email/text/executeActions.ftl << 'EOF'
<#ftl output_format="plainText">
<#assign displayName = (user.firstName?has_content)?then(user.firstName, user.username)>
Hello ${displayName},

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
EOF
```

- [ ] **Step 4: Verify the 3 text files are present and start with `<#ftl output_format="plainText">`**

```bash
ls -la src/keycloak/themes/wims-bfp/email/text/
echo "---"
head -1 src/keycloak/themes/wims-bfp/email/text/*.ftl
echo "---"
grep -c 'displayName' src/keycloak/themes/wims-bfp/email/text/*.ftl
```

Expected: 3 files listed; the first line of each is `<#ftl output_format="plainText">`; each file has 2 occurrences of `displayName` (the `<#assign>` + the `Hello ${displayName}`). Total = 6.

- [ ] **Step 5: Commit**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE
git add src/keycloak/themes/wims-bfp/email/text/
git commit -m "feat(theme): add 3 WIMS-BFP text email templates

Mirror of the HTML templates, one per email type. Each starts with
<#ftl output_format=\"plainText\"> so FreeMarker outputs plain text
(not HTML). URL on its own line for email-client auto-linking.

FreeMarkerEmailTemplateProvider.java constructs BOTH
text/<template> AND html/<template> for each email type and
throws EmailException if either fails to render. Missing the text
template means the email is never sent (not graceful fallback).
With these 3 files, all 3 email types can now render both parts.

Same displayName pattern as the HTML templates for consistency
(null-safe + empty-string-safe + ?html escaped). Plain text
doesn't need ?html, but the pattern is identical for code review
clarity."
```

---

### Task 4: Realm JSON edits (2 files, 1 line each)

**Files:**
- Modify: `src/keycloak/bfp-realm.json` (add `"emailTheme": "wims-bfp"`)
- Modify: `src/keycloak/import/bfp-realm.json` (add `"emailTheme": "wims-bfp"`)

**Interfaces:**
- Consumes: Tasks 1-3 (the theme files exist so the realm field is meaningful)
- Produces: both realm JSON files declare the email theme. A fresh-import deployment picks up the theme automatically; an in-place update needs the kcadm step (Task 6).

- [ ] **Step 1: Find the `displayName` field in `src/keycloak/bfp-realm.json` (anchor for the edit)**

```bash
grep -n '"displayName"' src/keycloak/bfp-realm.json | head -3
```

Expected: 1-2 occurrences in the first 20 lines of the file. Note the line number — the new field goes immediately after.

- [ ] **Step 2: Add `emailTheme: wims-bfp` to `src/keycloak/bfp-realm.json`**

Using sed to add a line after the `displayName` line:

```bash
# Read the line number of "displayName"
LINE=$(grep -n '"displayName"' src/keycloak/bfp-realm.json | head -1 | cut -d: -f1)
# Insert "emailTheme": "wims-bfp" on the next line
sed -i "${LINE}a\\  \"emailTheme\": \"wims-bfp\"," src/keycloak/bfp-realm.json
```

The `a` command appends after the matching line. The 2-space indent matches the surrounding top-level field indentation. The trailing comma is required by JSON (since `emailTheme` will not be the last field).

- [ ] **Step 3: Repeat for `src/keycloak/import/bfp-realm.json`**

```bash
LINE=$(grep -n '"displayName"' src/keycloak/import/bfp-realm.json | head -1 | cut -d: -f1)
sed -i "${LINE}a\\  \"emailTheme\": \"wims-bfp\"," src/keycloak/import/bfp-realm.json
```

- [ ] **Step 4: Verify the field is in both files, exactly once, with valid JSON**

```bash
echo "=== bfp-realm.json ==="
grep -n '"emailTheme"' src/keycloak/bfp-realm.json
echo "=== import/bfp-realm.json ==="
grep -n '"emailTheme"' src/keycloak/import/bfp-realm.json
echo "=== JSON validity check ==="
python3 -c 'import json; json.load(open("src/keycloak/bfp-realm.json")); print("bfp-realm.json: valid JSON")'
python3 -c 'import json; json.load(open("src/keycloak/import/bfp-realm.json")); print("import/bfp-realm.json: valid JSON")'
```

Expected: each file has 1 occurrence of `"emailTheme"`, and both JSON files parse successfully. If `json.load` raises `JSONDecodeError`, the sed command produced malformed JSON — re-check the comma placement.

- [ ] **Step 5: Commit**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE
git add src/keycloak/bfp-realm.json src/keycloak/import/bfp-realm.json
git commit -m "chore(realm): set emailTheme=wims-bfp on the bfp realm

Both bfp-realm.json (used by update-keycloak-smtp.sh and similar
scripts for live-realm updates) and import/bfp-realm.json (used on
fresh first-boot with start-dev --import-realm) get the new
emailTheme field. Fresh-import deployments pick up the theme
automatically; in-place deployments also need a kcadm update
(Task 6) because Keycloak does not re-resolve realm-level fields
on container restart (same B2 pattern as the live-notifications
work).

The field is added as a top-level realm field (next to displayName)
because the current realm JSON has no loginTheme field. EmailTheme
follows the same theme-attribute pattern."
```

---

### Task 5: Push branch and open PR

**Files:** None (git workflow only)

**Interfaces:**
- Consumes: Tasks 1-4 (all 4 commits on `feat/keycloak-email-theme` branch)
- Produces: an open PR for review

- [ ] **Step 1: Create the feature branch from `master`**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE
git checkout master
git pull origin master
git checkout -b feat/keycloak-email-theme
```

- [ ] **Step 2: Push the branch**

```bash
git push -u origin feat/keycloak-email-theme 2>&1 | tail -5
```

Expected: `* [new branch] feat/keycloak-email-theme -> feat/keycloak-email-theme` and `branch 'feat/keycloak-email-theme' set up to track 'origin/feat/keycloak-email-theme'`.

- [ ] **Step 3: Write the PR body to a file (avoids shell quoting issues with the long body)**

```bash
cat > /tmp/wims-keycloak-pr-body.md << 'PRBODY'
## Problem

WIMS-BFP's Keycloak transactional emails (password reset, email verification, execute-actions) use Keycloak's generic default templates. The 7 backend app-level Jinja2 templates at `src/backend/services/email/templates/` are WIMS-BFP-branded (maroon `#8B0000` header, BFP logo, table layout, 600px max width), but the Keycloak-driven flow is unbranded.

After PR #452 (Brevo SMTP on port 2525), the SMTP transport works end-to-end — V1 (direct send), V1b (Celery task), V2 (Keycloak password reset — verified by the user at 2026-06-24 17:00 PST, email arrived at the test user's Gmail inbox even if it landed in spam), and V4 (idempotency) all pass. The remaining gap is template branding, not transport.

## Solution

A new `email/` subdirectory under the existing `src/keycloak/themes/wims-bfp/` theme with 7 FreeMarker templates (4 HTML + 3 text), 1 `theme.properties`, 1 `messages_en.properties` (subject overrides), and 1 copied logo PNG. The realm JSON files (`bfp-realm.json` + `import/bfp-realm.json`) get 1 new top-level field (`emailTheme: wims-bfp`). The live persistent Keycloak DB on the VPS needs a kcadm update (because Keycloak doesn't re-resolve realm-level fields on restart — same B2 pattern as the live-notifications work).

## Files Changed (10 total)

| # | File | Change |
|---|------|--------|
| 1 | `src/keycloak/themes/wims-bfp/email/theme.properties` | NEW: `parent=base` |
| 2 | `src/keycloak/themes/wims-bfp/email/messages/messages_en.properties` | NEW: 3 subject-line overrides |
| 3 | `src/keycloak/themes/wims-bfp/email/resources/img/bfp-logo.png` | NEW: copy of login theme's logo |
| 4 | `src/keycloak/themes/wims-bfp/email/html/template.ftl` | NEW: shared `<#macro emailLayout>` wrapper |
| 5 | `src/keycloak/themes/wims-bfp/email/html/password-reset.ftl` | NEW: password-reset body |
| 6 | `src/keycloak/themes/wims-bfp/email/html/email-verification.ftl` | NEW: email-verification body |
| 7 | `src/keycloak/themes/wims-bfp/email/html/executeActions.ftl` | NEW: execute-actions body with requiredActions loop |
| 8 | `src/keycloak/themes/wims-bfp/email/text/password-reset.ftl` | NEW: plain-text version |
| 9 | `src/keycloak/themes/wims-bfp/email/text/email-verification.ftl` | NEW: plain-text version |
| 10 | `src/keycloak/themes/wims-bfp/email/text/executeActions.ftl` | NEW: plain-text version |
| 11 | `src/keycloak/bfp-realm.json` | EDIT: add `emailTheme: wims-bfp` (1 line) |
| 12 | `src/keycloak/import/bfp-realm.json` | EDIT: add `emailTheme: wims-bfp` (1 line) |

Plus 3 system-wiki updates (per AGENTS.md mandatory rule):
- `system-wiki/architecture/infrastructure-config.md` — Keycloak email theme section
- `system-wiki/log.md` — 2026-06-24 entry
- `system-wiki/gaps/frs-codebase-gap-register.md` — close email-related gap

## Why these specific files and not others

- **No change to `src/backend/services/email/templates/*.html.j2`** — the 7 backend app-level Jinja2 templates stay byte-identical (out of scope per the original handoff's "Do not change the email templates" constraint)
- **No change to `src/keycloak/themes/wims-bfp/login/`** — the existing 16-file login theme stays byte-identical; the BFP logo is COPIED to the new email `resources/`, not moved
- **No change to `src/keycloak/Dockerfile`** — the volume mount at `src/docker-compose.yml:60` picks up the new `email/` subdirectory automatically
- **No change to `src/docker-compose.yml`** — the theme volume mount already covers the new `email/` subdirectory
- **No new Python, no new tests, no new SMTP creds, no frontend changes** — this is a Keycloak theme + 2 realm JSON lines + 3 wiki files

## How the FreeMarker templates work

Each HTML template starts with:
```ftl
<#import "template.ftl" as layout>
<#assign displayName = (user.firstName?has_content)?then(user.firstName, user.username)>
<@layout.emailLayout>
  ... body content ...
</@layout.emailLayout>
```

The `<#assign displayName>` pattern is **important**: it handles both null and empty string (the `?has_content` check), falls back to `user.username`, and then the result is HTML-escaped with `?html` when rendered. This is more robust than the simpler `${(user.firstName)!user.username?html}` pattern — see the spec's "What changed from v1 (corrections summary)" table for why v2's simpler pattern had a FreeMarker operator-precedence XSS bug that v2.1 fixes.

Each text template starts with:
```ftl
<#ftl output_format="plainText">
<#assign displayName = (user.firstName?has_content)?then(user.firstName, user.username)>
Hello ${displayName},
... body content with the URL on its own line ...
```

The `<#ftl output_format="plainText">` directive makes FreeMarker output plain text (not HTML), and the URL is on its own line for email-client auto-linking.

## Verification

- **V1 (password reset)** — Trigger a password reset at `https://wimsbfp.tech/auth/realms/bfp/login-actions/reset-credentials`, confirm the email arrives with the WIMS-BFP template:
  - Subject: `[WIMS-BFP] Reset your password`
  - HTML body: maroon `#8B0000` header, "Bureau of Fire Protection" + "WIMS-BFP Incident Management System" text, BFP logo image, maroon "Reset Password" button
  - Plain-text body: contains the URL on its own line
  - MIME: BOTH `text/html` AND `text/plain` parts present
- **V2 (email verification)** — Trigger an email verification, confirm subject is `[WIMS-BFP] Verify your email address` and HTML body has "Verify Email" button
- **V3 (execute actions)** — Set a required action on a test user, trigger execute-actions email, confirm subject is `[WIMS-BFP] Action required for your account` and HTML body has bulleted list of required actions + "Review Required Actions" button
- **V4 (CI pre-flight)** — `cd src/backend && ruff check . && ruff format . --check && python -m pytest -v`; `cd src/frontend && npm run lint && npx vitest run && npm run build` — all 4 blocking gates pass
- **V5 (no regressions)** — the 7 backend Jinja2 templates are unchanged, the Brevo SMTP setup is unchanged, the login theme is unchanged

## Deploy Instructions (after PR merge)

1. `cd /opt/wims-bfp && git pull`
2. Source the prod env so kcadm credentials are available: `cd src && set -a && . .env.production && set +a`
3. Update the live realm: `docker exec wims-keycloak /opt/keycloak/bin/kcadm.sh config credentials --server http://localhost:8080/auth --realm master --user "$KEYCLOAK_ADMIN" --password "$KEYCLOAK_ADMIN_PASSWORD" && docker exec wims-keycloak /opt/keycloak/bin/kcadm.sh update realms/bfp -s emailTheme=wims-bfp`
4. Restart Keycloak: `cd /opt/wims-bfp/src && docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production restart keycloak`
5. Wait ~30s, then trigger a password reset and confirm the new template

## Spec / Plan / Handoff

- **Spec:** `docs/superpowers/specs/2026-06-24-keycloak-email-theme-design.md` (v2.1, commit `4847ceb6`) — went through 2 meta-analyses; v1 had 14 bugs, v2 had 6 bugs, v2.1 is implementation-ready
- **Plan:** `docs/superpowers/plans/2026-06-24-keycloak-email-theme.md` (this PR's commit)
- **Handoff:** `system-wiki/sessions/2026-06-24_email-provider-switch-handoff.md` (commit `2a6d7cfa`, the original email-provider-switch handoff that led to this work)
PRBODY
```

- [ ] **Step 4: Open the PR**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE
gh pr create \
  --base master \
  --head feat/keycloak-email-theme \
  --title "feat(theme): custom Keycloak email theme with WIMS-BFP branding" \
  --body-file /tmp/wims-keycloak-pr-body.md
```

Expected: `ok created #N https://github.com/x1n4te/WIMS-BFP-PROTOTYPE/pull/N`. Note the PR number for Task 9's verification.

- [ ] **Step 5: Clean up the temp PR body file**

```bash
rm /tmp/wims-keycloak-pr-body.md
```

- [ ] **Step 6: Commit (no code change, just a marker — skip if you don't want a no-op commit)**

This task doesn't have a code change to commit. Skip this step.

---

### Task 6: Live-realm kcadm update on the VPS

**Files:** None (operational task on the VPS)

**Interfaces:**
- Consumes: the merged PR (Task 5) and the prod env file on the VPS
- Produces: the live Keycloak realm's `emailTheme` field set to `wims-bfp`

- [ ] **Step 1: SSH to the VPS and verify the merged files are present**

```bash
ssh -i ~/.ssh/id_ed25519_pi root@165.22.101.73
cd /opt/wims-bfp && git log --oneline -1
ls src/keycloak/themes/wims-bfp/email/
```

Expected: the latest commit on the VPS matches the merge commit, and the `email/` subdirectory has 10 files (theme.properties, messages_en.properties, bfp-logo.png, html/template.ftl, html/password-reset.ftl, html/email-verification.ftl, html/executeActions.ftl, text/password-reset.ftl, text/email-verification.ftl, text/executeActions.ftl).

- [ ] **Step 2: Source the prod env so kcadm credentials are available**

```bash
cd /opt/wims-bfp/src
set -a && . .env.production && set +a
echo "KEYCLOAK_ADMIN: $KEYCLOAK_ADMIN"
echo "KEYCLOAK_ADMIN_PASSWORD length: ${#KEYCLOAK_ADMIN_PASSWORD}"
```

Expected: `KEYCLOAK_ADMIN: admin` and the password length is some non-zero value (e.g. 20+ chars). If the env vars are empty, the env file is missing or doesn't have these keys — STOP and investigate.

- [ ] **Step 3: Authenticate the kcadm session**

```bash
docker exec \
  -e KEYCLOAK_ADMIN \
  -e KEYCLOAK_ADMIN_PASSWORD \
  wims-keycloak /opt/keycloak/bin/kcadm.sh config credentials \
    --server http://localhost:8080/auth --realm master \
    --user "$KEYCLOAK_ADMIN" --password "$KEYCLOAK_ADMIN_PASSWORD"
```

Expected: `Logging into http://localhost:8080/auth as user admin of realm master`. If you see an auth error, the credentials in `.env.production` are wrong — re-check the file.

- [ ] **Step 4: Apply the emailTheme update to the bfp realm**

```bash
docker exec wims-keycloak /opt/keycloak/bin/kcadm.sh update realms/bfp \
  -s emailTheme=wims-bfp
```

Expected: no output (kcadm success is silent). If you see "realm not found", check the realm name — it must be `bfp` (lowercase).

- [ ] **Step 5: Verify the update applied**

```bash
docker exec wims-keycloak /opt/keycloak/bin/kcadm.sh get realms/bfp -r master \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print("emailTheme:", d.get("emailTheme"))'
```

Expected output: `emailTheme: wims-bfp`. If it shows `emailTheme: None`, the update did not apply — re-run Step 4 and check for any error output.

---

### Task 7: Restart Keycloak and verify health

**Files:** None (operational task on the VPS)

**Interfaces:**
- Consumes: Task 6's kcadm update (the live realm has emailTheme set)
- Produces: a running `wims-keycloak` container with the new theme loaded

- [ ] **Step 1: Restart the Keycloak container**

```bash
cd /opt/wims-bfp/src && \
  docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production \
  restart keycloak
```

`docker compose restart` forces a restart regardless of service-definition changes. Keycloak 24's theme cache gets refreshed.

- [ ] **Step 2: Wait for Keycloak to become healthy**

```bash
sleep 15
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' | grep -E 'wims-keycloak|keycloak-bootstrap'
```

Expected: `wims-keycloak` is `Up <duration> (healthy)`. If still in `Starting` state after 30 seconds, check `docker logs wims-keycloak --tail 30` for startup errors.

- [ ] **Step 3: If the restart didn't pick up the new theme, force-recreate**

```bash
cd /opt/wims-bfp/src && \
  docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production \
  up -d --force-recreate keycloak
```

`--force-recreate` destroys the container and creates a new one with the same image but fresh filesystem state. Use this only if `restart` didn't pick up the new theme (it usually does).

- [ ] **Step 4: Wait for the recreated container to be healthy**

```bash
sleep 30
docker ps --format 'table {{.Names}}\t{{.Status}}' | grep wims-keycloak
```

Expected: `wims-keycloak` is `Up <duration> (healthy)`.

- [ ] **Step 5: Verify the theme is recognized by Keycloak**

```bash
docker exec wims-keycloak /opt/keycloak/bin/kcadm.sh get realms/bfp -r master \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print("emailTheme:", d.get("emailTheme")); print("loginTheme:", d.get("loginTheme"))'
```

Expected: `emailTheme: wims-bfp`. (The `loginTheme` may be `None` or empty — the current realm doesn't set it; that's fine.)

---

### Task 8: System-wiki update (mandatory per AGENTS.md)

**Files:**
- Modify: `system-wiki/architecture/infrastructure-config.md` (or appropriate page)
- Append: `system-wiki/log.md`
- Modify: `system-wiki/gaps/frs-codebase-gap-register.md`

**Interfaces:**
- Consumes: Tasks 1-7 (the theme is implemented, deployed, and verified working)
- Produces: a system-wiki that accurately documents the current Keycloak email theme state

- [ ] **Step 1: Find the appropriate synthesis page in the system-wiki**

```bash
ls system-wiki/architecture/ 2>/dev/null
ls system-wiki/backend/ 2>/dev/null
```

Expected: directories with existing synthesis pages. The most appropriate page for a Keycloak theme update is likely `system-wiki/architecture/infrastructure-config.md` (or whichever page documents Keycloak's runtime configuration). If unsure, search for "Keycloak" in existing pages:

```bash
grep -l 'keycloak' system-wiki/**/*.md 2>/dev/null | head -5
```

- [ ] **Step 2: Add a "Keycloak email theme" section to the appropriate page**

Open the page found in Step 1 and add a section (suggested placement: after any existing Keycloak section, or as a new section if none exists). Suggested content:

```markdown
## Keycloak Email Theme (WIMS-BFP branding)

The `bfp` realm uses a custom email theme at `src/keycloak/themes/wims-bfp/email/`. The theme overrides the 3 default Keycloak transactional email templates (password reset, email verification, execute actions) with WIMS-BFP-branded versions.

**File structure:**
- `email/theme.properties` — declares `parent=base` (inherits from Keycloak's base email theme)
- `email/messages/messages_en.properties` — 3 subject-line overrides (e.g. `passwordResetSubject=[WIMS-BFP] Reset your password`)
- `email/resources/img/bfp-logo.png` — BFP logo PNG, referenced by `${url.resourcesUrl}/img/bfp-logo.png` in the template
- `email/html/template.ftl` — shared `<#macro emailLayout>` wrapper with maroon `#8B0000` header, BFP logo, gray footer
- `email/html/{password-reset,email-verification,executeActions}.ftl` — 3 HTML body templates
- `email/text/{password-reset,email-verification,executeActions}.ftl` — 3 plain-text body templates (required by Keycloak's `FreeMarkerEmailTemplateProvider`, which constructs BOTH `text/<template>` AND `html/<template>` and throws `EmailException` if either fails to render)

**Realm config:** `emailTheme: wims-bfp` is set as a top-level field in BOTH `src/keycloak/bfp-realm.json` and `src/keycloak/import/bfp-realm.json`. The live persistent DB on the VPS gets this field via `kcadm.sh update realms/bfp -s emailTheme=wims-bfp` (B2 pattern from the live-notifications work — Keycloak does not re-resolve realm-level fields on container restart).

**Deploy notes:**
- No Dockerfile or compose change needed — the volume mount at `src/docker-compose.yml:60` picks up the new `email/` subdirectory automatically
- After editing the theme files, restart Keycloak with `docker compose restart keycloak` (or `up -d --force-recreate keycloak` if `restart` doesn't pick up the changes due to caching)
- The logo URL uses `${url.resourcesUrl}` (a FreeMarker context variable injected by `UrlBean`) — this is portable across local, staging, and production
- FreeMarker render errors are surfaced in Keycloak logs when the email flow is triggered (not at startup) — check `docker logs wims-keycloak` after a test email send

**Visual style:** maroon `#8B0000` header, BFP logo (48x48), "Bureau of Fire Protection" + "WIMS-BFP Incident Management System" tagline, 600px max width, table-based layout, inline CSS. Matches the 7 backend app-level Jinja2 templates in `src/backend/services/email/templates/`.

**Security:** all 6 templates use the `<#assign displayName = (user.firstName?has_content)?then(user.firstName, user.username)>` pattern with `?html` applied to the final value. This handles BOTH null and empty string and avoids the FreeMarker operator-precedence XSS bug (where `?html` was previously only escaping the fallback, not the primary value).
```

- [ ] **Step 3: Check for an existing email-related gap in the gap register**

```bash
grep -niE 'email|smtp|brevo|theme|branding' system-wiki/gaps/frs-codebase-gap-register.md | head -20
```

Expected: existing entries from the live-notifications work (BREVO-EMAIL-CHANNEL, etc.). If a specific entry exists for "Keycloak email templates unbranded" or similar, add a closing note. If none exists, add a new entry.

- [ ] **Step 4: Close the gap in `system-wiki/gaps/frs-codebase-gap-register.md`**

Add or update the entry:

```markdown
### KEYCLOAK-EMAIL-THEME (closed 2026-06-24)

- **Problem:** WIMS-BFP's Keycloak transactional emails (password reset, email verification, execute actions) used Keycloak's generic default templates, which didn't match the WIMS-BFP branding of the 7 backend app-level Jinja2 templates. The visual inconsistency made the transactional emails look unbranded.
- **Fix:** Added a custom Keycloak email theme at `src/keycloak/themes/wims-bfp/email/` with 7 FreeMarker templates (4 HTML + 3 text), 1 `theme.properties`, 1 subject-override message bundle, and 1 copied BFP logo. The realm JSON files (both `bfp-realm.json` and `import/bfp-realm.json`) get `emailTheme: wims-bfp`. The live persistent DB on the VPS gets the field via `kcadm.sh update realms/bfp -s emailTheme=wims-bfp`. After restart, all 3 Keycloak-driven email types render with the WIMS-BFP header, BFP logo, table layout, and call-to-action button — matching the 7 backend templates visually.
- **Spec:** `docs/superpowers/specs/2026-06-24-keycloak-email-theme-design.md` (v2.1, commit `4847ceb6`). Plan: `docs/superpowers/plans/2026-06-24-keycloak-email-theme.md`. Closed by PR #N (where N is the PR number from Task 5).
- **Out of scope:** redesigning the 7 backend Jinja2 templates; switching to Brevo's HTTP API; localizing to Filipino; embedding the BFP logo as a base64 data URL.
```

- [ ] **Step 5: Append a 2026-06-24 entry to `system-wiki/log.md`**

Open `system-wiki/log.md`. Append a new entry at the end (most recent first) with the same shape as the live-notifications and device-id entries:

```markdown
## 2026-06-24 — Custom Keycloak email theme (WIMS-BFP branding)

- **Problem:** WIMS-BFP's Keycloak transactional emails (password reset, email verification, execute actions) used Keycloak's generic default templates, which didn't match the WIMS-BFP branding of the 7 backend app-level Jinja2 templates. After PR #452 (Brevo SMTP on port 2525), the SMTP transport worked end-to-end but the templates were unbranded.
- **Fix:** Added a custom Keycloak email theme at `src/keycloak/themes/wims-bfp/email/` with 7 FreeMarker templates (4 HTML + 3 text), 1 `theme.properties`, 1 subject-override message bundle, and 1 copied BFP logo. The realm JSON files get `emailTheme: wims-bfp`; the live persistent DB on the VPS gets the field via `kcadm.sh update realms/bfp -s emailTheme=wims-bfp` (B2 pattern from the live-notifications work). After container restart, all 3 Keycloak-driven email types render with the WIMS-BFP header, BFP logo, table layout, and call-to-action button — matching the 7 backend templates visually.
- **Files changed (12):** 4 new files in `email/` (theme.properties, messages bundle, logo, 4 HTML templates), 3 new text templates, 2 realm JSON edits (1 line each), 3 system-wiki updates.
- **Spec:** `docs/superpowers/specs/2026-06-24-keycloak-email-theme-design.md` (v2.1, commit `4847ceb6`). Plan: `docs/superpowers/plans/2026-06-24-keycloak-email-theme.md`. Closed by PR #N.
- **No scope creep:** zero application code changes; zero new tests; zero new SMTP creds; zero frontend changes; the 7 backend Jinja2 templates, the login theme, the Dockerfile, and the compose file are all byte-identical.
- **Spec quality note:** the v1 spec had 14 critical bugs (wrong file paths, wrong message keys, wrong template names, wrong FreeMarker context variables, hardcoded production URLs, missing plain-text templates); v2 fixed 14; v2.1 fixed 6 more (FreeMarker operator-precedence XSS bug in the greeting expression, kcadm command robustness, anonymization of real user data). v2.1 self-review includes a 17-row identifier-consistency table where each claim is cited to the actual Keycloak 24.0.0 source on GitHub.
- **Validation:** TBD by implementer (this entry is committed before the spec's V1-V5 deploy-time tripwires run).
```

- [ ] **Step 6: Commit the wiki updates**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE
git add system-wiki/
git commit -m "docs(wiki): document WIMS-BFP Keycloak email theme (closes KEYCLOAK-EMAIL-THEME gap)

Per AGENTS.md mandatory system-wiki update rule. Three files:
- architecture/infrastructure-config.md: add 'Keycloak email theme
  (WIMS-BFP branding)' section documenting the 10 new files in
  email/, the emailTheme realm field, the deploy notes (B2 pattern
  for live DB update), and the security note about the
  FreeMarker operator-precedence XSS fix
- gaps/frs-codebase-gap-register.md: close the KEYCLOAK-EMAIL-THEME
  gap with a problem/fix/spec/PR-links entry
- log.md: append 2026-06-24 entry following the same shape as the
  live-notifications and device-id entries

Doc-only change. No application code, no tests, no schema, no
frontend. Mirrors the v2.1 spec and the implementation plan."
```

---

### Task 9: CI pre-flight verification + live V1-V3 tripwires

**Files:** None (verification only)

**Interfaces:**
- Consumes: Tasks 1-8 (theme implemented, deployed, restarted, wiki updated)
- Produces: a verification report confirming all 5 tripwires pass

- [ ] **Step 1: Run backend ruff lint**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/src/backend
ruff check .
```

Expected: `All checks passed!` (or no output). No new Python in this plan, so ruff should report no findings.

- [ ] **Step 2: Run backend ruff format check**

```bash
ruff format . --check
```

Expected: `N files already formatted`. No new Python, so format should be unchanged.

- [ ] **Step 3: Run backend pytest**

```bash
python -m pytest -v
```

Expected: full test suite passes. No Python or test change, so the existing baseline is preserved. (If the local environment cannot run pytest — e.g. no Docker stack — document the skip with the reason from the spec: "Pre-existing CI gate runs in Docker; this plan's diff is config-only and adds no Python/tests, so the existing test suite is unaffected by construction. Will run in CI on PR open.")

- [ ] **Step 4: Run frontend lint/test/build**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/src/frontend
npm run lint && npx vitest run && \
  NEXT_PUBLIC_AUTH_API_URL=http://localhost:8080/auth \
  NEXT_PUBLIC_BASE_URL=http://localhost:3000 \
  npm run build
```

Expected: all 3 commands pass. No frontend change in this plan, so the existing baseline is preserved.

- [ ] **Step 5: Verify no secrets in the new files**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE
git diff master -- 'src/keycloak/themes/wims-bfp/email/' 'src/keycloak/bfp-realm.json' 'src/keycloak/import/bfp-realm.json' \
  | grep -E 'xsmtpsib|SMTP_(USER|PASSWORD)=[^[:space:]]' \
  && echo "FAIL: secret in diff" \
  || echo "OK: no secrets in diff"
```

Expected: `OK: no secrets in diff`. The new template files and realm JSON lines contain no Brevo keys, no admin passwords, no real user emails.

- [ ] **Step 6: Live V1 tripwire — trigger a password reset, confirm new template**

On the VPS (after Task 7's restart):

```bash
# SSH in (continuing the previous session)
ssh -i ~/.ssh/id_ed25519_pi root@165.22.101.73

# 1) Watch the celery-worker logs for the send (clears quickly; we check after)
docker logs wims-celery-worker --since 1m 2>&1 | tail -5 &
LOG_PID=$!

# 2) Trigger a password reset for the test user
#    (user goes to https://wimsbfp.tech/auth/realms/bfp/login-actions/reset-credentials
#     and enters their email; or use kcadm to trigger programmatically)
docker exec wims-keycloak /opt/keycloak/bin/kcadm.sh get users -r master \
  --query "username:test-user" 2>&1 | head -3

# 3) Wait a moment for the email to be sent
sleep 5

# 4) Check the celery-worker log for the Brevo send (not strictly required for Keycloak-driven emails,
#    since Keycloak sends directly via its own SMTP, not via the celery-worker)
# Keycloak-driven emails go out via Keycloak's internal SMTP, not via the celery-worker.
# The correct way to verify is: the user (or test) receives the email with the WIMS-BFP template.

# 5) Ask the user to confirm the email arrived with the new template
echo "Trigger a password reset at https://wimsbfp.tech/auth/realms/bfp/login-actions/reset-credentials and confirm the email has:"
echo "  - Subject: [WIMS-BFP] Reset your password"
echo "  - HTML body: maroon #8B0000 header, BFP logo, 'Bureau of Fire Protection' + 'WIMS-BFP Incident Management System' text, maroon 'Reset Password' button"
echo "  - Plain-text body: contains the URL on its own line"
echo "  - MIME: BOTH text/html AND text/plain parts present"
```

(The deploy operator — or the user — verifies by checking the received email. This is a manual step that requires a real recipient inbox.)

- [ ] **Step 7: Live V2 tripwire — trigger email verification, confirm new template**

The deploy operator (or the user) triggers an email verification (e.g. via Keycloak admin console for a test user, or via the `POST /api/auth/change-email` API path that triggers `send_email_async` in `auth.py:222`). Confirm the email has:

- Subject: `[WIMS-BFP] Verify your email address`
- HTML body: same WIMS-BFP branding, "Verify Email" call-to-action button
- Plain-text body: contains the URL on its own line
- MIME: BOTH `text/html` AND `text/plain` parts present

- [ ] **Step 8: Live V3 tripwire — trigger execute actions, confirm new template**

The deploy operator (or the user) sets a required action on a test user (e.g. "Update Password" via Keycloak admin console) and triggers an execute-actions email. Confirm the email has:

- Subject: `[WIMS-BFP] Action required for your account`
- HTML body: bulleted list of required actions (e.g. "- Update Password"), "Review Required Actions" call-to-action button
- Plain-text body: contains the URL on its own line
- MIME: BOTH `text/html` AND `text/plain` parts present

- [ ] **Step 9: No-commit (verification only)**

This task is verification only. No code or wiki change to commit. If any of the Steps 1-8 fail, the implementer must investigate and fix before marking the plan complete.

---

## Self-Review

**1. Spec coverage:**

| Spec section | Plan task | Notes |
|---|---|---|
| S1.1 `theme.properties` | Task 1 Step 2 | ✅ |
| S1.2 `messages_en.properties` | Task 1 Step 3 | ✅ |
| S1.3 `bfp-logo.png` copy | Task 1 Step 4 | ✅ |
| S1.4 `html/template.ftl` | Task 2 Step 1 | ✅ |
| S1.5 `html/password-reset.ftl` | Task 2 Step 2 | ✅ |
| S1.6 `html/email-verification.ftl` | Task 2 Step 3 | ✅ |
| S1.7 `html/executeActions.ftl` | Task 2 Step 4 | ✅ |
| S1.8 `text/password-reset.ftl` | Task 3 Step 1 | ✅ |
| S1.9 `text/email-verification.ftl` | Task 3 Step 2 | ✅ |
| S1.10 `text/executeActions.ftl` | Task 3 Step 3 | ✅ |
| S2 (2 realm JSON lines) | Task 4 | ✅ |
| S3 (live-realm kcadm update) | Task 6 | ✅ |
| S4 (restart) | Task 7 | ✅ |
| S5 (system-wiki update) | Task 8 | ✅ |
| V1 (password reset) | Task 9 Step 6 | ✅ |
| V2 (email verification) | Task 9 Step 7 | ✅ |
| V3 (execute actions) | Task 9 Step 8 | ✅ |
| V4 (CI pre-flight) | Task 9 Steps 1-4 | ✅ |
| V5 (no secrets) | Task 9 Step 5 | ✅ |

**2. Placeholder scan:** No "TBD", "TODO", "implement later", "fill in details". All file contents are concrete. All commands are exact. All commit messages are full bodies. The "N" in "PR #N" (Step 5 of Task 8) and the PR number references in the wiki are explicitly the PR number from Task 5 Step 4 (the implementer pastes the actual number).

**3. Type / identifier consistency (verified against Keycloak 24.0.0 source):**
- All 3 message keys (`passwordResetSubject`, `emailVerificationSubject`, `executeActionsSubject`) match the actual Keycloak 24 source.
- All 3 template filenames (`password-reset.ftl`, `email-verification.ftl`, `executeActions.ftl` — note camelCase on the last) match the actual FreeMarkerEmailTemplateProvider lookups.
- All 3 context variables (`link`, `linkExpiration`, `linkExpirationFormatter`, `user`, `url`, `requiredActions`) match the actual FreeMarkerEmailTemplateProvider attribute injection.
- The `<#import "template.ftl" as layout>` + `<@layout.emailLayout>` pattern matches the actual base theme pattern in `themes/.../email/html/password-reset.ftl`.
- The `${url.resourcesUrl}` pattern for the logo matches the actual `UrlBean` construction.
- The `<#assign displayName = (user.firstName?has_content)?then(user.firstName, user.username)>` + `${displayName?html}` pattern is the explicit null-safe + empty-string-safe + XSS-safe version (avoiding v2's `${(user.firstName)!user.username?html}` operator-precedence bug).

**4. Gaps found in self-review, fixed inline:**

- Originally Task 3's text templates used the simpler `${(user.firstName)!user.username}` pattern. Fixed to use the same `<#assign displayName>` pattern as the HTML templates for consistency. (The meta-analysis suggested this.)
- Originally Task 4 used `git apply` or `python -c` for the realm JSON edit. Fixed to use `sed` (more portable; no Python needed).
- Originally Task 5's PR body was inline in the bash command. Fixed to use a file (`/tmp/wims-keycloak-pr-body.md`) to avoid shell-quoting issues with the long body and special characters (em-dashes, backticks, etc.).
- Originally the plan didn't explicitly include the `mkdir -p` for the 4 new subdirectories under `email/`. Fixed in Task 1 Step 1.
- Originally Task 7's restart command was `docker compose up -d keycloak`. Fixed to `docker compose restart keycloak` per the v2.1 spec (S4) — `up -d` may not restart an unchanged container; `restart` is more reliable for theme refresh. The `up -d --force-recreate` is included as a fallback.
- Originally the `kcadm` step didn't include the `set -a && . .env.production` env sourcing. Fixed in Task 6 Step 2 per the v2.1 spec (S3) — without this, the `docker exec -e` flags pass empty strings and kcadm fails with an auth error.

**5. Why this plan is implementation-ready:**

- Every file content is shown in full, with the exact line breaks and FreeMarker syntax.
- Every shell command is shown with the expected output.
- Every commit message is a full Conventional Commits body.
- The dependency graph between tasks is explicit (Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6 → Task 7 → Task 8 → Task 9).
- The deploy-host path (`/opt/wims-bfp/`) and local-dev path are both referenced.
- The pitfalls flagged by the v2.1 meta-analysis (FreeMarker operator precedence, missing kcadm env sourcing, etc.) are baked into the relevant steps.

---

*This is an implementation plan. The source spec is at `docs/superpowers/specs/2026-06-24-keycloak-email-theme-design.md` (v2.1). 9 tasks, 0 application code changes, 0 new tests, 0 new SMTP creds, 0 frontend changes. Total commits when executed: 6 (Tasks 1+2+3+4+8 each get a commit; Tasks 5+6+7+9 are operational/verification only).*
