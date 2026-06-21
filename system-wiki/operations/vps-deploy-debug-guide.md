---
title: VPS Deployment Debugging Guide
created: 2026-06-21
updated: 2026-06-21
type: operations
tags: [wims-bfp, vps, deployment, ssh, docker, nginx, debugging, infra]
sources: [src/docker-compose.yml, src/docker-compose.prod.yml, src/nginx/nginx.conf, src/.env.production, .github/workflows/deploy.yml, .github/workflows/ci.yml]
status: current
---

# VPS Deployment Debugging Guide

## Quick Reference

| Resource | Value |
|----------|-------|
| VPS IP | `165.22.101.73` |
| SSH user | `root` |
| SSH key (local) | `~/.ssh/id_ed25519_pi` |
| Deploy directory | `/opt/wims-bfp` |
| Compose project dir | `/opt/wims-bfp/src` |
| Prod env file | `/opt/wims-bfp/src/.env.production` |
| Public URL | `https://wimsbfp.tech` |
| SSH command | `ssh -i ~/.ssh/id_ed25519_pi root@165.22.101.73` |
| Compose command | `docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production` |

## Service Endpoint Checks

Once SSH'd in, verify the full stack:

```bash
# Direct health (through nginx — 8000 is not exposed externally)
curl -s https://wimsbfp.tech/health

# Keycloak OIDC discovery
curl -s -o /dev/null -w '%{http_code}' https://wimsbfp.tech/auth/realms/bfp/.well-known/openid-configuration

# Frontend SSR
curl -s -o /dev/null -w '%{http_code}' https://wimsbfp.tech/login

# Backend API through nginx
curl -s -o /dev/null -w '%{http_code}' https://wimsbfp.tech/api/public/emergency-services
```

Expected: all return `200`.

## Common Failure Modes & Resolutions

### 1. Deploy fails with "container name is already in use"

**Symptom:** GitHub Actions deploy log shows:

```
Container name "<hex>_wims-<service>" is already in use by container "<id>". You have to remove (or rename) that container to be able to reuse that name.
```

**Root cause:** Docker Compose creates renamed containers (pattern `<hex>_wims-<name>`) during its atomic recreate process. If `compose up` is interrupted mid-way (another service fails), these renamed containers remain and block the next deploy.

**Fix — remove stale renamed containers:**

```bash
# Remove all Compose-renamed stale containers (hex prefix + _wims-)
docker ps -a --filter label=com.docker.compose.project=src \
  --format '{{.ID}} {{.Names}}' \
  | awk '$2 ~ /^[0-9a-f]+_wims-/ {system("docker rm -f "$1)}'

# Remove any wims-* containers stuck in "created" state
docker ps -a --filter status=created --filter name=wims \
  --format '{{.ID}} {{.Names}}' \
  | awk '{system("docker rm -f "$1)}'
```

**Prevention:** The deploy script in `.github/workflows/deploy.yml` has a `cleanup_stale_compose_renames()` function but it only runs *before* `compose up`. If you're editing the workflow, consider running it again on failure inside a retry loop.

---

### 2. Backend or frontend stuck in "Created" state

**Symptom:** `docker ps` doesn't show `wims-backend` or `wims-frontend`, but `docker ps -a` shows them as `Created` with no logs.

**Root cause:** When `compose up -d --build --wait` fails (e.g., celery-worker name conflict), Docker Compose aborts. Containers that were defined in the dependency graph are created but never transitioned to Running.

**Fix:**

```bash
# Start manually
docker start wims-backend
docker start wims-frontend

# Verify
docker ps --filter name=wims-backend --filter name=wims-frontend
```

---

### 3. Nginx returns 502 or "no live upstreams" after containers restart

**Symptom:** 
- `curl https://wimsbfp.tech/auth/...` returns 502
- nginx logs show `connect() failed (111: Connection refused)` or `host could not be resolved (3: Host not found)`

**Root cause:** The nginx container runs Docker's embedded DNS resolver (`127.0.0.11`) with `valid=10s` TTL. When containers are recreated, Docker assigns new IPs. Nginx's upstream zone caches the old IP until the 10s TTL expires — but if nginx was restarted out-of-order (or never reloaded after containers restarted), the stale IP persists.

**Fix — reload nginx to flush DNS:**

```bash
docker exec wims-nginx-gateway nginx -s reload
# Wait 3 seconds for DNS re-resolution
sleep 3
# Retry
curl -s https://wimsbfp.tech/auth/realms/bfp/.well-known/openid-configuration
```

**Note:** The deploy script runs `nginx -s reload` *after* the post-deploy health check loop. If the health check fails due to stale DNS, the reload never runs. Consider moving the reload before the health checks in the deploy script.

---

### 4. Full stack deployed but `/auth/` returns 502, other routes work

**Symptom:** Health, login, API endpoints all return 200, but Keycloak OIDC discovery returns 502.

**Root cause:** Nginx resolved the `keycloak` service name to a stale Docker IP. Keycloak's container IP changed after a recreate, but nginx kept the old IP in its upstream zone.

**Fix — same as #3:** Reload nginx: `docker exec wims-nginx-gateway nginx -s reload`

---

### 5. SSL / certbot issues

See the deploy workflow for automatic provisioning. Manual commands:

```bash
# Check certificate expiry
openssl x509 -in /etc/letsencrypt/live/wimsbfp.tech/fullchain.pem -noout -dates

# Force renewal test (dry-run)
certbot renew --dry-run

# Manual renewal
certbot renew --quiet --deploy-hook "docker exec wims-nginx-gateway nginx -s reload"
```

---

### 6. Database connectivity check fails

The deploy script runs a DB connectivity check before building:

```bash
# Manual check
cd /opt/wims-bfp/src
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  --env-file .env.production run --rm -T backend \
  python -c "from database import get_engine; from sqlalchemy import text; engine = get_engine(); conn = engine.connect(); conn.execute(text('SELECT 1')); conn.close(); print('DB OK')"
```

---

### 7. Full stack status check

```bash
# All running containers
docker ps --format 'table {{.Names}}\t{{.Status}}'

# All containers (including stopped/created)
docker ps -a --format 'table {{.Names}}\t{{.Status}}'

# Stale compose-renamed containers
docker ps -a --filter label=com.docker.compose.project=src \
  --format '{{.Names}} {{.Status}}' \
  | grep -E '^[0-9a-f]+_wims-'

# Nginx config syntax
docker exec wims-nginx-gateway nginx -t

# Nginx logs (recent errors)
docker logs wims-nginx-gateway --tail 30 2>&1 | grep -E 'error|upstream|resolve'

# Backend logs
docker logs wims-backend --tail 30

# Docker resource usage
df -h /
```

---

### 8. Previous deploy history

```bash
cat /opt/wims-bfp/.deploy_history
```

Each entry records the commit SHA and timestamp of every deploy that completed the post-deploy health checks.

---

### 9. GitHub CI/CD troubleshooting

Check recent workflow runs:

```bash
gh run list --branch master --limit 5
gh run view <run-id> --log-failed
```

Known CI patterns:
- **"Merge Gate" failing with "cancelled" status** — a newer push cancelled the in-progress run due to the `concurrency: cancel-in-progress: true` setting in `ci.yml`. Not a real failure; check the most recent run for the same commit.
- **Security-audit failures** — non-blocking (`continue-on-error: true`); advisory only.
- **Coverage <30%** — non-blocking (`continue-on-error: true`); advisory only.

---

## Deploy Script Defensiveness

The current deploy (`deploy.yml`) does the following in order:

1. **Provision TLS** — certbot initial issue or check existing
2. **Tag rollback image** — tag previous backend image as `src-backend-rollback:latest`
3. **Deploy via SSH** — the main script:
   - `git fetch origin master && git reset --hard && git checkout -B master origin/master`
   - Validate `.env.production` exists
   - `cleanup_stale_compose_renames()` — removes stale containers
   - `compose config --quiet` — validate compose syntax
   - `compose run --rm backend python -c "from database..."` — pre-deploy DB check
   - `compose up -d --build --wait --wait-timeout 600` — **this is where failures occur**
   - Apply DB migrations
   - `nginx -s reload` — flush DNS (runs AFTER health check)
   - Post-deploy health checks on all 4 endpoints

**Notable gaps:**
- `cleanup_stale_compose_renames` runs only once before `compose up`, but stale containers are created *during* a failed `compose up`. Consider a retry loop.
- `nginx -s reload` runs after the health check loop. If DNS is stale, the health checks fail before the reload happens.
- The celery-worker name collision issue is the most common failure. The compose `depends_on` graph means one failed service can block the entire deploy.
