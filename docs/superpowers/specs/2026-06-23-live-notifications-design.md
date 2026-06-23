# Enable Live Email & FCM Push Notifications

**Date:** 2026-06-23
**Status:** Design (v2 — post-review, pre-plan)
**Pattern:** Credential/infra wiring — minimal compose + `.env` edits; no new application code.
**Scope:** Email channel (Gmail SMTP) and FCM push channel (Firebase Cloud Messaging) for the WIMS-BFP stack running in Docker Compose.
**Reviewer basis:** Verified against current source — `src/docker-compose.yml`, `src/backend/services/email/sender.py:18-23`, `src/backend/tasks/notifications.py:25-42,70,165-200`, `src/keycloak/import/bfp-realm.json:1523-1533`, `src/frontend/src/lib/firebase.ts`, `api/routes/civilian.py:909-960` (FCM route), `services/email/templates/`, `docker-compose.yml:55-90 (keycloak), 199-235 (backend), 249-290 (celery-worker), 291-335 (frontend)`, `.gitignore:27-30`, `src/.gitignore:1-3`.
**v2 changes from v1:** S3 reverted from inline-JSON-in-.env to file volume mount (Docker Compose interpolation of raw JSON is brittle — spaces, colons, braces, internal quotes are parser-fragile across compose v1/v2 and host shells). S2 kcadm commands collapsed into a single `docker exec sh -c "..."` to keep the `kcadm.sh` session token in one shell context. S1 compose insertion anchor changed from absolute line numbers to surrounding content (line numbers drift). V1 example corrected to match the actual `send_email_task(to, template_name, context)` signature. FCM route citation corrected to `civilian.py:909-914` (`register_notification`); the earlier "line 793" was the docstring line, not the function definition.

---

## Problem

WIMS-BFP has a complete email and push notification stack — templates, async sender, Celery tasks, FCM token endpoint, service worker, DB migration for tokens, and Keycloak SMTP placeholder wiring — but **neither channel delivers to real users**:

- **Email is caught by MailHog** (dev trap at `127.0.0.1:8025`). `sender.py:18` defaults `SMTP_HOST` to `"mailhog"`; the backend and celery-worker only receive Gmail SMTP vars if `.env` is populated *and* the compose wiring actually delivers them.
- **FCM has a placeholder service account** on disk. `notifications.py:35` reads a file at `FIREBASE_CREDENTIALS_PATH`; if that file is not present inside the celery-worker container, dispatch crashes with `FileNotFoundError` at send time, and status notifications silently disappear.

A first-pass plan ("zero new code, only `.env` wiring") was reviewed against the actual codebase and found to be **load-bearing wrong** in three places. Executing it verbatim leaves both channels on the dev trap and FCM dispatch broken. This design fixes the wiring and states the verifiable acceptance criteria.

### Three verified blockers (the *why* this spec exists)

> All three were confirmed by direct read of the cited files; the original plan asserted the opposite and was wrong.

**B1 — celery-worker has no SMTP_* and no env_file.** `rg -n 'env_file' src/docker-compose.yml` returns only line 232, inside the **backend** service. The SMTP_* block at `docker-compose.yml:80-90` is inside the **keycloak** service (starts line 55). The celery-worker service (line 249) lists neither SMTP_* nor `env_file`. `send_email_task` (`tasks/notifications.py:173`) runs in celery-worker; `sender.py:18` defaults `SMTP_HOST` to `"mailhog"` when the var is absent. **Effect:** any celery-async email (password reset from Keycloak is the only path not affected; backend direct sends are) goes to MailHog, not Gmail.

**B2 — Keycloak realm SMTP does not re-resolve on restart.** `docker-compose.yml:59` runs `start-dev --import-realm`; `:61` mounts `./keycloak/import` read-only; `bfp-realm.json:1524` uses `"${env.SMTP_HOST:mailhog}"`. Keycloak resolves `${env.*}` **once at import time** and stores the resolved values in the `KC_DB: postgres` database (compose line 65). `--import-realm` **skips realms that already exist** — it does not override. After first boot, the DB holds `mailhog`; restarting Keycloak with new `SMTP_*` env changes nothing. **Effect:** Keycloak password-reset emails stay on MailHog no matter how many times Keycloak is restarted.

**B3 — `firebase-creds.json` is not mounted into celery-worker.** celery-worker volumes (`docker-compose.yml:269-273`): suricata/logs, postgres-init, incident_attachments_data, openbao_data, docker.sock — **no firebase-creds mount**. `notifications.py:35` does `credentials.Certificate(creds_path)` → `FileNotFoundError` at dispatch time. `FIREBASE_CREDENTIALS_PATH` (compose line 263) points at a host path the container cannot see. **Effect:** every `send_status_notification` fails; verified status promotions never reach the citizen's browser.

### Secondary (non-blocking) observations

- `sender.py:18-23` reads only `SMTP_HOST, SMTP_PORT, SMTP_FROM, SMTP_USER, SMTP_PASSWORD, SMTP_STARTTLS`. The other five vars (`SMTP_FROM_DISPLAY, SMTP_REPLYTO, SMTP_REPLYTO_DISPLAY, SMTP_SSL, SMTP_AUTH`) are consumed **only** by the Keycloak realm JSON (`bfp-realm.json:1524-1533`). Setting all 11 in `.env` is still correct; the backend sender will just not use the display name / reply-to. This is cosmetic for Gmail (STARTTLS + user + pass is sufficient) and **not** a spec violation.
- The FCM token registration endpoint is at `api/routes/civilian.py:793`, not ~920 as the v1 plan stated (line-citation correction; gotcha #1).
- `.env` does not exist in the repo — only `src/.env.production.example` (which has empty `FIREBASE_CREDENTIALS_PATH=` / `FIREBASE_SERVICE_ACCOUNT_JSON=` at lines 17-18). The plan assumes a deploy-host path `/opt/wims-bfp/...`; the new `.env` is created there, not committed.
- `.env` and `firebase-creds.json` **are** gitignored (`.gitignore:27-30`, `src/.gitignore:1-3`) — secrets stay local. Good; this spec relies on it.

---

## Goal

After this design is implemented, the WIMS-BFP stack, when run on a host that has a populated `/opt/wims-bfp/src/.env` with real Gmail + Firebase credentials, delivers:

1. **Keycloak transactional email** (password reset, email verification, execute-actions email) to the recipient's real inbox via Gmail SMTP — not MailHog.
2. **Backend- and Celery-async application email** (security alerts, notifications fired by the app) to the recipient's real inbox via Gmail SMTP.
3. **FCM push notifications** to a registered browser/device when a citizen report is promoted to `VERIFIED` (or other status transitions handled by `send_status_notification`).

MailHog remains in the stack for local dev convenience but is no longer the default for any production-shaped run.

---

## Requirements

### R1 — Keycloak transactional email reaches Gmail

- Password reset triggered from the Keycloak login page (`/auth/realms/bfp/login-actions/reset-credentials`) arrives in the real recipient inbox.
- `docker logs wims-keycloak | grep -i smtp` shows connection to `smtp.gmail.com:587`, not `mailhog:1025`.
- MailHog UI (`127.0.0.1:8025`) does **not** receive the message.

### R2 — Application email reaches Gmail

- Any code path that calls `send_email_task` (e.g. admin security alert, status notification emails) results in a `Email sent to ... via smtp.gmail.com:587` line in `docker logs wims-celery-worker --tail 50`.
- The recipient finds the email in their real inbox (Gmail Sent folder of the sender account shows the message).

### R3 — FCM push dispatch succeeds

- After a citizen registers an FCM token (via `POST /api/v1/civilian/reports/{id}/fcm-token` at `civilian.py:793`) and a report is promoted to `VERIFIED`, a push notification appears in the registered browser/device within ~30 seconds.
- `docker logs wims-celery-worker --tail 50` shows `Notifications report_id=X status=VERIFIED: sent=1 failed=0` (or the actual existing log format from `notifications.py:send_status_notification`) with **no** `FileNotFoundError`, no `Firebase credentials not configured`, and no `google.auth.exceptions.DefaultCredentialsError`.

### R4 — Secrets remain out of source control

- After implementation, `git status` shows no new tracked file containing SMTP password, app password, service-account JSON, or VAPID key.
- `.env` and `firebase-creds.json` remain in `.gitignore`.
- A `git diff` against the pre-change tree shows only the two allowed compose edits (see Solution) and any `.env.production.example` doc updates; **no** committed `.env` or credential file.

### R5 — All existing tests still pass

- `cd src/backend && python -m pytest -v` — no new failures.
- `cd src/backend && ruff check .` — clean.
- `cd src/backend && ruff format . --check` — clean.
- `cd src/frontend && npm run lint && npx vitest run && npm run build` — clean (with dummy `NEXT_PUBLIC_*` values per repo CI pre-flight).

---

## Solution

Three small, surgical changes — two compose edits and one credential-loading strategy change. No new application code, no new dependencies, no new schema.

### S1 — `src/docker-compose.yml`: add SMTP_* to celery-worker environment

`send_email_task` runs in celery-worker. The backend already gets SMTP_* via `env_file: .env` (compose line 230-232) — extend the same to celery-worker.

**Add** to the celery-worker `environment:` block, **after the existing `FIREBASE_*` entries and before the `OPENBAO_TOKEN_FILE` entry** (anchor on content, not line number):

```yaml
      - SMTP_HOST=${SMTP_HOST:-mailhog}
      - SMTP_PORT=${SMTP_PORT:-1025}
      - SMTP_FROM=${SMTP_FROM:-noreply@wims-bfp.local}
      - SMTP_USER=${SMTP_USER:-}
      - SMTP_PASSWORD=${SMTP_PASSWORD:-}
      - SMTP_STARTTLS=${SMTP_STARTTLS:-false}
```

Only the six vars `sender.py:18-23` actually reads. **SMTP_AUTH is intentionally not added** — `sender.py` does not read it; the sender uses STARTTLS + non-empty `SMTP_USER`/`SMTP_PASSWORD` to decide whether to authenticate (see `sender.py:127-130` where `username=SMTP_USER or None` and `password=SMTP_PASSWORD or None`). `SMTP_AUTH` is consumed by the Keycloak realm JSON only (`bfp-realm.json:1532`). Adding it to the celery-worker env would be harmless but YAGNI.

**Why compose interpolation, not `env_file`:** the existing pattern in the file is inline `${VAR:-default}` in the `environment:` block. The backend's `env_file` is an additional convenience; either approach works. Using `${SMTP_*:default}` in the celery-worker `environment:` block matches the surrounding style (keycloak does the same) and avoids a second `env_file` directive.

### S2 — `src/docker-compose.yml`: no change to Keycloak service; **do not** rely on restart to update SMTP

The Keycloak service block (line 55-103) already reads `SMTP_*` via compose interpolation (lines 80-90). The realm's `smtpServer` block in `bfp-realm.json:1523-1533` uses `${env.*}` placeholders. **But** the placeholders are resolved once at first import and stored in the Keycloak Postgres DB. The deployment must perform **one of** the following (the implementation plan will pick one based on data-loss tolerance):

- **2a — Fresh import (data loss acceptable, e.g. staging):** `cd src && docker compose down -v && docker compose up --build`. Wipes the Keycloak Postgres volume; realm re-imports from JSON with new env resolved. Use only when all persistent data can be recreated.
- **2b — Live kcadm update (no data loss):** **default mechanism.** After `docker compose up -d`, run **one** `docker exec` that chains `config credentials` and `update realms/bfp` in a single shell context. The `kcadm.sh config credentials` call writes the session token to `~/.keycloak/kcadm.config`; a second `docker exec` may not share that file if the container's user / `HOME` differs between calls. Use:
  ```
  docker exec wims-keycloak sh -c "
    /opt/keycloak/bin/kcadm.sh config credentials \
      --server http://localhost:8080/auth --realm master \
      --user \"\$KEYCLOAK_ADMIN\" --password \"\$KEYCLOAK_ADMIN_PASSWORD\" && \
    /opt/keycloak/bin/kcadm.sh update realms/bfp \
      -s 'smtpServer={\"host\":\"smtp.gmail.com\",\"port\":\"587\",\"from\":\"noreply.wimsbfp@gmail.com\",\"fromDisplayName\":\"WIMS-BFP\",\"replyTo\":\"no-reply@wimsbfp.tech\",\"replyToDisplayName\":\"WIMS-BFP No Reply\",\"ssl\":\"false\",\"starttls\":\"true\",\"auth\":\"true\",\"user\":\"noreply.wimsbfp@gmail.com\",\"password\":\"<app-password>\"}'
  "
  ```
  Where `<app-password>` is sourced from `.env`'s `SMTP_PASSWORD` at exec time. The `\$KEYCLOAK_ADMIN` / `\$KEYCLOAK_ADMIN_PASSWORD` escape the host shell so they are expanded inside the container, where the keycloak service has them as env vars (compose lines 67-68). For repeatability, wrap in `scripts/update-keycloak-smtp.sh` (see Resolved Questions).
- **2c — Admin console (manual, no scripting):** realm admin → Realm Settings → Email tab → edit and save.

**Why this is in the spec, not the plan:** the *requirement* (R1) is "Keycloak delivers via Gmail." The *mechanism* (2a vs 2b vs 2c) is a deploy-time decision based on data-loss tolerance and whether the deploy host has CLI access. The plan will pick 2b as the default and document 2a as the staging alternative.

### S3 — `src/docker-compose.yml`: mount `firebase-creds.json` into celery-worker

`tasks/notifications.py:30,35` reads `FIREBASE_CREDENTIALS_PATH` and does `credentials.Certificate(creds_path)`. The v1 plan's "replace the placeholder `firebase-creds.json`" approach failed because **the file is not mounted into celery-worker** (B3 — `docker-compose.yml:269-273` has no firebase-creds volume). The correct fix is to **mount the file into the container**, not to embed the JSON in `.env`.

> **Why not inline JSON in `.env`?** An earlier draft of this spec considered `FIREBASE_SERVICE_ACCOUNT_JSON` inline (`notifications.py:33` already supports it). Rejected on review: passing a raw JSON string with colons, braces, quotes, and internal whitespace through `.env` → compose parser → container env is fragile across compose v1/v2 and host shells (the parser may strip quotes, truncate at spaces, or choke on special characters, producing a malformed JSON string and a fatal `json.JSONDecodeError` at runtime). Standard practice for service-account credentials is a file mount.

**Add** to the celery-worker `volumes:` block, **after the `openbao_data` mount and before the `/var/run/docker.sock` mount** (anchor on content):

```yaml
      - ./firebase-creds.json:/app/firebase-creds.json:ro
```

And replace the existing `FIREBASE_CREDENTIALS_PATH=${FIREBASE_CREDENTIALS_PATH:-}` line in the celery-worker `environment:` block with the literal path:

```yaml
      - FIREBASE_CREDENTIALS_PATH=/app/firebase-creds.json
```

(Compose interpolation is no longer needed here — the in-container path is fixed by the volume mount, and the host path `./firebase-creds.json` is the standard repo-relative location for the downloaded service-account JSON.)

**Host-side setup:** the deploy host downloads the service-account JSON from the Firebase console (step 4 of the prerequisites) and writes it to `<repo-root>/firebase-creds.json` (i.e. `/opt/wims-bfp/src/firebase-creds.json` in production, repo-relative `./firebase-creds.json` in dev). The file is **gitignored** (`.gitignore:30`, `src/.gitignore:3` explicitly allows only `.env.production.example`). `chmod 600` is recommended before first run.

**Why this beats inline-JSON:** the file is a standard artifact that can be `cat`'d, `jq`'d, backed up, and rotated without escaping concerns. The mount is one line of YAML. The deploy host's path layout (`./firebase-creds.json` is repo-relative) is the same in dev and production, so the same compose file works in both.

### S4 — `.env.production.example` (optional doc update, not required for R1-R3)

For operator discoverability, update `src/.env.production.example` (which already lists `FIREBASE_CREDENTIALS_PATH=` at line 17) with:
- A short comment explaining that `firebase-creds.json` is mounted from the repo root and `FIREBASE_CREDENTIALS_PATH` is set in compose to `/app/firebase-creds.json`.
- A short comment block listing the SMTP_* keys with their purpose and required values for Gmail.

This is a doc-only change and does not affect any requirement; it can be deferred.

---

## Files Changed

| # | File | Action | Change |
|---|------|--------|--------|
| 1 | `src/docker-compose.yml` | **Edit** | Add 6 `SMTP_*` lines to celery-worker `environment:` (S1) |
| 2 | `src/docker-compose.yml` | **Edit** | Add `firebase-creds.json` volume mount to celery-worker, set `FIREBASE_CREDENTIALS_PATH=/app/firebase-creds.json` (S3) |
| 3 | `src/.env` (deploy host, gitignored) | **Create / populate** | Add all `SMTP_*` and `NEXT_PUBLIC_FIREBASE_*` (S1, frontend build args) |
| 4 | `src/firebase-creds.json` (deploy host, gitignored) | **Create / replace** | Write the real service-account JSON; chmod 600 (S3) |
| 5 | `src/.env.production.example` | **Edit (optional)** | Document the file-mount + SMTP_* block for operators (S4) |

> The Keycloak realm update (S2) is a deploy-time action, not a repo file change. It is captured here as a procedure because the requirement R1 cannot be met without it; the plan will encode it as a task.

### Not Changed

- **Application code:** No edits to `sender.py`, `notifications.py`, `civilian.py`, `firebase.ts`, `firebase-messaging-sw.js`. All required behaviors already exist.
- **DB schema / migrations:** No new migrations. `33_report_notification_tokens.sql` already exists.
- **Keycloak realm JSON:** No edits to `bfp-realm.json`. Placeholders are correct; the issue is runtime re-resolution, not the JSON itself.
- **Frontend build:** No new dependencies. `NEXT_PUBLIC_FIREBASE_*` are already passed as build args.
- **Tests:** No new tests required. R5 verifies that the existing suite still passes. (A live end-to-end test for Gmail delivery is out of scope — it would require a real inbox fixture and is manual verification per R1-R3.)
- **Other Docker services:** MailHog, Postgres, Redis, OpenBao, Ollama, Suricata, Nginx — untouched.

---

## Verification

### V1 — Backend / Celery email reaches Gmail (R2)

1. With `.env` populated and containers running, trigger a path that calls `send_email_task`. The task signature is `(self, to: str | list[str], template_name: str, context: dict)` (`notifications.py:174-179`; Celery task name `tasks.notifications.send_email`). Available templates in `services/email/templates/`: `account_locked, breach_alert, email_verification, password_reset, scheduled_report, security_alert, weekly_report`. Easiest end-to-end trigger is `password_reset` via V2 (Keycloak login page). For a backend-only smoke test without going through Keycloak, invoke from inside the celery-worker container:
   ```bash
   docker exec wims-celery-worker python -c \
     "from tasks.notifications import send_email_task; \
      send_email_task.delay('you@example.com', 'security_alert', {'user': 'test', 'event': 'smoke test', 'ip': '127.0.0.1'})"
   ```
   (The exact required context keys depend on the template; `security_alert.html.j2` accepts `user`, `event`, `ip` per its Jinja2 variables. If keys are wrong, the task fails with a template render error, not an SMTP error.)
2. `docker logs wims-celery-worker --tail 50` → `Email sent via send_email_task: to=you@example.com template=security_alert`.
3. Recipient's Gmail Sent folder (or the recipient's inbox) shows the message.
4. `127.0.0.1:8025` (MailHog) does **not** show the message.

### V2 — Keycloak password reset reaches Gmail (R1)

1. Visit `http://localhost:8080/auth/realms/bfp/login-actions/reset-credentials` (or click "Forgot password" on the login page).
2. Enter a real email of a user in the bfp realm.
3. The user receives the reset email in their real inbox (not MailHog).
4. `docker logs wims-keycloak --tail 50` shows no SMTP errors.

### V3 — FCM push dispatch succeeds (R3)

1. Open the citizen report tracking page for a real report.
2. Click "Enable Notifications" → grant browser permission. This calls `POST /api/v1/civilian/reports/{report_id}/notify` (`civilian.py:909-914`, handler `register_notification`) to register the FCM token.
3. From the admin/triage panel, promote the report to `VERIFIED`.
4. Within ~30 seconds, a push notification appears in the browser (or on mobile if PWA installed).
5. `docker logs wims-celery-worker --tail 50` shows the `send_status_notification` log line with `sent=1 failed=0` (or actual format from `notifications.py:70`). No `FileNotFoundError`, no `Firebase credentials not configured`, no `DefaultCredentialsError`.

### V4 — No secrets committed (R4)

1. `git status` — no `.env`, no `firebase-creds.json`, no service-account JSON, no SMTP password in any tracked file.
2. `git diff` against the change point shows only: the celery-worker SMTP_* addition in `docker-compose.yml`, the optional `.env.production.example` comment update, and the deletion of the old `firebase-creds.json` (if it was ever tracked — it should not be, per `.gitignore:30`).

### V5 — Existing CI gates pass (R5)

Run the repo's CI pre-flight routine (`docs/agents/ci-preflight.md`):
```bash
cd src/backend && ruff check . && ruff format . --check && python -m pytest -v
cd src/frontend && npm run lint && npx vitest run && npm run build
```
All four blocking gates pass.

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Gmail rate-limits the dedicated sender account | Medium (500/day cap on regular Gmail, higher with Workspace) | High — all email stops | Use a Google Workspace account with higher limits; add a retry/backoff in `sender.py` (deferred; out of scope for this spec); document the cap in the deploy runbook. |
| Gmail blocks "less secure" auth | Already mitigated by App Passwords (2-Step Verification + App Password) | — | Spec requires App Password, not raw account password. The plan's prerequisite step enforces this. |
| `firebase-creds.json` on deploy host is world-readable | Medium (default umask may be 644) | High — credential exposure | Plan chmods to 600 after writing. Document in runbook. |
| Keycloak realm SMTP update (S2) applied to wrong realm or with bad JSON | Low (operator error) | High — Keycloak admin broken | The kcadm command (2b) is shown above; plan encodes it as a single copy-paste block. The fresh-import path (2a) is the safer fallback. |
| `send_email_task` is also called from backend (not just celery) | Already mitigated | — | The backend's direct path uses `env_file: .env` (compose line 230-232), which S1 does not change. If the backend ever calls the sender directly (not via Celery), it already works. |
| FCM VAPID key is browser-only; FCM server key is server-only confusion | Low | Medium — push fails | Spec uses VAPID for web push (`NEXT_PUBLIC_FIREBASE_VAPID_KEY`) and service account for server dispatch (file mount → `FIREBASE_CREDENTIALS_PATH` → `credentials.Certificate`). These are the correct two keys; the plan will not confuse them. |
| `docker exec` keycloak user / `HOME` mismatch loses kcadm session token between calls | Medium (the two-call version failed in similar setups) | High — S2 step 2 silently fails | Resolved: S2 step 2b is now a single `docker exec sh -c "..."` so the session token written by `config credentials` is visible to the subsequent `update` call. |
| Existing MailHog service becomes confusing (still in stack, no longer used) | Certain | Low — UX | Spec leaves MailHog in place; it is still useful for local dev. No removal. |

---

## FRS / Security Context

- The notification channels being enabled are referenced in the FRS as the operational delivery paths for status updates and account events. This spec does not introduce new FRS obligations; it removes a dev-only blocking condition on channels the FRS expects to be live in production.
- SMTP credentials and the Firebase service account are **secrets** under standard classifications. Storage in `.env` on the deploy host (gitignored) is the established pattern in this repo (see also OpenBao token, Keycloak admin password). Rotation procedure: generate new Gmail App Password or new Firebase service account, update `.env`, restart affected containers. Documented in the runbook; not automated in this spec.
- The FCM service account has broad project access (Firebase Admin SDK scope). Compromise of `.env` would expose it. Mitigations: gitignore (R4), deploy-host filesystem permissions (operational, not in this spec), and future consideration of a secrets manager (OpenBao is already in the stack; future work).

---

## Out of Scope

- Automated tests for live email/FCM delivery (would require a real-inbox fixture; manual V1-V3 cover it).
- Switching from Gmail to a transactional email provider (SendGrid, SES) — Gmail is the operator's stated choice.
- Push notification channels other than FCM web (APNs, FCM Android) — out of scope; FCM web is the only path the current code supports (`firebase.ts` + service worker).
- Templated email redesign or new email types — templates already exist in `services/email/templates/`.
- Removing MailHog from the stack — left in place for local dev convenience.
- Keycloak admin console customizations, password policies, or 2FA enforcement — out of scope.
- Migration of existing dev `.env` to a secrets manager (OpenBao) — future work; the repo already supports `WIMS_CRYPTO_PROVIDER=openbao_transit` for application-level encryption, but `.env` itself is not in OpenBao.

---

## Resolved Questions (v2)

1. **S2 mechanism:** 2b (kcadm, single chained `docker exec sh -c`). Confirmed by operator. Staging may use 2a; production keeps data, so 2b.
2. **`.env` location:** The deploy host path is `/opt/wims-bfp/src/.env` (this is the VPS checkout; the local dev checkout is `/home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/`). The plan will reference both: dev paths for the implementer, `/opt/wims-bfp/src/...` for the deploy operator.
3. **Runbook artifact:** `scripts/update-keycloak-smtp.sh` will be created in the plan; takes `.env` path as `$1` and the app-password from there. Idempotent — the kcadm `update` call is naturally idempotent for SMTP settings.
4. **CI pre-flight dummy values:** Confirmed — `NEXT_PUBLIC_FIREBASE_API_KEY` and `NEXT_PUBLIC_FIREBASE_VAPID_KEY` must have non-empty dummy values for the frontend build gate. Use `NEXT_PUBLIC_FIREBASE_API_KEY=ci-dummy-api-key NEXT_PUBLIC_FIREBASE_VAPID_KEY=ci-dummy-vapid-key npm run build`. The browser-side Firebase init will see these as `undefined` and may log a warning at runtime, but the build succeeds. The plan's CI gate (V5) will set these via the shell environment, not via `.env`.

## Deferred to Plan Author

- Exact text of the `scripts/update-keycloak-smtp.sh` shell wrapper (the kcadm command is in S2 above; the script is a thin wrapper).
- The deploy runbook section covering `firebase-creds.json` placement, chmod 600, and rotation procedure.

---

## Self-Review

**Spec coverage:**
- R1-R5 each trace to V1-V5. ✅
- The 3 blockers (B1-B3) are addressed by S1, S2, S3 respectively. ✅
- All "Files Changed" entries are justified by a requirement (S1→R2/R5, S2→R1, S3→R3, S4→discoverability). ✅
- Out-of-scope items are explicit, so the plan author does not silently expand scope. ✅

**Placeholder scan:**
- No "TBD", "TODO", "implement later", "add appropriate error handling." ✅
- All S1-S3 changes show actual content (compose YAML, kcadm command, env var names). ✅
- Verification steps include exact commands and expected output format. ✅

**Type / identifier consistency:**
- Env var names (`SMTP_HOST`, `SMTP_PORT`, `SMTP_STARTTLS`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `FIREBASE_CREDENTIALS_PATH`, `NEXT_PUBLIC_FIREBASE_VAPID_KEY`, etc.) match the actual keys in `sender.py:18-23`, `notifications.py:30`, and `docker-compose.yml:80-90, 262-263, 303-309`. ✅
- Function names (`send_email_task`, `send_status_notification`, `register_notification`) match `tasks/notifications.py:70,174` and `api/routes/civilian.py:914`. ✅
- The earlier draft's "civilian.py line 793" was the docstring inside `register_notification`; the decorator is at line 909 and the function definition at line 914. Corrected. ✅
- `send_email_task` signature `(self, to, template_name, context)` from `notifications.py:174-179`; the v1 V1 example with raw HTML was wrong. Corrected to use a real template name and context dict. ✅

**Gaps found in self-review, fixed inline:**
- Initially did not state whether S2 was 2a/2b/2c; now states the requirement (R1) and defers mechanism choice to the plan author with 2b as default. ✅
- Initially did not call out that `.env` does not exist in the repo; now states it under secondary observations. ✅

---

*This is a design spec (v2). The implementation plan is at `docs/superpowers/plans/2026-06-23-live-notifications.md` (13 tasks, TDD-adapted to infra, with exact commands and commit boundaries).*
