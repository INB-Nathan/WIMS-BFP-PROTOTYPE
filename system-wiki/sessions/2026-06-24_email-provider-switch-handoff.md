# Handoff: Switch Email Provider (SMTP Blocked on DigitalOcean)

**Date:** 2026-06-24
**For:** A fresh agent session that will replace the current Gmail-SMTP email path with an HTTP-API-based provider that works on the DigitalOcean VPS.
**Created from:** A previous session that shipped the live-notifications SMTP + FCM wiring (now on `master` at `25d5eca`) and the device_id ownership fix (now on `master` at `8427b533`).

---

## What the next session is for

The current email channel is broken at the network layer on production. The VPS (DigitalOcean, 2 CPU / 8 GB) blocks outbound traffic on SMTP ports (25, 465, 587) to external relays like `smtp.gmail.com`. The live-notifications work at `25d5eca` wired `aiosmtplib` + Gmail SMTP correctly, but emails never arrive because the TCP connection times out. The handoff received at the start of the previous session called this out ("Email channel is blocked at the network layer on the VPS"); the previous session left it as-is because the user-visible bug at the time was the device_id tracking 404 (now fixed at `8427b533`).

**The next session's job:** swap the SMTP transport for an HTTP-API-based email provider. All major email providers (SendGrid, Mailgun, Postmark, Resend, Brevo, Mailjet, AWS SES) expose HTTP APIs that do NOT use SMTP, so they will work on DigitalOcean where SMTP egress is blocked.

The next session should pick a provider based on its own research (pricing, deliverability, free tier, Python SDK quality, regional support). The recommendation section below is a starting hypothesis, not a directive. The user explicitly wants the next session to do its own diligence.

---

## Current state of the email infrastructure (as of `8427b533`)

The email send path is two layers deep:

### Layer 1: The app's `aiosmtplib` SMTP client

**File:** `src/backend/services/email/sender.py` (141 lines)

The function `send_email_async(to, template_name, context)` is the only sender. It:
1. Renders a Jinja2 HTML template from `src/backend/services/email/templates/<name>.html.j2` (7 templates: `scheduled_report`, `weekly_report`, `breach_alert`, `security_alert`, `account_locked`, `email_verification`, `password_reset`).
2. Extracts the subject from a `{# subject: ... #}` header line in the template.
3. Builds an `EmailMessage` with `multipart/alternative` (HTML + plain text).
4. Calls `aiosmtplib.send(msg, hostname=SMTP_HOST, port=SMTP_PORT, username=..., password=..., start_tls=SMTP_STARTTLS)`.

It reads **6 env vars** at module-load time (lines 18-23):
```python
SMTP_HOST = os.getenv("SMTP_HOST", "mailhog")
SMTP_PORT = int(os.getenv("SMTP_PORT", "1025"))
SMTP_FROM = os.getenv("SMTP_FROM", "no-reply@bfp.gov.ph")
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_STARTTLS = os.getenv("SMTP_STARTTLS", "false").lower() in ("true", "1", "yes")
```

A sync wrapper `send_email(...)` calls `asyncio.run(send_email_async(...))` for Celery.

### Layer 2: The Celery task

**File:** `src/backend/tasks/notifications.py:165-205`

```python
@celery_app.task(
    name="tasks.notifications.send_email",
    autoretry_for=(aiosmtplib.SMTPException, ConnectionError, TimeoutError, OSError),
    ...
)
def send_email_task(self, to: str, template_name: str, context: dict) -> dict:
    ...
    _send_email(to, template_name, context)
```

The Celery task retries on **SMTP-specific exceptions** (`aiosmtplib.SMTPException`), `ConnectionError`, `TimeoutError`, `OSError`. This is the right behavior for SMTP transport. **It needs to be re-thought for an HTTP transport** — `requests.exceptions.HTTPError`, `requests.exceptions.ConnectionError`, `requests.exceptions.Timeout` are the right analogues; a 4xx response from the provider is a permanent failure (don't retry); a 5xx is transient (retry).

The task is dispatched from:
- `api/routes/auth/sessions.py` (password reset, email verification)
- `api/routes/profile.py` (email change confirmation)
- `tasks/scheduled_reports.py:172` (weekly scheduled reports)
- Other admin routes (security alerts, breach notifications)

### Layer 3: Keycloak realm SMTP (separate from the app)

**Files:** `src/keycloak/bfp-realm.json:1530-1541` and `src/keycloak/import/bfp-realm.json:1523-1534`

The Keycloak realm has its own `smtpServer` config block. Keycloak uses this for:
- Password reset emails
- Email verification emails
- User invitation emails
- Other identity events

Keycloak's SMTP config is independent of the app's `aiosmtplib` config. They share the same 11 env var names but Keycloak reads them from `${env.SMTP_*:default}` placeholders in the realm JSON, while the app reads them from `os.getenv()` in `sender.py`.

The 5 SMTP env vars used by **Keycloak only** (not by the app):
- `SMTP_FROM_DISPLAY`, `SMTP_REPLYTO`, `SMTP_REPLYTO_DISPLAY`, `SMTP_SSL`, `SMTP_AUTH`

The script `scripts/update-keycloak-smtp.sh` updates the live Keycloak realm via `kcadm.sh` after the first `start-dev --import-realm` (which resolves `${env.SMTP_*}` placeholders only once and stores the resolved values in the Keycloak DB).

### Layer 4: Docker Compose + env files

**File:** `src/docker-compose.yml` — `celery-worker` `environment:` block has 6 `SMTP_*` lines (added in PR #448 followup, documented in the live-notifications work).

**File:** `src/.env.production.example:29-44` — documents all 11 SMTP env vars for production (the `.env.production` file on the VPS is gitignored and has real Gmail creds; these are stale but the structure matches).

**File:** `.env.example:73-83` — dev defaults pointing to `mailhog:1025` (local sink, no auth).

---

## What the next session should do

The user explicitly asked the next session to do **its own diligence** — brainstorm, verify, and form its own view rather than just picking a provider from a list. The starting point below is a hypothesis, not a directive.

Suggested workflow (treat as a suggestion, not a mandate):

1. **Brainstorm** — re-derive the constraint from the current code, explore provider options. Open questions worth investigating:
   - Should the app use the provider's **HTTP API** (no SMTP at all) or the provider's **SMTP relay** (e.g. `smtp.sendgrid.net` on port 587)? Most providers offer both. The HTTP API is more robust to network quirks; the SMTP relay is a smaller code change. **Confirm whether DigitalOcean also blocks the provider's SMTP relay** before assuming HTTP-only is required.
   - Should Keycloak's SMTP config also be updated, or should the app intercept Keycloak's "send email" events and route them through the new app-level sender? (The latter is a much bigger refactor — probably not in scope.)
   - Are there any email templates whose content assumes SMTP-specific behavior (e.g. attachment handling) that need to be re-checked? The 7 templates currently use `{# subject: ... #}` headers and standard HTML; should be transport-agnostic.
2. **Spec** — write a design spec at `docs/superpowers/specs/YYYY-MM-DD-email-provider-switch-design.md` following the project spec format. The `2026-06-23-live-notifications-design.md` is the closest size analogue — same shape, same constraint, same env-var pattern. Add a "Why HTTP API over SMTP" subsection even if the recommendation is SMTP-relay, so the trade-off is documented.
3. **Plan** — write an executable plan at `docs/superpowers/plans/YYYY-MM-DD-email-provider-switch.md` using the writing-plans skill template. TDD is appropriate: the sender is small, the wire-in has a clear contract (`async def send_email_async(to, template_name, context) -> None`), and the project uses test-driven patterns. The Celery task retry logic should be TDD'd carefully (4xx is permanent, 5xx is transient).
4. **CI pre-flight** before declaring done (ruff, pytest, npm lint/vitest/build with dummy `NEXT_PUBLIC_*` values per `docs/agents/ci-preflight.md`).
5. **System wiki update** per the AGENTS.md mandatory rule. The relevant synthesis page is likely `system-wiki/backend/utilities-and-tasks.md` (verify by reading the agent routing guide).

---

## Files the next session will likely touch (verify, don't assume)

Backend — the sender and Celery task (primary):
- `src/backend/services/email/sender.py` — replace `aiosmtplib` with HTTP client (or SMTP relay to the new provider). Keep the public function signature `async def send_email_async(to, template_name, context) -> None` and the sync wrapper. The retry logic, error mapping, and multipart handling are the changes; template rendering and subject extraction should stay.
- `src/backend/tasks/notifications.py:165-205` — update `autoretry_for` to HTTP-specific exceptions. Distinguish 4xx (permanent) from 5xx (transient) at the task level if the sender raises a single error type.
- `src/backend/requirements.txt` — add the provider's Python SDK (e.g. `sendgrid`, `mailgun`, `boto3` for SES, `resend`, `brevo-python`). Remove `aiosmtplib` if no other code uses it.
- `src/backend/services/email/templates/` — verify the 7 templates are transport-agnostic. They should be.

Backend — Keycloak SMTP (likely in scope; verify):
- `src/keycloak/bfp-realm.json:1530-1541` — update the `smtpServer` block to point at the new provider's SMTP relay (or HTTP endpoint if Keycloak supports it; it does not as of Keycloak 24).
- `src/keycloak/import/bfp-realm.json:1523-1534` — same.
- `scripts/update-keycloak-smtp.sh` — update the `kcadm.sh` invocation with the new SMTP_HOST / SMTP_PORT / credentials.

Backend — Docker Compose + env (likely in scope):
- `src/docker-compose.yml` — `celery-worker` `environment:` block: rename `SMTP_*` env vars if the new provider uses different names (e.g. `SENDGRID_API_KEY` instead of `SMTP_USER` + `SMTP_PASSWORD`). Decide on the new env var naming and document it.
- `src/.env.production.example` — update the documentation block (lines 29-44). Add a comment explaining the move away from Gmail SMTP and the reason (DigitalOcean SMTP block).
- `.env.example` — dev defaults for the new provider.

Tests:
- `src/backend/tests/test_email_infra.py` — update the SMTP-mock-based tests to use the new transport (HTTP mock or SMTP-relay mock).
- `src/backend/tests/test_auth_email_verification.py` — update `patch("api.routes.auth.send_email_async")` calls if the import path changes.
- `src/backend/tests/test_profile_email.py` — same.
- `src/backend/tests/test_m13_email_triggers.py` — same.
- `src/backend/tests/test_admin_new_routes.py:1191` — same.
- New test file: `src/backend/tests/test_<provider>_client.py` (or similar) — direct unit tests of the new HTTP client wrapper.

The next session may discover other files the previous session missed. That is the point of the user's "do your own diligence" instruction.

---

## Provider landscape (starting hypothesis — verify before committing)

All these providers offer HTTP APIs that do NOT require SMTP egress. The next session should pick based on its own research. The list is not exhaustive.

| Provider | Free tier | HTTP API | SMTP relay | Python SDK | Notes |
|---|---|---|---|---|---|
| **SendGrid** | 100 emails/day forever | Yes | `smtp.sendgrid.net:587` | `sendgrid` (official) | Most popular; mature; good docs. |
| **Mailgun** | 100 emails/day (trial), then 5,000/month free | Yes | `smtp.mailgun.org:587` | `mailgun` (official) | Good for transactional; routing rules. |
| **AWS SES** | 3,000/month (from EC2) | Yes | `email-smtp.<region>.amazonaws.com:587` | `boto3` (official) | Cheapest at scale; requires AWS account; sandbox mode requires recipient verification. |
| **Postmark** | 100 emails/month (test) | Yes | `smtp.postmarkapp.com:587` | `postmarker` (community) | Best-in-class deliverability; paid only above test tier. |
| **Resend** | 100 emails/day, 3,000/month | Yes | No | `resend` (official) | Modern, developer-friendly, React Email templates. HTTP-only. |
| **Brevo (Sendinblue)** | 300 emails/day | Yes | `smtp-relay.brevo.com:587` | `brevo-python` (official) | Generous free tier; transactional + marketing in one. |
| **Mailjet** | 200 emails/day (6,000/month) | Yes | `in-v3.mailjet.com:587` | `mailjet-rest` (official) | EU-based; good if data residency matters. |

**Recommendation hypothesis (verify):** SendGrid or Brevo for the free tier + mature SDK. AWS SES if cost-at-scale matters and an AWS account exists. **Resend** is the cleanest API and the smallest code change, but it's HTTP-only (no SMTP fallback) and the free tier is the smallest.

---

## Architectural context (for the brainstorm phase)

- The codebase uses a **template-rendered, multipart/alternative** email body (HTML + plain text fallback). The 7 templates in `src/backend/services/email/templates/` are Jinja2 with `{# subject: ... #}` headers — the render is transport-agnostic.
- The Celery task retry logic is the main behavioral change. The current `autoretry_for=(aiosmtplib.SMTPException, ...)` is wrong for HTTP transport — 4xx must be permanent (no retry) or it will burn Celery retries on bad payloads / bad API keys.
- The app's `send_email_async` is the only caller. It is called by the Celery task only. The async/sync split is intentional (Celery runs sync; the underlying client is async). Any new HTTP client should preserve this.
- The Keycloak realm SMTP config is a **separate concern** from the app's SMTP client. They share env var names but are read by different processes (the app's `sender.py` and Keycloak's internal `email-sending` subsystem). Both need to move to the new provider.
- DigitalOcean's SMTP block is a **well-documented network policy** (outbound port 25 is blocked by default on all droplets; ports 465 and 587 are blocked for new accounts until a support ticket lifts the restriction). HTTP egress on port 443 is unrestricted. This is why an HTTP-based email API is the right pattern for this VPS.
- The frontend has no email-sending code. The frontend triggers emails indirectly (password reset → backend → Celery task → sender). No frontend changes are needed.
- Pi-subagents main harness is preferred for orchestration. The `opencode-go/deepseek-v4-flash` model (per the user's earlier directive) is sufficient for this task — the spec/plan is detailed enough that reasoning is not the bottleneck.

---

## Constraints / non-goals (inherited from the previous session's discussion with the user)

- **Do not abandon email entirely.** FCM push is wired but not a substitute for email — Keycloak requires email for password reset, and the auth flows assume email is reachable. Email must work.
- **Do not break the public-facing sender API.** `services.email.sender.send_email_async` and `send_email` are called from `tasks/notifications.py:194` and possibly other Celery tasks. Keep the signature `(to, template_name, context) -> None`. Internal implementation can change.
- **Do not commit credentials.** All provider API keys go in gitignored env files (`.env.production` on the VPS, `.env` locally). Never in repo files.
- **Do not change the email templates.** The 7 Jinja2 templates are content owned by the project. Transport changes only.
- **Do not re-architect the auth flow.** The current "Keycloak sends its own password-reset emails" pattern is intentional (Keycloak owns the user lifecycle). Keep it; just point Keycloak at the new provider.
- **Do not change the FCM wiring.** The live-notifications work wired FCM; the device_id fix unblocked the FCM token registration path. FCM is a separate channel from email and is out of scope for this handoff.
- **Do not modify the live-notifications spec/plan.** Those are done and merged.
- **Do not touch the device_id fix.** Merged at `8427b533`; verified working on production by the user ("track my report fully works now"). Out of scope.

---

## Pointers (do not re-read in full unless needed)

- `docs/superpowers/specs/2026-06-23-live-notifications-design.md` — the live-notifications spec (the new email spec should follow the same Problem / Solution / Files Changed / Verification / Self-Review structure; the live-notifications spec is the right size analogue for this task).
- `docs/superpowers/plans/2026-06-23-live-notifications.md` — the live-notifications plan (writing-plans template style; the 3 verified blockers B1/B2/B3 are a good model for "what can go wrong" before declaring done).
- `docs/superpowers/specs/2026-06-24-civilian-device-id-ownership-design.md` — the device_id spec (the new email spec should follow the same "Files Changed" table format; this spec is a good size analogue for the "Files Changed" table).
- `AGENTS.md` (project root) — the project's hard rules: the 16 review gotchas, the system-wiki update rule, the CI pre-flight routine.
- `docs/agents/ci-preflight.md` — the four-gate CI routine (backend ruff lint, backend ruff format, backend pytest, frontend lint/test/build).
- `src/backend/services/email/sender.py` — the SMTP client (141 lines; the whole file is the change surface).
- `src/backend/tasks/notifications.py:165-205` — the Celery task (the retry logic is the second change surface).
- `src/keycloak/bfp-realm.json:1530-1541` — Keycloak's SMTP config block (separate from the app's).
- `scripts/update-keycloak-smtp.sh` — the post-deploy script that re-resolves `${env.SMTP_*}` in the live Keycloak realm.
- `docs/operations/manual-smoke-tests.md` — the manual smoke-test routine; the email channel has its own smoke test that the next session should add to.

---

## Suggested skills for the next session

The user has not explicitly named skills for this handoff (the previous handoff named `writing-plans` and `karpathy-guidelines`). Reasonable defaults for this task:

- **brainstorming** — per the superpowers "Process skills first" rule, before designing the fix. The user explicitly wants re-derivation, not a copy of this handoff's hypothesis.
- **writing-plans** — for the spec + plan format. Reference `docs/superpowers/plans/2026-06-23-live-notifications.md` for the project's writing-plans template style.
- **karpathy-guidelines** — for behavioral discipline (think before coding, simplicity, surgical changes, surface assumptions, goal-driven execution).
- **tdd** or **test-driven-development** — the sender rewrite is small enough to TDD cleanly; the Celery task retry logic has a clear contract (4xx permanent, 5xx transient) that TDD pins.
- **using-git-worktrees** — the live-notifications work used a worktree. This email change touches 1 backend file in earnest and 4-5 supporting files; a branch on the main checkout is fine, but a worktree is acceptable if the next session prefers isolation.
- **receiving-code-review** — if this handoff's hypothesis (provider list, trade-offs) is challenged during brainstorm, defend with evidence from the current code, not deference.

---

## How the previous session ended

The user asked the previous session to fix a device_id ownership bug, which turned out to be a backend encryption regression (PR #448 nulled the plaintext `device_id` column after moving it into the encrypted blob). The fix was a 4-line removal in `_encrypt_witness_pii()` plus two new HTTP round-trip tests plus a test-helper rename to make the foot-gun visible. The user verified the fix on production: "track my report fully works now."

The user then asked the previous session to write this handoff. The previous session did **not** open a branch, create a PR, modify any files, or commit anything related to the email provider switch. The repo is clean at `8427b533` (the device_id fix is the most recent commit).

The current `master` is at `8427b533`, 7 commits ahead of `25d5eca` (the live-notifications work). The local checkout is clean. The worktree at `.worktrees/feat-live-notifications` (from the prior deploy) is now merged; it can be removed or left.

The FCM channel is **fully wired** (PR added the `firebase-creds.json` mount + `FIREBASE_CREDENTIALS_PATH` + `SMTP_*` env vars to celery-worker), but was not end-to-end tested because the device_id bug blocked the FCM token registration path. **With the device_id fix now deployed, FCM token registration is testable for new submissions.** This is out of scope for the email handoff but worth noting as a "next thing to verify after this handoff's work is done."
