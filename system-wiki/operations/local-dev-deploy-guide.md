---
title: Local Dev Deployment Guide
created: 2026-05-27
updated: 2026-06-03
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
# 1. Fresh build (from repo root, not src/)
cd src && docker compose down -v
cd src && docker compose build --no-cache
cd src && docker compose up -d

# 2. Wait for stack to stabilize, then seed dev users
#    (run from project root, not src/)
bash scripts/seed-dev-users.sh

# 3. Verify
curl -s http://localhost/health
```

If all containers are green and `{"status":"ok","via":"nginx-gateway"}` is returned, the local HTTP stack is up. Dev users are available at `http://localhost` with password **`Password123!`**.

---

## Prerequisites

| Tool | Notes |
|------|-------|
| Docker Desktop | Must be running. WSL2 backend recommended. |
| `bash` | Git Bash or WSL2 shell for the seed script. |

---

## Step-by-Step

### 1. Local nginx mode

Local development no longer requires generating self-signed certificates just to satisfy the base Compose file. The base `src/docker-compose.yml` keeps only the nginx config mount, and the automatically loaded `src/docker-compose.override.yml` swaps in `src/nginx/nginx.local.conf`, which serves HTTP on port 80 without TLS certificate paths. Production TLS certs are mounted only by `src/docker-compose.prod.yml` or an explicit deployment override.

Do not add `LETSENCRYPT_DIR=./.ssl` to `src/.env` for routine local development. If nginx fails locally with `cannot load certificate "/etc/letsencrypt/live/wimsbfp.tech/fullchain.pem"`, it is using the production nginx config by mistake; recreate with plain `docker compose up -d` from `src/` so the local override is loaded, or remove any explicit production compose flags.

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
curl -s http://localhost/health          # nginx: {"status":"ok","via":"nginx-gateway"}
curl -s http://localhost/ -o /dev/null -w "%{http_code}\n"  # 200 (frontend)
curl -s http://localhost/api/incidents -o /dev/null -w "%{http_code}\n"  # 401 (backend auth guard)
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

### Pitfall 2 — `wims-nginx-gateway` exits 1 with missing certificate errors

**Symptom:** `docker compose ps -a` shows `wims-nginx-gateway Exited (1)` and logs mention `/etc/letsencrypt/live/wimsbfp.tech/fullchain.pem`.

**Root cause:** The local stack is loading the production TLS nginx config instead of the local HTTP-only override. The base compose no longer mounts Let's Encrypt certificates; `src/docker-compose.prod.yml` is the only committed compose file that mounts `/etc/letsencrypt`.

**Fix:** for local development, run plain Compose from `src/` so `docker-compose.override.yml` mounts `src/nginx/nginx.local.conf`:

```bash
cd src && docker compose up -d --force-recreate nginx-gateway
```

If you intentionally need the production TLS config, use the production command with a real `LETSENCRYPT_DIR` as described below instead of generating repo-local self-signed certs.

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
