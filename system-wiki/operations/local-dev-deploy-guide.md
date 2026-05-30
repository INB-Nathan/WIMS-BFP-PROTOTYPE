---
title: Local Dev Deployment Guide
created: 2026-05-27
updated: 2026-05-30
type: operations
tags: [wims-bfp, docker, deployment, local-dev, windows, troubleshooting]
sources: [src/docker-compose.yml, src/nginx/nginx.conf, src/keycloak/bootstrap/bootstrap-master-realm.sh, scripts/seed-dev-users.sh, CLAUDE.md]
status: current
---

# Local Dev Deployment Guide

This page exists to prevent future agents from rediscovering the same pitfalls when doing a clean-slate local build on a Windows dev machine. All three problems below were hit during the first fresh build of the `fix/enc-val-bugs-and-UI` branch (2026-05-27) and fixed in commit `5791275`.

---

## TL;DR — The Correct Sequence

```bash
# 1. One-time local SSL setup (only needed on first clone or after volume wipe)
#    Skip if src/.ssl/live/wimsbfp.tech/fullchain.pem already exists.
mkdir -p src/.ssl/live/wimsbfp.tech
MSYS_NO_PATHCONV=1 openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout src/.ssl/live/wimsbfp.tech/privkey.pem \
  -out src/.ssl/live/wimsbfp.tech/fullchain.pem \
  -subj "/CN=localhost"
echo "LETSENCRYPT_DIR=./.ssl" >> src/.env

# 2. Fresh build (from repo root, not src/)
cd src && docker compose down -v
cd src && docker compose build --no-cache
cd src && docker compose up -d

# 3. Wait for stack to stabilize, then seed dev users
#    (run from project root, not src/)
bash scripts/seed-dev-users.sh

# 4. Verify
curl -sk https://localhost/health
```

If all containers are green and `{"status":"ok","via":"nginx-gateway"}` is returned, the stack is up. Dev users are available at `https://localhost` with password **`Password123!`**.

---

## Prerequisites

| Tool | Notes |
|------|-------|
| Docker Desktop | Must be running. WSL2 backend recommended. |
| `openssl` | Comes with Git for Windows; run from Git Bash. |
| `bash` | Git Bash or WSL2 shell for the seed script. |

---

## Step-by-Step

### 1. One-time SSL cert setup (local dev only)

`src/docker-compose.yml` mounts `${LETSENCRYPT_DIR:-/opt/wims-bfp/letsencrypt}` into the nginx container as `/etc/letsencrypt`. On the VPS this path holds the real Let's Encrypt cert. Locally, neither the default `/opt/wims-bfp/letsencrypt` path nor the cert exist, so nginx exits immediately with:

```
cannot load certificate "/etc/letsencrypt/live/wimsbfp.tech/fullchain.pem"
```

**Fix:** generate a self-signed cert and point the env var at it:

```bash
mkdir -p src/.ssl/live/wimsbfp.tech
MSYS_NO_PATHCONV=1 openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout src/.ssl/live/wimsbfp.tech/privkey.pem \
  -out src/.ssl/live/wimsbfp.tech/fullchain.pem \
  -subj "/CN=localhost"
```

Then add to `src/.env`:

```
LETSENCRYPT_DIR=./.ssl
```

`src/.ssl/` is gitignored. Run this once per machine. The cert lasts 365 days.

> **Why `MSYS_NO_PATHCONV=1`?** Git Bash on Windows converts leading `/` to a Windows drive path (e.g., `/CN=localhost` → `C:\Program Files\Git\CN=localhost`). The env var disables that conversion for the single command.

### 2. Clean-slate build

```bash
cd src && docker compose down -v   # wipes volumes (DB, Ollama, attachments)
cd src && docker compose build --no-cache
cd src && docker compose up -d
```

Expected build output: three images built (`src-backend`, `src-celery-worker`, `src-frontend`). Frontend will say `✓ Compiled successfully`.

Expected `up -d` result: all containers reach their target state. `wims-keycloak-bootstrap` will exit 0 after patching master realm redirect URIs; that is correct and expected.

### 3. Seed dev users

After `docker compose up -d`, Keycloak and Postgres are populated from the realm JSON and 34 SQL bootstrap files respectively, but no application users exist in PostgreSQL yet.

```bash
# Run from project root (not src/)
bash scripts/seed-dev-users.sh
```

This creates 22 Keycloak users and upserts them into `wims.users`. It waits for Keycloak to be healthy before proceeding.

**Dev credentials** (all users):

| Username | Role | Region |
|----------|------|--------|
| `encoder_test` | REGIONAL_ENCODER | 1 |
| `encoder_r02` … `encoder_r18` | REGIONAL_ENCODER | 2–18 |
| `validator_test` | NATIONAL_VALIDATOR | 1 |
| `analyst_test` | NATIONAL_ANALYST | — |
| `analyst1_test` | NATIONAL_ANALYST | — |
| `admin_test` | SYSTEM_ADMIN | — |

Password for all: **`Password123!`**

### 4. Verify

```bash
curl -sk https://localhost/health          # nginx: {"status":"ok","via":"nginx-gateway"}
curl -sk https://localhost/ -o /dev/null -w "%{http_code}\n"  # 200 (frontend)
curl -sk https://localhost/api/incidents -o /dev/null -w "%{http_code}\n"  # 401 (backend auth guard)
curl -sk http://localhost:8080/auth/realms/bfp/.well-known/openid-configuration -o /dev/null -w "%{http_code}\n"  # 200 (Keycloak)
```

---

## Known Pitfalls

### Pitfall 1 — `wims-keycloak-bootstrap` exits 2, backend never starts

**Symptom:** `docker compose ps -a` shows `wims-keycloak-bootstrap Exited (2)`. Backend and nginx are stuck in `Created` state.

**Root cause:** `src/keycloak/bootstrap/bootstrap-master-realm.sh` had Windows CRLF (`\r\n`) line endings. Inside the Linux container, bash reads `set -eu\r`. It processes `-e` (enables exit-on-error) then hits `\r` as an unrecognized flag. The `set` builtin returns non-zero. Because `-e` is now active, the shell exits immediately with code 2.

The garbled error message in logs (`set: -: invalid option`) is a terminal rendering artifact — the `\r` moves the cursor to start of line, overwriting part of the error so only `set: -` is visible.

**Fix:** already applied — `.gitattributes` at repo root enforces `*.sh text eol=lf`. Future checkouts on Windows will always produce LF on disk. If you somehow see this error again, run:

```bash
file src/keycloak/bootstrap/bootstrap-master-realm.sh
# Must say: ASCII text executable  (not "with CRLF line terminators")
# Fix if needed:
sed -i 's/\r//' src/keycloak/bootstrap/bootstrap-master-realm.sh
sed -i 's/\r//' src/backend/wait-for-db.sh
```

**What success looks like:** `wims-keycloak-bootstrap` logs end with `Keycloak master realm bootstrap complete` and the container exits 0. The `set: -: invalid option` lines that appear above it are from a previous failed run; docker compose logs aggregate across restarts.

### Pitfall 2 — `wims-nginx-gateway` exits 1

**Symptom:** `docker compose ps -a` shows `wims-nginx-gateway Exited (1)`. Ports 80/443 are not open.

**Root cause:** `src/nginx/nginx.conf` requires TLS certs at `/etc/letsencrypt/live/wimsbfp.tech/fullchain.pem`. The compose file mounts `${LETSENCRYPT_DIR:-/opt/wims-bfp/letsencrypt}` — on a dev machine neither the env var nor the default path holds real certs.

**Fix:** do the one-time SSL setup in step 1 above. If you've already done it, check:

```bash
ls src/.ssl/live/wimsbfp.tech/      # fullchain.pem and privkey.pem must exist
grep LETSENCRYPT_DIR src/.env        # must be present and point to ./.ssl
```

If the env var is missing from `src/.env`, add it:

```
LETSENCRYPT_DIR=./.ssl
```

Then restart just nginx: `cd src && docker compose up -d nginx-gateway`.

> **Note:** `src/.ssl/` is gitignored and not committed. Each developer machine needs to run the `openssl` command once. The cert is self-signed so browsers will warn — accept the exception for `https://localhost`.

### Pitfall 3 — `seed-dev-users.sh` fails with password policy error

**Symptom:**

```
Invalid password: must contain at least 1 special characters.
```

**Root cause:** The `bfp` Keycloak realm enforces:
```
length(12) and upperCase(1) and lowerCase(1) and digits(1) and specialChars(1)
```

An older version of the seed script used `password123` (11 chars, no uppercase, no special character).

**Fix:** already applied — script now uses `Password123!` which meets all five requirements. If you see this error, check the `PASSWORD=` line in `scripts/seed-dev-users.sh`.

---

## Production Deployment (VPS)

This section is for reference only — the CI/CD pipeline handles production. Do not run this manually unless recovering from an outage.

```bash
cd src
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production up -d --build
```

To recover only nginx after it was accidentally recreated with the local override:

```bash
cd src
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production up -d --force-recreate nginx-gateway
```

`docker-compose.prod.yml` overrides:
- `KC_HOSTNAME_URL` → `${PUBLIC_BASE_URL}/auth`
- `KEYCLOAK_ISSUER` → `${PUBLIC_BASE_URL}/auth/realms/bfp`
- All frontend `NEXT_PUBLIC_*` build args and runtime env vars to HTTPS public origin

`.env.production` (uncommitted) sets `PUBLIC_BASE_URL=https://wimsbfp.tech` and `LETSENCRYPT_DIR=/etc/letsencrypt` (points to the host cert directory on the VPS).

Do not use plain `docker compose up` on the VPS. Compose auto-loads `docker-compose.override.yml`, which mounts the local HTTP-only `src/nginx/nginx.local.conf`; HTTP may still work, but HTTPS will not terminate because nginx is no longer using the TLS server block.

See [[architecture/infrastructure-config]] for the full VPS setup, certbot renewal hook, and UFW firewall rules.

---

## Container Startup Order

```
postgres (healthy) ──┐
redis    (healthy) ──┼──► keycloak (healthy) ──► keycloak-bootstrap (exit 0) ──► backend ──► nginx-gateway
ollama   (started) ──┘                                                          postgres ──► celery-worker
```

If any container in the chain fails, everything downstream stays in `Created` state. Always check from left to right when diagnosing: postgres → redis → keycloak → keycloak-bootstrap → backend/nginx.

---

## Useful Debug Commands

```bash
# Container state overview
cd src && docker compose ps -a

# Tail logs for a specific service
cd src && docker compose logs -f backend

# Bootstrap script logs (shows both failed and successful runs combined)
cd src && docker compose logs keycloak-bootstrap

# Re-run just one service without rebuilding others
cd src && docker compose up -d nginx-gateway

# Connect to Postgres directly
docker exec -it wims-postgres psql -U postgres -d wims

# Check Keycloak realm password policy
docker exec wims-keycloak /opt/keycloak/bin/kcadm.sh config credentials \
  --server http://localhost:8080/auth --realm master --user admin --password admin
docker exec wims-keycloak /opt/keycloak/bin/kcadm.sh get realms/bfp --fields passwordPolicy
```
