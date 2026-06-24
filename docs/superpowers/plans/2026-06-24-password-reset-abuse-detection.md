# Password Reset Abuse Detection — Implementation Plan v1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated nginx rate limit zone for the Keycloak password reset POST path so single-IP email-bombing attacks are blocked at the edge, and the reset traffic budget is isolated from the shared `/auth/` zone.

**Architecture:** 3 nginx config files (`nginx.conf`, `nginx.ci.conf`, `nginx.local.conf`) get 3 additions each: (1) a `map` block that extracts POST methods as `$reset_post_only`, (2) a `limit_req_zone` for the reset path, (3) an exact-match `location =` block BEFORE the generic `/auth/` location that applies `limit_req zone=reset_credentials burst=2 nodelay` and `limit_conn addr 10`. Only the production `nginx.conf` goes to the VPS; CI and local are kept in sync.

**Source spec:** `docs/superpowers/specs/2026-06-24-password-reset-abuse-detection-design.md` (v2.1). This plan implements M1 only — the hard nginx edge gate. M2 (per-email enforcement) and M3 (SMTP telemetry) are deferred.

**Workflow:** Feature branch → nginx config edits (3 files) → `nginx -t` verification → `curl` smoke tests → push and open PR → merge → VPS deploy → post-deploy curl verification.

**Key constraints (from spec reviews):**
- POST-only rate limiting via `map $request_method` — GET requests are NOT rate limited (empty zone key is not accounted by nginx)
- `limit_req_status 429;` is already set in all 3 configs (line 68 in nginx.conf, line 37 in nginx.ci.conf, line 51 in nginx.local.conf) — no change needed
- `limit_conn addr 10;` is explicitly repeated in the reset location because exact-match `location =` terminates location search (the generic `/auth/` block does not also apply)
- The reset location uses the full upstream path in `proxy_pass` — must be verified with a before/after curl smoke test
- `hash $binary_remote_addr$reset_post_only` is not needed — we key per-IP via `$realip_remote_addr` on the `$reset_post_only` variable (which is only non-empty for POST)

## File Structure

| # | File | Action | Change |
|---|------|--------|--------|
| 1 | `src/nginx/nginx.conf` | **Edit** | Insert `map` block + `limit_req_zone` after line 65; insert `location =` block before line 203 (first `/auth/`); insert another before line 419 (second `/auth/`) |
| 2 | `src/nginx/nginx.ci.conf` | **Edit** | Insert `map` block + `limit_req_zone` after line 35; insert `location =` block before line 179 |
| 3 | `src/nginx/nginx.local.conf` | **Edit** | Insert `map` block + `limit_req_zone` after line 49; insert `location =` block before line 172 (first `/auth/`); insert another before line 335 (second `/auth/`) |

**Total: 3 files, 8 insertion points (3 map + zone blocks + 5 location blocks).**

---

### Task 0: Create the feature branch (do this FIRST, before any file edits)

**Files:** None (git workflow only)

- [ ] **Step 1: Verify the working tree is clean on master**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE
git status
git rev-parse --abbrev-ref HEAD
```

Expected: working tree clean, branch `master`. If there are uncommitted changes, resolve them before continuing (commit or stash).

- [ ] **Step 2: Pull the latest from origin/master**

```bash
git pull --ff-only origin master
```

- [ ] **Step 3: Create and switch to the feature branch**

```bash
git checkout -b feat/password-reset-abuse-detection
```

- [ ] **Step 4: Verify the branch is created**

```bash
git rev-parse --abbrev-ref HEAD
git log --oneline -1
```

Expected: `feat/password-reset-abuse-detection` and the latest commit from `master`.

---


### Task 1: Edit 3 nginx config files (map + zone + location block)

**Files:**
- `src/nginx/nginx.conf`
- `src/nginx/nginx.ci.conf`
- `src/nginx/nginx.local.conf`

**Insertion content (same for all 3 files):**

**Insert A — Inside the `http {}` block (next to the existing `limit_req_zone` directives), add the `map` + new zone. Verify the insertion point is inside `http {}` and NOT inside any `server {}` block — nginx's `map` directive is only valid in the `http` context (see [nginx map docs](https://nginx.org/en/docs/http/ngx_http_map_module.html)).**

```nginx
    # POST-only rate-limit zone for the password reset endpoint.
    # GET requests have $reset_post_only = "" which nginx does not account,
    # so the form page loads freely. Only POST form submissions consume tokens.
    map $request_method $reset_post_only {
        POST    $realip_remote_addr;
        default "";
    }
    limit_req_zone  $reset_post_only zone=reset_credentials:10m rate=1r/m;
```

**Insert B — Before each `/auth/` location block, add the reset-specific exact-match location:**

```nginx
        # POST-only rate limit for password reset abuse protection.
        # Exact-match location — terminates search, so the generic /auth/ block
        # does NOT apply. All proxy headers are explicitly repeated.
        location = /auth/realms/bfp/login-actions/reset-credentials {
            limit_req  zone=reset_credentials burst=2 nodelay;
            limit_conn addr 10;

            proxy_pass http://keycloak_servers/auth/realms/bfp/login-actions/reset-credentials;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $realip_remote_addr;
            proxy_set_header X-Forwarded-For $remote_addr;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header X-Forwarded-Host $host;
            proxy_set_header X-Forwarded-Port $server_port;
        }
```

**Important config-specific overrides:**

| Config | Insert A location (after) | Insert B locations (before each) | Upstream name | `$remote_addr` vs `$proxy_add_x_forwarded_for` |
|---|---|---|---|---|
| `nginx.conf` | line 65 (`limit_conn_zone`) | lines 203 and 419 | `keycloak_servers` | `$remote_addr` |
| `nginx.ci.conf` | line 35 (`limit_conn_zone`) | line 179 | `keycloak` | `$proxy_add_x_forwarded_for` (matches the CI block) |
| `nginx.local.conf` | line 49 (`limit_conn_zone`) | lines 172 and 335 | `keycloak_servers` | `$proxy_add_x_forwarded_for` (matches the local block) |

> **Note:** `nginx.ci.conf` and `nginx.local.conf` proxy to `keycloak:8080/auth/` (singular hostname) and `keycloak_servers` respectively. Use the upstream name (`keycloak` for CI, `keycloak_servers` for production and local) in the `proxy_pass` URL. The upstream name is copied from the existing generic `/auth/` block in each file.

> **Note:** `X-Forwarded-For` uses `$proxy_add_x_forwarded_for` in CI and local configs (they track the chain) and `$remote_addr` in production (nginx already sees the real client IP — see the inline comment in nginx.conf). Copy the EXACT `proxy_set_header` line from the generic `/auth/` block for each file.

> **Note:** `limit_req_status 429;` is already present in all 3 configs at the http/server level — no need to repeat it in the location block. If a config variant does NOT have it, add it at the `http`, `server`, or `location` level.

- [ ] **Step 1 — Edit `src/nginx/nginx.conf`** — Insert A after line 65, Insert B before line 203 and before line 419.

- [ ] **Step 2 — Edit `src/nginx/nginx.ci.conf`** — Insert A after line 35, Insert B before line 179.

- [ ] **Step 3 — Edit `src/nginx/nginx.local.conf`** — Insert A after line 49, Insert B before line 172 and before line 335.

- [ ] **Step 4 — Verify all 3 files look correct**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE

echo "=== Verify map insertion is inside http {} context, not server {} ==="
# Show line numbers so implementer can confirm the map lines appear after http { and before server {}:
grep -n "http {" src/nginx/nginx.conf
grep -n "map \$request_method" src/nginx/nginx.conf
grep -n "limit_req_zone.*reset_credentials" src/nginx/nginx.conf
grep -n "server {" src/nginx/nginx.conf | head -5
echo ""
echo ">>> Confirm manually: the map and reset_credentials zone lines must appear AFTER http {"
echo ">>> and BEFORE any server { block. If they are inside a server block, move them up."
echo ""
echo "=== Verify limit_req_status 429 is set in all configs ==="
grep -n 'limit_req_status[[:space:]]\+429' src/nginx/nginx.conf
grep -n 'limit_req_status[[:space:]]\+429' src/nginx/nginx.ci.conf
grep -n 'limit_req_status[[:space:]]\+429' src/nginx/nginx.local.conf
echo "  (expect 1 match per config — if missing, add at http level)"
echo ""
echo "=== nginx.conf — reset zone + location ==="
echo "---"
grep -n 'map.*request_method' src/nginx/nginx.conf

echo "=== nginx.ci.conf — reset zone + location ==="
grep -n 'reset' src/nginx/nginx.ci.conf
echo "---"
grep -n 'map.*request_method' src/nginx/nginx.ci.conf

echo "=== nginx.local.conf — reset zone + location ==="
grep -n 'reset' src/nginx/nginx.local.conf
echo "---"
grep -n 'map.*request_method' src/nginx/nginx.local.conf
```

Expected: each file has 1 `map` line, 1 `limit_req_zone reset_credentials` line, and 1 or 2 `reset-credentials` location lines. nginx.conf should have 2 reset location blocks (1 production + 1 HTTPS). nginx.local.conf should have 2 (1 HTTP + 1 HTTPS). nginx.ci.conf should have 1 (CI-only HTTP).

- [ ] **Step 5 — Commit**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE
git add src/nginx/nginx.conf src/nginx/nginx.ci.conf src/nginx/nginx.local.conf
git commit -m "feat(nginx): password reset POST rate limit (1r/m burst=2 per IP)

Add a dedicated nginx limit_req zone for the Keycloak password reset
endpoint /auth/realms/bfp/login-actions/reset-credentials, separated
from the shared keycloak_api zone so reset abuse does not degrade
login/admin console traffic.

POST-only enforcement via map $request_method $reset_post_only:
- For GET (form page load), $reset_post_only = '' — nginx does not
  account requests with an empty limit_req_zone key, so the form
  loads freely without consuming tokens.
- For POST (form submission), $reset_post_only = $realip_remote_addr.
  Rate: 1r/m burst=2 — a legitimate user submits once and never
  hits the limit; a single-IP attacker can send at most 60/hr.

Three nginx configs updated:
- nginx.conf (production): 2 location blocks (HTTP + HTTPS servers)
- nginx.ci.conf (CI): 1 location block (CI-only HTTP server)
- nginx.local.conf (local dev): 2 location blocks (HTTP + HTTPS)

Spec: docs/superpowers/specs/2026-06-24-password-reset-abuse-detection-design.md (v2.1)
M1-only implementation. M2/M3 deferred."
```

---


### Task 2: Local verification (nginx -t + curl smoke tests)

**Files:** None (verification only)

> **Fallback behaviour:** If the local nginx container is running, run both `nginx -t` and curl smoke tests. If the local stack is unavailable, run syntax-only checks locally and rely on CI + VPS post-deploy curl verification (Task 7).

- [ ] **Step 1 — Run `nginx -t` on all 3 configs**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE

echo "=== nginx.conf syntax check ==="
nginx -t -c "$PWD/src/nginx/nginx.conf" 2>&1 | tail -3

echo "=== nginx.ci.conf syntax check ==="
nginx -t -c "$PWD/src/nginx/nginx.ci.conf" 2>&1 | tail -3

echo "=== nginx.local.conf syntax check ==="
nginx -t -c "$PWD/src/nginx/nginx.local.conf" 2>&1 | tail -3
```

Expected: each returns `test is successful`. If any fails, fix the syntax error before continuing.

> **Note:** If `nginx -t` is not available on the local machine, use a standalone `nginx:1.27.3-alpine` container as a **best-effort syntax check only** (may fail if the config references upstream hostnames, cert paths, resolver config, or included files outside `src/nginx/` — the authoritative check is `docker exec wims-nginx-gateway nginx -t` against the running stack or VPS).
>
> Run the standalone check:
> ```bash
> docker run --rm -v "$PWD/src/nginx:/etc/nginx:ro" nginx:1.27.3-alpine nginx -t -c /etc/nginx/nginx.conf 2>&1 | tail -3
> ```

- [ ] **Step 2 — Local curl smoke test (before the change is deployed, use the container)**

```bash
# If a local nginx container is running (docker compose up):
curl -sS -X POST 'http://localhost/auth/realms/bfp/login-actions/reset-credentials' \
  -d "username=nonexistent-reset-rate-test-$(date +%s)@example.invalid" -v 2>&1 | grep -E '< HTTP/|< Location|Too Many|429'

# Repeat 4+ times rapidly to confirm rate limiting:
for i in 1 2 3 4 5; do
  echo "--- Request $i ---"
  curl -sS -X POST 'http://localhost/auth/realms/bfp/login-actions/reset-credentials' \
    -d "username=nonexistent-reset-rate-test-$(date +%s)@example.invalid" -w "\n  HTTP %{http_code}\n" -o /dev/null
done
```

Expected: requests 1-3 may pass (200/302), request 4+ returns 429 (`Too Many Requests`).

```bash
# GET request (form page) should NOT be rate limited:
for i in 1 2 3 4 5; do
  curl -sS 'http://localhost/auth/realms/bfp/login-actions/reset-credentials' \
    -w "  GET %{http_code}\n" -o /dev/null
done
```

Expected: all GET requests return 200 (never consume the `reset_credentials` zone budget).

- [ ] **Step 3 — Verify existing `/auth/` paths still work (not affected)**

```bash
# Login page should work normally:
curl -sS 'http://localhost/auth/realms/bfp/.well-known/openid-configuration' \
  -w "  OIDC discovery: HTTP %{http_code}\n" -o /dev/null

# Admin console should be reachable:
curl -sS 'http://localhost/auth/admin/master/console/' \
  -w "  Admin console: HTTP %{http_code}\n" -o /dev/null
```

Expected: both return 200 (the generic `/auth/` location still matches).

- [ ] **Step 4 — Commit (skip — verification only)**

This task is verification only. If any check fails, fix before continuing. If all checks pass, proceed to Task 3.

---


### Task 3: System-wiki update (per AGENTS.md, BEFORE the PR is opened)

**Files:**
- Append to `system-wiki/log.md`
- Update `system-wiki/architecture/infrastructure-config.md` (or `system-wiki/security/security-baseline.md`)
- Update `system-wiki/gaps/frs-codebase-gap-register.md`

- [ ] **Step 1 — Find the relevant wiki page**

```bash
grep -n 'Nginx Edge Rate Limiting\|keycloak_api\|password reset' system-wiki/security/security-baseline.md | head -5
```

The most relevant page is `system-wiki/security/security-baseline.md` §Nginx Edge Rate Limiting for Keycloak (2026-06-23). Add the new reset-specific zone as a subsection.

- [ ] **Step 2 — Add a note to the security baseline**

After the existing "### Nginx Edge Rate Limiting for Keycloak (2026-06-23)" section, add:

```markdown
#### Password reset POST rate limit (2026-06-24)

Added a dedicated `limit_req_zone reset_credentials` for `/auth/realms/bfp/login-actions/reset-credentials` at `1r/m burst=2` per IP. POST-only enforcement via `map $request_method $reset_post_only`. GET (form page) is not rate limited. This isolates reset-traffic budget from the shared `keycloak_api` zone so reset abuse does not degrade login/admin console traffic. Spec: `docs/superpowers/specs/2026-06-24-password-reset-abuse-detection-design.md` (v2.1). M1 only — per-email enforcement deferred.
```

- [ ] **Step 3 — Update the gap register**

Create a new entry (if a placeholder exists, close it):

```markdown
### PASSWORD-RESET-ABUSE (closed 2026-06-24)

- **Problem:** The Keycloak password reset endpoint at `/auth/realms/bfp/login-actions/reset-credentials` shared the nginx `keycloak_api` rate-limit zone with all other `/auth/` traffic. A single-IP attacker could fire 20 reset POSTs in 2 seconds before hitting the shared zone's limit, degrading legitimate login/admin traffic. Keycloak brute-force protection guards LOGIN_ERROR only, not reset-trigger abuse.
- **Fix:** Added a dedicated `limit_req_zone reset_credentials` at `1r/m burst=2` per-IP for the reset-credentials POST path. POST-only enforcement via `map $request_method`; GET (form page) is unthrottled. Three nginx configs updated (`nginx.conf`, `nginx.ci.conf`, `nginx.local.conf`). Deployed on VPS with `nginx -s reload`.
- **Spec:** `docs/superpowers/specs/2026-06-24-password-reset-abuse-detection-design.md` (v2.1). Plan: `docs/superpowers/plans/2026-06-24-password-reset-abuse-detection.md`. Closed by PR #N.
- **Deferred:** per-email rate limiting (M2 in the spec — requires a backend-owned reset endpoint or Keycloak SPI); SMTP daily-budget telemetry (M3).
```

- [ ] **Step 4 — Append an entry to `system-wiki/log.md`**

```markdown
## 2026-06-24 — Password reset abuse detection (nginx POST rate limit, M1 only)

- **Problem:** The Keycloak password reset endpoint shared the nginx `keycloak_api` rate-limit zone (10r/s, burst=20) with login and admin console traffic. A single-IP attacker could burn the shared budget with reset requests. Keycloak brute-force protection does not cover reset events.
- **Fix:** Dedicated nginx `limit_req_zone reset_credentials` at `1r/m burst=2` per-IP for POST `/auth/realms/bfp/login-actions/reset-credentials`. POST-only enforcement via `map $request_method` — the form page (GET) is not rate limited. The reset-API budget is now isolated from the shared `/auth/` zone. Three nginx configs updated: `nginx.conf` (2 server blocks), `nginx.ci.conf` (1), `nginx.local.conf` (2). VPS deploy: `git pull --ff-only origin master && docker exec wims-nginx-gateway nginx -t && docker exec wims-nginx-gateway nginx -s reload`.
- **Spec:** `docs/superpowers/specs/2026-06-24-password-reset-abuse-detection-design.md` (v2.1). Plan: `docs/superpowers/plans/2026-06-24-password-reset-abuse-detection.md` (this plan). Closed by PR #N.
- **Scope:** nginx config only. Zero Python, zero tests, zero SMTP creds, zero Keycloak changes, zero frontend changes.
- **Deferred:** M2 (per-email rate limiting) and M3 (SMTP daily-budget telemetry) per the spec's implementation decision.
- **Validation:** `nginx -t` clean; POST 4+ times → 429; GET 10 times → all 200; existing OIDC discovery and admin console paths unaffected.
```

- [ ] **Step 5 — Commit the wiki updates (same branch, same PR)**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE
git add system-wiki/security/security-baseline.md \
        system-wiki/gaps/frs-codebase-gap-register.md \
        system-wiki/log.md
git commit -m "docs(wiki): document password reset abuse detection (M1 nginx rate limit)

Note: wiki commit is done BEFORE the PR is opened (per AGENTS.md mandatory rule).

Per AGENTS.md mandatory system-wiki update rule. Three files:
- security/security-baseline.md: add subsection under Nginx Edge Rate
  Limiting for Keycloak documenting the reset_credentials zone
- gaps/frs-codebase-gap-register.md: close PASSWORD-RESET-ABUSE gap
  with problem/fix/spec/deferred-items entry
- log.md: append 2026-06-24 entry with problem/fix/scope/validation

Spec: docs/superpowers/specs/2026-06-24-password-reset-abuse-detection-design.md (v2.1)"
```

---


### Task 4: Push, open PR

**Files:** None (git workflow only)

- [ ] **Step 1 — Push the feature branch**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE
git push -u origin feat/password-reset-abuse-detection 2>&1 | tail -5
```

Expected: `* [new branch] feat/password-reset-abuse-detection -> feat/password-reset-abuse-detection`

- [ ] **Step 2 — Open the PR**

Create the PR body file:

```bash
cat > /tmp/reset-abuse-pr-body.md << 'PRBODY'
## Problem

The password reset endpoint at `/auth/realms/bfp/login-actions/reset-credentials` shares
the same nginx `keycloak_api` rate-limit zone (10r/s, burst=20) as all other `/auth/`
traffic (login, admin console, OIDC discovery). A single-IP attacker can send 20 password
reset POSTs in 2 seconds before hitting the shared zone's limit, degrading legitimate
login and admin traffic in the process.

Keycloak's brute-force protection guards LOGIN_ERROR events only — it does not protect
against abuse of the `reset-credential-email` SMTP trigger. There is no per-IP rate
limit specific to the password reset flow.

## Solution

A dedicated nginx `limit_req_zone` for the password reset POST endpoint, isolated from
the shared `keycloak_api` zone. POST-only enforcement via `map $request_method`,
so the form page (GET) loads freely without consuming tokens.

**Three nginx configs updated:**
- `src/nginx/nginx.conf` — 2 location blocks (HTTP + HTTPS servers)
- `src/nginx/nginx.ci.conf` — 1 location block (CI-only HTTP server)
- `src/nginx/nginx.local.conf` — 2 location blocks (HTTP + HTTPS servers)

## How it works

```nginx
map $request_method $reset_post_only {
    POST    $realip_remote_addr;
    default "";
}
limit_req_zone  $reset_post_only zone=reset_credentials:10m rate=1r/m;

location = /auth/realms/bfp/login-actions/reset-credentials {
    limit_req  zone=reset_credentials burst=2 nodelay;
    limit_conn addr 10;
    proxy_pass http://keycloak_servers/auth/realms/bfp/login-actions/reset-credentials;
    # ... proxy headers (same as generic /auth/ block)
}
```

**Rate analysis:**
- 1st POST: passes (1 token in bucket)
- 2nd-3rd POST in quick succession: passes (burst=2 consumed)
- 4th+ POST in the same minute: 429 (`Too Many Requests`)
- After 60s of inactivity: 1 token refilled
- Max sustained throughput from a single IP: 60 POSTs/hr
- GET (form page): never rate limited (empty zone key is not accounted)

## Why these specific files and not others

- **No change to `src/docker-compose*.yml`** — the compose file mounts the `src/nginx/` directory to the nginx container; no rebuild needed
- **No change to `src/backend/`** — no Python code, no Redis, no routes
- **No change to `src/keycloak/`** — no Keycloak theme, realm, or Dockerfile changes
- **No change to `.env*` files** — no new environment variables
- **No new automated tests** — verified by `nginx -t` + curl smoke tests

## Spec

- **Spec:** `docs/superpowers/specs/2026-06-24-password-reset-abuse-detection-design.md` (v2.1)
- **Plan:** `docs/superpowers/plans/2026-06-24-password-reset-abuse-detection.md` (M1 only)
PRBODY
```

```bash
gh pr create \
  --base master \
  --head feat/password-reset-abuse-detection \
  --title "feat(nginx): password reset POST rate limit (1r/m burst=2 per IP)" \
  --body-file /tmp/reset-abuse-pr-body.md
```

Expected: `ok created #N https://github.com/x1n4te/WIMS-BFP-PROTOTYPE/pull/N`

- [ ] **Step 3 — Clean up**

```bash
rm /tmp/reset-abuse-pr-body.md
```

---


### Task 5: Wait for CI, review, and merge to master (HUMAN GATE)

**Files:** None (workflow gate)

- [ ] **Step 1: Wait for CI to pass** — check the PR's CI status (`gh pr checks N`). All blocking gates should pass. Since this is nginx-only, the relevant CI jobs are `nginx -t` and the docker-build/stack-up checks.

- [ ] **Step 2: Wait for code review approval**

- [ ] **Step 3: Wait for the PR to be merged to master**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE
git fetch origin master
git log --oneline origin/master -3
```

Expected: the latest commit on origin/master is the merge commit of the PR.

---

### Task 6: VPS deploy (after merge)

**Files:** None (operational task on the VPS)

**What changes on the VPS:** Only `src/nginx/nginx.conf` (production config). The CI and local configs are not used on the VPS. The nginx container mounts `src/nginx/` directly, so a `git pull` followed by `nginx -s reload` is sufficient — no container restart needed.

- [ ] **Step 1 — SSH to the VPS and pull the merge commit**

```bash
ssh -i ~/.ssh/id_ed25519_pi root@165.22.101.73
cd /opt/wims-bfp
git fetch origin master
git checkout master
git pull --ff-only origin master
git log --oneline -3
```

Expected: the latest commit is the merge commit of the PR.

- [ ] **Step 2 — Verify the nginx config is valid**

```bash
cd /opt/wims-bfp/src
docker exec wims-nginx-gateway nginx -t 2>&1
```

Expected: `test is successful`. If it fails, fix the syntax before proceeding.

- [ ] **Step 3 — Reload nginx (graceful, no downtime)**

```bash
docker exec wims-nginx-gateway nginx -s reload
echo "exit: $?"
```

Expected: exit 0. `nginx -s reload` tells the nginx master process to reload config while existing worker processes continue serving active connections. New workers start with the new config.



### Task 7: Post-deploy verification (on the VPS)

**Files:** None (verification only)

- [ ] **Step 4 — Verify the config is live**

```bash
# POST should be rate limited:
for i in 1 2 3 4 5; do
  echo "--- Request $i ---"
  curl -sS -X POST 'https://wimsbfp.tech/auth/realms/bfp/login-actions/reset-credentials' \
    -d "username=nonexistent-reset-rate-test-$(date +%s)@example.invalid" -w "HTTP %{http_code}\n" -o /dev/null
done
```

Expected: requests 1-3 may pass (200/302), request 4+ returns 429.

```bash
# GET should NOT be rate limited:
for i in 1 2 3 4 5; do
  curl -sS 'https://wimsbfp.tech/auth/realms/bfp/login-actions/reset-credentials' \
    -w "GET HTTP %{http_code}\n" -o /dev/null
done
```

Expected: all GET requests return 200.

```bash
# GET with query string (proxy_pass path integrity check):
curl -sS -I 'https://wimsbfp.tech/auth/realms/bfp/login-actions/reset-credentials?client_id=wims-frontend' \
  -w 'GET with args: HTTP %{http_code}\n' -o /dev/null
```

Expected: returns 200 or 302 (not 404/502 — confirms exact-match proxy_pass preserves the path and query string).

```bash
# Legitimate login flow still works:
curl -sS 'https://wimsbfp.tech/auth/realms/bfp/.well-known/openid-configuration' \
  -w "OIDC discovery: HTTP %{http_code}\n" -o /dev/null
```

Expected: 200.

- [ ] **Step 5 — Verify the reset email still works for a legitimate user**

Trigger a password reset at `https://wimsbfp.tech/auth/realms/bfp/login-actions/reset-credentials` with a real email address. Confirm the email arrives with WIMS-BFP-branded template (subject `[WIMS-BFP] Reset your password`, maroon header, BFP logo).

---


---


## Self-Review

**1. Spec coverage:**

| Spec section | Plan task | Notes |
|---|---|---|
| M1 — nginx per-IP POST-only rate limit | Task 1 (map + zone + locations) | ✅ |
| M1 POST-only via `map` | Task 1 Insert A | ✅ |
| M1 exact proxy block copy | Task 1 Insert B (matches existing `/auth/` block headers) | ✅ |
| M1 `limit_conn addr 10` repeated | Task 1 Insert B | ✅ |
| M1 rate `1r/m burst=2` | Task 1 Insert B | ✅ |
| M1 `limit_req_status 429` | Already in all 3 configs | ✅ |
| Verification — `nginx -t` | Task 2 Step 1 | ✅ |
| Verification — POST rate limited (up to 3 pass, 4th 429) | Task 2 Step 2 | ✅ |
| Verification — GET not rate limited | Task 2 Step 2 | ✅ |
| Verification — existing paths unaffected | Task 2 Step 3 | ✅ |
| Before/after proxy_pass smoke test | Task 2 Step 2 | ✅ |
| VPS deploy → `nginx -s reload` | Task 6 Step 3 | ✅ |
| System-wiki update (before PR) | Task 3 | ✅ |

**2. Placeholder scan:** The `#N` PR number in Task 4 (push/open PR) and wiki Task 3 should be filled in by the implementer after the PR is opened.

**3. Type/identifier consistency:**
- All upstream names (`keycloak_servers`, `keycloak`) match the existing generic `/auth/` location blocks in each config
- All `proxy_set_header` lines match the existing blocks in each config
- The location path `/auth/realms/bfp/login-actions/reset-credentials` matches the actual Keycloak reset-credentials path used by `ResetCredentialsAction` (verified in the spec's review against keycloak/24.0.0 source)
- The `map` variable `$reset_post_only` is unique and won't conflict with any existing variable
- The zone name `reset_credentials` follows the same naming convention as `public_api`, `civilian_api`, `general_api`, `keycloak_api`

**4. Rate analysis (per the spec's fixed burst behavior):**

With `rate=1r/m burst=2 nodelay`:
- Bucket starts with 1 token (the rate). Burst of 2 means 2 additional tokens can be queued.
- Request 1: consumes the initial token. Burst queue = 0/2.
- Request 2 (rapid): draws from burst. Burst queue = 1/2.
- Request 3 (rapid): draws from burst. Burst queue = 2/2.
- Request 4 (rapid): no tokens left → 429.
- After 60s: 1 token refilled. Burst queue = 1/2.
- After 3 minutes of inactivity: 3 tokens available (base rate × 3 + burst = 3 + 2 = 5, capped at 3 burst).
- **Effective max sustained throughput:** 1 POST per 60 seconds = 60/hr.

**5. Why this plan is implementation-ready:**

- Every shell command is shown with the expected output
- Every nginx insertion point is specified with exact line numbers and content
- The 3 config files have slightly different upstream names and proxy headers — each is documented in the override table
- The wiki update content is provided in full
- The plan is scoped to M1 only — no M2/M3 scope creep

---

*This is an implementation plan (v1). The source spec is at `docs/superpowers/specs/2026-06-24-password-reset-abuse-detection-design.md` (v2.1). 8 tasks (0-7), 0 application code changes, 0 new tests, 0 new SMTP creds, 0 Keycloak changes, 0 frontend changes. Total commits when executed: 2 (Tasks 1, 3). Tasks 2, 4, 5, 6, 7 are operational/workflow/verification only.*
