# Enable Live Email & FCM Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire WIMS-BFP's existing email and FCM notification channels to real external services (Gmail SMTP + Firebase Cloud Messaging) so that password-reset emails, application emails, and citizen-report status push notifications reach real users instead of being trapped by MailHog / crashing on missing Firebase credentials.

**Architecture:** Three surgical Docker Compose edits (`src/docker-compose.yml` — add SMTP_* to celery-worker env, mount `firebase-creds.json` into celery-worker, set literal `FIREBASE_CREDENTIALS_PATH`), two host-side files at `/opt/wims-bfp/src/.env` and `/opt/wims-bfp/src/firebase-creds.json` (gitignored), one Keycloak realm SMTP update via a chained `docker exec sh -c` so the `kcadm.sh` session token stays in one shell context, and one wrapper script `scripts/update-keycloak-smtp.sh` for repeatable deploys. No new application code, no new dependencies, no schema changes.

**Tech Stack:** Docker Compose v2, Keycloak 24.0.0 (`kcadm.sh`), Firebase Admin SDK (Python, already in `requirements.txt` via `firebase-admin`), aiosmtplib (already in `requirements.txt`), Celery (already in stack).

**Source spec:** `docs/superpowers/specs/2026-06-23-live-notifications-design.md` (v2). This plan implements S1, S3, S2 (default 2b), S4, and the Q3-deferred `scripts/update-keycloak-smtp.sh` wrapper. The three verified blockers (B1 celery-worker no SMTP_*, B2 Keycloak realm SMTP not re-resolved on restart, B3 firebase-creds.json not mounted) each map to a task below.

## Global Constraints

- Python 3.10+ for backend; 4-space indent; `snake_case` modules; `Annotated[..., Depends(...)]` route signatures.
- TypeScript/React for frontend; `PascalCase` components; `camelCase` functions.
- Conventional Commits for commit subjects (e.g. `chore(compose): ...`, `feat(scripts): ...`).
- Run `ruff format .` (auto-fix) before committing Python changes — this is the most common CI blocker.
- `NEXT_PUBLIC_*` env vars are baked into the Next.js client bundle at build time; a rebuild is required when they change.
- `.env` and `firebase-creds.json` are gitignored at both repo root (`.gitignore:27-30`) and `src/` (`src/.gitignore:1-3`). Never commit them.
- Frontend CI pre-flight (`docs/agents/ci-preflight.md`) requires non-empty `NEXT_PUBLIC_FIREBASE_API_KEY` and `NEXT_PUBLIC_FIREBASE_VAPID_KEY` — set dummy values (`ci-dummy-api-key`, `ci-dummy-vapid-key`) via the shell when running `npm run build` in CI. Browser-side Firebase init will warn at runtime but the build will succeed.
- Deploy host path is `/opt/wims-bfp/...`; local dev path is `/home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/...`. This plan references both, with deploy-host paths used in operator tasks.
- All SMTP_* env vars the plan sets in `.env` are also used by the Keycloak service via compose interpolation (`src/docker-compose.yml:80-90`); the keycloak service already wires them into the realm JSON placeholders at first import.
- Backend `services/email/sender.py:18-23` reads only `SMTP_HOST, SMTP_PORT, SMTP_FROM, SMTP_USER, SMTP_PASSWORD, SMTP_STARTTLS` — these six must reach `celery-worker` for `send_email_task` to use Gmail. The other five SMTP_* vars (`SMTP_FROM_DISPLAY, SMTP_REPLYTO, SMTP_REPLYTO_DISPLAY, SMTP_SSL, SMTP_AUTH`) are consumed by the Keycloak realm JSON only and are still required in `.env` for Keycloak; they are intentionally not added to the celery-worker env block.

## File Structure

| # | File | Action | Why |
|---|------|--------|-----|
| 1 | `src/docker-compose.yml` | **Edit** | Add 6 `SMTP_*` lines to celery-worker env (S1); add `firebase-creds.json` volume mount + literal `FIREBASE_CREDENTIALS_PATH` (S3) |
| 2 | `/opt/wims-bfp/src/.env` | **Create on deploy host** (gitignored) | Populate `SMTP_*` and `NEXT_PUBLIC_FIREBASE_*` |
| 3 | `/opt/wims-bfp/src/firebase-creds.json` | **Create on deploy host** (gitignored) | Real Firebase service account JSON, `chmod 600` |
| 4 | `scripts/update-keycloak-smtp.sh` | **Create** | Wrapper around the chained kcadm command (Q3 from spec) |
| 5 | `src/.env.production.example` | **Edit (optional but recommended)** | Document SMTP_* and `FIREBASE_CREDENTIALS_PATH` for operators (S4) |
| 6 | `system-wiki/log.md` | **Append** | Wiki update per AGENTS.md rule |
| 7 | `system-wiki/architecture/infrastructure-config.md` (or relevant synthesis page) | **Edit** | Document live SMTP / FCM wiring |
| 8 | `system-wiki/gaps/frs-codebase-gap-register.md` | **Edit (if applicable)** | Close the dev-MailHog / placeholder-creds gap if listed there |

The plan does **not** modify any application code (`sender.py`, `notifications.py`, `civilian.py`, `firebase.ts`, `firebase-messaging-sw.js`, `bfp-realm.json`).

---

### Task 1: Add SMTP_* env to celery-worker (S1)

Resolves blocker **B1** (celery-worker has no SMTP_* and no `env_file`; `send_email_task` falls back to mailhog).

**Files:**
- Modify: `src/docker-compose.yml` — celery-worker `environment:` block, after the `FIREBASE_*` entries and before `OPENBAO_TOKEN_FILE`

**Interfaces:**
- Consumes: `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_STARTTLS` from `.env` (via compose interpolation)
- Produces: `celery-worker` container has the six SMTP_* env vars set; `tasks/notifications.py:send_email_task` (run via Celery in the worker) can call `sender.py` with Gmail creds

- [ ] **Step 1: Verify current state — celery-worker has no SMTP_HOST**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/src && docker compose config 2>/dev/null | grep -A 30 'wims-celery-worker:' | grep -E 'SMTP_HOST|SMTP_PORT' || echo 'EXPECTED: no SMTP_* in celery-worker env'
```

Expected: the `grep` finds no SMTP_* lines (only the keycloak and backend services have them). If you see SMTP_HOST in the celery-worker block, B1 is already fixed — skip to Task 2.

- [ ] **Step 2: Edit `src/docker-compose.yml` — insert 6 SMTP_* lines in celery-worker env**

Open `src/docker-compose.yml`. Locate the celery-worker service `environment:` block (it has entries like `DATABASE_URL`, `REDIS_URL`, `KEYCLOAK_REALM_URL`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `FIREBASE_CREDENTIALS_PATH`, then `OPENBAO_ADDR` / `OPENBAO_TOKEN` / `OPENBAO_TOKEN_FILE`).

Insert **after** the `FIREBASE_CREDENTIALS_PATH` line and **before** the `OPENBAO_ADDR` line:

```yaml
      - SMTP_HOST=${SMTP_HOST:-mailhog}
      - SMTP_PORT=${SMTP_PORT:-1025}
      - SMTP_FROM=${SMTP_FROM:-noreply@wims-bfp.local}
      - SMTP_USER=${SMTP_USER:-}
      - SMTP_PASSWORD=${SMTP_PASSWORD:-}
      - SMTP_STARTTLS=${SMTP_STARTTLS:-false}
```

> **Why only six, not all eleven:** `sender.py:18-23` reads only these six. `SMTP_AUTH` is consumed by the Keycloak realm JSON only and is unnecessary for the backend sender (it uses non-empty `SMTP_USER`/`SMTP_PASSWORD` to decide auth — see `sender.py:127-130`). Adding the other five to celery-worker would be harmless but YAGNI.
> **Why `${VAR:-default}` not `env_file`:** matches the surrounding style (keycloak service does the same). Both approaches work; this one is consistent with the existing file.

- [ ] **Step 3: Verify compose config is valid**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/src && docker compose config --quiet && echo 'OK: compose config valid'
```

Expected: `OK: compose config valid` and exit code 0. If the config fails, fix the YAML indentation (6 spaces + `- ` for list items under `environment:`).

- [ ] **Step 4: Verify SMTP_HOST now appears in the celery-worker env**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/src && docker compose config 2>/dev/null | grep -A 30 'wims-celery-worker:' | grep SMTP_HOST
```

Expected: one line like `- SMTP_HOST=mailhog` (the default is `mailhog` because `.env` doesn't exist yet — Task 3 populates the real value).

- [ ] **Step 5: Commit**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && git add src/docker-compose.yml && git commit -m "chore(compose): pass SMTP_* to celery-worker for app email via Gmail"
```

---

### Task 2: Mount `firebase-creds.json` into celery-worker (S3, compose part)

Resolves blocker **B3** (`firebase-creds.json` not mounted into celery-worker → `notifications.py:35` raises `FileNotFoundError` at dispatch time).

**Files:**
- Modify: `src/docker-compose.yml` — celery-worker `volumes:` block (after `openbao_data`, before `/var/run/docker.sock`) and `environment:` block (replace the `FIREBASE_CREDENTIALS_PATH` line)

**Interfaces:**
- Consumes: `./firebase-creds.json` from the repo/deploy root (operator places it there in Task 4)
- Produces: celery-worker has read-only access to `/app/firebase-creds.json`; `notifications.py:35` reads `credentials.Certificate(creds_path)` successfully

- [ ] **Step 1: Verify current state — no firebase-creds mount in celery-worker**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/src && docker compose config 2>/dev/null | awk '/wims-celery-worker:/,/^  [a-z]/{print}' | grep -i 'firebase\|/var/run/docker.sock' || echo 'no firebase mount yet'
```

Expected: the output shows `/var/run/docker.sock:/var/run/docker.sock` (the last existing mount) but no firebase-creds line. If firebase-creds already appears, skip to Task 3.

- [ ] **Step 2: Replace the `FIREBASE_CREDENTIALS_PATH` env line in celery-worker**

In `src/docker-compose.yml`, find the celery-worker `environment:` line:
```yaml
      - FIREBASE_CREDENTIALS_PATH=${FIREBASE_CREDENTIALS_PATH:-}
```

Replace it with a literal path:
```yaml
      - FIREBASE_CREDENTIALS_PATH=/app/firebase-creds.json
```

The in-container path is now fixed by the volume mount added in the next step. Compose interpolation is no longer needed.

- [ ] **Step 3: Add the volume mount in celery-worker `volumes:` block**

In `src/docker-compose.yml`, find the celery-worker `volumes:` block. It currently contains (in order): `./suricata/logs:/var/log/suricata:ro`, `./postgres-init:/postgres-init:ro`, `incident_attachments_data:/app/storage`, `openbao_data:/openbao-creds:ro`, then `/var/run/docker.sock:/var/run/docker.sock` (with a 6-line security comment before it).

Insert **after** the `openbao_data` line and **before** the docker.sock mount's security comment:

```yaml
      - ./firebase-creds.json:/app/firebase-creds.json:ro
```

The resulting volumes block should have the firebase-creds mount directly before the docker.sock mount.

- [ ] **Step 4: Verify compose config is valid**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/src && docker compose config --quiet && echo 'OK'
```

Expected: `OK`, exit 0.

- [ ] **Step 5: Verify both env and mount are present**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/src && docker compose config 2>/dev/null | awk '/wims-celery-worker:/,/^  [a-z]/{print}' | grep -E 'FIREBASE_CREDENTIALS_PATH|firebase-creds'
```

Expected: two lines — one for `FIREBASE_CREDENTIALS_PATH=/app/firebase-creds.json` and one for the `./firebase-creds.json:/app/firebase-creds.json:ro` volume mount.

- [ ] **Step 6: Commit**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && git add src/docker-compose.yml && git commit -m "chore(compose): mount firebase-creds.json into celery-worker for FCM Admin SDK"
```

---

### Task 3: Create `.env` on the deploy host (S1 + frontend build args)

**Operator-only task — not committed.** Populates the `.env` file at the deploy host path so compose interpolation resolves to real values. The file is gitignored.

**Files:**
- Create: `/opt/wims-bfp/src/.env` (gitignored by both `.gitignore:27-30` and `src/.gitignore:1-3`)

**Interfaces:**
- Consumes: real Gmail App Password, Firebase project values, VAPID key (operator obtains these in the manual prerequisites of the spec)
- Produces: the `SMTP_*` and `NEXT_PUBLIC_FIREBASE_*` keys compose reads to populate container env and frontend build args

- [ ] **Step 1: Confirm prerequisites from spec v2 prerequisites are met**

Before creating `.env`, confirm the operator has:
- Gmail account `noreply.wimsbfp@gmail.com` (or chosen sender) with 2-Step Verification enabled and a 16-char App Password generated.
- Firebase project `wims-bfp` (or chosen project ID) with Cloud Messaging API enabled, VAPID key generated, and the service-account JSON downloaded (Task 4 places that file).
- Optionally: confirm hardcoded Firebase defaults match the actual project (`projectId=wims-bfp`, `messagingSenderId=465171995576`, `appId=1:465171995576:web:9aa2403d8f6b9c4bb50d4d`). If they differ, uncomment the corresponding `NEXT_PUBLIC_FIREBASE_*` lines below.

- [ ] **Step 2: Create the `.env` file with real values**

```bash
sudo tee /opt/wims-bfp/src/.env > /dev/null <<'EOF'
# Gmail SMTP (sender.py:18-23 reads these six for app email;
# bfp-realm.json:1523-1533 reads all eleven for Keycloak transactional email)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_FROM=noreply.wimsbfp@gmail.com
SMTP_FROM_DISPLAY=WIMS-BFP
SMTP_REPLYTO=no-reply@wimsbfp.tech
SMTP_REPLYTO_DISPLAY=WIMS-BFP No Reply
SMTP_SSL=false
SMTP_STARTTLS=true
SMTP_AUTH=true
SMTP_USER=noreply.wimsbfp@gmail.com
SMTP_PASSWORD=<paste-16-char-app-password>

# Firebase (frontend build args — baked into client bundle at build time)
NEXT_PUBLIC_FIREBASE_API_KEY=<from-firebase-console>
NEXT_PUBLIC_FIREBASE_VAPID_KEY=<vapid-key>
# Uncomment ONLY if the console values differ from compose defaults:
# NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=wims-bfp.firebaseapp.com
# NEXT_PUBLIC_FIREBASE_PROJECT_ID=wims-bfp
# NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=wims-bfp.firebasestorage.app
# NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=465171995576
# NEXT_PUBLIC_FIREBASE_APP_ID=1:465171995576:web:9aa2403d8f6b9c4bb50d4d
EOF
sudo chmod 600 /opt/wims-bfp/src/.env
```

> **Security:** do **not** commit this file. `.gitignore:27` and `src/.gitignore:1` both exclude it. `chmod 600` limits read to the file owner.

- [ ] **Step 3: Verify the file exists with the right permissions and no SMTP_PASSWORD is empty**

```bash
ls -la /opt/wims-bfp/src/.env
grep -E '^SMTP_PASSWORD=' /opt/wims-bfp/src/.env | grep -v '<paste' | grep -q '.' && echo 'OK: SMTP_PASSWORD is set' || echo 'ERROR: SMTP_PASSWORD missing or still a placeholder'
```

Expected: `-rw-------` permissions and `OK: SMTP_PASSWORD is set`. If you see `ERROR`, re-edit and replace the `<paste-16-char-app-password>` placeholder.

- [ ] **Step 4: Verify compose picks up the new values**

```bash
cd /opt/wims-bfp/src && docker compose config 2>/dev/null | grep -A 3 'wims-keycloak:' | grep -E 'SMTP_HOST|SMTP_USER|SMTP_PASSWORD'
```

Expected: lines showing `SMTP_HOST=smtp.gmail.com`, `SMTP_USER=noreply.wimsbfp@gmail.com`, and a non-empty `SMTP_PASSWORD=...` (the actual app password).

- [ ] **Step 5: No commit**

`.env` is gitignored. Skip `git add` for this file. Proceed to Task 4.

---

### Task 4: Place `firebase-creds.json` on the deploy host (S3, host-side)

**Operator-only task — not committed.** The Firebase service-account JSON downloaded from the Firebase console in the spec's prerequisites is placed at the repo root so the volume mount from Task 2 (`./firebase-creds.json:/app/firebase-creds.json:ro`) resolves.

**Files:**
- Create: `/opt/wims-bfp/src/firebase-creds.json` (gitignored by `.gitignore:30`)

**Interfaces:**
- Consumes: the service-account JSON file downloaded from Firebase console (Project Settings → Service Accounts → "Generate new private key")
- Produces: celery-worker container can read it as `/app/firebase-creds.json`; `notifications.py:35` calls `credentials.Certificate(creds_path)` successfully

- [ ] **Step 1: Locate the downloaded service-account JSON**

The Firebase console download is typically named `wims-bfp-firebase-adminsdk-XXXXX-XXXXXXXXXX.json` and lands in `~/Downloads/` on the operator's machine. The operator must `scp` (or otherwise transfer) it to the deploy host. This plan assumes the file has been transferred to `/root/wims-bfp-firebase-adminsdk.json` on the deploy host; adjust the path as needed.

- [ ] **Step 2: Move and lock down the file**

```bash
sudo mv /root/wims-bfp-firebase-adminsdk.json /opt/wims-bfp/src/firebase-creds.json
sudo chmod 600 /opt/wims-bfp/src/firebase-creds.json
sudo chown root:root /opt/wims-bfp/src/firebase-creds.json
```

Expected: file exists at `/opt/wims-bfp/src/firebase-creds.json` with `-rw-------` perms.

- [ ] **Step 3: Validate the JSON is well-formed (not the file the celery-worker will read, just a sanity check)**

```bash
python3 -c "import json; d = json.load(open('/opt/wims-bfp/src/firebase-creds.json')); assert d['type'] == 'service_account'; print('OK: valid service-account JSON, project_id =', d['project_id'])"
```

Expected: `OK: valid service-account JSON, project_id = wims-bfp` (or your chosen project ID).

- [ ] **Step 4: Verify the file is gitignored**

```bash
cd /opt/wims-bfp/src && git check-ignore -v firebase-creds.json
```

Expected: a line like `.gitignore:30:firebase-creds.json .//firebase-creds.json` (or `src/.gitignore:3:!.env.production.example` if the .env.production.example allow-rule is the nearest match — that one is OK, but it must not allow firebase-creds.json). If git does **not** ignore the file, do not proceed — fix `.gitignore` first.

- [ ] **Step 5: No commit**

`firebase-creds.json` is gitignored. Proceed to Task 5.

---

### Task 5: Restart containers and verify env propagation

After Tasks 1-4, restart the three services that need the new env / mount so the running containers pick up the changes.

**Files:** none (operational)

- [ ] **Step 1: Restart backend, celery-worker, keycloak**

```bash
cd /opt/wims-bfp/src && docker compose up -d backend celery-worker keycloak
```

Expected: containers start, exit code 0. Keycloak will re-resolve `${env.SMTP_*}` placeholders in the realm JSON **only on first import** — see Task 7 for the separate kcadm update that handles the existing realm in the DB.

- [ ] **Step 2: Verify celery-worker has SMTP_HOST in its env**

```bash
docker exec wims-celery-worker env | grep -E '^SMTP_(HOST|USER|PASSWORD|STARTTLS)='
```

Expected: four non-empty lines. `SMTP_HOST=smtp.gmail.com`, `SMTP_USER=noreply.wimsbfp@gmail.com`, `SMTP_PASSWORD=...` (the actual app password), `SMTP_STARTTLS=true`.

- [ ] **Step 3: Verify celery-worker can read the mounted firebase-creds.json**

```bash
docker exec wims-celery-worker test -r /app/firebase-creds.json && echo 'OK: creds file readable' || echo 'ERROR: creds file not readable'
docker exec wims-celery-worker python -c "import json; d = json.load(open('/app/firebase-creds.json')); print('OK: project_id =', d['project_id'])"
```

Expected: `OK: creds file readable` and `OK: project_id = wims-bfp`. If you see `ERROR: creds file not readable`, check the volume mount in Task 2 (the file path on the host must match `./firebase-creds.json` relative to the `src/` directory that `docker compose` runs from).

- [ ] **Step 4: Verify backend has SMTP_* via its `env_file`**

```bash
docker exec wims-backend env | grep -E '^SMTP_(HOST|USER|PASSWORD|STARTTLS)='
```

Expected: same four lines as Step 2.

- [ ] **Step 5: No commit yet**

The env / file changes are operator-side. The compose changes were already committed in Tasks 1-2. Proceed to Task 6.

---

### Task 6: Create `scripts/update-keycloak-smtp.sh` (Q3 from spec)

Resolves the spec's "Deferred to Plan Author" item: a thin wrapper around the chained kcadm command from S2 2b, so the SMTP update is idempotent and scriptable.

**Files:**
- Create: `scripts/update-keycloak-smtp.sh`

**Interfaces:**
- Consumes: `$1` = path to `.env` file (defaults to `./.env`); reads `SMTP_*` keys from it
- Produces: the bfp Keycloak realm's `smtpServer` field is updated to match `.env` values

- [ ] **Step 1: Create the script directory and file**

```bash
mkdir -p /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/scripts
```

Then create `scripts/update-keycloak-smtp.sh` with the content below.

- [ ] **Step 2: Write the script**

Create `scripts/update-keycloak-smtp.sh` (in the repo root, not in `src/`):

```bash
#!/usr/bin/env bash
# scripts/update-keycloak-smtp.sh
#
# Update the bfp Keycloak realm's SMTP settings to match the SMTP_* keys in .env.
# The kcadm.sh "config credentials" + "update realms/bfp" commands are chained in
# a single `docker exec sh -c "..."` so the session token written by
# `config credentials` (~/.keycloak/kcadm.config) stays in one shell context and
# is visible to the subsequent `update` call.
#
# Usage:
#   ./scripts/update-keycloak-smtp.sh [path-to-env-file]
#
# Default env-file path: ./.env (relative to the script's CWD)
set -euo pipefail

ENV_FILE="${1:-.env}"
if [ ! -f "$ENV_FILE" ]; then
  echo "Error: env file not found at $ENV_FILE" >&2
  exit 1
fi

# Load .env
set -a
. "$ENV_FILE"
set +a

# Validate required keys
for v in SMTP_HOST SMTP_PORT SMTP_FROM SMTP_USER SMTP_PASSWORD; do
  if [ -z "${!v:-}" ]; then
    echo "Error: $v is empty or unset in $ENV_FILE" >&2
    exit 1
  fi
done

# Build the smtpServer JSON. Defaults match bfp-realm.json's ${env.*} fallbacks
# so the script works even if the *_DISPLAY / REPLYTO / SSL / AUTH keys are
# absent from .env.
SMTP_FROM_DISPLAY="${SMTP_FROM_DISPLAY:-WIMS-BFP}"
SMTP_REPLYTO="${SMTP_REPLYTO:-$SMTP_FROM}"
SMTP_REPLYTO_DISPLAY="${SMTP_REPLYTO_DISPLAY:-WIMS-BFP No Reply}"
SMTP_SSL="${SMTP_SSL:-false}"
SMTP_STARTTLS="${SMTP_STARTTLS:-true}"
SMTP_AUTH="${SMTP_AUTH:-true}"

SMTP_JSON="{\"host\":\"$SMTP_HOST\",\"port\":\"$SMTP_PORT\",\"from\":\"$SMTP_FROM\",\"fromDisplayName\":\"$SMTP_FROM_DISPLAY\",\"replyTo\":\"$SMTP_REPLYTO\",\"replyToDisplayName\":\"$SMTP_REPLYTO_DISPLAY\",\"ssl\":\"$SMTP_SSL\",\"starttls\":\"$SMTP_STARTTLS\",\"auth\":\"$SMTP_AUTH\",\"user\":\"$SMTP_USER\",\"password\":\"$SMTP_PASSWORD\"}"

# Pass SMTP_JSON as an env var to the container to avoid shell-escape issues
# with the JSON's quotes inside the inner single-quoted kcadm arg.
docker exec -e SMTP_JSON="$SMTP_JSON" wims-keycloak sh -c '
  /opt/keycloak/bin/kcadm.sh config credentials \
    --server http://localhost:8080/auth --realm master \
    --user "$KEYCLOAK_ADMIN" --password "$KEYCLOAK_ADMIN_PASSWORD" && \
  /opt/keycloak/bin/kcadm.sh update realms/bfp \
    -s "smtpServer=$SMTP_JSON"
'

echo "✓ Keycloak bfp realm SMTP updated to $SMTP_HOST:$SMTP_PORT"
```

- [ ] **Step 3: Make the script executable**

```bash
chmod +x /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/scripts/update-keycloak-smtp.sh
```

- [ ] **Step 4: Lint the script (optional, shellcheck if available)**

```bash
command -v shellcheck >/dev/null && shellcheck /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/scripts/update-keycloak-smtp.sh || echo 'shellcheck not installed; skipping'
```

Expected: no errors if shellcheck is installed; otherwise the message above. CI does not gate on shellcheck for this repo.

- [ ] **Step 5: Commit**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && git add scripts/update-keycloak-smtp.sh && git commit -m "feat(scripts): add update-keycloak-smtp.sh to wire bfp realm SMTP from .env"
```

---

### Task 7: Run the script to update Keycloak realm SMTP (S2, default 2b)

Resolves blocker **B2** (Keycloak's `--import-realm` does not override existing realms; the bfp realm's `smtpServer` was resolved at first import with mailhog defaults and persists in the Postgres DB).

**Files:** none (operational; the script was created in Task 6)

- [ ] **Step 1: Run the script**

```bash
cd /opt/wims-bfp/src && sudo /opt/wims-bfp/scripts/update-keycloak-smtp.sh /opt/wims-bfp/src/.env
```

(Adjust the path to the script: if you cloned to a different deploy location, use that path. The script's `$1` is the `.env` file path; default would be `./.env` if the script runs from the same dir as `.env`.)

Expected: `✓ Keycloak bfp realm SMTP updated to smtp.gmail.com:587`. Exit code 0.

If you see `Error: env file not found`, the path is wrong. If you see `Error: SMTP_HOST is empty`, the `.env` from Task 3 is missing a key — fix and rerun.

- [ ] **Step 2: Verify the realm's smtpServer is now set to Gmail**

```bash
docker exec wims-keycloak /opt/keycloak/bin/kcadm.sh get realms/bfp --fields smtpServer 2>&1 | head -20
```

If kcadm complains about missing credentials in this exec, prefix with the config call:
```bash
docker exec wims-keycloak sh -c '
  /opt/keycloak/bin/kcadm.sh config credentials \
    --server http://localhost:8080/auth --realm master \
    --user "$KEYCLOAK_ADMIN" --password "$KEYCLOAK_ADMIN_PASSWORD" >/dev/null && \
  /opt/keycloak/bin/kcadm.sh get realms/bfp --fields smtpServer
'
```

Expected: JSON like
```json
{
  "smtpServer" : {
    "host" : "smtp.gmail.com",
    "port" : "587",
    "from" : "noreply.wimsbfp@gmail.com",
    ...
  }
}
```

If the output shows `host: mailhog`, the script did not actually update — check `docker logs wims-keycloak --tail 30` for kcadm errors and rerun the script.

- [ ] **Step 3: No commit**

The realm update is a runtime state change in the Keycloak DB, not a repo file change. Proceed to Task 8.

---

### Task 8: Rebuild frontend so `NEXT_PUBLIC_FIREBASE_*` are baked in

`NEXT_PUBLIC_*` vars are inlined into the Next.js client bundle at build time. After Task 3 populated `.env`, the running compose interpolation has the right values, but the frontend's static bundle still has the old (empty) values. A rebuild is required.

**Files:** none (operational; frontend is rebuilt from the existing Dockerfile)

- [ ] **Step 1: Rebuild the frontend container**

```bash
cd /opt/wims-bfp/src && docker compose up --build -d frontend
```

Expected: docker compose builds the frontend image (passing the `NEXT_PUBLIC_FIREBASE_*` build args from the new `.env`), then starts the container. Exit 0.

- [ ] **Step 2: Verify the frontend serves the Firebase config**

```bash
docker exec wims-frontend sh -c 'grep -r "firebaseConfig\|apiKey" /app/.next/static 2>/dev/null | head -3' || echo 'check the rendered HTML instead'
curl -s http://localhost/ | grep -oE 'apiKey["\x27]?\s*[:=]\s*["\x27][A-Za-z0-9_-]+' | head -1
```

Expected: the `apiKey` in the served HTML matches the real value from `.env` (not empty and not `ci-dummy-api-key`).

- [ ] **Step 3: No commit**

The frontend image is a build artifact. Proceed to Task 9.

---

### Task 9: Live verification — Email channels (R1, R2, V1, V2)

End-to-end manual checks against real Gmail. Document results in the runbook / commit message of Task 12.

**Files:** none (operational)

- [ ] **Step 1: Trigger a Keycloak password reset**

Browse to `http://localhost:8080/auth/realms/bfp/login-actions/reset-credentials` (or click "Forgot password" on the login page). Enter the email of a real user in the bfp realm.

- [ ] **Step 2: Confirm the email arrives in the real recipient inbox (not MailHog)**

```bash
docker logs wims-keycloak --tail 30 | grep -iE 'smtp|mail' | tail -5
```

Expected: the user finds the reset email in their real inbox. MailHog UI at `http://localhost:8025` does **not** show the message.

- [ ] **Step 3: Trigger an application email (R2 / V1)**

Use any in-app action that fires `send_email_task`. Easiest: invoke directly from the celery-worker container for a smoke test:
```bash
docker exec wims-celery-worker python -c \
  "from tasks.notifications import send_email_task; \
   send_email_task.delay('you@example.com', 'security_alert', {'user': 'test', 'event': 'live wiring smoke test', 'ip': '127.0.0.1'})"
```

(Replace `you@example.com` with a real address you can check.)

- [ ] **Step 4: Confirm the celery-worker logged the Gmail send**

```bash
docker logs wims-celery-worker --tail 50 | grep -E 'Email sent|smtp.gmail.com'
```

Expected: a line like `Email sent via send_email_task: to=you@example.com template=security_alert` (from `notifications.py:185`).

- [ ] **Step 5: No commit yet**

Proceed to Task 10.

---

### Task 10: Live verification — FCM push (R3, V3)

**Files:** none (operational)

- [ ] **Step 1: Register an FCM token from the citizen tracking page**

1. Open `http://localhost/` and navigate to a citizen report tracking page for a real report.
2. Click "Enable Notifications" → grant browser permission. This calls `POST /api/v1/civilian/reports/{report_id}/notify` (`civilian.py:909-914`, handler `register_notification`).
3. Open browser DevTools → Network tab; confirm the request returns `201` with body `{"status":"registered", ...}`.

- [ ] **Step 2: Trigger a status transition**

From the admin/triage panel, promote the report to `VERIFIED` (or another status that fires `send_status_notification`).

- [ ] **Step 3: Confirm the push notification arrives**

Within ~30 seconds, a push notification should appear in the browser (or on a mobile device with the PWA installed).

- [ ] **Step 4: Confirm the celery-worker logged the FCM dispatch**

```bash
docker logs wims-celery-worker --tail 50 | grep -iE 'notification|fcm|firebase' | tail -10
```

Expected: a line indicating dispatch succeeded (e.g. `sent=1 failed=0` per the spec's expected format). **No** `FileNotFoundError`, no `Firebase credentials not configured`, no `google.auth.exceptions.DefaultCredentialsError`.

If you see `FileNotFoundError` for `/app/firebase-creds.json`: re-check Task 4 (file exists on host) and Task 2 (volume mount present in compose). If you see `DefaultCredentialsError`: re-check that the service-account JSON's `project_id` matches the Firebase project you created the token in.

- [ ] **Step 5: No commit yet**

Proceed to Task 11.

---

### Task 11: Update `.env.production.example` (S4, optional but recommended)

Improves operator discoverability. The example file already has `FIREBASE_CREDENTIALS_PATH=` at line 17; add a comment block explaining the file-mount and the SMTP_* key requirements.

**Files:**
- Modify: `src/.env.production.example`

- [ ] **Step 1: Read the current example file**

```bash
cat /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/src/.env.production.example
```

- [ ] **Step 2: Replace the `FIREBASE_CREDENTIALS_PATH` line with a documented block**

Find the line:
```
FIREBASE_CREDENTIALS_PATH=
```

Replace it with:
```
# Path INSIDE the celery-worker container to the Firebase service-account JSON.
# The file is mounted from <repo-root>/firebase-creds.json in docker-compose.yml
# (celery-worker volumes, see commit "chore(compose): mount firebase-creds.json").
# This path is FIXED by the compose volume mount; do not change unless you also
# update docker-compose.yml.
FIREBASE_CREDENTIALS_PATH=/app/firebase-creds.json

# FIREBASE_SERVICE_ACCOUNT_JSON (alternative) — paste the full service-account
# JSON here as a single line if you cannot use the file mount. Either approach
# works; the file mount is the repo default.
# FIREBASE_SERVICE_ACCOUNT_JSON=
```

- [ ] **Step 3: Add the SMTP_* block at the end of the example file**

Append to `src/.env.production.example`:
```
# ----- Live email (Gmail SMTP) -----
# sender.py:18-23 reads the first six for application email; bfp-realm.json:1523-1533
# reads all eleven for Keycloak transactional email. Generate the app password at
# https://myaccount.google.com/apppasswords after enabling 2-Step Verification on
# the sender account. The kcadm-side update is run by scripts/update-keycloak-smtp.sh.
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_FROM=noreply.wimsbfp@gmail.com
SMTP_FROM_DISPLAY=WIMS-BFP
SMTP_REPLYTO=no-reply@wimsbfp.tech
SMTP_REPLYTO_DISPLAY=WIMS-BFP No Reply
SMTP_SSL=false
SMTP_STARTTLS=true
SMTP_AUTH=true
SMTP_USER=noreply.wimsbfp@gmail.com
SMTP_PASSWORD=
```

- [ ] **Step 4: Verify the file is still gitignored correctly**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && git check-ignore -v src/.env.production.example
```

Expected: the file is **not** ignored (it has the explicit `!.env.production.example` allow-rule in `src/.gitignore:3`). If it shows as ignored, fix the gitignore — the whole point of the example is to be a tracked, sanitized reference.

- [ ] **Step 5: Commit**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && git add src/.env.production.example && git commit -m "docs(env): document SMTP_* and FIREBASE_CREDENTIALS_PATH in .env.production.example"
```

---

### Task 12: System wiki update (per AGENTS.md mandatory rule)

Per the repo `AGENTS.md` "Mandatory System Wiki Update Rule": for non-trivial code/infra/test changes, update the relevant `system-wiki/` synthesis page, append to `system-wiki/log.md`, and update the gaps register if applicable.

**Files:**
- Append: `system-wiki/log.md`
- Edit: `system-wiki/architecture/infrastructure-config.md` (and/or `system-wiki/backend/utilities-and-tasks.md` for the celery task wiring, and `system-wiki/frontend/frontend-infrastructure.md` for the FCM build args)
- Edit: `system-wiki/gaps/frs-codebase-gap-register.md` (close the dev-MailHog / placeholder-creds gap if listed there)

- [ ] **Step 1: Read the relevant synthesis pages to know the current structure**

```bash
ls /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/system-wiki/architecture/
ls /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/system-wiki/backend/
ls /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/system-wiki/frontend/
rg -n 'SMTP|firebase|FCM|notification' /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/system-wiki/architecture/infrastructure-config.md 2>/dev/null | head -20
```

Skim the relevant section to understand the format used for similar entries (e.g. how other env-var wirings are documented). Match the existing style.

- [ ] **Step 2: Add a "Live email & FCM wiring" section to `infrastructure-config.md`**

In `system-wiki/architecture/infrastructure-config.md`, find the docker-compose / service-config section and append:

```markdown
### Live email & FCM wiring (2026-06-23)

Email (Gmail SMTP) and FCM (Firebase Cloud Messaging) are wired to real external services. Both channels were previously dev-trapped (MailHog for email, placeholder creds for FCM).

**Compose changes** (`src/docker-compose.yml`):
- celery-worker `environment:` adds 6 `SMTP_*` lines (host/port/from/user/password/starttls) — resolves B1.
- celery-worker `volumes:` adds `./firebase-creds.json:/app/firebase-creds.json:ro`; the corresponding `FIREBASE_CREDENTIALS_PATH` env is now a literal `/app/firebase-creds.json` — resolves B3.

**Keycloak realm update**: `${env.SMTP_*}` placeholders in `src/keycloak/import/bfp-realm.json:1523-1533` are resolved at first import only; `start-dev --import-realm` skips existing realms. The live realm's smtpServer is updated by `scripts/update-keycloak-smtp.sh`, which sources `SMTP_*` from `.env` and runs a chained `docker exec sh -c "kcadm config credentials && kcadm update realms/bfp"` so the session token is preserved. Resolves B2.

**Host-side files** (gitignored, not in repo):
- `/opt/wims-bfp/src/.env` — `SMTP_*` (Gmail) and `NEXT_PUBLIC_FIREBASE_*` (frontend build args).
- `/opt/wims-bfp/src/firebase-creds.json` — service-account JSON, `chmod 600`.

**Frontend rebuild required** when `NEXT_PUBLIC_FIREBASE_*` change (baked at build time). See `docs/superpowers/specs/2026-06-23-live-notifications-design.md` and `docs/superpowers/plans/2026-06-23-live-notifications.md` for full context.
```

- [ ] **Step 3: Append an entry to `system-wiki/log.md`**

```bash
cat >> /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/system-wiki/log.md <<'EOF'

## 2026-06-23 — Live email & FCM push wiring

Wired WIMS-BFP's existing email and FCM notification channels to real external services (Gmail SMTP, Firebase Cloud Messaging). Three verified blockers resolved:

- B1: celery-worker had no `SMTP_*` env and no `env_file`; `send_email_task` fell back to mailhog. Fix: add 6 `SMTP_*` lines to celery-worker environment.
- B2: Keycloak's `start-dev --import-realm` resolves `${env.SMTP_*}` placeholders once at first import and stores the resolved values in the Postgres-backed Keycloak DB. Restart does not re-resolve. Fix: `scripts/update-keycloak-smtp.sh` runs a chained `docker exec sh -c "kcadm config credentials && kcadm update realms/bfp"` to update the live realm.
- B3: `firebase-creds.json` was not volume-mounted into the celery-worker container. Fix: add `./firebase-creds.json:/app/firebase-creds.json:ro` to celery-worker volumes and set `FIREBASE_CREDENTIALS_PATH=/app/firebase-creds.json` literally.

Spec: `docs/superpowers/specs/2026-06-23-live-notifications-design.md` (v2). Plan: `docs/superpowers/plans/2026-06-23-live-notifications.md`. No application code changes; no new dependencies; no schema changes.
EOF
```

- [ ] **Step 4: Update `system-wiki/gaps/frs-codebase-gap-register.md` if the dev-MailHog / placeholder-creds gap is listed**

```bash
rg -n -i 'mailhog|placeholder.*creds|firebase.*placeholder' /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/system-wiki/gaps/frs-codebase-gap-register.md 2>/dev/null || echo 'gap not in register — skip Step 4'
```

If a gap is listed, mark it as closed (move to a "Closed gaps" subsection, or add a `closed: 2026-06-23` annotation, matching the register's existing convention). If no gap is listed, skip this step and note in the commit message that the gap register was reviewed and no entry applied.

- [ ] **Step 5: Commit**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && git add system-wiki/ && git commit -m "docs(wiki): document live email and FCM wiring; close dev-trap gap if listed"
```

---

### Task 13: CI pre-flight gate (V5, R5)

The repo's CI pre-flight routine (`docs/agents/ci-preflight.md`) runs four blocking gates: backend ruff lint, backend ruff format, backend pytest, and frontend lint/test/build. **All four must pass** with the new compose changes in place. The frontend build gate requires dummy `NEXT_PUBLIC_FIREBASE_*` values (per spec Q4 resolved).

**Files:** none (operational)

- [ ] **Step 1: Backend ruff lint**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/src/backend && ruff check .
```

Expected: `All checks passed!` and exit 0. The compose changes don't touch Python; this should pass unchanged.

- [ ] **Step 2: Backend ruff format check**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/src/backend && ruff format . --check
```

Expected: no diff. If it reports files needing reformat, run `ruff format .` (auto-fix) and re-check. **Do not commit the auto-format in this task** — the plan intentionally makes no Python changes; if ruff format fails, investigate before proceeding.

- [ ] **Step 3: Backend pytest**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/src/backend && python -m pytest -v 2>&1 | tail -40
```

Expected: all tests pass. The compose changes don't affect backend code, so this should be unchanged. If any test fails, it is pre-existing and unrelated to this plan; surface it but do not fix in this task.

- [ ] **Step 4: Frontend build (with dummy NEXT_PUBLIC_FIREBASE_* values)**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/src/frontend && \
  NEXT_PUBLIC_FIREBASE_API_KEY=ci-dummy-api-key \
  NEXT_PUBLIC_FIREBASE_VAPID_KEY=ci-dummy-vapid-key \
  NEXT_PUBLIC_AUTH_API_URL=http://localhost:8080/auth \
  NEXT_PUBLIC_BASE_URL=http://localhost:3000 \
  npm ci && npm run lint && npx vitest run && npm run build
```

Expected: all four steps pass. `npm run build` will succeed with the dummy values; the browser-side Firebase init will warn at runtime but the build is clean.

- [ ] **Step 5: Final sanity check — no secrets in tracked files**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && \
  git ls-files | xargs rg -l 'AIza[0-9A-Za-z_-]{30,}|BEGIN PRIVATE KEY|app_password.*[a-z0-9]{12,}' 2>/dev/null && echo 'ERROR: secret-like content in tracked files' || echo 'OK: no secrets in tracked files'
```

Expected: `OK: no secrets in tracked files`. If you see the error message, `git ls-files` is showing a tracked file that contains a secret pattern; remove it from the index (and from history if it was ever committed) before declaring done.

- [ ] **Step 6: No commit**

All changes from Tasks 1-12 are already committed. This task is verification only.

---

## Self-Review

1. **Spec coverage:**
   - R1 (Keycloak → Gmail) → Tasks 6, 7, 9. ✅
   - R2 (App email → Gmail) → Tasks 1, 5, 9. ✅
   - R3 (FCM push) → Tasks 2, 4, 5, 10. ✅
   - R4 (secrets out of git) → Task 12 Step 4 (`git check-ignore`), Task 13 Step 5 (sanity grep). ✅
   - R5 (CI pre-flight passes) → Task 13. ✅
   - B1 → Task 1. ✅
   - B2 → Tasks 6, 7. ✅
   - B3 → Tasks 2, 4. ✅
   - S4 (`.env.production.example` doc update) → Task 11. ✅
   - Q3 (runbook script) → Task 6. ✅
   - Q4 (CI dummy values) → Task 13 Step 4. ✅
   - Wiki update per AGENTS.md rule → Task 12. ✅
   - Gaps: nothing in the spec is left unaddressed.

2. **Placeholder scan:** no "TBD", "TODO", "implement later". All shell commands, compose edits, and the `update-keycloak-smtp.sh` script body are shown verbatim. The script in Task 6 Step 2 is complete and self-contained.

3. **Type / identifier consistency:**
   - Env var names match spec v2's "Files Changed" table and the actual code (`sender.py:18-23`, `notifications.py:30`, `docker-compose.yml:80-90, 262-263, 303-309`). ✅
   - Function names (`send_email_task`, `send_status_notification`, `register_notification`) match `tasks/notifications.py:70,174` and `api/routes/civilian.py:909-914`. ✅
   - Container names (`wims-celery-worker`, `wims-keycloak`, `wims-backend`, `wims-frontend`) match the `container_name:` lines in `docker-compose.yml`. ✅
   - The script uses `set -euo pipefail`, sources `.env` with `set -a` / `set +a`, and validates required keys before invoking kcadm. Matches the spec's "thin wrapper" guidance.

4. **Risks surfaced and handled:** the risks table in spec v2 (Gmail rate limits, FCM VAPID vs server-key confusion, kcadm session-token loss between execs, `firebase-creds.json` perms) is addressed by the corresponding tasks (Tasks 3, 4, 6-7, 10, 12).

5. **Things deliberately out of plan scope:** automated live-inbox tests (manual V1-V3 in Tasks 9-10 cover it), Gmail → SendGrid/SES migration, APNs / FCM Android, MailHog removal, OpenBao-backed secrets management for `.env` (future work).

---

## Execution Notes

- **Worktree recommended but not required.** The repo's other 2026-06-23 plans (`metrics-auth`, `keycloak-brute-force-protection`, `suricata-gap-detection-rules`) work in a worktree per the `using-git-worktrees` convention. This plan's host-side tasks (creating `.env`, placing `firebase-creds.json`, restarting the stack) operate on the **deploy host's** filesystem, not the worktree's — the worktree's `src/docker-compose.yml` and `scripts/update-keycloak-smtp.sh` are committed, but the operator-side state lives on the VPS. Use a worktree for Tasks 1, 2, 6, 11, 12 (all repo commits); run Tasks 3, 4, 5, 7, 8, 9, 10 directly on the deploy host.

- **Order of execution:** strictly Task 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13. Tasks 9 and 10 (live verification) require Tasks 1-8 to be done first; Task 13 (CI gate) is independent of operator-side state and can run any time after Tasks 1, 2, 6, 11, 12 are committed.

- **Rollback:** if a task fails, the commits are independent and can be reverted in reverse order with `git revert <sha>`. The host-side files (`.env`, `firebase-creds.json`) can be removed; the Keycloak realm update can be reverted by re-running `scripts/update-keycloak-smtp.sh` with mailhog values, or by `docker exec wims-keycloak kcadm.sh update realms/bfp -s smtpServer='{...mailhog...}'`.
