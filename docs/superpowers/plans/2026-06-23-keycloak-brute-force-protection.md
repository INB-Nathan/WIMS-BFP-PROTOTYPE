# Keycloak Brute Force Protection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three layers of brute force protection for Keycloak: Suricata detection rules, nginx edge rate limiting, and verify existing Keycloak realm hardening.

**Architecture:** Two files changed — `custom.rules` (Suricata detection) and `nginx.conf` (edge rate limiting). Keycloak realm already has `bruteForceProtected: true` — confirm only. Rules are loaded via existing `suricata-update --local` pipeline. Nginx rate limit uses existing shared memory zone pattern.

**Tech Stack:** Suricata 7.0.5 (custom rules + detection_filter), nginx 1.27.3 (limit_req_zone + limit_req), Keycloak 24.0.0 (brute force detection config)

## Global Constraints

- SID range for custom rules: 1000000-1000999 (existing convention)
- Nginx limit_req_zone name must be descriptive (`keycloak_api`)
- Nginx limit_req burst=20, rate=10r/s for user-facing endpoints (per spec)
- Nginx must be reloaded (not restarted) to avoid downtime: `nginx -s reload`
- Suricata custom rules go in `custom.rules`, NOT `suricata.rules` (preserved by suricata-update --local)
- Suricata rule syntax validated with `suricata -T`
- Nginx config validated with `nginx -t`
- All three server blocks (dev HTTP, production HTTP->HTTPS redirect, production HTTPS) must get the rate limit on `/auth/`

---

### Task 1: Add Suricata Detection Rules for Keycloak Endpoints

**Files:**
- Modify: `src/suricata/rules/custom.rules` — append 3 new rules after last rule (SID 1000024)

**Interfaces:**
- Consumes: existing `detection_filter:track by_src` convention in custom.rules
- Produces: 3 new Suricata rules that fire alerts on 10+ POSTs to Keycloak endpoints within 60s
- Consumed by: `suricata-update --local` (existing Celery task), `suricata -T` (syntax validation)

- [ ] **Step 1: Read existing custom.rules to confirm last line / SID**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && bat src/suricata/rules/custom.rules | tail -20
```
Expected: Last rule is SID 1000024 (`WIMS BFP Public report spam`). File ends with newline.

- [ ] **Step 2: Append three new rules to custom.rules**

Add to the end of `src/suricata/rules/custom.rules`:

```
# ===== Keycloak Brute Force Protection =====
alert http $EXTERNAL_NET any -> $HOME_NET $HTTP_PORTS (
    msg:"WIMS Keycloak token brute-force";
    flow:established,to_server;
    http.method; content:"POST";
    http.uri; content:"/auth/realms/bfp/token"; nocase;
    detection_filter:track by_src, count 10, seconds 60;
    classtype:attempted-recon;
    sid:1000100;
    rev:1;
)

alert http $EXTERNAL_NET any -> $HOME_NET $HTTP_PORTS (
    msg:"WIMS Keycloak login-actions brute-force";
    flow:established,to_server;
    http.method; content:"POST";
    http.uri; content:"/auth/realms/bfp/login-actions/authenticate"; nocase;
    detection_filter:track by_src, count 10, seconds 60;
    classtype:attempted-recon;
    sid:1000101;
    rev:1;
)

alert http $EXTERNAL_NET any -> $HOME_NET $HTTP_PORTS (
    msg:"WIMS Keycloak admin console brute-force";
    flow:established,to_server;
    http.uri; content:"/auth/admin/"; nocase;
    detection_filter:track by_src, count 5, seconds 60;
    classtype:attempted-recon;
    sid:1000102;
    rev:1;
)
```

- [ ] **Step 3: Validate Suricata rule syntax**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && docker exec wims-suricata suricata -T -c /etc/suricata/suricata.yaml -S /var/lib/suricata/rules/custom.rules 2>&1
```
Expected: exits 0 with no syntax errors. If the container isn't running, validate locally with `suricata -T` or skip if stack is down (note in output).

- [ ] **Step 4: Commit**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && git add src/suricata/rules/custom.rules && git commit -m "feat(suricata): add Keycloak brute force detection rules

Add three Suricata rules to detect brute force attacks on Keycloak:
- SID 1000100: POST /auth/realms/bfp/token (10 req/60s)
- SID 1000101: POST /auth/realms/bfp/login-actions/authenticate (10 req/60s)
- SID 1000102: /auth/admin/ access (5 req/60s)

Part of layered Keycloak brute force protection."
```

---

### Task 2: Add Nginx Rate Limiting for /auth/ Path

**Files:**
- Modify: `src/nginx/nginx.conf`

**Interfaces:**
- Consumes: existing `limit_req_zone` block and `limit_req` / `limit_conn` directive pattern
- Produces: rate-limited `/auth/` location in all three server blocks (dev HTTP, HTTP->HTTPS redirect, HTTPS)
- Consumed by: nginx reload (docker exec or nginx -s reload), nginx -t (config validation)

- [ ] **Step 1: Read current nginx.conf to locate insertion points**

```bash
bat /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE/src/nginx/nginx.conf | head -40
```
Expected: See the `limit_req_zone` block near the top (public_api, civilian_api, general_api zones). Note the exact line where `keycloak_api` zone should be added.

- [ ] **Step 2: Add keycloak_api rate limit zone**

Insert after the `limit_req_zone  $binary_remote_addr zone=general_api:10m   rate=30r/s;` line in the `http` block:

```
    limit_req_zone  $binary_remote_addr zone=keycloak_api:10m   rate=10r/s;
```

- [ ] **Step 3: Add limit_req + limit_conn to dev HTTP server block**

In the dev server block (`listen 80; server_name localhost 127.0.0.1;`), add `limit_req` and `limit_conn` to the `location /auth/` block, right before `proxy_pass`:

```nginx
        location /auth/ {
            limit_req  zone=keycloak_api burst=20 nodelay;
            limit_conn addr 10;

            proxy_pass http://keycloak_servers/auth/;
```

- [ ] **Step 4: Add limit_req + limit_conn to production HTTPS server block**

In the TLS server block (`listen 443 ssl; server_name wimsbfp.tech;`), add the same two lines to the production `location /auth/` block, right before `proxy_pass`:

```nginx
        location /auth/ {
            limit_req  zone=keycloak_api burst=20 nodelay;
            limit_conn addr 10;

            proxy_pass http://keycloak_servers/auth/;
```

- [ ] **Step 5: Validate nginx config syntax**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && docker exec wims-nginx-gateway nginx -t 2>&1
```
Expected: `nginx: the configuration file /etc/nginx/nginx.conf syntax is ok` and `test is successful`.

If container isn't running, validate with `nginx -t` locally or note the skip.

- [ ] **Step 6: Reload nginx to apply**

```bash
docker exec wims-nginx-gateway nginx -s reload
```
Expected: no output (exit 0). Confirm with `docker exec wims-nginx-gateway ps aux | grep nginx` showing running master + worker processes.

- [ ] **Step 7: Commit**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && git add src/nginx/nginx.conf && git commit -m "feat(nginx): add rate limiting for Keycloak auth path

Add edge rate limiting for /auth/ to prevent brute force attacks
from reaching Keycloak. Zone set to 10r/s with burst=20.
Applies to both dev (HTTP) and production (HTTPS) server blocks.

Part of layered Keycloak brute force protection."
```

---

### Task 3: Verify Keycloak Realm Brute Force Configuration

**Files:**
- Read-only: `src/keycloak/bfp-realm.json`, `src/keycloak/import/bfp-realm.json`

**Interfaces:**
- Consumes: existing realm JSON files
- Produces: documented confirmation of existing configuration

- [ ] **Step 1: Confirm brute force settings in both realm JSON files**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && rg -A 10 '"bruteForceProtected"' src/keycloak/bfp-realm.json && echo "---IMPORT---" && rg -A 10 '"bruteForceProtected"' src/keycloak/import/bfp-realm.json
```

Expected: Both files show identical settings:
- `"bruteForceProtected": true`
- `"failureFactor": 5`
- `"maxFailureWaitSeconds": 900`
- `"waitIncrementSeconds": 300`
- `"maxDeltaTimeSeconds": 43200`
- `"maxTemporaryLockouts": 0`
- `"permanentLockout": false`

- [ ] **Step 2: Log confirmation (no code change needed)**

Layer C is already configured. No files changed. Note in commit message that configuration was verified.

- [ ] **Step 3: Commit**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && git commit --allow-empty -m "chore(keycloak): verify existing brute force protection config

Keycloak bfp realm already has bruteForceProtected: true with
failureFactor: 5, 15-min initial lockout, 5-min increment, 12h window.
No changes needed.

Part of layered Keycloak brute force protection."
```

---

### Task 4: Integration Verification

**Files:** None modified. Run verification commands.

- [ ] **Step 1: Stack is running — confirm all three services healthy**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && docker ps --format 'table {{.Names}}\t{{.Status}}' | grep -E 'wims-(suricata|nginx-gateway|keycloak)'
```

Expected: All three show `Up` or `healthy`.

- [ ] **Step 2: Confirm suricata-update picks up new custom rules**

```bash
docker exec wims-suricata suricata-update --local /var/lib/suricata/rules/custom.rules 2>&1
```

Expected: exits 0, mentions merging local rules. Then check rule count:
```bash
docker exec wims-suricata suricata --dump-stats 2>&1 | grep rules_loaded
```
Expected: count shows rules including the 3 new ones (check before/after if possible).

- [ ] **Step 3: Confirm nginx rate limit is live**

```bash
# Send 50 requests quickly — should get 429s after burst consumed
docker run --rm --net wims_internal alpine/bombardier -c 5 -n 50 -l http://nginx-gateway/auth/realms/bfp/token 2>&1 | tail -10
```

Expected: Some responses are `429` (Too Many Requests). If bombardier isn't available, use `ab` or `curl` with a rapid loop:
```bash
for i in $(seq 1 50); do curl -s -o /dev/null -w "%{http_code}\n" http://localhost/auth/realms/bfp/token; done | sort | uniq -c
```
Expected: mix of 200 and 429 responses (first ~20 OK, rest 429 after burst consumed).

- [ ] **Step 4: Verify nginx 429s don't affect other API routes**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost/api/health
```
Expected: 200 — general API still works.

- [ ] **Step 5: Final commit if any fix-ups needed**

```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && git add -A && git commit -m "chore: verification of Keycloak brute force protection layers"
```

---

### Before Final Response Checklist

- [ ] All 3 SIDs (1000100-1000102) present in `custom.rules` and syntactically valid
- [ ] `limit_req_zone` for `keycloak_api` present in `nginx.conf`
- [ ] `limit_req` + `limit_conn` applied in all 3 server blocks' `/auth/` locations
- [ ] Keycloak realm brute force settings confirmed (no code change)
- [ ] `git status` clean (no stray files)
- [ ] `system-wiki/log.md` updated with a log entry for this change
- [ ] If FRS alignment changed, `system-wiki/gaps/frs-codebase-gap-register.md` updated
