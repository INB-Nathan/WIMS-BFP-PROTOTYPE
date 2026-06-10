---
title: Infrastructure Configuration
created: 2026-05-16
updated: 2026-06-10
type: architecture
tags: [wims-bfp, docker, nginx, suricata, keycloak, infrastructure]
sources: [src/docker-compose.yml, src/docker-compose.prod.yml, src/.env.production.example, src/nginx/, src/suricata/, src/keycloak/import/bfp-realm.json, .github/workflows/ci.yml]
status: draft
---

# Infrastructure Configuration

## Docker Compose

**File:** `src/docker-compose.yml`

**Keycloak import inputs:** `src/keycloak/import/bfp-realm.json`, `src/keycloak/import/master-realm.json`

**Keycloak bootstrap:** `src/keycloak/import/bfp-realm.json` imports the application realm. Keycloak 24 creates the `master` realm before startup import and skips `master-realm.json` with `IGNORE_EXISTING`, so `src/keycloak/bootstrap/bootstrap-master-realm.sh` runs through the one-shot `keycloak-bootstrap` service after Keycloak is healthy. The script authenticates to the `master` realm with `kcadm.sh`, finds `security-admin-console`, and patches absolute admin-console redirect URIs and web origins for localhost, VPS, and production hostnames. Backend startup waits for this service to exit successfully via `condition: service_completed_successfully`.

**Network:** `wims_internal` (bridge driver)

**Services:**

| Service | Container Name | Image | Ports |
|---|---|---|---|
| postgres | wims-postgres | `postgis/postgis:15-3.4-alpine` | 5432 |
| redis | wims-redis | `redis:7.2-alpine` | 6379 |
| mailhog | wims-mailhog | `mailhog/mailhog:v1.0.1` | 1025 (SMTP), 8025 (Web UI) |
| keycloak | wims-keycloak | `quay.io/keycloak/keycloak:24.0.0` | 8080 |
| keycloak-bootstrap | wims-keycloak-bootstrap | `quay.io/keycloak/keycloak:24.0.0` | (one-shot, no ports) |
| backend | wims-backend | Dockerfile at `./backend/Dockerfile` (python:3.11-slim) | 8000 (internal) |
| frontend | wims-frontend | `./frontend/Dockerfile` (Next.js) | 3000 (internal) |
| wims-suricata | wims-suricata | `jasonish/suricata:7.0.5` | (none) |
| nginx-gateway | wims-nginx-gateway | `nginx:1.27.3-alpine` | 80, 443 |

**Health checks:** postgres (`pg_isready -U postgres -d wims`, interval 5s), redis (`redis-cli ping`, interval 5s), Keycloak (HTTP probe), and Suricata (`pgrep Suricata-Main`). Backend depends on healthy Postgres and Redis plus the completed Keycloak bootstrap.

**Named volumes:** `postgres_data`, `ollama_data`, `incident_attachments_data`

**Required env interpolation:** Base `src/docker-compose.yml` intentionally uses `${VAR:?error}` for local/test secrets such as `POSTGRES_PASSWORD`, `KC_DB_PASSWORD`, `KEYCLOAK_ADMIN`, `KEYCLOAK_ADMIN_PASSWORD`, `NEXT_PUBLIC_FIREBASE_API_KEY`, and `NEXT_PUBLIC_FIREBASE_VAPID_KEY`. GitHub CI jobs that run compose (`docker-build`, `security-scan`) copy root `.env.example` to `src/.env` before `docker compose config`, build, or stack startup so fail-fast interpolation remains enabled without committing real secrets.

**Host port exposure:** Only `nginx-gateway` intentionally binds public interfaces (`0.0.0.0:80` and `0.0.0.0:443`). Database and support/admin surfaces are bound to host loopback only: Postgres `127.0.0.1:5432`, Redis `127.0.0.1:6379`, MailHog `127.0.0.1:1025`/`8025`, and direct Keycloak `127.0.0.1:8080`. Browser and OIDC traffic should reach Keycloak only through nginx at `/auth/`.

**Host firewall:** UFW is enabled on the VPS with default deny incoming, allow outgoing, and explicit inbound allows only for SSH `22/tcp`, HTTP `80/tcp`, and HTTPS `443/tcp` on IPv4/IPv6.

**Key env vars (backend):**

| Variable | Default |
|---|---|
| `DATABASE_URL` | `postgresql://postgres:${POSTGRES_PASSWORD:?error}@postgres:5432/wims` in compose; production may override through environment |
| `REDIS_URL` | `redis://redis:6379/0` |
| `KEYCLOAK_REALM_URL` | `http://keycloak:8080/auth/realms/bfp` |
| `KEYCLOAK_ISSUER` | `${PUBLIC_BASE_URL}/auth/realms/bfp` in production override; current VPS `PUBLIC_BASE_URL=https://wimsbfp.tech` |
| `KEYCLOAK_CLIENT_ID` | `wims-web` |
| `KEYCLOAK_ADMIN_USER` | `${KEYCLOAK_ADMIN:?error}` |
| `KEYCLOAK_ADMIN_PASSWORD` | `${KEYCLOAK_ADMIN_PASSWORD:?error}` |
| `OLLAMA_URL` | `http://ollama:11434` |
| `SURICATA_EVE_PATH` | `/var/log/suricata/eve.json` |
| `EXPORT_DIR` | `/app/storage/exports` |
| `BACKUP_DIR` | `/app/storage/backups` |

---

## Nginx

**File:** `src/nginx/nginx.conf`

**Compose split:** `src/docker-compose.yml` is the dev-neutral base compose file. Production/VPS deployment uses the committed `src/docker-compose.prod.yml` override plus an uncommitted `src/.env.production` file. Local HTTP-only nginx testing uses `src/docker-compose.override.yml`, which mounts `src/nginx/nginx.local.conf` over the container config. The tracked `src/.env.production.example` documents required host values.

**Local HTTP-only command:**

```bash
docker compose up -d --build
```

`src/nginx/nginx.local.conf` is local-development-only and intentionally omits TLS. It is loaded automatically by `src/docker-compose.override.yml` when running plain `docker compose ...` from `src/`. Do not deploy it to VPS/production.

**VPS deployment command:**

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production up -d --build
```

**VPS nginx recovery command:**

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production up -d --force-recreate nginx-gateway
```

Use explicit `-f` flags on the VPS. Plain `docker compose up` auto-loads `docker-compose.override.yml`, mounts `src/nginx/nginx.local.conf`, and publishes port 443 to an HTTP-only nginx process. The symptom is HTTP working while HTTPS fails with connection refused or an SSL EOF. The production command mounts `/etc/letsencrypt` into the container and loads `src/nginx/nginx.conf`, which terminates TLS for `wimsbfp.tech`.

Changing `.env.production` does not update database roles already stored in the `postgres_data` volume. If Keycloak or backend startup reports password authentication failures after an environment change, synchronize the persisted `postgres`, `keycloak`, and `wims_app_user` role passwords before recreating dependent services.

**Operational note:** On 2026-05-26, a login outage occurred when the VPS services were running with only the base `docker-compose.yml` values. Public Keycloak discovery returned `403 {"error":"invalid_request","error_description":"HTTPS required"}` and/or advertised localhost/port-8080 auth URLs. Recreating Keycloak, backend, frontend, and nginx with the production override restored `KC_HOSTNAME_URL=${PUBLIC_BASE_URL}/auth`, backend `KEYCLOAK_ISSUER=${PUBLIC_BASE_URL}/auth/realms/bfp`, and frontend public auth build/runtime values. After the restart, `https://wimsbfp.tech/auth/realms/bfp/.well-known/openid-configuration` returned 200 and advertised `https://wimsbfp.tech/auth/...` endpoints only.

**GitOps deploy workflow:** `.github/workflows/deploy.yml` mirrors the production command above via a shell `compose()` helper that always includes `docker-compose.yml`, `docker-compose.prod.yml`, and `.env.production`. It validates `compose config --quiet`, checks DB connectivity with the production compose stack, rebuilds/restarts the full stack with `up -d --build`, then checks backend health plus public nginx `/health` and Keycloak discovery endpoints. TLS provisioning skips issuance when `/etc/letsencrypt/live/wimsbfp.tech/` already contains a cert/key; first-time issuance uses certbot standalone and the renewal hook reloads the running nginx container with `docker exec wims-nginx-gateway nginx -s reload`.

**Current VPS public origin:** `src/.env.production` sets `PUBLIC_BASE_URL=https://wimsbfp.tech`, replacing the previous `https://165-22-101-73.nip.io` deployment origin. Production frontend build args, runtime auth variables, backend `KEYCLOAK_ISSUER`, and Keycloak `KC_HOSTNAME_URL` derive from this value through `src/docker-compose.prod.yml`.

**Current certificate state:** `src/nginx/nginx.conf` expects `/etc/letsencrypt/live/wimsbfp.tech/fullchain.pem` and `privkey.pem`. A Let’s Encrypt certificate for `wimsbfp.tech` was issued on the VPS on 2026-05-26 and certbot renewal is installed with an nginx reload hook.

**TLS mount:** `src/docker-compose.yml` no longer mounts certificate paths in the dev-neutral base service. Production TLS is added only by `src/docker-compose.prod.yml`, which binds `${LETSENCRYPT_DIR:-/opt/wims-bfp/letsencrypt}:/etc/letsencrypt:ro` for `wims-nginx-gateway`. On the VPS, `src/.env.production` sets `LETSENCRYPT_DIR=/etc/letsencrypt`, so the gateway receives the host certificate tree directly. Do not replace this with a repo-local symlink directory; Docker bind mounts expose the directory itself, so mounting `/opt/wims-bfp/letsencrypt` when it only contains `letsencrypt -> /etc/letsencrypt` hides the expected `/etc/letsencrypt/live/<domain>/...` paths from nginx.

**Frontend/auth env:** `docker-compose.prod.yml` sets browser-facing frontend build/runtime variables to the public HTTPS origin (`${PUBLIC_BASE_URL}`) or relative paths (`/api`, `/auth`). The development compose file also uses relative `/api` and `/auth` for browser-facing access, so local HTTP desk checks stay same-origin and avoid CORS preflight redirects. The Next.js server-side auth routes use `BACKEND_URL=http://backend:8000` in both development and production, and route handlers append `/api/...` explicitly. Keycloak advertises `KC_HOSTNAME_URL=${PUBLIC_BASE_URL}/auth` in production to keep OIDC discovery issuer/endpoints aligned with the nginx `/auth/` proxy path. For `POST /api/auth/sync`, the route forwards nginx-provided `X-Real-IP`/sanitized `X-Forwarded-For` to backend `POST /api/auth/callback` so backend Redis rate limiting keys by end-user IP rather than by the frontend container.

**Route Table:**

| Location | Proxy Target | Purpose |
|---|---|---|
| `/api/auth/` | `http://frontend:3000` | Auth routes (session, callback, logout) handled by Next.js |
| `/api/` | `http://backend:8000` | Main API backend with CORS + cookie domain rewrite |
| `/auth/login`, `/auth/login/` | redirect to `/login` | Legacy app-login compatibility redirect before the Keycloak proxy |
| `/report/tracking`, `/report/tracking/` | redirect to `/tracking` preserving query string | Legacy public-report tracking compatibility redirect |
| `/auth/` | `http://keycloak:8080/auth/` | Keycloak authentication (with X-Forwarded-Host/Port) |
| `/` | `http://frontend:3000/` | All other traffic to Next.js |

**Key config points:**
- `client_max_body_size 50M`
- OPTIONS preflight handled directly by nginx (returns 204), not proxied to backend
- CORS: production uses a deny-by-default `$cors_origin` map for `Access-Control-Allow-Origin` with explicit HTTPS origins; local dev remains same-origin via `$scheme://$host`
- Cookie domain rewrite: `proxy_cookie_domain nginx-gateway $host` — rewrites backend's `Domain=nginx-gateway` to the request host so the browser accepts it
- TLS terminates in nginx on port 443 for `wimsbfp.tech` using `/etc/letsencrypt/live/wimsbfp.tech/fullchain.pem` and `privkey.pem`
- Gateway security headers: nginx disables version tokens, hides proxied `X-Powered-By`, and adds HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer`, and a restrictive camera/microphone permissions policy while allowing same-origin geolocation.
- Production CSP currently permits inline scripts because Next.js emits inline bootstrap scripts required for React hydration. Replace `'unsafe-inline'` with per-request nonces when nonce propagation is implemented.
- Port 80 redirects to HTTPS
- `/health` is served directly by nginx from the HTTPS server block for gateway uptime checks
- **No WebSocket/SSE** specific proxy settings (no `proxy_http_version 1.1`, no Upgrade header)
- **No caching or rate limiting** at nginx level.

---

## Suricata IDS

**Container:** `jasonish/suricata:7.0.5` with `-i eth0`

**Directories:**
- `src/suricata/logs/` → `/var/log/suricata/` — EVE JSON output, fast.log, stats.log
- `src/suricata/rules/` → `/var/lib/suricata/rules/` — only `classification.config` present (no .rules files)

**EVE output** is consumed by the backend service via `SURICATA_EVE_PATH=/var/log/suricata/eve.json`. The backend reads `eve.json` for real-time event ingestion via `services/suricata_ingestion.py`.

The container exposes the running process as `Suricata-Main`; the Compose health check matches that process name with `pgrep`.

**Note:** No custom `suricata.yaml` exists — the container uses its built-in default configuration. The compose file notes this is for prototype only; production would use `network_mode: "host"`.

---

## Keycloak Realm

**File:** `src/keycloak/import/bfp-realm.json` (~2641 lines)

Full Keycloak realm export for the `bfp` realm.

### Realm Settings

| Setting | Value |
|---|---|
| Realm ID | `bfp` |
| Display Name | `BFP` |
| Default Signature Algorithm | RS256 |
| Login Theme | `wims-bfp` (custom) |
| Reset Password Allowed | true |
| Edit Username Allowed | false |
| Revoke Refresh Token | false |
| Refresh Token Max Reuse | 0 |

### Session & Token Timeouts

| Setting | Value | Human |
|---|---|---|
| `accessTokenLifespan` | 300 | 5 min |
| `ssoSessionIdleTimeout` | 1800 | 30 min |
| `ssoSessionMaxLifespan` | 28800 | 8 hours |
| `actionTokenGeneratedByUserLifespan` | 300 | 5 min |

**Note:** 5-min access token + aggressive SSO idle timeout (30 min) explains the fast-logout bug (F-04).

### Brute Force Protection

`bruteForceProtected=true`, `permanentLockout=false`, `failureFactor=5` attempts, `waitIncrementSeconds=300` (5 min escalations).

### TOTP Policy

| Setting | Value |
|---|---|
| Type | `totp` |
| Algorithm | HmacSHA1 |
| Digits | 6 |
| Period | 30 seconds |
| Look-ahead window | 1 |
| Code reusable | false |

### Password Policy

`length(12) and upperCase(1) and lowerCase(1) and digits(1) and specialChars(1)`

### SMTP

MailHog local development: host=`mailhog`, port=`1025`, from=`noreply@wims-bfp.local`

### Roles

| Role | Description |
|---|---|
| `REGIONAL_ENCODER` | Regional encoder |
| `NATIONAL_VALIDATOR` | National validator |
| `NATIONAL_ANALYST` | National analyst |
| `SYSTEM_ADMIN` | System administrator |

> **Note (2026-06-05, PR #213):** Legacy roles `VALIDATOR` and `ANALYST` were removed from `bfp-realm.json` in issue #206. Only the four canonical roles above remain.

### Clients

| Client ID | Type | Auth Flow | Notes |
|---|---|---|---|
| `wims-web` | Public | Standard + PKCE S256 | Main frontend OIDC client; has audience mapper for `wims-web`; allows `http://localhost`, `https://localhost`, VPS HTTPS, and production redirects/origins |
| `wims-admin-service` | Confidential | Direct Grant + Service Account | Backend-to-Keycloak service client; hardcoded secret |
| `bfp-client` | Public | Standard + Direct Grant | Alternative/legacy client without PKCE |

### Authentication Flows

**Browser Flow:** Cookie check (ALTERNATIVE) → Username/Password form (REQUIRED) → Conditional OTP sub-flow (REQUIRED):
  - `conditional-user-configured` (ALTERNATIVE) — skip if user has no TOTP
  - `otp-role-system-administrator` (ALTERNATIVE) — requires OTP if role = system_administrator
  - `otp-role-national-validator` (ALTERNATIVE) — requires OTP if role = national_validator
  - `auth-otp-form` with `otpRememberDeviceFor=7d` (REQUIRED) — 7-day trusted device

**Reset Credentials Flow:** Choose user → Email via Mailhog → Reset password → Conditional OTP (if user has TOTP)

### Seed Test Users

All use password `Password123!` (set by `scripts/seed-dev-users.sh`):

| Username | Email | Role |
|---|---|---|
| `encoder_ncr` | encoder_ncr@bfp.gov.ph | REGIONAL_ENCODER |
| `encoder_car` | encoder_car@bfp.gov.ph | REGIONAL_ENCODER |
| `encoder_r01` through `encoder_r13` | encoder_r{01-13}@bfp.gov.ph | REGIONAL_ENCODER |
| `encoder_barmm` / `encoder_nir` | encoder_barmm@bfp.gov.ph / encoder_nir@bfp.gov.ph | REGIONAL_ENCODER |
| `validator_test` | validator@bfp.gov.ph | NATIONAL_VALIDATOR |
| `analyst_test` | analyst@bfp.gov.ph | NATIONAL_ANALYST |
| `analyst1_test` | analyst1_test@gmail.com | NATIONAL_ANALYST |
| `admin_test` | admin@bfp.gov.ph | SYSTEM_ADMIN |

### Key Security Headers

`X-Content-Type-Options: nosniff`, `Content-Security-Policy: frame-src 'self'; frame-ancestors 'self'; object-src 'none'`, `Strict-Transport-Security: max-age=31536000; includeSubDomains`
