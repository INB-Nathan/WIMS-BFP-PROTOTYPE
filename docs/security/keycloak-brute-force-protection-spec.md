# Keycloak Brute Force Protection — Implementation Spec

**Status:** Draft  
**Author:** pi-agent  
**Date:** 2026-06-23  
**Issue:** N/A (ad-hoc gap)  
**Test time:** ~15 min  
**Labels:** `security`, `suricata`, `nginx`, `keycloak`, `rate-limiting`

---

## 1. Problem

Keycloak is exposed at `/auth/` through the nginx gateway. The `/auth/` location block has **no rate limiting** at the edge (nginx) and **no Suricata detection rules** for its endpoints. While the `bfp` realm has `bruteForceProtected: true` with `failureFactor: 5`, this is reactive — traffic still reaches Keycloak before detection triggers, and there is no audit trail at the network layer.

The only existing brute-force rule (`custom.rules` SID 1000009) targets `/api/auth` (Next.js session handler), not Keycloak.

**Attack surface:** An attacker can POST to `/auth/realms/bfp/token` (password grant) or `/auth/realms/bfp/login-actions/authenticate` (form auth) at full speed until Keycloak's reactive throttling kicks in. No alert fires. No upstream rate cut is applied.

---

## 2. Scope

Three independent layers, implemented together:

| Layer | Files changed | Type |
|---|---|---|
| **A. Suricata rules** | `src/suricata/rules/custom.rules` | Detection (alert) |
| **B. Nginx rate limiting** | `src/nginx/nginx.conf` | Prevention (throttle) |
| **C. Keycloak realm hardening** | `src/keycloak/bfp-realm.json`, `src/keycloak/import/bfp-realm.json` | Prevention (reactive) |

---

## 3. Layer A — Suricata Detection Rules

### 3.1 New Rules

Add three rules to `src/suricata/rules/custom.rules` in the existing SID range `1000000-1000999`:

| SID | Message | Target | Threshold | Class |
|---|---|---|---|---|
| 1000100 | `WIMS Keycloak token brute-force` | `POST /auth/realms/bfp/token` | 10 req / 60 s per src IP | `attempted-recon` |
| 1000101 | `WIMS Keycloak login-actions brute-force` | `POST /auth/realms/bfp/login-actions/authenticate` | 10 req / 60 s per src IP | `attempted-recon` |
| 1000102 | `WIMS Keycloak admin console brute-force` | `/auth/admin/master/console/*` or `/auth/realms/master/login-actions/*` | 5 req / 60 s per src IP | `attempted-recon` |

**Rule template (for each):**

```
alert http $EXTERNAL_NET any -> $HOME_NET $HTTP_PORTS (
    msg:"WIMS Keycloak <endpoint> brute-force";
    flow:established,to_server;
    http.method; content:"POST";
    http.uri; content:"<path>"; nocase;
    detection_filter:track by_src, count <N>, seconds 60;
    classtype:attempted-recon;
    sid:10001XX;
    rev:1;
)
```

### 3.2 Rationale

- `detection_filter:track by_src` uses the source IP as the rate key — matches how nginx rate limiting works.
- Thresholds (10/60s for user-facing endpoints, 5/60s for admin console) are intentionally low to catch early probing.
- Using `$HTTP_PORTS` (port 80/443) rather than `any` avoids matching internal Docker bridge traffic.
- The rules fire `alert` only — they do not `drop` (Suricata runs in IDS mode per the af-packet config with no IPS `copy-mode`).

### 3.3 Non-goals

- No changes to `suricata.yaml` or `suricata.rules`.
- No new Celery task needed — the existing `update_suricata_rules` task runs `suricata-update --local` which already picks up `custom.rules`.

---

## 4. Layer B — Nginx Rate Limiting

### 4.1 New Rate Limit Zone

Add one `limit_req_zone` line to the existing zone block at the top of the `http` block:

```
limit_req_zone $binary_remote_addr zone=keycloak_api:10m rate=10r/s;
```

This joins the existing zones: `public_api`, `civilian_api`, `general_api`.

### 4.2 Apply to `/auth/`

Add `limit_req` and `limit_conn` to both the dev HTTP block and the production HTTPS block:

**Dev block (`listen 80; server_name localhost;`):**
```
location /auth/ {
    limit_req  zone=keycloak_api burst=20 nodelay;
    limit_conn addr 10;

    proxy_pass http://keycloak_servers/auth/;
    ...
}
```

**Production block (`listen 443 ssl; server_name wimsbfp.tech;`):**
Same `limit_req` / `limit_conn` directives added before `proxy_pass`.

### 4.3 Rationale

- `10 req/s` allows legitimate SSO traffic (redirect chains, concurrent tab loads) while blocking scripted attacks.
- `burst=20` absorbs short spikes from legitimate OIDC redirect flows.
- `nodelay` means excess requests within burst are served immediately, but requests beyond burst + rate get 429.
- `limit_conn addr 10` limits concurrent connections per IP.

### 4.4 Existing Protection Preserved

- `/api/v1/public/` remains at `10r/s` (tightest — unauthenticated zero-trust DMZ).
- `/api/civilian/` remains at `5r/s` (mid-tier).
- `/api/` remains at `30r/s` (relaxed — authenticated users).

---

## 5. Layer C — Keycloak Realm Hardening

### 5.1 Current State

Already enabled in `bfp-realm.json` (both `src/keycloak/bfp-realm.json` and `src/keycloak/import/bfp-realm.json`):

```json
"bruteForceProtected": true,
"permanentLockout": false,
"maxTemporaryLockouts": 0,
"maxFailureWaitSeconds": 900,
"minimumQuickLoginWaitSeconds": 60,
"waitIncrementSeconds": 300,
"quickLoginCheckMilliSeconds": 1000,
"maxDeltaTimeSeconds": 43200,
"failureFactor": 5,
```

### 5.2 Changes

**No change needed** — the existing settings are reasonable for a protected government system. However, document that these values exist and should be monitored:

| Setting | Current | Notes |
|---|---|---|
| `failureFactor` | 5 | Locks after 5 consecutive failures within 12h |
| `maxFailureWaitSeconds` | 900 (15 min) | Initial wait after lockout |
| `waitIncrementSeconds` | 300 (5 min) | Wait increases by 5 min per re-lockout |
| `maxDeltaTimeSeconds` | 43200 (12 h) | Failure counter resets after 12h |
| `maxTemporaryLockouts` | 0 (unlimited) | Consider setting to 20 to prevent runaway |**

### 5.3 Optional Enhancement (deferred)

Setting `maxTemporaryLockouts: 20` would cap temporary lockouts at 20 consecutive lockout cycles before the user is permanently locked (requires admin unlock). This prevents a determined attacker from keeping a user permanently locked via repeated lock/unlock cycles. Defer to follow-up if needed.

---

## 6. Test Plan

| # | Test | Layer | How |
|---|---|---|---|
| 1 | Suricata rule syntax | A | `suricata -T -c /etc/suricata/suricata.yaml -S /var/lib/suricata/rules/custom.rules` |
| 2 | Suricata rule matches | A | Simulate 11 POSTs to `/auth/realms/bfp/token` from same IP → verify `fast.log` has alert |
| 3 | Nginx rate limit active | B | `ab -n 50 -c 5 http://localhost/auth/...` → verify 429s after burst exhausted |
| 4 | Nginx config syntax | B | `nginx -t` |
| 5 | Keycloak realm imported | C | After rebuild, verify `bfp` realm shows `Brute Force Protection: ON` in admin console |
| 6 | Suricata rule reload | A | After editing `custom.rules`, verify `update_suricata_rules` Celery task picks them up |
| 7 | Alert reaches DB | A | Trigger rule match → verify row in `wims.security_threat_logs` via `ingest_suricata_eve` |

---

## 7. Implementation Order

1. **Suricata rules** — edit `custom.rules`, test with `suricata -T`
2. **Nginx rate limiting** — edit `nginx.conf`, test with `nginx -t` + `ab`
3. **Hardening doc** — confirm Keycloak realm settings (no code change)
4. **Verify** — rebuild stack, trigger rule match, confirm alert + 429 behavior

---

## 8. Open Questions

1. Should `SURICATA_INTERFACE` ever differ from the interface nginx binds to? (Currently both use `eth0` / `0.0.0.0` — same traffic.)
2. Should the Celery worker's `update_suricata_rules` task be triggered automatically after `custom.rules` changes on the shared volume, or is manual (via admin UI) sufficient?
3. Is `maxTemporaryLockouts: 20` worth including in this batch?
