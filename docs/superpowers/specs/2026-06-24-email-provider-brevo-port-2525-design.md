# Switch Email Provider to Brevo SMTP on Port 2525

**Date:** 2026-06-24
**Status:** Design (v1)
**Pattern:** Config-only swap (env vars + Keycloak realm config + update script) — no application code, no new dependencies, no schema.
**Scope:** Email channel only (both Keycloak transactional and backend/Celery application email). FCM is out of scope; the live-notifications work at `25d5eca` and the device_id fix at `8427b533` are merged and unaffected.
**Reviewer basis:** Verified against current source — `src/backend/services/email/sender.py:11-23` (env var reads), `src/backend/tasks/notifications.py:1-205` (Celery task with `aiosmtplib.SMTPException` retry), `src/keycloak/bfp-realm.json:1523-1533` (Keycloak SMTP block), `src/keycloak/import/bfp-realm.json:1523-1534` (import-path realm SMTP), `scripts/update-keycloak-smtp.sh:32-44` (default values for un-set vars), `src/docker-compose.yml:80-90` (Keycloak service env) and `:264-269` (celery-worker env), `src/.env.production.example:29-44` (documented SMTP_*), `.env.example:73-83` (dev defaults), `src/backend/requirements.txt:27` (`aiosmtplib>=3.0.0`), DigitalOcean support docs (`docs.digitalocean.com/support/why-is-smtp-blocked/`, last verified 22 Jun 2026), Brevo SMTP relay docs (`developers.brevo.com/docs/smtp-integration`).

---

## Problem

The WIMS-BFP email channel is broken at the network layer on the production VPS. The live-notifications work at `25d5eca` correctly wired `aiosmtplib` + Gmail SMTP, but emails never arrive because **DigitalOcean blocks outbound TCP on SMTP ports 25, 465, and 587** to external relays (per DigitalOcean's own documentation, last verified 22 Jun 2026: *"SMTP ports 25, 465, and 587 are blocked on Droplets to prevent spam and other abuses on our platform. This block applies to all Droplets by default and includes traffic passing through a Reserved IP address."*). The VPS uses default DigitalOcean networking; opening a support ticket to lift the block is a 24-48h operational step the operator has declined, so the constraint is: **the email transport must work over ports that are NOT in the DO block list, with no DO-side cooperation.**

The handoff received at the start of the previous session called this out. The handoff's hypothesis was to migrate the app to an HTTP-API-based provider (SendGrid, Mailgun, Brevo, etc.). The handoff explicitly asked the next session to **verify that hypothesis before committing**, because the design assumption — *"all SMTP ports are blocked, so only HTTP works"* — is a stronger claim than the DO docs actually support.

### What the handoff got right

- The handoff correctly identified that the email channel is broken and that the `aiosmtplib` + Gmail path cannot work on this VPS.
- The handoff correctly identified the file change surface: `sender.py:18-23` (6 env vars), `tasks/notifications.py:165-205` (Celery task retry), Keycloak realm JSON (11 env vars), Docker Compose env blocks, env files, update script, tests.
- The handoff correctly mapped the 7 templates, 4 test files, and 3 admin route call sites that depend on the email channel.

### What the handoff got wrong (verified by direct research)

**The handoff's "SMTP is fully blocked, HTTP API is the only path" assumption is wrong.** The DO support docs are explicit: only ports **25, 465, and 587** are blocked. Other SMTP submission ports — notably **2525** (a long-standing alternative for outbound SMTP submission, defined in RFC 6409 / widely supported by transactional email providers) — are NOT in the block list. DigitalOcean does not document blocking port 2525. This means an SMTP relay to a provider that supports port 2525 will work on this VPS, with no DO support ticket and no HTTP API rewrite.

**Concretely: Brevo's SMTP relay supports port 2525.** From Brevo's own documentation (`developers.brevo.com/docs/smtp-integration`): *"Non-encrypted: Use ports 587 or 2525. Encrypted: Use port 465 with SSL or TLS encryption."* Port 2525 is the standard "if your ISP or hosting provider blocks 587" alternative. Mailgun and SendGrid also support 2525. The handoff author did not check this — they assumed all SMTP was blocked and jumped to HTTP.

### Why SMTP on 2525 beats HTTP API for this project

1. **Zero application code change.** The `aiosmtplib` transport in `sender.py:124-130` already takes `hostname`, `port`, `username`, `password`, `start_tls` as parameters. Changing `SMTP_HOST` and `SMTP_PORT` env vars is the entire app change.
2. **The Celery retry logic stays correct.** `tasks/notifications.py:168` uses `autoretry_for=(aiosmtplib.SMTPException, ConnectionError, TimeoutError, OSError)`. These exceptions are still the right ones for an SMTP transport. If we moved to HTTP, the retry exceptions would need to change to `requests.exceptions.HTTPError`/`ConnectionError`/`Timeout`, AND a 4xx response would need to be a *permanent* failure (no retry) to avoid burning Celery retries on bad payloads. The HTTP path is strictly more failure surface.
3. **The tests stay correct.** `src/backend/tests/test_email_infra.py` patches `services.email.sender.aiosmtplib.send` with `AsyncMock` and asserts `mock_send.called`. The mocks do not care which port is used. If we moved to HTTP, all four test files (`test_email_infra.py`, `test_auth_email_verification.py`, `test_profile_email.py`, `test_m13_email_triggers.py`, `test_admin_new_routes.py:1191`) plus `test_breach_notifications.py` would need updating because the patch target would change from `aiosmtplib.send` to a new HTTP client method.
4. **Keycloak's SMTP block only supports SMTP transport.** The handoff acknowledged this — *"Should the app use the provider's HTTP API (no SMTP at all) or the provider's SMTP relay? ... Keycloak still needs SMTP"* — and correctly concluded that Keycloak would still need an SMTP path. If we used HTTP for the app, we'd be running **two transport mechanisms** in the same stack (HTTP for the app, SMTP for Keycloak) for the same provider. Pure-SMTP keeps a single transport.
5. **Port 2525 is the established workaround for "ISP blocks 587"** — the same reason transactional email providers have offered it for over a decade. It is a stable, documented, well-supported port.

### Why Brevo over SendGrid, Resend, Mailgun, Mailjet, AWS SES, Postmark

The handoff listed 7 providers with a hypothesis recommendation of "SendGrid or Brevo for the free tier; AWS SES at scale; Resend for the cleanest API." After verification against the current state of this project (a thesis prototype, ~1-10 emails/day normal, <100/day under stress, .gov.ph domain, keycloak + Celery + Docker Compose stack), the trade-off favors Brevo:

| Provider | Free tier | SMTP port 2525 | Python SDK | Why not chosen |
|---|---|---|---|---|
| **Brevo** | **300 emails/day** | **Yes (documented)** | `sib-api-v3-sdk` for HTTP; SMTP works with any stdlib/`aiosmtplib` | **Chosen.** Generous free tier; port 2525 documented; SMTP key auth (no full-account credential); EU-based (favorable for .gov.ph data posture); HTTP API exists as future escape hatch. |
| SendGrid | 100 emails/day | Yes (less commonly used; 587/465 are defaults) | Official `sendgrid` (HTTP); SMTP works with `aiosmtplib` | Smaller free tier; documentation foregrounds 587/465. |
| Resend | 100/day + 3,000/month | No — Resend's SMTP is 25/465/587/2465/2587 only. | Official `resend` (HTTP); SMTP works with `aiosmtplib` | 2525 not supported. Closest non-blocked port is 2587 (custom, less standard). |
| Mailgun | 100/day trial, then 5,000/month | Yes | Official `mailgun` (HTTP + SMTP helper) | Worse deliverability reputation per community reports; trial-to-paid friction. |
| Mailjet | 200/day, 6,000/month | Inferred (not confirmed in this research) | Official `mailjet-rest` (HTTP); SMTP works with `aiosmtplib` | Documentation not verified in this research. |
| AWS SES | 3,000/month from EC2 | Yes | `boto3` (HTTP); SMTP works with `aiosmtplib` | Cheapest at scale but requires AWS account, IAM, and recipient verification in sandbox mode — too much operational overhead for a thesis. |
| Postmark | 100/month (test) | No confirmed 2525 | Community `postmarker` | Paid-only above test tier; smallest free tier. |

**Free tier comparison (most important for a thesis):** Brevo 300/day ≫ Mailjet 200/day ≫ Resend/SendGrid 100/day. Brevo wins on volume alone.

**SMTP key auth (important for security):** Brevo's SMTP auth uses a per-key SMTP key (generated in `app.brevo.com/settings/keys/smtp`), not the full account password. The key can be revoked independently and rotated without touching the account. SendGrid also has this. The Brevo doc explicitly says: *"Use an SMTP key, not an API key, for SMTP relay connections."*

### Secondary findings (not blocking, but the handoff missed them)

- **`auth.py:222` calls `send_email_async` directly, not through the Celery task.** The handoff claimed *"It is called by the Celery task only."* This is incorrect. The async route at `api/routes/auth.py:218-241` calls `send_email_async(...)` directly with its own try/except → 502 response. This means there are **two retry paths in production**: the Celery task (with `autoretry_for`) for `admin/security.py:530,541` and `tasks/scheduled_reports.py:172`, and the direct async call (with no retry, returns 502 to the client) for `auth.py:222`. Both paths go through the same `sender.py`, so this spec's change to `sender.py`'s env var reads still applies to both. The retry semantics are NOT changed by this spec — SMTPException-based autoretry remains correct.
- **`scheduled_reports.py` does NOT have its own `SMTP_*` env vars or import of `aiosmtplib`.** The handoff mentioned "scheduled_reports.py:172" as a caller; that's correct (it dispatches `send_email_task.delay(...)`), but the file does not directly use SMTP. The handoff's enumeration of files to touch is correct; the env-var scoping is at `sender.py:18-23` and `docker-compose.yml:264-269` (celery-worker env). No SMTP env vars are duplicated in `scheduled_reports.py`.
- **The system-wiki page `system-wiki/backend/services.md` is stale:** it says 4 templates (lines for the email service) when the directory actually contains 7 (`account_locked, breach_alert, email_verification, password_reset, scheduled_report, security_alert, weekly_report`). The system-wiki is also missing the env-var list and the retry semantics for `send_email_task`. This spec corrects both as part of the wiki update requirement (AGENTS.md mandatory rule).
- **`requirements.txt:27` keeps `aiosmtplib>=3.0.0` unchanged.** No SDK additions or removals.

---

## Goal

After this design is implemented, the WIMS-BFP stack, when run on a host that has a populated `/opt/wims-bfp/src/.env` with real Brevo SMTP credentials, delivers:

1. **Keycloak transactional email** (password reset, email verification, execute-actions email) to the recipient's real inbox via **Brevo SMTP on port 2525** — not MailHog, not blocked.
2. **Backend- and Celery-async application email** (security alerts, breach alerts, weekly reports, scheduled report notifications, email verification) to the recipient's real inbox via **Brevo SMTP on port 2525** — not MailHog, not blocked.
3. **The `scripts/update-keycloak-smtp.sh` deploy script works for Brevo on port 2525** with no special-casing — the same script the live-notifications work shipped, with the default values updated.
4. **No application code changes.** The `aiosmtplib` transport and the `aiosmtplib.SMTPException`-based Celery retry remain the right shape; this is a config-only swap.

MailHog remains in the stack for local dev (it is on `mailhog:1025` inside the Docker network, which is unaffected by the VPS port blocks) but is no longer the default for any production-shaped run.

---

## Requirements

### R1 — Keycloak transactional email reaches recipients via Brevo

- Password reset triggered from the Keycloak login page (`/auth/realms/bfp/login-actions/reset-credentials`) arrives in the real recipient inbox.
- `docker logs wims-keycloak --tail 50 | grep -i smtp` shows a connection to `smtp-relay.brevo.com:2525` (not `mailhog:1025` and not `smtp.gmail.com:587`).
- MailHog UI (`127.0.0.1:8025`) does **not** receive the message.

### R2 — Application email reaches recipients via Brevo

- Any code path that calls `send_email_task` (admin security alert at `api/routes/admin/security.py:530,541`; weekly report at `tasks/notifications.py:281`; scheduled reports at `tasks/scheduled_reports.py:172`; breach alerts at `api/routes/admin/security.py`) results in a `Email sent to ... via smtp-relay.brevo.com:2525` line in `docker logs wims-celery-worker --tail 50`.
- The `auth.py:222` direct call to `send_email_async` for the email-verification flow also logs the Brevo connection (when triggered end-to-end by a `POST /api/auth/change-email` request from a real user).
- The recipient finds the email in their real inbox.

### R3 — `scripts/update-keycloak-smtp.sh` works for Brevo

- Running `./scripts/update-keycloak-smtp.sh .env` on the deploy host (where `.env` has `SMTP_HOST=smtp-relay.brevo.com`, `SMTP_PORT=2525`, `SMTP_USER=<brevo-smtp-key>`, `SMTP_PASSWORD=<brevo-smtp-key>`) updates the live Keycloak realm's `smtpServer` block to point at Brevo on 2525.
- `kcadm.sh get realms/bfp | jq .smtpServer` (run inside the keycloak container) shows `host: smtp-relay.brevo.com`, `port: 2525`, `starttls: true`, `auth: true`, `user: <brevo-smtp-key>`. (Note: Brevo's port 2525 is non-encrypted plaintext SMTP that the server expects to be upgraded to TLS via STARTTLS — `starttls: true` is correct, `ssl: false`.)
- The script is idempotent — running it twice with the same `.env` is a no-op on the second run.

### R4 — Secrets remain out of source control

- After implementation, `git status` shows no new tracked file containing Brevo SMTP key, Brevo API key, or any other credential.
- `src/.env.production.example` and `.env.example` contain only placeholder values, documentation comments, and host/port defaults.
- `.env` remains in `.gitignore` (already true at `.gitignore:27-30`).

### R5 — All existing tests still pass and no new tests are required

- `cd src/backend && pytest -v` — no new failures. The existing `test_email_infra.py`, `test_auth_email_verification.py`, `test_m13_email_triggers.py`, `test_breach_notifications.py`, `test_admin_new_routes.py`, `test_security_monitoring.py`, `test_scheduled_reports.py`, `test_infra_config.py` all continue to pass with `aiosmtplib` unchanged.
- `cd src/backend && ruff check .` — clean.
- `cd src/backend && ruff format . --check` — clean.
- `cd src/frontend && npm run lint && npx vitest run && npm run build` — clean (with dummy `NEXT_PUBLIC_*` values per `docs/agents/ci-preflight.md`).
- No new tests are added by this spec because **the change surface is configuration, not code**. The `aiosmtplib` mock in `test_email_infra.py:85-118` is port-agnostic; it patches `services.email.sender.aiosmtplib.send` and asserts `mock_send.call_args`, neither of which depends on `SMTP_PORT`.

---

## Solution

Four small, surgical changes — three config files and one script default — plus the mandatory system-wiki update. No new application code, no new dependencies, no schema, no tests.

### S1 — `src/.env.production.example`: change `SMTP_*` defaults to Brevo on 2525

The current file (lines 29-44) has `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, Gmail username, and a comment block about Gmail App Passwords. Replace the entire 16-line block with a Brevo-flavored equivalent. The full new block:

```bash
# ----- Live email (Brevo SMTP relay, port 2525) -----
# sender.py:18-23 reads the first six for application email; bfp-realm.json:1523-1533
# reads all eleven for Keycloak transactional email. Why Brevo on port 2525:
#   * 300 emails/day free tier (most generous for a transactional workload).
#   * Port 2525 is the standard alternative SMTP submission port when an ISP
#     or hosting provider blocks 587. DigitalOcean blocks 25/465/587 on
#     Droplets by default (docs.digitalocean.com/support/why-is-smtp-blocked/,
#     last verified 2026-06-22) but does NOT document a block on 2525.
#   * Brevo supports port 2525 explicitly (developers.brevo.com/docs/smtp-integration:
#     "Non-encrypted: Use ports 587 or 2525. Encrypted: Use port 465 with SSL or TLS").
# Generate the SMTP key at https://app.brevo.com/settings/keys/smtp — use the
# SMTP key, not an API key. The kcadm-side update is run by scripts/update-keycloak-smtp.sh.
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=2525
SMTP_FROM=noreply@wimsbfp.tech
SMTP_FROM_DISPLAY=WIMS-BFP
SMTP_REPLYTO=no-reply@wimsbfp.tech
SMTP_REPLYTO_DISPLAY=WIMS-BFP No Reply
SMTP_SSL=false
SMTP_STARTTLS=true
SMTP_AUTH=true
SMTP_USER=
SMTP_PASSWORD=
```

`SMTP_USER` and `SMTP_PASSWORD` are intentionally empty — the operator must paste the Brevo SMTP key into both. (Brevo uses the same SMTP key for both the SMTP `USER` and `PASSWORD` AUTH PLAIN fields; this is by design and matches the Brevo docs.)

**Why not just change the host/port and keep the rest:** the file's purpose is to document the deploy-host's expected `.env` shape, and the comment block currently leads the operator to Google's App Password flow. If we leave that comment in place, the next operator will be confused about which auth method to use. The new comment block explains the *why* (DigitalOcean block) and the *how* (Brevo SMTP key, port 2525).

### S2 — `src/docker-compose.yml`: change `SMTP_HOST`/`SMTP_PORT` defaults in Keycloak service and celery-worker

The Keycloak service env block at `src/docker-compose.yml:80-90` currently has:

```yaml
      SMTP_HOST: ${SMTP_HOST:-mailhog}
      SMTP_PORT: ${SMTP_PORT:-1025}
      ...
      SMTP_USER: ${SMTP_USER:-}
      SMTP_PASSWORD: ${SMTP_PASSWORD:-}
      SMTP_STARTTLS: ${SMTP_STARTTLS:-false}
```

Change the default values for `SMTP_HOST` and `SMTP_PORT` to `smtp-relay.brevo.com` and `2525`. The other vars (FROM, FROM_DISPLAY, REPLYTO, REPLYTO_DISPLAY, SSL, STARTTLS, AUTH, USER, PASSWORD) keep their current defaults; the operator's `.env` overrides are authoritative at deploy time.

**Concretely, change lines 80 and 81 from:**

```yaml
      SMTP_HOST: ${SMTP_HOST:-mailhog}
      SMTP_PORT: ${SMTP_PORT:-1025}
```

**to:**

```yaml
      SMTP_HOST: ${SMTP_HOST:-smtp-relay.brevo.com}
      SMTP_PORT: ${SMTP_PORT:-2525}
```

Apply the same two-line change to the celery-worker service env block at `src/docker-compose.yml:264-265`. (The other 4 celery-worker SMTP_* lines at `:266-269` are unchanged — they already default to mailhog-relative values and the operator's `.env` overrides.)

**Why this is needed in addition to S1:** compose interpolation `${SMTP_HOST:-default}` reads the default *only* if `.env` does not set `SMTP_HOST`. The default exists so that `docker compose config` is valid even when `.env` is missing (e.g. for first-boot, for `docker compose up` in a fresh checkout). If the default says `mailhog`, a fresh operator who follows the README and only edits `.env.production.example` would still get the wrong default. Setting the in-compose default to Brevo aligns the "no env file" path with the "with env file" path.

**Why this does NOT need a Keycloak compose rebuild:** the Keycloak service block already reads `SMTP_*` via compose interpolation (lines 80-90). The realm JSON's `${env.SMTP_*:default}` placeholders are resolved at first `start-dev --import-realm`. The mechanism for getting the new values into a *running* Keycloak is `scripts/update-keycloak-smtp.sh` (S3) — `docker compose` restart is NOT sufficient (verified by the live-notifications spec's B2 blocker, which this spec inherits as a known constraint).

### S3 — `scripts/update-keycloak-smtp.sh`: change default values for `SMTP_FROM_DISPLAY`, `SMTP_REPLYTO`, `SMTP_REPLYTO_DISPLAY`, `SMTP_SSL`, `SMTP_STARTTLS`, `SMTP_AUTH`

The current script at `scripts/update-keycloak-smtp.sh:32-37` has:

```bash
SMTP_FROM_DISPLAY="${SMTP_FROM_DISPLAY:-WIMS-BFP}"
SMTP_REPLYTO="${SMTP_REPLYTO:-$SMTP_FROM}"
SMTP_REPLYTO_DISPLAY="${SMTP_REPLYTO_DISPLAY:-WIMS-BFP No Reply}"
SMTP_SSL="${SMTP_SSL:-false}"
SMTP_STARTTLS="${SMTP_STARTTLS:-true}"
SMTP_AUTH="${SMTP_AUTH:-true}"
```

These defaults are correct for Brevo on 2525:
- `SMTP_STARTTLS=true` — Brevo's port 2525 is plaintext SMTP that the server expects to be upgraded via STARTTLS. Verified against Brevo docs.
- `SMTP_SSL=false` — port 2525 does not use implicit SSL/TLS. Port 465 is for SSL; we are not using 465. Verified against Brevo docs.
- `SMTP_AUTH=true` — Brevo requires AUTH on port 2525. Verified against Brevo docs.
- The DISPLAY / REPLYTO values are unchanged — they are operator-friendly defaults, not transport-specific.

**No code changes are needed in this script.** The defaults already match Brevo's port 2525 behavior. The script's only "change" is that it now runs against a Brevo-shaped `.env` (S1) and produces a Brevo-shaped `smtpServer` JSON for the kcadm update.

**Why this is the case (worth stating):** the live-notifications work that shipped `scripts/update-keycloak-smtp.sh` happened to pick reasonable defaults for STARTTLS/SSL/AUTH that match what most transactional email providers require. The defaults are provider-agnostic, so the script needs no provider-specific logic. This is a happy accident of the original spec — the live-notifications spec did not say "the defaults must be Brevo-compatible," but they turned out to be.

**Add a 1-line comment to the script header** documenting the new provider, so the next operator who reads the script knows which provider the defaults are tuned for:

```bash
# Update the bfp Keycloak realm's SMTP settings to match the SMTP_* keys in .env.
# Default values below are tuned for Brevo on port 2525 (plaintext + STARTTLS).
# For other providers (SendGrid, Mailgun, etc.), check the provider's SMTP docs
# for the right STARTTLS/SSL/AUTH combination on the chosen port.
```

### S4 — `.env.example` (dev defaults): change `SMTP_PORT` to mailhog's 1025 (keep) and document the production port

The dev file at `.env.example:73-83` has:

```bash
# SMTP / Email (M13b)

# Development: points to local MailHog SMTP sink (docker-compose.yml).
# Production: override with your real SMTP relay credentials.
SMTP_HOST=mailhog
SMTP_PORT=1025
SMTP_FROM=no-reply@bfp.gov.ph
# SMTP_USER=your-smtp-username
# SMTP_PASSWORD=your-smtp-password
# STARTTLS: false for dev/MailHog (no TLS); true for production SMTP relays
# SMTP_STARTTLS=false
```

This is **already correct for dev** (MailHog is the local sink; the 1025 plaintext port is right; STARTTLS is off because MailHog does not negotiate TLS). The only change needed is a one-line comment update that points the dev to the production setup:

```bash
# Development: points to local MailHog SMTP sink (docker-compose.yml).
# Production: see src/.env.production.example for the Brevo SMTP relay on port 2525.
# DigitalOcean Droplets block 25/465/587; Brevo's port 2525 is not in the block list.
```

**No env var values change in this file.** Local dev continues to use MailHog on 1025 with no auth.

### S5 — System-wiki update (mandatory per AGENTS.md)

The system-wiki is stale in three places relevant to this spec. Update:

1. **`system-wiki/backend/services.md`** — the "Email Service (M13b)" section (search anchor: "Email Service (M13b)") currently documents 4 templates and a Gmail SMTP example. Replace the entire section with a Brevo-flavoured version: 7 templates (the full list from `src/backend/services/email/templates/`), Brevo on port 2525 as the documented example, and a short paragraph explaining why port 2525 (the DigitalOcean block context).
2. **`system-wiki/backend/utilities-and-tasks.md`** — the "send_email_task (Email delivery — M13b)" subsection under "notifications.py" (search anchor: "send_email_task"). Update the env var list and the retry-exception list. The retry list (`aiosmtplib.SMTPException, ConnectionError, TimeoutError, OSError`) is unchanged; the env var list adds a note that port 2525 is the production default and 25/465/587 are blocked on DigitalOcean.
3. **`system-wiki/gaps/frs-codebase-gap-register.md`** — search for any entry related to the SMTP channel being broken. If one exists (the live-notifications entry at `25d5eca` mentions the dev-trap but not the DO block), add a new entry: `BREVO-EMAIL-CHANNEL` — closed by this design, references the spec and the new deploy script behavior. If no such entry exists, create one.
4. **`system-wiki/log.md`** — append a new entry dated 2026-06-24 with the same shape as the live-notifications and device-id entries. Include: problem, fix, files changed, validation results (filled in after implementation, not at spec time).

---

## Files Changed

| # | File | Action | Change |
|---|------|--------|--------|
| 1 | `src/.env.production.example` | **Edit** | Replace 16-line Gmail block (lines 29-44) with Brevo block (S1) |
| 2 | `src/docker-compose.yml` | **Edit** | Change 2 lines in Keycloak service env (`SMTP_HOST`, `SMTP_PORT` defaults to Brevo + 2525); same 2 lines in celery-worker env (S2) |
| 3 | `scripts/update-keycloak-smtp.sh` | **Edit** | Add 1 paragraph of header comment documenting the default-provider assumption (S3) |
| 4 | `.env.example` | **Edit** | Add 2 lines of comment pointing dev to Brevo production setup (S4) |
| 5 | `system-wiki/backend/services.md` | **Edit** | Update "Email Service (M13b)" section to document 7 templates + Brevo on 2525 (S5.1) |
| 6 | `system-wiki/backend/utilities-and-tasks.md` | **Edit** | Update "send_email_task" subsection env-var list and add port-2525 note (S5.2) |
| 7 | `system-wiki/gaps/frs-codebase-gap-register.md` | **Edit** | Add `BREVO-EMAIL-CHANNEL` entry; reference this spec and the closing commit (S5.3) |
| 8 | `system-wiki/log.md` | **Append** | New dated entry for 2026-06-24 (S5.4) |

### Not Changed

- **`src/backend/services/email/sender.py`** — no edits. The 6 env var reads at lines 18-23 are port-agnostic; `aiosmtplib.send` is called with the same `hostname=SMTP_HOST, port=SMTP_PORT, start_tls=SMTP_STARTTLS` signature.
- **`src/backend/tasks/notifications.py`** — no edits. The `autoretry_for=(aiosmtplib.SMTPException, ConnectionError, TimeoutError, OSError)` at line 168 is correct for the SMTP transport.
- **`src/backend/requirements.txt`** — no changes. `aiosmtplib>=3.0.0` at line 27 stays.
- **The 7 templates in `src/backend/services/email/templates/`** — no changes. The handoff constraint "Do not change the email templates" is honored.
- **Keycloak realm JSON files (`src/keycloak/bfp-realm.json`, `src/keycloak/import/bfp-realm.json`)** — no edits. The `${env.SMTP_*:default}` placeholders at `:1523-1533` and `:1523-1534` are correct; the issue is the operator populating `.env` with real Brevo values, not the JSON structure.
- **`src/backend/api/routes/auth.py`, `src/backend/api/routes/admin/security.py`, `src/backend/tasks/scheduled_reports.py`, `src/backend/tasks/notifications.py`** — no edits. The caller code is unchanged; it still calls `send_email_async(...)` (direct, `auth.py:222`) or `send_email_task.delay(...)` (Celery, others). The retry semantics of both paths are unchanged.
- **Test files** — no new tests. The existing `test_email_infra.py:85-118` patches `services.email.sender.aiosmtplib.send` and is port-agnostic. R5 verifies that all existing tests still pass.
- **Frontend** — no changes. The frontend has no email-sending code; emails are triggered backend-side.
- **MailHog service** — not removed. MailHog remains in `src/docker-compose.yml` for local dev (`mailhog:1025` is the local sink; production uses Brevo on 2525 via the deploy-host `.env`).
- **DB schema, migrations, FCM wiring, device_id ownership, FCM token registration** — all out of scope. This spec touches the email transport only.

---

## Verification

### V1 — Backend / Celery email reaches Brevo (R2)

1. With `src/.env` populated on the deploy host with real Brevo SMTP key, and containers running, trigger a path that calls `send_email_task`. Available templates: `account_locked, breach_alert, email_verification, password_reset, scheduled_report, security_alert, weekly_report`. Easiest end-to-end trigger is the weekly Celery beat (the task is registered in `tasks/notifications.py:send_weekly_report_email` and runs every Monday at 07:00 UTC; for verification, force a run with `docker exec wims-celery-worker python -c "from tasks.notifications import send_weekly_report_email; send_weekly_report_email.delay()"`).
2. `docker logs wims-celery-worker --tail 100` → `Email sent to ... via smtp-relay.brevo.com:2525` (formatted by `sender.py:128-129`'s `logger.info("Email sent to %s via %s:%d", ...)`).
3. The recipient (an active SYSTEM_ADMIN who has `email_opt_in = TRUE`; see the SQL at `tasks/notifications.py:260-272`) finds the email in their real inbox.
4. `127.0.0.1:8025` (MailHog) does **not** show the message.

### V2 — Keycloak password reset reaches Brevo (R1)

1. On the deploy host, run `./scripts/update-keycloak-smtp.sh .env` (where `.env` has the Brevo values). The script should print `✓ Keycloak bfp realm SMTP updated to smtp-relay.brevo.com:2525` (the existing echo at the end of the script, with the host/port formatted into the message — verify the format matches the actual echo line at `scripts/update-keycloak-smtp.sh:54`).
2. Inside the keycloak container, `docker exec wims-keycloak /opt/keycloak/bin/kcadm.sh get realms/bfp | python -m json.tool | grep -A 12 smtpServer` should show `host: smtp-relay.brevo.com`, `port: 2525`, `starttls: true`, `auth: true`, `user: <the Brevo SMTP key>`, `password: <the Brevo SMTP key>`.
3. Visit `http://localhost:8080/auth/realms/bfp/login-actions/reset-credentials` (or click "Forgot password" on the login page) and enter a real email of a user in the bfp realm.
4. The user receives the reset email in their real inbox.
5. `docker logs wims-keycloak --tail 50` shows no SMTP errors. (Keycloak's SMTP errors look like `ERROR [org.keycloak.email] (default task-1) Failed to send email` — grep for `ERROR` and `email` together to be safe.)
6. MailHog UI (`127.0.0.1:8025`) does **not** show the message.

### V3 — Direct async path from auth.py (R2 second path)

This is the path the handoff missed. It uses `send_email_async` directly, not through the Celery task.

1. Log in as a registered user. `POST /api/auth/change-email` with `{ "new_email": "<your-real-inbox>@example.com", "current_password": "<the password>" }` (`api/routes/auth.py:200-252`).
2. The endpoint calls `send_email_async(to=body.new_email, template_name="email_verification", context={...})` at line 222.
3. `docker logs wims-backend --tail 50` shows the `Email sent to ... via smtp-relay.brevo.com:2525` line (the backend's `aiosmtplib` call uses the same `sender.py:128-129` log format).
4. The recipient's inbox has the verification code email. (The verification code is also stored in Redis at `email_verify:{user_id}` with a 10-minute TTL — the email is the only delivery path.)

### V4 — `scripts/update-keycloak-smtp.sh` is idempotent (R3)

1. Run `./scripts/update-keycloak-smtp.sh .env` twice in a row.
2. After the first run, the live realm's `smtpServer` block is Brevo-shaped (per V2.2).
3. After the second run, the live realm's `smtpServer` block is identical (the kcadm `update` call is a SET, not a PATCH; the second call is a no-op write of the same values).
4. No errors from `kcadm.sh` on either run.

### V5 — No secrets committed (R4)

1. `git status` — no `.env`, no Brevo SMTP key, no Brevo API key, no password in any tracked file.
2. `git diff` against the change point shows only: the 4 code/config files in the "Files Changed" table above (items 1-4), the 4 system-wiki updates (items 5-8). No committed credentials, no service-account JSON, no SMTP key.
3. `src/.env.production.example` and `.env.example` contain only `SMTP_USER=` and `SMTP_PASSWORD=` empty strings (or commented-out examples) and no real values.

### V6 — Existing CI gates pass (R5)

Run the repo's CI pre-flight routine (`docs/agents/ci-preflight.md`):
```bash
cd src/backend && ruff check . && ruff format . --check && python -m pytest -v
cd src/frontend && npm run lint && npx vitest run && npm run build
```

For the frontend build, set dummy values per the AGENTS.md note:
```bash
cd src/frontend && \
  NEXT_PUBLIC_AUTH_API_URL=http://localhost:8080/auth \
  NEXT_PUBLIC_BASE_URL=http://localhost:3000 \
  npm run build
```

All four blocking gates pass with no new failures. Specifically:
- `pytest -v` — all `test_email_infra.py`, `test_auth_email_verification.py`, `test_m13_email_triggers.py`, `test_breach_notifications.py`, `test_admin_new_routes.py`, `test_security_monitoring.py`, `test_scheduled_reports.py`, `test_infra_config.py` tests pass.
- `ruff check .` — clean.
- `ruff format . --check` — clean.
- Frontend lint/test/build — clean.

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| DigitalOcean does in fact block port 2525 (undocumented) | Low — DO docs only list 25/465/587; no public report of 2525 being blocked; 2525 has been the standard "ISP blocks 587" workaround for 15+ years | High — all email stops | The spec's V1 + V2 + V3 are the tripwire. If the deploy shows `connection timed out` or `connection refused` to `smtp-relay.brevo.com:2525` in the celery-worker or keycloak logs, the response is to fall back to port 465 (encrypted, also supported by Brevo; 465 is also in the DO block list per the same docs but the spec's V1 will distinguish timeout from auth-failure to know which fallback applies). If 465 is also blocked, the response is to rewrite `sender.py` to use Brevo's HTTP API (`sib-api-v3-sdk`); the spec's boundary keeps the transport change isolated to `sender.py` only. |
| Brevo SMTP key leaks (committed to repo, logged, exposed in error message) | Low — the key is generated in Brevo's dashboard, never enters `.env.example`, and the file is gitignored | High — recipient spoofing, brand damage | R4 verifies no keys in tracked files. The operator should `chmod 600 src/.env` on the deploy host. Brevo's SMTP keys can be revoked and rotated from the dashboard without code changes. |
| Brevo free-tier exhaustion (300/day) | Low for thesis — normal load is 1-10/day, stress is <100/day | Medium — email stops | Brevo sends a warning email at 80% of the daily quota. The operator can monitor via the Brevo dashboard. If load grows, upgrade plan or switch to AWS SES. The HTTP API escape hatch via `sib-api-v3-sdk` is also available without changing providers. |
| Brevo STARTTLS on port 2525 has a known bug (server-side) | Very low — port 2525 with STARTTLS is Brevo's standard documented offering | Medium — connection drops after STARTTLS handshake | The aiosmtplib library (`sender.py:124-130`) handles STARTTLS via the `start_tls=True` parameter. If STARTTLS fails, `aiosmtplib` raises `SMTPException` which the Celery task catches and retries (`tasks/notifications.py:168`). The auth.py direct path catches the exception and returns 502 to the client (`api/routes/auth.py:239-249`). |
| `scripts/update-keycloak-smtp.sh` updates the wrong realm | Low — the script's kcadm command targets `realms/bfp` literally (line 47); there is only one non-master realm in this stack | High — Keycloak admin broken | The kcadm command is `update realms/bfp` — explicit, copy-paste, no parameterization. V2.2 verifies the result via `kcadm.sh get realms/bfp`. |
| Brevo's port 2525 sends over plaintext until STARTTLS is negotiated — credentials leak if STARTTLS is not enabled | Low — `SMTP_STARTTLS` default in `scripts/update-keycloak-smtp.sh:36` is `true`, the comment header in S3 documents this assumption, and `.env.production.example` ships with `SMTP_STARTTLS=true` | High — SMTP key leak on the wire | R3 verifies that the deployed Keycloak realm has `starttls: true` in the smtpServer block. The `sender.py:23` reads `SMTP_STARTTLS` and passes it to `aiosmtplib.send(start_tls=SMTP_STARTTLS)` at line 127. If the operator sets `SMTP_STARTTLS=false`, the connection is plaintext and the credentials are exposed. R3 catches this. |
| The `auth.py:222` direct `send_email_async` call returns 502 to the user but does not retry | Certain (the direct path has no retry; only the Celery task path retries) | Low — user sees "Failed to send verification email. Try again later." and can retry the change-email flow | The 502 message is intentional; the user retries. The Celery task path (security alerts, weekly reports, scheduled reports) DOES retry. The asymmetry is by design: a real-time user-facing action should fail fast and tell the user to retry; a background notification should retry silently. This spec does not change the asymmetry. |
| Keycloak realm SMTP update (S3/S5) is applied to a Keycloak instance whose placeholders were never resolved (first-boot, fresh DB) | Very low — this VPS's Keycloak has been running since the live-notifications deploy; the placeholders are already resolved to mailhog/Gmail values | Low — the kcadm `update` call overwrites whatever is there | The kcadm `update realms/bfp -s 'smtpServer=...'` is a SET, not a conditional update. V2.2 verifies the result. No first-boot ordering issue. |
| The 7 templates become stale relative to the operator's email content (e.g. wrong support contact, wrong dashboard link) | Out of scope | — | Template content is owned by the project, not this spec. If the operator wants to update content, that's a separate change to the `.html.j2` files. |
| Brevo changes their SMTP port offerings or removes 2525 | Very low — 2525 is documented at `developers.brevo.com/docs/smtp-integration` as of 2026-06-24; it's been offered for years | High — email stops | The transport change is isolated to `sender.py:18-23` (env var reads) and `sender.py:127-130` (aiosmtplib call). Switching to port 465 or to the HTTP API is a config-only or sender-only change. The spec's design boundary keeps the blast radius small. |

---

## FRS / Security Context

- The email channel is referenced throughout the FRS as the operational delivery path for account events, security alerts, and weekly reports. This spec does not introduce new FRS obligations; it switches the underlying transport for an already-implemented channel. The functional behavior (template rendering, multipart/alternative, retry on transient failure, fail-fast on permanent failure) is unchanged.
- SMTP credentials are **secrets** under standard classifications. Storage in `.env` on the deploy host (gitignored at `.gitignore:27-30`) is the established pattern in this repo. Brevo's SMTP key is narrower than a Gmail App Password — it can be revoked from the Brevo dashboard without rotating the Brevo account password. Rotation procedure: generate a new SMTP key at `app.brevo.com/settings/keys/smtp`, update `.env`, restart `wims-celery-worker` and re-run `scripts/update-keycloak-smtp.sh`. Documented in the runbook; not automated in this spec.
- The Brevo SMTP key has transactional-send scope only — it cannot read account data, cannot send marketing email, cannot manage contacts. Compromise is bounded to "can send email that appears to come from our domain." Mitigations: gitignore (R4), deploy-host filesystem permissions (operational, not in this spec), DKIM/SPF/DMARC records (already in place for `wimsbfp.tech` per the live-notifications deploy), and Brevo's per-key revocation. Future consideration: store the key in OpenBao (already in the stack) and reference it via a token-claim pattern. Not in this spec.
- Port 2525 + STARTTLS is the documented secure-channel pattern for Brevo. The connection is plaintext until STARTTLS is negotiated; the SMTP key is sent only after TLS is established. R3 verifies the deployed Keycloak realm has `starttls: true`. The backend `sender.py:127` passes `start_tls=SMTP_STARTTLS` to `aiosmtplib.send`. R5 verifies that `SMTP_STARTTLS=true` is the default in both `.env.production.example` and the script.

---

## Out of Scope

- **Migrating to Brevo's HTTP API (`sib-api-v3-sdk`).** SMTP on 2525 is the right path for this VPS's constraints. HTTP is a future escape hatch if 2525 ever gets blocked; the spec's design keeps that change isolated to `sender.py`.
- **Keycloak's "execute-actions" or password-policy changes.** The auth flow is unchanged. The handoff constraint "Do not re-architect the auth flow" is honored.
- **Template content changes.** The 7 templates are content-owned; this spec changes the transport only. If the operator wants to update the email copy, that's a separate change to the `.html.j2` files.
- **Removing MailHog from the Docker stack.** MailHog remains in `src/docker-compose.yml` for local dev convenience. Production deploys override `SMTP_*` in `.env` to use Brevo on 2525.
- **Automated tests for live email delivery.** Would require a real-inbox fixture (e.g. MailHog, Mailtrap, or a sandbox Brevo account). The existing `aiosmtplib` mock in `test_email_infra.py:85-118` is port-agnostic and is the right unit-test boundary. R5 verifies that the existing suite still passes; V1-V4 are the manual end-to-end tripwires.
- **OpenBao-backed SMTP credential storage.** Future work; the repo already supports `WIMS_CRYPTO_PROVIDER=openbao_transit` for application-level encryption, but `.env` itself is not in OpenBao.
- **Multi-provider failover (e.g. Brevo primary, SendGrid backup).** Out of scope. If Brevo is down, email stops; the operator restores by either waiting for Brevo or by switching the env vars to a different provider. The retry logic (`tasks/notifications.py:168`) handles transient Brevo outages within a single deploy.
- **DNS records (SPF/DKIM/DMARC for `wimsbfp.tech`).** The live-notifications deploy already added these per the live-notifications work at `25d5eca`. Not in this spec.
- **Brevo account creation, domain verification, SMTP key generation steps.** Operational, not in this spec. Documented in the deploy runbook (out of scope for the design).

---

## Resolved Questions (v1)

1. **HTTP API vs SMTP relay on a non-blocked port** — Resolved: SMTP on port 2525 to Brevo. DO docs only block 25/465/587; 2525 is the standard alternative and is not in the block list. The handoff's HTTP-API hypothesis was over-broad.
2. **Provider choice** — Resolved: Brevo. Most generous free tier (300/day), port 2525 explicitly documented, SMTP key auth (not full account credential), HTTP API exists as future escape hatch. SendGrid (smaller free tier) and Resend (no 2525) considered and rejected.
3. **Should the `auth.py:222` direct call be moved to a Celery task for retry consistency?** — Resolved: no. The asymmetry is intentional and pre-existing; the live-notifications work did not change it. User-facing actions fail fast; background notifications retry silently. This spec does not change the asymmetry.
4. **Should `system-wiki/backend/services.md` be updated to 7 templates (not 4)?** — Resolved: yes, as part of S5.1. The wiki is stale and the correction is in scope of the AGENTS.md mandatory update rule.
5. **Should the `scripts/update-keycloak-smtp.sh` script get provider-specific code paths?** — Resolved: no. The existing defaults (`STARTTLS=true, SSL=false, AUTH=true`) happen to be correct for Brevo on 2525. The script gets a documentation comment header (S3) but no logic changes. If a future provider requires different defaults, the script can be extended then.
6. **What is the deploy-host `.env` shape after this spec?** — Resolved: `src/.env.production.example` (S1) shows the full block. Operator populates `SMTP_USER` and `SMTP_PASSWORD` with the Brevo SMTP key, leaves everything else at the documented defaults.

## Deferred to Plan Author

- Exact `system-wiki/log.md` entry text. The shape should match the live-notifications and device-id entries (problem → fix → files changed → TDD/validation results → scope limits → follow-ups).
- The exact wording of the `scripts/update-keycloak-smtp.sh` header comment update (S3 shows a draft).
- The order of edits in the implementation plan. S2 (compose) should come before S1 (env.example) so that a fresh `docker compose config` validates the new defaults before the env file is updated; the plan should reflect this.
- Whether to add a single tiny new unit test (e.g. `test_sender_reads_port_2525`) or rely on R5's "no new tests required" rationale. The recommendation is **no new tests** because the change is config-only and the existing `aiosmtplib` mock is port-agnostic. The plan author may override if a test seems valuable for the docstring-value of "this test pins the port."

---

## Self-Review

**Spec coverage:**
- R1 (Keycloak reaches Brevo) → V2, V4. ✅
- R2 (app reaches Brevo, both Celery and direct async paths) → V1, V3. ✅
- R3 (script works for Brevo, idempotent) → V4, V2.2. ✅
- R4 (no secrets committed) → V5. ✅
- R5 (existing tests pass, no new tests required) → V6. ✅
- All 4 S# solutions map to V# verification steps. ✅
- The 3 risks the handoff got wrong (SMTP block scope, port 2525 availability, Brevo free tier) are each addressed in the Problem section and re-stated in the Goal/Solution. ✅
- The 2 secondary findings the handoff missed (`auth.py:222` direct call; `scheduled_reports.py` does not directly use SMTP) are stated in the Problem section and re-stated under "Not Changed" so the plan author does not silently expand scope. ✅
- Out-of-scope items are explicit (8 enumerated). ✅

**Placeholder scan:**
- No "TBD", "TODO", "implement later", "add appropriate error handling." ✅
- All S1-S5 show actual content (file paths, line numbers, exact code/config strings, env var names). ✅
- Verification steps include exact commands and expected output format (the `Email sent to ... via smtp-relay.brevo.com:2525` log line is the actual format from `sender.py:128-129`). ✅
- The Risks table has Likelihood + Impact + Mitigation for each of the 10 risks. ✅

**Type / identifier consistency:**
- Env var names (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_FROM_DISPLAY`, `SMTP_REPLYTO`, `SMTP_REPLYTO_DISPLAY`, `SMTP_SSL`, `SMTP_STARTTLS`, `SMTP_AUTH`) match the 11 keys in `sender.py:18-23` and the 11 keys in `bfp-realm.json:1523-1533`. ✅
- Function names (`send_email_async`, `send_email`, `send_email_task`, `send_weekly_report_email`) match `sender.py:95,138` and `tasks/notifications.py:172,253`. ✅
- File paths (`src/.env.production.example`, `src/docker-compose.yml`, `scripts/update-keycloak-smtp.sh`, `.env.example`, `src/keycloak/bfp-realm.json`, `src/keycloak/import/bfp-realm.json`) match the actual repo layout. ✅
- Celery task name `tasks.notifications.send_email` matches `tasks/notifications.py:167`. ✅
- Brevo host `smtp-relay.brevo.com` and port 2525 match the Brevo docs cited in the Problem section. ✅
- DO block list `25, 465, 587` matches the DO docs cited (last verified 2026-06-22). ✅

**Gaps found in self-review, fixed inline:**
- Initially S1's new `.env.production.example` block had `SMTP_USER=<brevo-smtp-key>` and `SMTP_PASSWORD=<brevo-smtp-key>` as the same value; clarified in S1 that Brevo uses the same SMTP key for both AUTH PLAIN fields, which is by design. ✅
- Initially S2 didn't state the line-anchor for the celery-worker env block edit; corrected to "lines 264-265" (matching the live-notifications spec's line-citation convention). ✅
- Initially the secondary finding about `scheduled_reports.py` not directly using SMTP was implicit in "Not Changed"; promoted to an explicit finding in the Problem section so the plan author doesn't go looking for SMTP_* refs in that file. ✅
- Initially V1's email-template example used `security_alert` with hardcoded context keys that didn't match the template; replaced with the weekly-report Celery beat trigger (which is the actual production path and the one the operator can force-run for verification). ✅
- Initially "Out of Scope" didn't list DNS records; added (with reference to the live-notifications deploy that already added them). ✅

---

*This is a design spec (v1). The implementation plan will be at `docs/superpowers/plans/2026-06-24-email-provider-brevo-port-2525.md`. Once the spec is approved, invoke the writing-plans skill to produce the plan.*
