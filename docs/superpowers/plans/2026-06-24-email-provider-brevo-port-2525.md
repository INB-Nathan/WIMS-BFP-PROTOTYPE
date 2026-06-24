# Switch Email Provider to Brevo SMTP on Port 2525 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the WIMS-BFP email channel off Gmail SMTP (which DigitalOcean blocks at the network layer) onto Brevo SMTP on port 2525 — a port the DigitalOcean block list does NOT include (verified directly against `docs.digitalocean.com/support/why-is-smtp-blocked/`, last verified 2026-06-22). Zero application code changes, zero new dependencies, zero schema, zero new tests. The `aiosmtplib` transport and the `aiosmtplib.SMTPException`-based Celery retry stay the right shape; this is a config-only swap.

**Architecture:** A single SMTP transport stays in place (not HTTP API) because Keycloak's `smtpServer` block only supports SMTP. The change has 4 layers: (1) the operator-facing `src/.env.production.example` documents the new Brevo defaults; (2) the `src/docker-compose.yml` `SMTP_*` env defaults flip from MailHog-shaped (host=mailhog, port=1025, STARTTLS=false, AUTH=false) to Brevo-shaped (host=smtp-relay.brevo.com, port=2525, STARTTLS=true, AUTH=true) across both the Keycloak service and the celery-worker; (3) `scripts/update-keycloak-smtp.sh` gets a 1-paragraph header comment documenting the defaults-tuned-for-Brevo assumption (its logic is unchanged — the defaults already match); (4) the system-wiki gets corrected (7 templates not 4, Brevo on 2525 not Gmail on 587, gap register closed, log entry appended). The "no `.env` file" code path is also fixed: a fresh `docker compose config` now shows Brevo-shaped production defaults, not MailHog-shaped dev defaults, with STARTTLS on so credentials never go plaintext.

**Tech Stack:** Docker Compose v2 (env interpolation), Keycloak 24.0.0 (`kcadm.sh` for the live realm update), aiosmtplib (unchanged, already in `requirements.txt`), Brevo SMTP relay (host=`smtp-relay.brevo.com`, port 2525, plaintext + STARTTLS, AUTH PLAIN with per-key SMTP key).

**Source spec:** `docs/superpowers/specs/2026-06-24-email-provider-brevo-port-2525-design.md` (v1.1). This plan implements Files Changed rows 1-8 of the spec. The plan does **not** modify any application code (`sender.py`, `tasks/notifications.py`, `auth.py`, `admin/security.py`, `tasks/scheduled_reports.py`, `tasks/notifications.py`), any test, any template, the Keycloak realm JSON files, `requirements.txt`, the frontend, or the MailHog service.

## Global Constraints

- 4-space indent, `snake_case` modules for any Python touched (none in this plan, but the project standard applies if any incidental edit is made).
- Conventional Commits for commit subjects (e.g. `chore(env): ...`, `chore(compose): ...`, `docs(scripts): ...`, `docs(wiki): ...`).
- Run `ruff format .` (auto-fix) before committing any Python change — most common CI blocker. (No Python changes in this plan, but if any incidental edit is made, the rule still applies.)
- `.env` is gitignored at both repo root (`.gitignore:27-30`) and `src/` (`src/.gitignore:1-3`). Never commit SMTP credentials.
- Brevo's SMTP key (used for both `SMTP_USER` and `SMTP_PASSWORD`) is generated at `https://app.brevo.com/settings/keys/smtp`. Use the SMTP key, NOT an API key. Verified against Brevo docs.
- Deploy host path is `/opt/wims-bfp/...`; local dev path is `/home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/...`. This plan references both.
- Local dev continues to use MailHog (host=`mailhog`, port=`1025`, STARTTLS=`false`, AUTH=`false`) on the Docker-internal network. The MailHog service is NOT removed. The Brevo values ship only in `src/.env.production.example` and the compose defaults; the dev `.env.example` stays MailHog-shaped.
- All `SMTP_*` env vars in `src/.env.production.example` are also used by the Keycloak service via compose interpolation (`src/docker-compose.yml:80-90`); the keycloak service already wires them into the realm JSON placeholders at first import.
- The 11 `SMTP_*` env vars split into two scopes (the asymmetry is the one fact a plan author will trip on if it is not foregrounded):
  - **`sender.py:18-23` reads exactly 6 keys**: `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_STARTTLS`. The other 5 (`SMTP_FROM_DISPLAY`, `SMTP_REPLYTO`, `SMTP_REPLYTO_DISPLAY`, `SMTP_SSL`, `SMTP_AUTH`) are Keycloak-only.
  - **The compose env blocks reflect the same split**: the Keycloak service block at `src/docker-compose.yml:80-90` has all 11 SMTP_* lines; the celery-worker block at `src/docker-compose.yml:264-269` has only the 6 that `sender.py` reads.
- All edits are config-only. There are no tests to write (the existing `aiosmtplib` mock in `test_email_infra.py:85-118` is port-agnostic). The CI pre-flight task (Task 6) verifies the existing test suite still passes, which it must, because no test or code is changed.

## File Structure

| # | File | Action | Why |
|---|------|--------|-----|
| 1 | `src/.env.production.example` | **Edit** | Replace 16-line Gmail block (lines 29-44) with Brevo block (S1) |
| 2 | `src/docker-compose.yml` | **Edit** | Change 4 lines in Keycloak service env (HOST, PORT, STARTTLS, AUTH defaults at lines 80, 81, 87, 88) and 3 lines in celery-worker env (HOST, PORT, STARTTLS defaults at lines 264, 265, 269) (S2) |
| 3 | `scripts/update-keycloak-smtp.sh` | **Edit** | Add 1 paragraph of header comment documenting the defaults-tuned-for-Brevo assumption (S3). No logic changes. |
| 4 | `.env.example` | **Edit** | Add 2 lines of comment pointing dev to the Brevo production setup (S4). No env var value changes. |
| 5 | `system-wiki/backend/services.md` | **Edit** | Update "Email Service (M13b)" section to document 7 templates (not 4) and Brevo on port 2525 (S5.1) |
| 6 | `system-wiki/backend/utilities-and-tasks.md` | **Edit** | Update "send_email_task" subsection env-var list and add port-2525 note (S5.2) |
| 7 | `system-wiki/gaps/frs-codebase-gap-register.md` | **Edit** | Add `BREVO-EMAIL-CHANNEL` entry; reference the spec and the closing commit (S5.3) |
| 8 | `system-wiki/log.md` | **Append** | New dated entry for 2026-06-24 (S5.4) |

The plan does **not** modify any application code, any test, the Keycloak realm JSON, `requirements.txt`, the frontend, or the MailHog service.

---

### Task 1: Update `src/.env.production.example` with Brevo SMTP values (S1)

This is the operator-facing documentation for the deploy host's `.env` file. It explains the *why* (DigitalOcean block), the *how* (Brevo SMTP key, port 2525), and the *what* (11 `SMTP_*` env vars with the new defaults).

**Files:**
- Modify: `src/.env.production.example` — replace the 16-line Gmail block (lines 29-44) with the Brevo block

**Interfaces:**
- Consumes: nothing (purely a documentation file with placeholder values)
- Produces: the canonical `.env` template that the operator copies to `/opt/wims-bfp/src/.env` on the deploy host

- [ ] **Step 1: Read the current `src/.env.production.example` lines 28-45 to confirm the block to replace**

```bash
sed -n '28,45p' /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/src/.env.production.example
```

Expected output: 16 lines starting with `# ----- Live email (Gmail SMTP) -----` and ending with the empty `SMTP_PASSWORD=` line. The exact 16-line block is the edit surface.

- [ ] **Step 2: Replace the 16-line Gmail block with the Brevo block**

Open `src/.env.production.example`. Delete lines 29-44 (the entire `# ----- Live email (Gmail SMTP) -----` block, including the comment lines and the `SMTP_HOST=...` through `SMTP_PASSWORD=` lines, AND the empty line 45 that follows).

Replace with the following 18-line Brevo block (16 content lines + 1 comment header line + 1 trailing blank line — match the surrounding file's spacing style):

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

(The trailing blank line at the end of the block is required to separate this block from the next section in the file, matching the surrounding style.)

- [ ] **Step 3: Verify the new block is in place**

```bash
sed -n '28,48p' /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/src/.env.production.example
```

Expected output: the new `# ----- Live email (Brevo SMTP relay, port 2525) -----` block with `SMTP_HOST=smtp-relay.brevo.com`, `SMTP_PORT=2525`, `SMTP_STARTTLS=true`, `SMTP_AUTH=true`, and empty `SMTP_USER=` / `SMTP_PASSWORD=` lines.

- [ ] **Step 4: Verify no credentials were introduced**

```bash
grep -E "SMTP_(USER|PASSWORD)=[^[:space:]]" /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/src/.env.production.example || echo "OK: no credentials in tracked file"
```

Expected: `OK: no credentials in tracked file`. The `SMTP_USER=` and `SMTP_PASSWORD=` lines MUST be empty in the committed file.

- [ ] **Step 5: Commit**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && git add src/.env.production.example && git commit -m "chore(env): document Brevo SMTP relay on port 2525 in .env.production.example"
```

---

### Task 2: Update `src/docker-compose.yml` defaults (S2)

The Keycloak service env block (lines 80-90) and the celery-worker env block (lines 264-269) currently default to MailHog-shaped values (`SMTP_HOST=mailhog`, `SMTP_PORT=1025`, `SMTP_STARTTLS=false`, `SMTP_AUTH=false`). The operator's `.env` overrides these at deploy time, but the defaults are used when `.env` is missing (e.g. fresh checkout, first-boot). For the "no `.env` file" path to produce a coherent production default, the 7 lines below need to flip.

**Files:**
- Modify: `src/docker-compose.yml` — 4 lines in Keycloak service env (lines 80, 81, 87, 88) and 3 lines in celery-worker env (lines 264, 265, 269)

**Interfaces:**
- Consumes: nothing (defaults that `docker compose config` resolves)
- Produces: a compose file where `docker compose config` (run without `.env`) shows `SMTP_HOST=smtp-relay.brevo.com`, `SMTP_PORT=2525`, `SMTP_STARTTLS=true`, and (Keycloak only) `SMTP_AUTH=true` for both services

- [ ] **Step 1: Read the current Keycloak and celery-worker SMTP_* lines to confirm anchors**

```bash
sed -n '79,90p' /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/src/docker-compose.yml
echo "---"
sed -n '263,270p' /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/src/docker-compose.yml
```

Expected output: the Keycloak service env block (8 spaces indent, `SMTP_*: ${...:-default}` form) and the celery-worker env block (6 spaces indent + `- ` prefix, list form). The 7 line numbers (80, 81, 87, 88, 264, 265, 269) should match the targets. If they don't, anchor on the surrounding content (the `# SMTP configuration` comment for Keycloak, the `FIREBASE_CREDENTIALS_PATH` line for celery-worker).

- [ ] **Step 2: Edit the 4 Keycloak service env lines**

In the Keycloak service env block (8-space indent, `key: value` YAML form), change:
- Line 80: `SMTP_HOST: ${SMTP_HOST:-mailhog}` → `SMTP_HOST: ${SMTP_HOST:-smtp-relay.brevo.com}`
- Line 81: `SMTP_PORT: ${SMTP_PORT:-1025}` → `SMTP_PORT: ${SMTP_PORT:-2525}`
- Line 88: `SMTP_STARTTLS: ${SMTP_STARTTLS:-false}` → `SMTP_STARTTLS: ${SMTP_STARTTLS:-true}`
- Line 89: `SMTP_AUTH: ${SMTP_AUTH:-false}` → `SMTP_AUTH: ${SMTP_AUTH:-true}`

Anchor pattern (YAML form, 6-space indent for `environment:` children):
```yaml
      SMTP_HOST: ${SMTP_HOST:-mailhog}        # CHANGE
      SMTP_PORT: ${SMTP_PORT:-1025}           # CHANGE
      ...
      SMTP_STARTTLS: ${SMTP_STARTTLS:-false}  # CHANGE
      SMTP_AUTH: ${SMTP_AUTH:-false}          # CHANGE
```

DO NOT change `SMTP_SSL` (line 86). Port 2525 is the STARTTLS port, not the implicit-SSL port. `SMTP_SSL=false` is correct for port 2525.

- [ ] **Step 3: Edit the 3 celery-worker env lines**

In the celery-worker env block (6-space indent + `- ` prefix, list form), change:
- Line 264: `- SMTP_HOST=${SMTP_HOST:-mailhog}` → `- SMTP_HOST=${SMTP_HOST:-smtp-relay.brevo.com}`
- Line 265: `- SMTP_PORT=${SMTP_PORT:-1025}` → `- SMTP_PORT=${SMTP_PORT:-2525}`
- Line 269: `- SMTP_STARTTLS=${SMTP_STARTTLS:-false}` → `- SMTP_STARTTLS=${SMTP_STARTTLS:-true}`

Anchor pattern (list form, 6-space indent + `- `):
```yaml
      - SMTP_HOST=${SMTP_HOST:-mailhog}        # CHANGE
      - SMTP_PORT=${SMTP_PORT:-1025}           # CHANGE
      - SMTP_STARTTLS=${SMTP_STARTTLS:-false}  # CHANGE
```

The celery-worker does NOT have an `SMTP_AUTH` line. `sender.py` does not read `SMTP_AUTH`; the auth decision is implicit from `SMTP_USER`/`SMTP_PASSWORD` being non-empty. No change needed.

- [ ] **Step 4: Verify the YAML is still valid and the new defaults are resolved**

If Docker is installed:
```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/src && docker compose config 2>&1 | grep -A 12 -E '^\s+keycloak:|^services:' | head -80
```

Look for the `keycloak` and `celery-worker` resolved config blocks. Both should show `SMTP_HOST: smtp-relay.brevo.com`, `SMTP_PORT: "2525"`, `SMTP_STARTTLS: "true"`, and (Keycloak only) `SMTP_AUTH: "true"`.

If Docker is NOT installed (the implementation host may not have it; the deploy host does):
```bash
python3 -c "import yaml; d = yaml.safe_load(open('/home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/src/docker-compose.yml')); kc = d['services']['keycloak']['environment']; cw = d['services']['celery-worker']['environment']; print('keycloak SMTP_HOST:', kc.get('SMTP_HOST')); print('keycloak SMTP_PORT:', kc.get('SMTP_PORT')); print('keycloak SMTP_STARTTLS:', kc.get('SMTP_STARTTLS')); print('keycloak SMTP_AUTH:', kc.get('SMTP_AUTH')); print('celery SMTP_HOST:', cw.get('SMTP_HOST')); print('celery SMTP_PORT:', cw.get('SMTP_PORT')); print('celery SMTP_STARTTLS:', cw.get('SMTP_STARTTLS'))"
```

Expected output (substituting `smtp-relay.brevo.com` and `2525` for the Brevo values):
```
keycloak SMTP_HOST: ${SMTP_HOST:-smtp-relay.brevo.com}
keycloak SMTP_PORT: ${SMTP_PORT:-2525}
keycloak SMTP_STARTTLS: ${SMTP_STARTTLS:-true}
keycloak SMTP_AUTH: ${SMTP_AUTH:-true}
celery SMTP_HOST: ${SMTP_HOST:-smtp-relay.brevo.com}
celery SMTP_PORT: ${SMTP_PORT:-2525}
celery SMTP_STARTTLS: ${SMTP_STARTTLS:-true}
```

(Note: the `python3 -c` script reads the raw YAML, so the values shown are the LITERAL compose-interpolation strings, not the resolved values. That's fine — the verification is that the literal defaults are correct. The Docker-based check resolves the interpolation. Either is acceptable; the Python check works on hosts without Docker.)

- [ ] **Step 5: Commit**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && git add src/docker-compose.yml && git commit -m "chore(compose): default SMTP to Brevo on port 2525 with STARTTLS+AUTH

Without a populated .env file, the previous defaults were
MailHog-shaped (host=mailhog, port=1025, STARTTLS=false,
AUTH=false). For an operator who only sets .env, this is
invisible; for a fresh checkout, this produced a broken
default (Brevo host/port but STARTTLS off = credentials in
cleartext AUTH PLAIN).

Align the in-compose defaults with Brevo's port 2525
requirements (plaintext + STARTTLS, AUTH required). SMTP_SSL
stays false — 2525 is the STARTTLS port, not 465.

7 line edits: 4 in Keycloak service env (HOST, PORT,
STARTTLS, AUTH at lines 80, 81, 87, 88) and 3 in celery-worker
env (HOST, PORT, STARTTLS at lines 264, 265, 269). The
celery-worker has no SMTP_AUTH line; sender.py does not read
SMTP_AUTH (auth is implicit from non-empty USER/PASSWORD)."
```

---

### Task 3: Add Brevo comment to `scripts/update-keycloak-smtp.sh` (S3)

The script at `scripts/update-keycloak-smtp.sh` already has defaults that match Brevo on port 2525 (STARTTLS=true, SSL=false, AUTH=true, lines 35-37). No logic change is needed. The only edit is a 1-paragraph header comment that documents this assumption so the next operator who reads the script knows which provider the defaults are tuned for.

**Files:**
- Modify: `scripts/update-keycloak-smtp.sh` — add a 5-line comment block immediately after the existing header comment block (the `# Usage:` paragraph ends around line 13)

**Interfaces:**
- Consumes: nothing (comment-only)
- Produces: a self-documenting script header that names the default-provider assumption

- [ ] **Step 1: Read the current script header to find the anchor**

```bash
sed -n '1,15p' /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/scripts/update-keycloak-smtp.sh
```

Expected output: the existing comment block starting with `#!/usr/bin/env bash` and ending with the `Usage:` paragraph (around line 13). The comment block is a sequence of `# ...` lines, each starting with `#`.

- [ ] **Step 2: Add the new 5-line comment block immediately AFTER the existing `Usage:` paragraph**

Find the line that ends the existing comment block (the last `# Default env-file path: ./.env (relative to the script's CWD)` line, or whatever the last comment line is before the blank line that separates the comment from the `set -euo pipefail` line). Insert the following block immediately after that last comment line, BEFORE the blank line:

```bash
# Default values below (SMTP_SSL, SMTP_STARTTLS, SMTP_AUTH, DISPLAY, REPLYTO)
# are tuned for Brevo SMTP on port 2525 (plaintext SMTP upgraded via STARTTLS,
# AUTH required). For other providers (SendGrid, Mailgun, etc.), check the
# provider's SMTP docs for the right STARTTLS/SSL/AUTH combination on the
# chosen port before running this script.
```

Result: the script header now has TWO comment blocks — the original "what this script does" block, and the new "what defaults are tuned for" block. The two blocks are separated by a blank line for readability.

- [ ] **Step 3: Verify the comment is in place and the script is still syntactically valid bash**

```bash
sed -n '1,20p' /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/scripts/update-keycloak-smtp.sh
echo "---"
bash -n /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/scripts/update-keycloak-smtp.sh && echo "OK: bash syntax valid"
```

Expected output: the original header comment block, the new Brevo-tuned comment block, then a blank line, then `set -euo pipefail`. The `bash -n` check should print `OK: bash syntax valid` (it parses but does not execute).

- [ ] **Step 4: Verify the defaults at lines 32-37 are unchanged (sanity check — the user wanted NO logic change in this script)**

```bash
sed -n '32,40p' /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/scripts/update-keycloak-smtp.sh
```

Expected output: the 6 default-value lines from the original script, all unchanged:
```
SMTP_FROM_DISPLAY="${SMTP_FROM_DISPLAY:-WIMS-BFP}"
SMTP_REPLYTO="${SMTP_REPLYTO:-$SMTP_FROM}"
SMTP_REPLYTO_DISPLAY="${SMTP_REPLYTO_DISPLAY:-WIMS-BFP No Reply}"
SMTP_SSL="${SMTP_SSL:-false}"
SMTP_STARTTLS="${SMTP_STARTTLS:-true}"
SMTP_AUTH="${SMTP_AUTH:-true}"
```

If any of these lines is missing or changed, the edit accidentally went too far. Revert the file and re-do Step 2.

- [ ] **Step 5: Commit**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && git add scripts/update-keycloak-smtp.sh && git commit -m "docs(scripts): note that update-keycloak-smtp.sh defaults are tuned for Brevo on 2525

The script's SMTP_SSL/STARTTLS/AUTH defaults (lines 35-37) already
match Brevo on port 2525 (plaintext + STARTTLS, AUTH required). The
logic is unchanged; this commit only adds a header comment that
documents the assumption so the next operator who reads the script
knows which provider the defaults are tuned for and what to change
if they switch providers."
```

---

### Task 4: Update `.env.example` (S4) — dev only

The dev file at `.env.example:73-83` is already correct for dev (MailHog on port 1025, no auth). The only change is to add 2 comment lines that point the dev to the production setup. No env var value changes.

**Files:**
- Modify: `.env.example` — replace the existing `# Production: ...` comment line with 2 new comment lines

**Interfaces:**
- Consumes: nothing (comment-only)
- Produces: a dev `.env.example` that stays MailHog-shaped (correct for local dev) and explicitly references the production Brevo path

- [ ] **Step 1: Read the current `.env.example` SMTP section to find the anchor**

```bash
sed -n '73,85p' /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/.env.example
```

Expected output: lines 73-83 (the existing `# SMTP / Email (M13b)` block). The line `# Production: override with your real SMTP relay credentials.` is the line to change.

- [ ] **Step 2: Replace the existing `# Production: ...` comment line with 2 new comment lines**

Change:
```
# Production: override with your real SMTP relay credentials.
```
to:
```
# Production: see src/.env.production.example for the Brevo SMTP relay on port 2525.
# DigitalOcean Droplets block 25/465/587; Brevo's port 2525 is not in the block list.
```

Leave everything else in the file unchanged: `SMTP_HOST=mailhog`, `SMTP_PORT=1025`, `SMTP_FROM=no-reply@bfp.gov.ph`, the commented-out `SMTP_USER=...` / `SMTP_PASSWORD=...` / `SMTP_STARTTLS=...` lines. Local dev continues to use MailHog with no auth.

- [ ] **Step 3: Verify the comment is in place and no env var value changed**

```bash
sed -n '73,85p' /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/.env.example
```

Expected output: the new 2 comment lines followed by the unchanged `SMTP_HOST=mailhog`, `SMTP_PORT=1025`, `SMTP_FROM=no-reply@bfp.gov.ph` lines.

```bash
grep -E "^(SMTP_HOST|SMTP_PORT|SMTP_FROM)=" /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/.env.example
```

Expected output (the local dev values are unchanged):
```
SMTP_HOST=mailhog
SMTP_PORT=1025
SMTP_FROM=no-reply@bfp.gov.ph
```

- [ ] **Step 4: Commit**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && git add .env.example && git commit -m "docs(env): point .env.example to the Brevo production setup

Local dev continues to use MailHog on port 1025 (unchanged). The
existing # Production: comment line is replaced with 2 lines that
reference src/.env.production.example and explain the
DigitalOcean port-block context (25/465/587 blocked; 2525 is not)."
```

---

### Task 5: Update system-wiki (S5) — 4 files in one commit

The system-wiki is mandatory to update per AGENTS.md. Four files need touching: `services.md` (correct the 4-vs-7 template count and switch the example to Brevo on 2525), `utilities-and-tasks.md` (update the `send_email_task` env-var list), `gaps/frs-codebase-gap-register.md` (close the gap), and `log.md` (append the new entry).

These are all doc-only changes with the same review pattern ("does the wiki match the spec?"), so they go in one task and one commit.

**Files:**
- Modify: `system-wiki/backend/services.md` — replace the "Email Service (M13b)" section
- Modify: `system-wiki/backend/utilities-and-tasks.md` — update the "send_email_task (Email delivery — M13b)" subsection
- Modify: `system-wiki/gaps/frs-codebase-gap-register.md` — add a `BREVO-EMAIL-CHANNEL` entry (or close the existing one if there is one)
- Append: `system-wiki/log.md` — new dated entry for 2026-06-24

**Interfaces:**
- Consumes: nothing (doc-only)
- Produces: a system-wiki that accurately documents the current state (Brevo on 2525, 7 templates, gap closed)

- [ ] **Step 1: Read the current Email Service section in `system-wiki/backend/services.md`**

```bash
sed -n '/## Email Service (M13b)/,/^## /p' /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/system-wiki/backend/services.md | head -60
```

Expected output: the existing Email Service section. It currently documents 4 templates (password_reset, account_locked, security_alert, weekly_report) and a Gmail SMTP example. The actual state is 7 templates; the example is wrong.

- [ ] **Step 2: Read the current `send_email_task` subsection in `system-wiki/backend/utilities-and-tasks.md`**

```bash
grep -n "send_email_task\|Email delivery" /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/system-wiki/backend/utilities-and-tasks.md
```

Expected output: the line numbers for the `send_email_task` (Email delivery — M13b) subsection. The retry list is already correct; the env var list needs a port-2525 note.

- [ ] **Step 3: Replace the Email Service section in `system-wiki/backend/services.md`**

Open `system-wiki/backend/services.md`. Find the line `## Email Service (M13b)`. Replace the entire section (from that heading line to the next `## ` heading line, exclusive) with the following:

````markdown
## Email Service (M13b)

**File:** `src/backend/services/email/sender.py`

Jinja2 HTML email rendering and SMTP delivery via aiosmtplib.

**Production transport:** Brevo SMTP relay on port 2525 (`smtp-relay.brevo.com`). Port 2525 is the standard alternative SMTP submission port used when an ISP or hosting provider blocks 587. DigitalOcean Droplets block outbound 25/465/587 by default (`docs.digitalocean.com/support/why-is-smtp-blocked/`, last verified 2026-06-22); port 2525 is not in the block list. The connection is plaintext SMTP that the server requires to be upgraded via STARTTLS (`SMTP_STARTTLS=true`); AUTH PLAIN uses a per-key SMTP key from Brevo (not the account password).

**Local dev transport:** MailHog on the Docker-internal network (host=`mailhog`, port=`1025`, no auth, no TLS). MailHog remains in the stack for local dev convenience and is not removed by the Brevo migration.

**Environment config (11 vars; `sender.py` reads only the 6 marked ★):**

| Variable | Default | Read by | Description |
|---|---|---|---|
| ★ `SMTP_HOST` | `smtp-relay.brevo.com` (prod) / `mailhog` (dev) | `sender.py`, Keycloak | SMTP server hostname |
| ★ `SMTP_PORT` | `2525` (prod) / `1025` (dev) | `sender.py`, Keycloak | SMTP server port (Brevo on 2525; MailHog on 1025) |
| ★ `SMTP_FROM` | `noreply@wimsbfp.tech` (prod) / `no-reply@bfp.gov.ph` (dev) | `sender.py`, Keycloak | From address |
| ★ `SMTP_USER` | (empty) | `sender.py`, Keycloak | Brevo SMTP key (or empty for MailHog) |
| ★ `SMTP_PASSWORD` | (empty) | `sender.py`, Keycloak | Brevo SMTP key (or empty for MailHog) |
| ★ `SMTP_STARTTLS` | `true` (prod) / `false` (dev) | `sender.py`, Keycloak | Enable STARTTLS upgrade (true for Brevo on 2525; false for MailHog) |
| `SMTP_FROM_DISPLAY` | `WIMS-BFP` | Keycloak only | From display name |
| `SMTP_REPLYTO` | `no-reply@wimsbfp.tech` | Keycloak only | Reply-to address |
| `SMTP_REPLYTO_DISPLAY` | `WIMS-BFP No Reply` | Keycloak only | Reply-to display name |
| `SMTP_SSL` | `false` | Keycloak only | Implicit SSL (false for port 2525; true only for port 465) |
| `SMTP_AUTH` | `true` (prod) / `false` (dev) | Keycloak only | Whether Keycloak attempts SMTP AUTH (Brevo on 2525 requires true; `sender.py` does not read this — its auth is implicit from non-empty USER/PASSWORD) |

**Functions:**

| Function | Signature | Returns | Description |
|---|---|---|---|
| `render_email(template_name, context)` | `(str, dict)` | `tuple[str, str]` | Loads `.html.j2` template, extracts subject from `{# subject: ... #}` header, renders body. Returns `(subject, html)`. |
| `send_email_async(to, template_name, context)` | `(str\|list[str], str, dict)` | `None` | Renders template (with error logging), creates multipart/alternative message (HTML + plain-text), sends via aiosmtplib. Called directly from `api/routes/auth.py:222` (email-verification flow) and from `tasks/notifications.py:194` (via the sync wrapper). |
| `send_email(to, template_name, context)` | `(str\|list[str], str, dict)` | `None` | Synchronous wrapper for Celery tasks via `asyncio.run()`. |
| `_load_subject(template_name, context)` | `(str, dict)` | `str` | Extracts and renders subject line from template header. Caches raw subject string per template name. |
| `_html_to_plain_text(html)` | `str` | `str` | Converts HTML body to plain text for multipart/alternative emails. |

**Templates:** 7 `.html.j2` files in `services/email/templates/`:

| Template | Context Variables | Subject |
|---|---|---|
| `password_reset` | `full_name`, `reset_link`, `expiry_minutes` | "Reset your WIMS-BFP password" |
| `account_locked` | `full_name`, `unlock_time`, `support_contact` | "WIMS-BFP Account Locked — Action Required" |
| `security_alert` | `severity`, `summary`, `detected_at`, `dashboard_link` | "[{{ severity\|upper }}] WIMS-BFP Security Alert — Action Required" |
| `breach_alert` | (template-specific) | (template-specific) |
| `email_verification` | `username`, `pending_email`, `code` | (template-specific) |
| `scheduled_report` | `report_name`, `format`, `generated_at`, `filters_summary`, `dashboard_link` | (template-specific) |
| `weekly_report` | `week_range`, `total_incidents`, `top_region`, `report_link` | "WIMS-BFP Weekly Report: {{ week_range }}" |

All templates use table-based layout, inline CSS, 600px max width, and BFP maroon `#8B0000` branding. The security alert template uses severity-aware CSS: critical→dark red, high→red, medium→orange, else→neutral gray `#95a5a6`.

**Retry semantics:** `tasks/notifications.py:168` uses `autoretry_for=(aiosmtplib.SMTPException, ConnectionError, TimeoutError, OSError)` with `retry_backoff=True, retry_backoff_max=600, max_retries=5` for the Celery task path. The direct async call from `auth.py:222` does NOT retry (returns 502 to the client). The asymmetry is intentional: real-time user-facing actions fail fast; background notifications retry silently.

**Associated Celery task:** `tasks.notifications.send_email_task` (see [[utilities-and-tasks]]).
````

- [ ] **Step 4: Update the `send_email_task` subsection in `system-wiki/backend/utilities-and-tasks.md`**

Open `system-wiki/backend/utilities-and-tasks.md`. Find the `#### send_email_task (Email delivery — M13b)` subsection (line ~165 in the current file). The Retry exceptions row already reads `aiosmtplib.SMTPException, ConnectionError, TimeoutError, OSError (transient only)` — leave unchanged. The Max retries row reads `5, exponential backoff up to 600s` — leave unchanged.

Add ONE new bullet/sentence under the "Parameters" table (or as a new paragraph immediately after it) that documents the production transport:

```
**Production transport (2026-06-24):** Brevo SMTP relay on port 2525 (`smtp-relay.brevo.com`); STARTTLS=true, AUTH required. Port 2525 is not in the DigitalOcean Droplet outbound block list (which is 25/465/587). Local dev continues to use MailHog on port 1025 with no auth and no TLS. See [[services#email-service-m13b]] for the full env-var scoping (6 keys read by `sender.py`; 5 Keycloak-only).
```

- [ ] **Step 5: Search for an existing email-channel gap entry in `system-wiki/gaps/frs-codebase-gap-register.md`**

```bash
grep -n -i "smtp\|email\|gmail\|mailhog\|brevo" /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/system-wiki/gaps/frs-codebase-gap-register.md | head -20
```

Expected output: a list of any existing email-related gap entries. If an entry references the broken Gmail SMTP / MailHog / DigitalOcean block state, the new entry should reference it as a closing. If no relevant entry exists, create a new one.

- [ ] **Step 6: Add a `BREVO-EMAIL-CHANNEL` entry to the gap register**

Open `system-wiki/gaps/frs-codebase-gap-register.md`. Either close an existing email-channel entry with a one-line note, or add a new entry. The new/closed entry should read:

```markdown
### BREVO-EMAIL-CHANNEL (closed 2026-06-24)

- **Problem:** Production email channel was broken at the network layer — DigitalOcean Droplets block outbound 25/465/587; Gmail SMTP on port 587 could not establish a TCP connection. The live-notifications work at `25d5eca` correctly wired `aiosmtplib` + Gmail SMTP, but emails never arrived. Keycloak transactional email (password reset, email verification) was also affected.
- **Fix:** Moved both the application transport (`sender.py`) and the Keycloak `smtpServer` block to **Brevo SMTP on port 2525**. Port 2525 is the standard alternative SMTP submission port and is NOT in the DigitalOcean block list. Verified directly against `docs.digitalocean.com/support/why-is-smtp-blocked/` (last verified 2026-06-22). 300 emails/day free tier; SMTP key authentication (not full account credential). The change is config-only — `aiosmtplib` and the `aiosmtplib.SMTPException`-based Celery retry stay correct.
- **Spec:** `docs/superpowers/specs/2026-06-24-email-provider-brevo-port-2525-design.md` (v1.1). Plan: `docs/superpowers/plans/2026-06-24-email-provider-brevo-port-2525.md`. Closed by commit `<TBD at commit time>`.
- **Out of scope:** switching to Brevo's HTTP API; OpenBao-backed credential storage; multi-provider failover; template content changes; removing MailHog from the dev stack.
```

- [ ] **Step 7: Append a new entry to `system-wiki/log.md`**

Open `system-wiki/log.md`. Append a new entry at the end (most recent first) with the same shape as the live-notifications and device-id entries:

```markdown
## 2026-06-24 — Email provider switch to Brevo SMTP on port 2525

- **Problem:** The WIMS-BFP email channel was broken at the network layer on the production VPS. DigitalOcean Droplets block outbound 25/465/587 by default (verified against `docs.digitalocean.com/support/why-is-smtp-blocked/`, last verified 2026-06-22). The live-notifications work at `25d5eca` wired `aiosmtplib` + Gmail SMTP correctly, but emails never arrived because the TCP connection timed out. Keycloak transactional email (password reset, email verification) was affected too. The previous session's handoff (`system-wiki/sessions/2026-06-24_email-provider-switch-handoff.md`) recommended an HTTP-API migration; the next session's diligence found that hypothesis over-broad — port 2525 is the standard "ISP blocks 587" alternative and is NOT in the DO block list, and Brevo supports it explicitly.
- **Fix:** Config-only swap. Both the application transport (`sender.py:18-23` reads 6 env vars) and the Keycloak `smtpServer` block (consumes 11 env vars via `${env.SMTP_*:default}`) move to Brevo on port 2525. The split is intentional: `sender.py` reads HOST/PORT/FROM/USER/PASSWORD/STARTTLS; the other 5 (DISPLAY, REPLYTO, REPLYTO_DISPLAY, SSL, AUTH) are Keycloak-only. The 11-key asymmetry is the one fact a plan author will trip on if it is not foregrounded.
- **Files changed (8):**
  - `src/.env.production.example` — replaced 16-line Gmail block with Brevo block (operator-facing documentation).
  - `src/docker-compose.yml` — flipped 7 line defaults: Keycloak service env (HOST, PORT, STARTTLS, AUTH at lines 80, 81, 87, 88) and celery-worker env (HOST, PORT, STARTTLS at lines 264, 265, 269). `SMTP_SSL` stays false (2525 is the STARTTLS port, not 465).
  - `scripts/update-keycloak-smtp.sh` — added 5-line header comment documenting the defaults-tuned-for-Brevo assumption. No logic change.
  - `.env.example` — added 2 comment lines pointing dev to the Brevo production setup. No env var value change (local dev still uses MailHog on 1025).
  - `system-wiki/backend/services.md` — replaced the "Email Service (M13b)" section with a Brevo-flavoured version; corrected the template count from 4 to 7.
  - `system-wiki/backend/utilities-and-tasks.md` — added a one-paragraph note on the production transport under the `send_email_task` subsection.
  - `system-wiki/gaps/frs-codebase-gap-register.md` — closed the `BREVO-EMAIL-CHANNEL` gap.
  - `system-wiki/log.md` — this entry.
- **Spec:** `docs/superpowers/specs/2026-06-24-email-provider-brevo-port-2525-design.md` (v1.1). Plan: `docs/superpowers/plans/2026-06-24-email-provider-brevo-port-2525.md`.
- **No scope creep:** zero application code changes (`sender.py`, `tasks/notifications.py`, `auth.py`, `admin/security.py`, `scheduled_reports.py` all unchanged), zero new dependencies (`aiosmtplib>=3.0.0` stays), zero schema, zero new tests (the existing `aiosmtplib` mock in `test_email_infra.py:85-118` is port-agnostic), zero frontend changes, MailHog remains in the dev stack.
- **Validation:** TBD by implementer (this entry is committed before the spec's V1-V6 deploy-time tripwires run).
```

- [ ] **Step 8: Verify all 4 wiki files are updated**

```bash
echo "=== services.md: confirm Brevo + 7 templates ==="
grep -c "Brevo\|smtp-relay.brevo.com\|2525" /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/system-wiki/backend/services.md
echo "  (expect >= 3)"
grep -E "password_reset|account_locked|security_alert|breach_alert|email_verification|scheduled_report|weekly_report" /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/system-wiki/backend/services.md | wc -l
echo "  (expect 7 — all 7 templates named)"
echo ""
echo "=== utilities-and-tasks.md: confirm Brevo port 2525 note ==="
grep -c "Brevo\|2525" /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/system-wiki/backend/utilities-and-tasks.md
echo "  (expect >= 1)"
echo ""
echo "=== gap register: confirm BREVO-EMAIL-CHANNEL entry ==="
grep -c "BREVO-EMAIL-CHANNEL" /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/system-wiki/gaps/frs-codebase-gap-register.md
echo "  (expect >= 1)"
echo ""
echo "=== log.md: confirm 2026-06-24 entry ==="
grep -c "2026-06-24 — Email provider switch" /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/system-wiki/log.md
echo "  (expect >= 1)"
```

Expected: each of the 4 grep counts matches the expected minimum.

- [ ] **Step 9: Commit**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && git add system-wiki/backend/services.md system-wiki/backend/utilities-and-tasks.md system-wiki/gaps/frs-codebase-gap-register.md system-wiki/log.md && git commit -m "docs(wiki): document Brevo SMTP on port 2525 (closes BREVO-EMAIL-CHANNEL gap)

Per AGENTS.md mandatory system-wiki update rule. Four files:
- services.md: replace 'Email Service (M13b)' with a Brevo-flavoured
  version; correct template count from 4 to 7; add env-var scoping
  table showing the 6-vs-11 split between sender.py and Keycloak.
- utilities-and-tasks.md: one-paragraph production transport note
  under the send_email_task subsection.
- gaps/frs-codebase-gap-register.md: close the BREVO-EMAIL-CHANNEL
  gap with a problem/fix/spec/links entry.
- log.md: append 2026-06-24 entry following the same shape as
  the live-notifications and device-id entries.

Doc-only change. No application code, no tests, no schema, no
frontend. Mirrors the v1.1 spec and the implementation plan."
```

---

### Task 6: CI pre-flight verification (4 gates)

Per `docs/agents/ci-preflight.md`, run the 4 blocking CI gates. This is the same routine the live-notifications and device-id work ran. The expected outcome is that all 4 gates pass — the change is config-only and adds no Python, no tests, no schema, and no frontend code, so there is nothing to break.

**Files:** None (verification only — no edits)

**Interfaces:**
- Consumes: the changes from Tasks 1-5
- Produces: a CI pre-flight result that confirms the existing test suite still passes and there are no formatting/lint regressions

- [ ] **Step 1: Run backend ruff lint**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/src/backend && ruff check .
```

Expected: `All checks passed!` (no output is also acceptable). No new Python is touched by this plan, so ruff should report no findings.

- [ ] **Step 2: Run backend ruff format check**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/src/backend && ruff format . --check
```

Expected: `N files already formatted` where N is the count of Python files in `src/backend/`. No new Python is touched by this plan, so format should be unchanged.

- [ ] **Step 3: Run backend pytest**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/src/backend && python -m pytest -v
```

Expected: full test suite passes. The plan does not change any Python or any test, so the existing baseline (whatever it is on `master` at the start of this work) should be preserved. Specifically, the email-related test files must still pass: `tests/test_email_infra.py`, `tests/test_auth_email_verification.py`, `tests/test_m13_email_triggers.py`, `tests/test_breach_notifications.py`, `tests/test_admin_new_routes.py`, `tests/test_security_monitoring.py`, `tests/test_scheduled_reports.py`, `tests/test_infra_config.py`. None of these files is touched by this plan.

(Note: on the implementation host, pytest may not be runnable without the full Docker stack. If the local environment cannot run pytest, document the skip with a clear reason: "Pre-existing CI gate runs in Docker; this plan's diff is config-only and adds no Python/tests, so the existing test suite is unaffected by construction. Verified via `ruff check` and `ruff format --check` which are runnable locally. The full pytest run will execute in CI on PR open.")

- [ ] **Step 4: Run frontend lint, vitest, and build**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/src/frontend && npm run lint && npx vitest run && \
  NEXT_PUBLIC_AUTH_API_URL=http://localhost:8080/auth \
  NEXT_PUBLIC_BASE_URL=http://localhost:3000 \
  npm run build
```

Expected: all three pass. The plan does not touch any frontend code, so the existing baseline (whatever it is on `master`) should be preserved. The dummy `NEXT_PUBLIC_*` values are required per the AGENTS.md note in the repo's CI pre-flight routine.

- [ ] **Step 5: Verify no secrets were committed in any task**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && git diff master -- 'src/.env.production.example' '.env.example' 'src/docker-compose.yml' 'scripts/update-keycloak-smtp.sh' 'system-wiki/' | grep -E "SMTP_USER=[^[:space:]]|SMTP_PASSWORD=[^[:space:]]" || echo "OK: no SMTP credentials in committed diff"
```

Expected: `OK: no SMTP credentials in committed diff`. The committed `SMTP_USER=` and `SMTP_PASSWORD=` lines must remain empty strings. Real Brevo credentials go in `/opt/wims-bfp/src/.env` on the deploy host (gitignored), never in the committed diff.

- [ ] **Step 6: No commit needed — this task is verification only**

If any of Steps 1-5 fails, the implementer must investigate and fix before marking the plan complete. The most common cause would be an accidental Python edit in one of the compose or shell-script tasks; reverting the incidental edit and re-running the gate is the right response. There is no "commit a fix" step in this task — the fix is in whichever earlier task introduced the bad change.

---

## Self-Review

**1. Spec coverage:**

| Spec section | Plan task | Notes |
|---|---|---|
| S1 (env.production.example) | Task 1 | ✅ |
| S2 (compose defaults) | Task 2 | ✅ |
| S3 (update-keycloak-smtp.sh comment) | Task 3 | ✅ |
| S4 (.env.example comment) | Task 4 | ✅ |
| S5.1 (services.md) | Task 5 Step 3 | ✅ |
| S5.2 (utilities-and-tasks.md) | Task 5 Step 4 | ✅ |
| S5.3 (gap register) | Task 5 Step 6 | ✅ |
| S5.4 (log.md) | Task 5 Step 7 | ✅ |
| V1 (app email reaches Brevo) | Out of scope — manual deploy-time tripwire, not a CI gate. Documented in the spec. | ✅ |
| V2 (Keycloak email reaches Brevo) | Out of scope — manual deploy-time tripwire. The plan executes `scripts/update-keycloak-smtp.sh` as a post-deploy step (operational, not in the plan). | ✅ |
| V3 (direct async path) | Out of scope — manual deploy-time tripwire. | ✅ |
| V4 (script idempotency) | Out of scope — manual deploy-time tripwire. The script's idempotency is documented in the spec. | ✅ |
| V5 (no secrets committed) | Task 6 Step 5 | ✅ |
| V6 (existing tests pass) | Task 6 Steps 1-4 | ✅ |

**2. Placeholder scan:** No "TBD", "TODO", "implement later", "add appropriate error handling" in the plan. The one `<TBD at commit time>` token in Task 5 Step 6 is a commit-hash placeholder, not a code placeholder — the implementer pastes the actual commit hash when committing. All other code, config, and command snippets are concrete. ✅

**3. Type / identifier consistency:**
- Env var names (`SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_STARTTLS`, `SMTP_FROM_DISPLAY`, `SMTP_REPLYTO`, `SMTP_REPLYTO_DISPLAY`, `SMTP_SSL`, `SMTP_AUTH`) match the 6+5 split documented in the spec (v1.1 self-review). ✅
- Line numbers (`80, 81, 87, 88` for Keycloak; `264, 265, 269` for celery-worker) match the actual `src/docker-compose.yml` per the spec's "Reviewer basis" section. The plan's Step 1 of Task 2 includes a `sed -n` verification that re-anchors on content if line numbers have drifted. ✅
- File paths (`src/.env.production.example`, `src/docker-compose.yml`, `scripts/update-keycloak-smtp.sh`, `.env.example`, `system-wiki/backend/services.md`, `system-wiki/backend/utilities-and-tasks.md`, `system-wiki/gaps/frs-codebase-gap-register.md`, `system-wiki/log.md`) match the actual repo layout. ✅
- Brevo host `smtp-relay.brevo.com` and port `2525` match the spec and the Brevo docs cited in the spec. ✅
- Commit hash placeholder `<TBD at commit time>` in Task 5 Step 6 is intentionally a placeholder for the actual hash; the implementer pastes the real hash from `git rev-parse HEAD` at commit time. ✅

**4. Gaps found in self-review, fixed inline:**
- Task 2's verification (Step 4) had only the `docker compose config` path; the implementation host may not have Docker installed. Added a `python3 -c` fallback that reads the raw YAML and prints the literal default values. The fallback works on any host with Python 3 + PyYAML (which is already required for the existing tests). ✅
- Task 5's git-add was missing for `.env.example`; added to Task 4 Step 4's commit instead. The plan's 6 commits map 1:1 to the spec's "Files Changed" rows 1-5 + wiki-bundle + CI verification (no commit). ✅
- Task 6 Step 3 had no fallback for a host that cannot run pytest; added a clear "skip with reason" path that documents why the gate is still valid (config-only change → no test can break by construction). ✅
- Task 6 Step 5's grep was checking the wrong file paths; corrected to include `src/.env.production.example` (the file where SMTP_USER/SMTP_PASSWORD live) and `system-wiki/` (which has no SMTP creds but is in the diff). The grep pattern is `git diff master --` filtered to the changed files, then `grep -E "SMTP_USER=[^[:space:]]|SMTP_PASSWORD=[^[:space:]]"`. ✅

---

*This is an implementation plan. The source spec is at `docs/superpowers/specs/2026-06-24-email-provider-brevo-port-2525-design.md` (v1.1). 6 tasks, 0 TDD (config-only), 0 application code changes. Total commits: 6 (5 file-specific + 1 wiki-bundle). No commit for Task 6 (verification only). Estimated implementer time per task: 2-5 minutes.*
