---
title: Infrastructure Configuration
created: 2026-05-16
updated: 2026-07-19
type: architecture
tags: [wims-bfp, docker, nginx, suricata, keycloak, infrastructure]
sources: [src/docker-compose.yml, src/docker-compose.prod.yml, src/.env.production.example, src/osrm/metro-manila.env, scripts/provision-osrm-metro-manila.sh, src/nginx/, src/suricata/, src/keycloak/import/bfp-realm.json, src/keycloak/Dockerfile, .github/workflows/ci.yml]
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
| keycloak | wims-keycloak | `wims-keycloak-demo-otp:local` built from `./keycloak` | 8080 |
| keycloak-bootstrap | wims-keycloak-bootstrap | `quay.io/keycloak/keycloak:24.0.0` | (one-shot, no ports) |
| backend | wims-backend | Dockerfile at `./backend/Dockerfile` (python:3.11-slim) | 8000 (internal) |
| frontend | wims-frontend | `./frontend/Dockerfile` (Next.js) | 3000 (internal) |
| wims-suricata | wims-suricata | `jasonish/suricata:7.0.5` | (none) |
| osrm (production overlay only) | wims-osrm | `osrm/osrm-backend:v5.25.0` | none |
| nginx-gateway | wims-nginx-gateway | `nginx:1.27.3-alpine` | 80, 443 |

**Health checks:** postgres (`pg_isready -U postgres -d wims`, interval 5s), redis (`redis-cli ping`, interval 5s), Keycloak (HTTP probe), and Suricata (`pgrep Suricata-Main`). Backend depends on healthy Postgres and Redis plus the completed Keycloak bootstrap.

**Named volumes:** `postgres_data`, `ollama_data`, `incident_attachments_data`, `openbao_data`. `openbao_data` stores OpenBao file storage plus prototype bootstrap credentials (`.bootstrap-creds`) and the regenerated backend/celery app token (`.wims-app-token`), mounted read-only into backend/celery at `/openbao-creds`.

**Temporary Keycloak provider:** The base Keycloak image is currently wrapped by `src/keycloak/Dockerfile` to build and install `src/keycloak/demo-otp-provider`, which registers `wims-demo-otp-form` for presentation-only browser OTP bypass code `123123`. Remove this provider and restore `quay.io/keycloak/keycloak:24.0.0` before PR; see `docs/agents/remove-demo-otp-bypass.md`.

**Required env interpolation:** Base `src/docker-compose.yml` intentionally uses `${VAR:?error}` for local/test secrets such as `POSTGRES_PASSWORD`, `KC_DB_PASSWORD`, `KEYCLOAK_ADMIN`, `KEYCLOAK_ADMIN_PASSWORD`, `NEXT_PUBLIC_FIREBASE_API_KEY`, and `NEXT_PUBLIC_FIREBASE_VAPID_KEY`. GitHub CI jobs that run compose (`docker-build`, `security-scan`) copy root `.env.example` to `src/.env` before `docker compose config`, build, or stack startup so fail-fast interpolation remains enabled without committing real secrets.

**Host port exposure:** Only `nginx-gateway` intentionally binds public interfaces (`0.0.0.0:80` and `0.0.0.0:443`). Database and support/admin surfaces are bound to host loopback only: Postgres `127.0.0.1:5432`, Redis `127.0.0.1:6379`, MailHog `127.0.0.1:1025`/`8025`, and direct Keycloak `127.0.0.1:8080`. Browser and OIDC traffic should reach Keycloak only through nginx at `/auth/`.

**Host firewall:** UFW is enabled on the VPS with default deny incoming, allow outgoing, and explicit inbound allows only for SSH `2222/tcp`, HTTP `80/tcp`, and HTTPS `443/tcp` on IPv4/IPv6.

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
| `OPENBAO_ADDR` | `http://openbao:8200` |
| `OPENBAO_TOKEN_FILE` | `/openbao-creds/.wims-app-token` when using Compose token-file auth |
| `SURICATA_EVE_PATH` | `/var/log/suricata/eve.json` |
| `EXPORT_DIR` | `/app/storage/exports` |
| `BACKUP_DIR` | `/app/storage/backups` |
| `OSRM_BASE_URL` | Unset in base/local/CI; fixed to `http://osrm:5000` for backend and Celery in the production overlay |

### Controlled Metro Manila routing

`src/docker-compose.prod.yml` adds an internal-only OSRM service for issues #552 and #668. It has no published port or Nginx route, uses static internal address `172.18.0.9`, mounts the external `${OSRM_DATA_DIR}` parent read-only and resolves the dataset through its `active` symlink, and runs at `WARNING` verbosity to suppress normal coordinate-bearing access paths. The data root must remain outside `/opt/wims-bfp` so deployment's `git clean -fd` cannot remove or block on generated map data. Backend and Celery receive the internal URL but deliberately do not depend on OSRM health, preserving the existing estimated fallback during an outage. Production `compose up --wait` still treats an unhealthy OSRM container as a failed activation.

The service uses a preprocessed Metro Manila MLD dataset. `scripts/provision-osrm-metro-manila.sh` downloads the source named in `src/osrm/metro-manila.env`, verifies its committed SHA-256, preprocesses it with the same pinned OSRM image, validates required files, and atomically switches an `active` symlink. Routine deploys never download map data. Local and CI Compose do not define the OSRM service and leave routing disabled by default. See `docs/operations/osrm-routing.md` for provisioning, refresh, privacy verification, and rollback.

Coverage is intentionally Metro Manila only; outside or unroutable endpoints use the backend straight-line estimate. Public OpenStreetMap basemap tiles remain a documented external tile-area egress boundary. See [[security/security-baseline]] and [[frontend/route-map]].

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

**GitOps deploy workflow:** `.github/workflows/deploy.yml` SSHs to the hardened VPS as the non-root `wims` user, using passwordless sudo only for root-owned certbot package/certificate/cron operations. It mirrors the production command above via a shell `compose()` helper that always includes `docker-compose.yml`, `docker-compose.prod.yml`, and `.env.production`. It validates `compose config --quiet`, checks DB connectivity, and rebuilds/restarts with `up -d --build --wait`. The `--wait` flag requires every service to be in "running" or "healthy" state. The `openbao-bootstrap` init container has no healthcheck and would normally exit after its script completes, causing `--wait` to fail. Its bootstrap script therefore ends with a keep-alive loop (`while true; do sleep 3600; done`) to stay in "running" state until the stack is torn down. Post-deploy checks cover backend-local `/health`, public nginx `/health`, Keycloak discovery, a real public backend route (`/api/public/emergency-services`), and the required Ollama model. The public backend probe catches stale nginx upstream addresses that nginx's self-served `/health` cannot detect. TLS provisioning skips issuance when `/etc/letsencrypt/live/wimsbfp.tech/` already contains a cert/key; first-time issuance uses certbot standalone and the renewal hook reloads the running nginx container with `docker exec wims-nginx-gateway nginx -s reload`.

**Current VPS public origin:** `src/.env.production` sets `PUBLIC_BASE_URL=https://wimsbfp.tech`, replacing the previous `https://165-22-101-73.nip.io` deployment origin. Production frontend build args, runtime auth variables, backend `KEYCLOAK_ISSUER`, and Keycloak `KC_HOSTNAME_URL` derive from this value through `src/docker-compose.prod.yml`.

**Current certificate state:** `src/nginx/nginx.conf` expects `/etc/letsencrypt/live/wimsbfp.tech/fullchain.pem` and `privkey.pem`. A Let’s Encrypt certificate for `wimsbfp.tech` was issued on the VPS on 2026-05-26 and certbot renewal is installed with an nginx reload hook.

**TLS mount:** `src/docker-compose.yml` no longer mounts certificate paths in the dev-neutral base service. Production TLS is added only by `src/docker-compose.prod.yml`, which binds `${LETSENCRYPT_DIR:-/opt/wims-bfp/letsencrypt}:/etc/letsencrypt:ro` for `wims-nginx-gateway`. On the VPS, `src/.env.production` sets `LETSENCRYPT_DIR=/etc/letsencrypt`, so the gateway receives the host certificate tree directly. Do not replace this with a repo-local symlink directory; Docker bind mounts expose the directory itself, so mounting `/opt/wims-bfp/letsencrypt` when it only contains `letsencrypt -> /etc/letsencrypt` hides the expected `/etc/letsencrypt/live/<domain>/...` paths from nginx.

**Docker DNS upstream refresh:** Both nginx configs use Docker's embedded resolver (`127.0.0.11`) and shared upstream zones with `server backend:8000 resolve` (`backend_servers`) and `server frontend:3000 resolve` (`frontend_servers`). Nginx refreshes both addresses after Compose recreates containers instead of retaining stale IPs and returning `502 Connection refused`. The deploy workflow also runs `nginx -s reload` after `compose up` as a safety net, and checks the frontend `/login` route post-deploy in addition to the existing Keycloak and API health probes.

**Real-IP trusted proxy range:** `nginx.conf`, `nginx.local.conf`, and `nginx.ci.conf` trust only `172.18.0.0/24` (the configured `wims_internal` subnet) plus `127.0.0.1` for `real_ip_header X-Forwarded-For`. Keep this range aligned with the Compose subnet; do not broaden it back to `172.18.0.0/16` unless the bridge subnet is widened too.

**Bad-bot blocker at edge (issue #517):** All three nginx configs include a vendored
[nginx-ultimate-bad-bot-blocker](https://github.com/mitchellkrogza/nginx-ultimate-bad-bot-blocker)
ruleset (MIT license, version V4.2026.07.6037) that blocks known bad user agents,
bad referrers, and malicious IPs at the edge before they reach application
endpoints. The ruleset is vendored under `src/nginx/bot-blocker/` and mounted
into the nginx-gateway container via `src/docker-compose.yml`:
`./nginx/bot-blocker:/etc/nginx/bot-blocker:ro`.

**Include structure:**
- `http {}` scope: `conf.d/globalblacklist.conf` (generated map/geo blocklists +
  bot-prefixed rate-limit zones) and `conf.d/wims-botblocker-settings.conf`
  (defines the `flood` zone required by ddos.conf).
- Each app-serving `server {}` block: `bots.d/blockbots.conf` and
  `bots.d/ddos.conf` (enforce the checks with `return 444` and DDoS rate limiting).

The HTTP→HTTPS redirect-only server block is exempt from server-scope includes
(no application endpoints to protect).

**False-positive unblock workflow:** See `src/nginx/bot-blocker/README.md` for
whitelisting procedures (IP, UA, or Super Whitelist bypass).

**Ollama model provisioning:** `ollama-model-pull` is a one-shot service that runs `ollama pull qwen2.5:3b` through the image's existing `ollama` entrypoint. Its Compose command is therefore `pull qwen2.5:3b`, not `ollama pull ...`. Backend startup waits for successful model provisioning.

**Ollama VPS resource cap:** The current Contabo production VPS has 8 vCPUs / 23 GiB RAM. `docker-compose.yml` and `docker-compose.prod.yml` cap Ollama at `cpus: '4'` / `memory: 6gb` for `qwen2.5:3b`. This reserves enough headroom for Qwen2.5-3B inference while leaving CPU and memory for Postgres, Keycloak, backend, Celery, Suricata, Redis, nginx, and the host OS cache. Older 2-vCPU / 8 GB VPS overrides must not be used on the Contabo host because they under-allocate the model and database services.

**Frontend/auth env:** `docker-compose.prod.yml` sets browser-facing frontend build/runtime variables to the public HTTPS origin (`${PUBLIC_BASE_URL}`) or relative paths (`/api`, `/auth`). The development compose file also uses relative `/api` and `/auth` for browser-facing access, so local HTTP desk checks stay same-origin and avoid CORS preflight redirects. The Next.js server-side auth routes use `BACKEND_URL=http://backend:8000` in both development and production, and route handlers append `/api/...` explicitly. Production `POST /api/auth/refresh` uses `AUTH_SERVER_URL=${PUBLIC_BASE_URL}/auth`: a refresh token issued through the public Keycloak issuer is rejected when the Next.js server instead calls the internal `http://nginx-gateway/auth` host. Do not substitute browser-relative `/auth` for this server-side value. Keycloak advertises `KC_HOSTNAME_URL=${PUBLIC_BASE_URL}/auth` in production to keep OIDC discovery issuer/endpoints aligned with the nginx `/auth/` proxy path. For `POST /api/auth/sync`, the route forwards nginx-provided `X-Real-IP`/sanitized `X-Forwarded-For` to backend `POST /api/auth/callback` so backend Redis rate limiting keys by end-user IP rather than by the frontend container.

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
- `/health` is served directly by nginx from the HTTPS server block for gateway uptime checks. The frontend also exposes a Next.js `/health` route for direct `npm run dev`/frontend-only runs; nginx takes precedence in Docker deployments.
- **No WebSocket/SSE** specific proxy settings (no `proxy_http_version 1.1`, no Upgrade header)
- **No caching or rate limiting** at nginx level.

---

## Suricata IDS

**Container:** `jasonish/suricata:7.0.5` with `-i eth0`

**Directories:**
- `src/suricata/logs/` → `/var/log/suricata/` — EVE JSON output, fast.log, stats.log
- `src/suricata/rules/` → `/var/lib/suricata/rules/` — only `classification.config` present (no .rules files)

**EVE output** is shared into both `backend` and `celery-worker` via `./suricata/logs:/var/log/suricata`. `celery-worker` uses `SURICATA_EVE_PATH=/var/log/suricata/eve.json` for fallback file-tail ingestion (`tasks.suricata.ingest_suricata_eve` → `services/suricata_ingestion.py`), while `backend` uses the same env var for `/api/admin/health` EVE mtime heartbeat checks.

The container exposes the running process as `Suricata-Main`; the Compose health check matches that process name with `pgrep`.

**Custom `suricata.yaml`** (`src/suricata/suricata.yaml`, ~85KB) — the prototype runs a customized config rather than the image default. Notable pen-test changes (2026-06-29):

- `redis-server: "redis"` under `eve-log.types[0].alert.redis` — real-time alert stream to Redis (`suricata:alerts`) for `tasks.suricata_redis.subscribe_alerts`.
- The bind mount `./suricata/suricata.yaml:/etc/suricata/suricata.yaml:ro` is the source of truth; the jasonish/suricata image declares `VOLUME /etc/suricata` which creates an anonymous volume that can shadow the bind mount on first run. Workaround: `docker compose down -v` for the suricata service, or remove the anonymous volume manually.

### Suricata <-> Redis host networking (pen-test follow-up 2026-06-29)

`wims-suricata` uses `network_mode: "host"` for AF_PACKET raw-socket packet capture. This is a **load-bearing constraint**: it cannot be changed without losing IDS capture capability. The side effect is that the Suricata container does NOT participate in the `wims_internal` bridge network, so Docker DNS cannot resolve the `redis` hostname for it.

The fix has three parts in `src/docker-compose.yml`:

1. **Static IPs on the low end of `wims_internal`** — `redis` is pinned to `172.18.0.5` via `networks.wims_internal.ipv4_address` so `wims-suricata` can use `extra_hosts`. PR #487 extends the same pattern to `postgres` (`172.18.0.3`), `ollama` (`172.18.0.4`), `keycloak` (`172.18.0.7`), and `openbao` (`172.18.0.8`) for backend/celery/bootstrap DNS-bypass mappings. The network declares `ipam.config.subnet: 172.18.0.0/24` and keeps dynamic allocations in `ipam.config.ip_range: 172.18.0.128/25` so one-shot/dynamic services cannot claim these low static addresses during parallel Compose startup.
2. **`extra_hosts` on wims-suricata** — `extra_hosts: ["redis:172.18.0.5"]` injects the mapping into the container's /etc/hosts. This works even with `network_mode: "host"` because /etc/hosts is per-container filesystem, not per-network-namespace.
3. **Config comment in `suricata.yaml`** — the pen-test comment above the `redis` block documents the dependency on the docker-compose entries.

**Why not just use `redis-server: 127.0.0.1`?** That was the pre-fix config. With `network_mode: "host"`, 127.0.0.1 in the Suricata container IS the host loopback, and the redis port mapping `127.0.0.1:6379:6379` does make redis reachable from the host loopback. So 127.0.0.1 *would* work for Suricata. But the hostname approach is more explicit and doesn't depend on the port mapping being present (which was originally added for dev convenience, not for Suricata).

**Contract test:** `src/backend/tests/test_suricata_redis_host_networking.py` pins the structure, including the static IPs and non-overlapping dynamic `ip_range`. Regressions to the docker-compose, suricata.yaml, or pen-test comment are caught at `pytest` time without needing a live stack.

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

**Browser Flow:** Cookie check (ALTERNATIVE) → Username/Password form (REQUIRED) → `otp-skip-mfa` conditional-user-role (ALTERNATIVE, priority 20) → Browser Conditional OTP sub-flow (ALTERNATIVE, priority 30):
  - `conditional-user-configured` (ALTERNATIVE) — skip if user has no TOTP
  - `otp-role-system-administrator` (ALTERNATIVE) — requires OTP if role = SYSTEM_ADMIN
  - `otp-role-national-validator` (ALTERNATIVE) — requires OTP if role = NATIONAL_VALIDATOR
  - `otp-role-regional-encoder` (ALTERNATIVE) — requires OTP if role = REGIONAL_ENCODER
  - `otp-role-national-analyst` (ALTERNATIVE) — requires OTP if role = NATIONAL_ANALYST
  - `wims-demo-otp-form` with `otpRememberDeviceFor=7d` (REQUIRED) — 7-day trusted device plus temporary demo code support

**Direct Grant Flow:** Direct Grant Conditional OTP is REQUIRED in the parent direct-grant flow (intentional #243 hardening to close direct-grant MFA bypass). Its sub-flow uses the same four uppercase role conditionals plus REQUIRED `direct-grant-validate-otp`; unlike browser login, it does not use the temporary demo OTP provider.

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

## Keycloak Email Theme (WIMS-BFP branding)

The `bfp` realm uses a custom email theme at `src/keycloak/themes/wims-bfp/email/`. The theme overrides the 3 default Keycloak transactional email templates (password reset, email verification, execute actions) with WIMS-BFP-branded versions.

**File structure (10 new files in `email/`):**
- `email/theme.properties` (1 line: `parent=base`)
- `email/messages/messages_en.properties` (3 subject-line overrides: `passwordResetSubject`, `emailVerificationSubject`, `executeActionsSubject`)
- `email/resources/img/bfp-logo.png` (BFP logo, referenced by `${url.resourcesUrl}/img/bfp-logo.png`)
- `email/html/template.ftl` (shared `<#macro emailLayout>` wrapper, ~70 lines)
- `email/html/{password-reset,email-verification,executeActions}.ftl` (3 HTML body templates, ~20 lines each)
- `email/text/{password-reset,email-verification,executeActions}.ftl` (3 plain-text body templates, ~12 lines each)

**Realm config:** `emailTheme: wims-bfp` is set as a top-level field in BOTH `src/keycloak/bfp-realm.json` and `src/keycloak/import/bfp-realm.json`. The live persistent DB on the VPS gets this field via `kcadm.sh update realms/bfp -s emailTheme=wims-bfp` (B2 pattern from the live-notifications work — Keycloak does not re-resolve realm-level fields on container restart).

**Deploy notes:**
- No Dockerfile or compose change needed — the volume mount at `src/docker-compose.yml:60` picks up the new `email/` subdirectory automatically
- After editing the theme files, restart Keycloak with `docker compose restart keycloak` (or `up -d --force-recreate keycloak` if `restart` doesn't pick up the changes due to caching)
- The logo URL uses `${url.resourcesUrl}` (a FreeMarker context variable injected by `UrlBean`) — this is portable across local, staging, and production
- FreeMarker render errors are surfaced in Keycloak logs when the email flow is triggered (not at startup) — check `docker logs wims-keycloak` after a test email send

**Visual style:** maroon `#8B0000` header, BFP logo (48x48), "Bureau of Fire Protection" + "WIMS-BFP Incident Management System" tagline, 600px max width, table-based layout, inline CSS. Matches the 7 backend app-level Jinja2 templates in `src/backend/services/email/templates/`.

**Security:** all 6 body templates use the `<#assign displayName = (user.firstName?has_content)?then(user.firstName, user.username)>` pattern. The `?has_content` + `?then` builtins handle BOTH null/missing AND empty-string cases (FreeMarker's `!` operator only handles null/missing, not empty strings). XSS protection is provided by **FreeMarker's auto-escape**, which is on by default for the HTML output format in FreeMarker 2.3.30+ (Keycloak 24 ships 2.3.32). Do **NOT** add `?html` to the output expressions in HTML templates — the FreeMarker parser **rejects** `?html` under auto-escape as a double-escape safeguard, which causes `Failed to send email` at the user level. The 3 text templates use `<#ftl output_format="plainText">` and do not have auto-escape on, so they don't need (and don't use) `?html` either. See `docs/superpowers/specs/2026-06-24-keycloak-email-theme-design.md` v2.1.1 patch for the full post-mortem.

**Post-deploy fix (v2.1.1, 2026-06-24):** PR #453 was deployed with `?html` in the 3 HTML templates (carried over from the v2.1 spec's "XSS fix"). The v2/v2.1 self-reviews verified identifier consistency against the Keycloak 24 source but did not verify parseability against FreeMarker 2.3.32 with auto-escape on. The first live password-reset trigger returned `Failed to send email, please try again later.` because of `freemarker.core.ParseException: Using ?html (legacy escaping) is not allowed when auto-escaping is on with a markup output format (HTML), to avoid double-escaping mistakes`. Fix: 7 `?html` call sites removed across 3 HTML templates; auto-escape provides the XSS protection. No realm JSON change, no kcadm step, no Docker/compose change. VPS deploy: `git pull --ff-only origin master && docker compose ... restart keycloak`.

**`parent=base` means base templates CAN be inherited** for templates we don't override. The 3 target flows (password reset, email verification, execute actions) use the new themed templates; other email types (event notifications) still use the base theme defaults.
