---
title: Security Baseline
created: 2026-05-14
updated: 2026-06-22
type: security
tags: [wims-bfp, security, auth, rbac, rls, audit-log, ids, xai, privacy, fail-closed]
sources: [raw/frs/frs-auth.md, raw/frs/frs-complianceanddataprivacy.md, raw/frs/frs-intrusiondetectionandnetworkingmonitoring.md, raw/frs/frs-threatdetectionwithexplainableai.md, raw/codebase/codebase-snapshot-2026-05-14.md, src/keycloak/demo-otp-provider, src/keycloak/bfp-realm.json, src/keycloak/import/bfp-realm.json]
status: draft
---

# Security Baseline

## Auth and RBAC
FRS Module 1 defines Keycloak-backed authentication, MFA for privileged roles, session timeout, password policy, and role-based access control. Relevant implementation surfaces: `admin.py`, `sessions.py`, `user.py`, frontend auth API routes, and Keycloak config.

Development Keycloak realm config in `src/keycloak/bfp-realm.json` enables the built-in `reset credentials` flow, `resetPasswordAllowed`, and MailHog SMTP defaults (`mailhog:1025`, `noreply@wims-bfp.local`) for local forgot-password testing. `src/docker-compose.yml` includes a MailHog service exposing SMTP on `1025` and the web/API UI on `8025`.

Temporary demo MFA shortcut (2026-06-11): browser OTP login uses `wims-demo-otp-form`, a custom Keycloak provider in `src/keycloak/demo-otp-provider` that accepts normal OTP codes and also accepts fixed code `123123` for accounts that reach the OTP step. This is presentation-only, logs `wims_demo_otp_bypass=true` on the Keycloak event, does not alter Direct Grant OTP, and must be removed before PR using `docs/agents/remove-demo-otp-bypass.md`.

### SKIP_MFA Role (2026-06-14)
A deliberate per-user MFA exemption via the `SKIP_MFA` realm role (`bfp-realm.json` → `roles.realm[]`). Users assigned this role bypass only the OTP sub-flow during browser login; all other accounts must still complete MFA.

**How it works:**
- Realm role `SKIP_MFA` with description "Exempts user from TOTP/OTP multi-factor authentication requirements".
- Authenticator config `otp-skip-mfa` checks `condUserRole=SKIP_MFA` (negate=false) using the `conditional-user-role` authenticator.
- In the `forms` authentication flow, the `conditional-user-role` step runs as an ALTERNATIVE at priority 20, before the existing `Browser - Conditional OTP` sub-flow (now ALTERNATIVE at priority 30).
- If the user has `SKIP_MFA`, the conditional-user-role check succeeds and the ALTERNATIVE chain is satisfied → OTP sub-flow never executes.
- If the user does NOT have `SKIP_MFA`, the conditional-user-role check is silently skipped and execution proceeds to `Browser - Conditional OTP` as before.
- The Direct Grant flow is unchanged — this exemption applies only to browser login.

**Seeded users with SKIP_MFA:** `validator_test`, `n-val`, `g-val`, `e-val`, `r-val` (all NATIONAL_VALIDATOR accounts).

**Config files:** `src/keycloak/import/bfp-realm.json` (source of truth) and `src/keycloak/bfp-realm.json` (sync copy) — both updated.

Self-service profile email edits (`PATCH /api/user/me`) treat email as a login identity: direct email changes via this endpoint are now blocked (400) with guidance redirecting users to the dedicated two-step verification flow (`POST /api/auth/change-email` → `POST /api/auth/verify-email`). Name/contact-only profile updates remain JWT-authenticated.

**Email verification flow (2026-06-17, #225):** Users initiate an email change via `POST /api/auth/change-email` (password verified against Keycloak's Direct Grant with optional TOTP support), a 6-digit cryptographically-random code is stored in Redis with 10-minute TTL, and a verification email is sent. The user then confirms via `POST /api/auth/verify-email`. On success the email is updated in both Keycloak and `wims.users`. Both endpoints have per-user Redis-based rate limiting (3 requests/10 min for change-email, 5 requests/10 min for verify-email) to deter brute-force and email bombing. Keycloak remains configured with `verifyEmail: false` in the development realm (the custom flow replaces built-in verification).

### Keycloak EventListener SPI — RP-08 + RP-18 (WS-B, 2026-06-25)

Closes the non-repudiation gap where true credential rejections and Keycloak-native password resets were never visible in `wims.system_audit_trails`.

**Root cause:** The WIMS login page calls `signinRedirect()` directly to Keycloak. Failed logins and password resets happen entirely on Keycloak-hosted pages and never reach any WIMS route. The existing `POST /api/auth/security-event` endpoint (used for LOGOUT and for the rare post-OIDC-callback sync failure) is never called for these events.

**Fix:** `src/keycloak/wims-audit-event-listener/` — a new Keycloak `EventListenerProvider` SPI that:
- Filters `LOGIN`, `LOGIN_ERROR`, `USER_DISABLED_BY_BRUTE_FORCE`, `UPDATE_PASSWORD`, `SEND_RESET_PASSWORD` (LOGOUT is excluded — WS-A/frontend handles it to avoid duplicate rows). `LOGIN` was added in the AuditMoreGapsFix branch (RP-07) so all roles' successful logins are audited, not just REGIONAL_ENCODER.
- POSTs `{event_type, username, error, keycloak_event_id}` to `http://backend:8000/api/auth/keycloak-event` with `Authorization: Bearer $WIMS_KEYCLOAK_EVENT_SECRET`.
- Swallows all HTTP failures — audit ingest failure must never break a login.

**Backend ingest endpoint:** `POST /api/auth/keycloak-event` in `src/backend/api/routes/security_events.py`.
- **Fail-closed:** `_KC_SECRET = os.environ.get("WIMS_KEYCLOAK_EVENT_SECRET", "")` read at import. Blank → 401 on every request (never `os.environ["..."]` which would crash import on missing key).
- **Mapping:** `LOGIN` → `USER_LOGIN` / `success`; `LOGIN_ERROR` / `USER_DISABLED_BY_PERMANENT_LOCKOUT` → `FAILED_LOGIN` / `failure`; `UPDATE_PASSWORD` / `SEND_RESET_PASSWORD` → `PASSWORD_RESET` / `success`. Unknown event_type → 422.
- **user_id always NULL:** no Keycloak → `wims.users` lookup to prevent account-existence leakage.
- Writes one `wims.system_audit_trails` row via `log_system_audit(db, None, action_type, "wims.auth", None, request, new_values={username, error, source:"keycloak_spi", keycloak_event_id}, result=...)`.

**Registration:** `eventsListeners` array in both `src/keycloak/bfp-realm.json` and `src/keycloak/import/bfp-realm.json` includes `"wims-audit-event-listener"`.

**Build:** Single Maven build stage in `src/keycloak/Dockerfile` builds `demo-otp-provider` and `wims-audit-event-listener` sequentially to share the Maven dependency cache. Both JARs copied to `/opt/keycloak/providers/` before `kc.sh build`.

**Env vars:**

| Variable | Service | Value |
|---|---|---|
| `WIMS_AUDIT_INGEST_URL` | keycloak | `http://backend:8000/api/auth/keycloak-event` |
| `WIMS_KEYCLOAK_EVENT_SECRET` | keycloak + backend | shared Bearer token (generate with `openssl rand -hex 32`) |

**Deploy note:** `WIMS_KEYCLOAK_EVENT_SECRET` must be set on the VPS (both `keycloak` and `backend` services) **before** the new Keycloak image rolls out. SPI fails open if the secret is unset on Keycloak (logs warning, skips push). Backend fails closed if unset (401 every request — no false audit rows accepted).

**Tests:** `src/backend/tests/test_security_events.py` (7 unit tests, no Docker required): missing header → 401, wrong secret → 401, unset backend secret → 401 (fail-closed), valid secret + LOGIN_ERROR → 202 (FAILED_LOGIN/failure), unknown event → 422, four event-type round-trip, user_id always None. Integration assertion added to `test_keycloak_password_reset.py::TestForgotPasswordConfiguration`.

## Fail-Closed Rule
Any missing authentication context defaults to deny. Public unauthenticated behavior is limited to explicit public routes; all adjacent APIs should require valid role context.

### Public Abuse Controls (2026-06-20, PR #428)
Implements D18 (Public abuse controls), D5 (Public audit logging), and D6 (Redis fail-open policy) for all Tier-0 public/no-auth endpoints:

- **Redis sliding-window throttles** (fail-closed per D6): All public write endpoints rate-limited per-IP via atomic Lua-script ZSET with Retry-After header. Consent (5/IP/hr), public DMZ (3/IP/hr), notification registration (5/IP/hr). Redis down → 503 (not allow-through).
- **Neutral 404 responses**: All public /{id} GET/POST/PATCH endpoints return identical "Not found" for missing vs. wrong-owner to prevent report existence leakage.
- **Notification spam limits**: Max 10 FCM tokens per report; 5 registrations per IP per hour.
- **Privacy-preserving audit logging**: Public endpoints use the shared `log_system_audit(..., user_id=None, action_type="PUBLIC_INCIDENT_SUBMIT", table_affected="wims.fire_incidents", record_id=..., ip_hash=hash_client_ip(get_client_ip(request)), sensitive=True)` from `utils.audit`. The IP is salted-hashed via the `WIMS_AUDIT_IP_SALT` env var (env-var rotation, no Redis dependency). The `sensitive=True` flag keeps the audit INSERT in the same transaction as the fire_incidents INSERT, so audit failures roll back the incident write (D20 fail-closed). One audit row per public submission, written in the same transaction.
- Shared helpers in `utils/public_abuse.py`: `rate_limit_public()` (Redis sliding-window ZSET Lua throttle, fail-closed) and `neutral_404()` (consistent 404 shape for public /{id} routes). IP extraction (`get_client_ip`) and IP hashing (`hash_client_ip`) are reused from `utils.audit` to keep a single salt strategy across the codebase.

## RLS and Data Privacy
FRS Module 10 requires minimization, purpose limitation, rectification/erasure handling, breach notification, DPIA, and RoPA. Database enforcement must be verified in `src/postgres-init/09_rls_helpers.sql`, `10_rls_policies.sql`, and route dependencies.

## Audit and Immutability
FRS Module 4 requires SHA-256 data hashes, append-only audit logs, and immutable commit records. Verification/correction workflow remains a high-risk area; see [[gaps/frs-codebase-gap-register]].

- `17_immutable_records.sql` now includes `no_delete_audit` and `no_update_audit` RULEs on `wims.system_audit_trails` (GH #240) — DELETE and UPDATE silently no-op at DB level for full audit trail immutability. (Future migrations that need to UPDATE/DELETE rows must temporarily drop these rules.)
- `wims.system_audit_trails` now has `old_values` and `new_values` JSONB columns (GH #242, migration `60_audit_forensics_columns.sql`) for forensic completeness per ASVS V7.3.1.
- `log_system_audit()` accepts optional `old_values`/`new_values` params; UPDATE call sites in `users.py` and `config.py` populate them. Non-JSON-serializable types (UUID, datetime, Decimal) are safely coerced via `default=str`.

### Direct-Insert Detection (RP-20, 2026-06-25)

`wims.fire_incidents` is now guarded against undetected out-of-band INSERTs:

- **Trigger:** `trg_detect_direct_fire_incident_insert` (AFTER INSERT, SECURITY DEFINER) on `wims.fire_incidents` — deployed via `63_fire_incidents_insert_audit_trigger.sql` and applied on every restart by `apply_schema_patches()`.
- **GUC guard:** Every application session (`get_db()`, `get_db_with_rls()`, Suricata ingestion paths) executes `SET LOCAL app.audit_source = 'app'` at the start of its transaction. The trigger checks `current_setting('app.audit_source', true)`; if `'app'`, it returns immediately. If absent or any other value, the trigger inserts a `DIRECT_DB_INSERT` row into `wims.system_audit_trails` with `record_id = NEW.incident_id` and `new_values = {incident_id, region_id}` (IDs only — no PII).
- **`SECURITY DEFINER` + `SET search_path`:** The function runs as its definer (postgres), bypassing RLS on `system_audit_trails` so the audit INSERT always succeeds regardless of which role performed the direct INSERT. `SET search_path = wims, pg_catalog` prevents search_path injection.
- **Action type `DIRECT_DB_INSERT` is visible** on the `/admin/audit` page with all standard filters.

## IDS/XAI
FRS Modules 7 and 8 define Suricata network monitoring and Qwen2.5-3B explainability. Relevant code/config: `src/suricata/`, admin security-log routes, and AI service paths. Real-time security event push via SSE (`GET /api/events/stream`) notifies SYSTEM_ADMIN clients of threat detection, AI analysis completion, and HITL confirmations.

### XAI Prompt Completeness (2026-06-23)
`analyze_threat_log()` in `src/backend/services/ai_service.py` now includes `suricata_signature` and `classification` in the Ollama prompt (added between `SID=` and `payload=`). Custom WIMS SIDs 1000001-1000134 are NOT in any public Suricata feed, so the bare SID is opaque to Ollama — the human-readable signature (e.g. "WIMS OWASP A03 SQLi UNION SELECT") tells the LLM the attack type, and the classification (e.g. "high_signal_threat") tells the threat model. Without these, the LLM could only guess from the raw payload, producing generic narratives that failed the user's goal: XAI must tell humans **what the attack is and what to do for future purposes**. Regression test: `test_analyze_threat_log_prompt_includes_signature_and_classification` in `tests/integration/test_ai_ids_api.py` (captures the Ollama request body via `respx` and asserts both fields are present in the prompt).

### Network Topology (M7a)

Suricata runs with `network_mode: "host"` — directly attached to the host's network stack.
This allows it to sniff all ingress traffic arriving at the VPS public IP through nginx
(ports 80/443). Port 80 yields cleartext HTTP (requests, auth attempts, file uploads);
port 443 yields only TLS handshake metadata (SNI, cipher suite) since nginx terminates TLS internally.
Previously Suricata was limited to the `wims_internal` Docker bridge (inter-container
traffic and mDNS); sniffing only `eth0` does not include Docker-bridge traffic
(e.g., backend ↔ Postgres). Host network mode requires `cap_add: [NET_ADMIN, NET_RAW]` for
promiscuous capture. AF_PACKET zero-copy capture (`--af-packet=${SURICATA_INTERFACE:-eth0}`) with workers runmode
replaces the previous pcap mode for higher throughput and lower CPU overhead.

**Note:** Host network mode only functions on Linux (VPS). Docker Desktop on Windows/Mac
does not expose host traffic to containers in host network mode.

### Suricata Detection Rules (M7b)

All rules combined in `src/suricata/rules/suricata.rules` (~136k lines). Loaded via the base image's
default `rule-files` configuration — no custom suricata.yaml override needed.

| Tier | Source | SID Range | Lines | Update Cadence |
|---|---|---|---|---|
| 1 | ET Open (full ruleset) | 2000000+ | ~68k | Weekly via suricata-update (Sun 03:00 UTC) |
| 2 | OWASP Top 10 + SQLi/XSS body + URI evasion | 1000001–1000010, 1000103–1000114 | 22 | Manual, committed to repo |
| 3 | BFP-specific | 1000020–1000024 | 5 | Manual, committed to repo |
| 4 | Keycloak brute force | 1000100–1000102 | 3 | Manual, committed to repo |
| 5 | Privilege escalation + rate-limit abuse | 1000115–1000121 | 7 | Manual, committed to repo |
| 6 | Recon + SSRF + method tamper + redirect + CRLF | 1000122–1000134 | 13 | Manual, committed to repo |

Weekly update: Celery beat task `update-suricata-rules-weekly` (Sunday 03:00 UTC) executes
`suricata-update` inside the Suricata container via Docker SDK, sends `kill -USR2` for
live rule reload. Rules before/after counts logged and compared for regressions.
Docker socket mounted in celery-worker for container exec access.

### Nginx Edge Rate Limiting for Keycloak (2026-06-23)

The `/auth/` path (proxied to Keycloak) now has edge rate limiting via nginx:
- Zone `keycloak_api`: 10 req/s per IP (`$binary_remote_addr`), 10 MB shared memory
- `limit_req zone=keycloak_api burst=20 nodelay` — allows short spikes, then 429
- `limit_conn addr 10` — max 10 concurrent connections per IP
- Applied in both dev HTTP (`listen 80; server_name localhost`) and production HTTPS
  (`listen 443 ssl; server_name wimsbfp.tech`) server blocks.
- Previously `/auth/` was the only API location without rate limiting — the existing
  `public_api` (10r/s), `civilian_api` (5r/s), and `general_api` (30r/s) zones
  covered backend and frontend paths only.

### Password-Reset Rate Limit (2026-06-24)

A dedicated `reset_credentials` zone protects the Keycloak password-reset endpoint
from single-IP abuse without degrading login/admin-console traffic:
- **Map:** `$reset_post_only` evaluates to `$realip_remote_addr` for POST requests
  and `""` (empty) for GET/other methods. An empty zone key is not counted by nginx,
  so the reset form page loads freely; only POST submissions consume tokens.
- **Zone:** `reset_credentials:10m` at `1r/m` — a legitimate user submits once and
  never hits the limit; a single-IP attacker can send at most 60 POSTs/hour.
- **Burst:** `burst=2 nodelay` — tolerates the rare double-submit without 429.
- **Connections:** `limit_conn addr 10` — same per-IP connection limit as the
  shared `/auth/` block.
- **Location:** `= /auth/realms/bfp/login-actions/reset-credentials` — exact-match
  takes precedence over the prefix `location /auth/`, returning 429 before the
  shared rate limiter is checked.
- **Configs:** `nginx.conf` (2 server blocks), `nginx.ci.conf` (1), `nginx.local.conf` (2).
  Each block copies `proxy_set_header` lines from the adjacent `/auth/` block to
  preserve per-config upstream names and XFF behaviour.

### POST Body SQLi/XSS Detection Rules (2026-06-23)

Extended custom Suricata rules to inspect `http.request_body` — previously all
SQLi/XSS rules scanned `http.uri` only, missing POST body payloads:

| SID | Message | Buffer | Pattern |
|---|---|---|---|
| 1000103 | SQLi body OR boolean | request_body | `' OR` / URL-encoded variants |
| 1000104 | SQLi body UNION SELECT | request_body | `union` + `select` within 100 bytes |
| 1000105 | SQLi body comment bypass | request_body | `x/*...*/` inline comment injection |
| 1000106 | SQLi body DB functions | request_body | `xp_cmdshell`, `pg_sleep`, `WAITFOR DELAY`, benchmark |
| 1000107 | SQLi body tautology | request_body | `1=1`, `'a'='a'` in operator context |
| 1000108 | XSS body script tag | request_body | `<script` |
| 1000109 | XSS body event handler | request_body | `on\w+=` event handler assignment |
| 1000110 | XSS body img onerror | request_body | `<img` + `onerror` within 500 bytes |
| 1000111 | XSS body javascript URI | request_body | `javascript:` URI scheme |
| 1000112 | SQLi URI comment bypass | uri | `x/*...*/` inline comment injection (URI) |
| 1000113 | SQLi URI stacked query | uri | `; DROP/DELETE/EXEC/TRUNCATE/...` |
| 1000114 | SQLi URI encoded chars | uri | `%27` `%3D` `%3B` `%22` `%60` `--` (URL-encoded SQL chars) |

### Privilege Escalation Detection (2026-06-23)

Flowbit-based rules that pair a `to_server` noalert rule (sets a flowbit when a
privileged URI is requested) with a `from_server` alert rule (fires when the same
flow returns HTTP 403). This detects a non-privileged user requesting a
privileged endpoint and being denied — a privilege escalation probe.

Three privilege tiers monitored:

| SID | Category | URI Pattern | Threshold | Alert Type |
|---|---|---|---|---|
| 1000115 (noalert) | Admin system | `/api/admin` | — | flowbit:set,priv_admin |
| 1000116 | Admin escalation | `/api/admin` → 403 | 5 hits / 60s | attempted-recon |
| 1000117 (noalert) | Validator | `/api/validator` | — | flowbit:set,priv_validator |
| 1000118 | Validator escalation | `/api/validator` → 403 | 10 hits / 60s | attempted-recon |
| 1000119 (noalert) | National Analyst | `/api/incidents/analyst` | — | flowbit:set,priv_analyst |
| 1000120 | Analyst escalation | `/api/incidents/analyst` → 403 | 10 hits / 60s | attempted-recon |

**What this detects:** Systematic cross-role endpoint probing that a legitimate
user would not exhibit. A single HTTP 403 from a mistyped URL is ignored;
5+ admin 403s in 60s triggers an alert.

**What this cannot detect:** IDOR (same URI, different IDs); JWT token
tampering; business-logic privilege escalation (e.g., workflow skips).
These require application-layer detection.

### Rate-Limit Violation Detection (2026-06-23)

A `from_server` rule fires when the same source IP accumulates 20+ HTTP 429
(Too Many Requests) responses within 300 seconds across any endpoint.

| SID | Message | Buffer | Threshold |
|---|---|---|---|
| 1000121 | RATE-LIMIT violation 429 burst | http.response_line `429` | 20 hits / 300s |

**Why this is useful despite nginx already rate-limiting:** The nginx `limit_req`
zones block excess requests at the edge, but Suricata provides alerting
visibility that rate-limit abuse IS happening against a specific IP. When
correlated with other alerts (SQLi, brute force, scanner UA), this confirms
ongoing attack activity at the incident response layer.

### Recon & Exploitation Gap Rules (2026-06-23)

13 rules covering attack categories that previously had zero custom detection,
all at `rev:2` after the post-implementation FP/bypass review pass.

**Directory brute-forcing (SIDs 1000122-1000124, `rev:2`):**
- 1000122: Sensitive dotfile probe (`/.env`, `/.git`, `/.svn`, `/.htaccess`)
- 1000123: Sensitive path probe (`/backup`, `/swagger`, `/openapi`, `/actuator`,
  `/api/configuration` — `docs`/`redoc`/`config` removed because they are
  legitimate FastAPI endpoints in this app)
- 1000124: 404 enumeration burst — 20+ 404 responses from same destination IP
  in 60s (uses `track by_dst` to track the client, not the server)

**SSRF (SIDs 1000125-1000128, `rev:2`):**
- 1000125/1000127: Internal target SSRF in URI/body. Covers IPv4 (`127.0.0.1`,
  `127.1`, `0x7f000001`, `2130706433`, `0.0.0.0`, octal `0177.0.0.1`), IPv6
  (`[::1]`, `[::ffff:127.0.0.1]`), cloud metadata (`169.254.169.254` AWS,
  `169.254.170.2` AWS ECS, `100.100.100.200` Alibaba, `fd00:ec2::254` AWS IMDSv6,
  `metadata.google.internal` GCP), plus `localhost` keyword.
- 1000126/1000128: Dangerous URL schemes (`file://`, `gopher://`, `dict://`,
  `ldap://`, `sftp://`, `expect://`) with both literal `:` and URL-encoded
  `%3a`/`%3A` colon variants.

**HTTP method tampering (SIDs 1000129-1000130, `rev:2`):**
- 1000129: TRACE method (XST attack vector) — `nocase` to catch `Trace`/`trace`/etc.
- 1000130: CONNECT method (proxy tunneling abuse) — `nocase`.

**Open redirect (SIDs 1000131-1000132, `rev:2`):**
- 1000131: Protocol-relative redirect in 9 redirect-param names — matches
  `//`, `%2f%2f`, `\\` (IE/Edge), `%5c%5c` (URL-encoded backslash).
- 1000132: External URL redirect in 9 redirect-param names (excluding
  `redirect` to avoid OIDC `redirect_uri` FP) with `detection_filter:track by_src,
  count 5, seconds 60` so single OAuth bounces don't alert.

**CRLF injection (SIDs 1000133-1000134, `rev:2`):**
- 1000133: CRLF sequences in URI — anchored to header injection pattern
  (`Set-Cookie|Location|Content-Type|HTTP/`) to avoid FP on legitimate base64 /
  multi-line data in query params.
- 1000134: CRLF + header injection in body — same pattern in `http.request_body`.

**Cross-cutting fix applied (Commit A `a4868446`):** All 5 `from_server` rules
with `detection_filter` were migrated from `track by_src` to `track by_dst`.
In Suricata, `by_src` on `from_server` tracks the server's IP (the packet's
source), not the attacker's. The previous code aggregated all attackers into
one bucket per server IP, making the rules effectively server-wide flood
detectors rather than per-attacker detection. Affected SIDs: 1000116, 1000118,
1000120, 1000121 (pre-existing PRIVESC/RATE-LIMIT rules), 1000124 (new 404
burst).

**Known limitations (documented, not addressed by rules):**
- CORS probing: requires cross-flow header correlation, complex with Suricata flowbits.
- SMTP injection: MailHog bound to `127.0.0.1:1025`, not externally accessible.
- HTTP/2 fingerprinting: very low value for prototype, requires JA3/JA4 config.
- Production HTTPS blindness (port 443): Suricata in host mode sees only TLS
  ciphertext on 443. All HTTP-level rules in this file are dev-only (port 80) or
  only see TLS handshake metadata in production. Fixing requires SSL key
  disclosure, Docker bridge port mirroring, or inline IPS mode — all
  architectural changes beyond rule additions.
- Post-auth business logic abuse (IDOR, workflow skip, bulk approve):
  inherently undetectable at network layer. Same URI, same headers, valid JWT.
  Requires application-layer anomaly detection.
- URL-encoded dotfile bypass (`%2e` variant) on 1000122-1000123: deferred, low
  signal in this stack (libhtp does single-decode so most variants decode to
  the matched form).
- 1000134 header list is narrow (Set-Cookie, Location, Content-Type, HTTP/):
  deferred; an exhaustive list requires per-app response-building knowledge.
- base64-encoded SSRF (e.g. `url=aHR0cDovLzE2OS4yNTQuMTY5LjI1NA==`):
  architectural limit — Suricata cannot base64-decode inside pcre.

### Keycloak Realm Brute Force Detection (2026-06-23, verified)

The `bfp` realm already has Keycloak's built-in brute force detection enabled
(no code change needed for this implementation):
- `bruteForceProtected: true`
- `failureFactor: 5` — locks after 5 consecutive failures within 12h
- `maxFailureWaitSeconds: 900` — initial 15-min wait
- `waitIncrementSeconds: 300` — +5 min per re-lockout cycle
- `maxDeltaTimeSeconds: 43200` — failure counter resets after 12h idle
- `maxTemporaryLockouts: 0` — unlimited temporary lockouts (deferred: consider 20)
- `permanentLockout: false`

Config: `src/keycloak/bfp-realm.json` + `src/keycloak/import/bfp-realm.json`

## IP Blocklist + Repeat-Offender Escalation (2026-06-22)

FRS does not specify an IP blocklist (genuine product gap — see `frs-codebase-gap-register.md`), but the System Admin needs an enforcement lever when the XAI narrative identifies a repeat attacker. **App-layer block only** — this is NOT a volumetric DoS shield. A blocked IP is denied by the FastAPI middleware (403) after it has already passed through nginx and consumed a worker for the 403 response. Real volumetric shielding (nginx `deny` / iptables / WAF) is intentionally out of scope for a prototype on a live VPS.

**Architecture:**
- **Postgres** = durable write-path. New `wims.ip_blocklist` table (migration `65_ip_blocklist.sql`): `block_id, source_ip, blocked_at, expires_at, is_permanent, blocked_by, block_reason, threat_log_id, is_active`. RLS policy `ip_blocklist_admin_all` (SYSTEM_ADMIN-only, uses `wims.current_user_role()`). Indexes: `idx_ip_blocklist_source_ip`, partial index on `is_active=true`.
- **Redis** = hot-path source of truth. Key scheme: `ip:block:{ip}` (one key per blocked IP). Block: `SET ip:block:{ip} "1" EX {ttl_seconds}` (24h = 86400). Permanent: `SET ip:block:{ip} "1"` (no `EX` — lives until explicit `DEL`). Middleware does `EXISTS f"ip:block:{client_ip}"` only — **zero Postgres queries in the request path**. Native Redis TTL self-expires, no Celery sweep needed for expiry. Boot resync (`BlockedIPMiddleware` startup hook) + Celery beat every 5 min (`tasks.ip_blocklist.resync_ip_blocklist`) cover Redis data loss / restart / drift. Best-effort Redis writes AFTER Postgres commit.
- **`BlockedIPMiddleware`** (`src/backend/main.py`): Health exempt (`/health`, `/api/v1/public/health`). Fail-open if Redis down (matches `main.py:765-767` rate-limiter pattern). Returns 403 JSON `{detail: "IP blocked by admin action"}`.

**Security properties (verified against 2 SOTA-model reviews, 12 revisions adopted):**
- **X-Real-IP first, never parse X-Forwarded-For leftmost.** Nginx sets `X-Real-IP` to `$remote_addr` (after realip module) in all configs (`nginx.conf`, `nginx.local.conf`, `nginx.ci.conf`) — not client-appendable. Prod (`nginx.conf`) overwrites XFF with `$remote_addr`; local/CI appends via `$proxy_add_x_forwarded_for` (client-spoofable leftmost). The blocklist helper (`_get_request_client_ip` in `services/ip_blocklist.py`) reads `X-Real-IP` first, falls back to `request.client.host`. **Note:** the existing rate limiter (`main.py:771`) still parses XFF leftmost — same latent spoofing bug, out of scope for this feature.
- **Self-IP guard** on all block endpoints (`block-source-ip`, `block-by-filter`, `bulk-action block_ip`): refuses with 400 if `source_ip == requester_ip`. Prevents self-lockout.
- **Critical-IP allowlist** (`ip_blocklist.allowlist` in `system_config`, default `127.0.0.1,::1`): IPs/CIDRs that must never be blocked. Checked by `BlockedIPMiddleware` AND all block endpoints. Protects other admins, uptime monitors, VPS egress, health-checkers. **Important for NAT/CGNAT-heavy PH mobile user bases** where one public IP can represent many users.
- **Already-active no-op:** if an active block exists for an IP, the `block_ip` service returns `{already_active: true}` without INSERT, count increment, or audit. Prevents double-click/filter-duplicate false escalation toward permanent.
- **Repeat-offender escalation** (configurable, default threshold 3 from `ip_blocklist.repeat_offender_threshold`): `block_count` is DERIVED via `SELECT COUNT(*) FROM ip_blocklist WHERE source_ip = :ip` (no stored column). On the Nth block where `count >= threshold`, the new row is `is_permanent=true, expires_at=NULL`. Each block is a separate row; an unblock separates episodes. **Removes the stored `block_count` column** to avoid two sources of truth.
- **24h TTL default**, permanent only via repeat-offender or manual "permanent" toggle. Unblock always available from the panel.
- **500-IP hard cap** on `block-by-filter` execute (504 fix at 25k scale). Dry-run preview returns full counts including the cap warning; UI shows it before confirm.
- **RLS context**: all service functions take `db` from `get_db_with_rls` (RLS GUC set; required for the `WITH CHECK` policy). Never create a standalone session for blocklist writes.
- **Soft-delete** for threat alerts (no hard delete) — avoids FK violations on `34_security_incident` + `52_breach_notifications`. `DELETE /security-logs/{id}` + bulk `dismiss` share one `dismiss_security_log` helper.
- **Audit-logged** end-to-end (`log_system_audit` with `action_type=BLOCK_SOURCE_IP|UNBLOCK_IP|BLOCK_BY_FILTER|BULK_SECURITY_ACTION|DELETE_SECURITY_LOG`).
- **Fail-open** on Redis down (rate limiter + blocklist middleware both fail open — `main.py:765-767` pattern).
- **Classification filter dropped** from `block-by-filter`: the `classification` column from migration `62_security_threat_classification.sql` never applied to the running DB (same first-init-only problem as `65_ip_blocklist.sql`). The `SecurityLogFilter.classification?` field is in the API contract but ignored server-side until migration 62 is applied. Restore note left in `services/ip_blocklist.py:block_ips_by_filter`.
- **Pre-existing XFF bug in rate limiter** (`main.py:771`) noted but not fixed (out of scope for this feature).

**Frontend (admin/monitoring only, system/page.tsx untouched):** 4 per-row action groups (HITL verdict / Block Source IP / Create Incident / Delete Alert), bulk bar, S3 filter-scoped block with 500-IP cap preview, Blocked IPs panel with repeat-offender "Confirmed Attacker" badge (red 4px left accent), confirm dialogs with pre-commit preview (HCI: count + cap warning + repeat-offender breakdown before destructive execute).

**Endpoints (6 new):** `POST /api/admin/security-logs/{id}/block-source-ip`, `POST /api/admin/security-logs/block-by-filter?preview=true`, `POST /api/admin/security-logs/bulk-action`, `DELETE /api/admin/security-logs/{id}`, `DELETE /api/admin/ip-blocklist/{ip}`, `GET /api/admin/ip-blocklist`. All SYSTEM_ADMIN-only.

**Spec:** `docs/superpowers/specs/2026-06-22-monitoring-threat-actions-design.md`. **Plan:** `docs/superpowers/plans/2026-06-22-monitoring-threat-actions.md`.

## Real-Time Notifications (SSE)
FRS Module 13 defines a notification system. The SSE event stream (`GET /api/events/stream`) provides real-time push via Redis pub/sub. Channels: `incident` (status changes/corrections), `verification` (triage cluster workflow), `security` (threat/HITL events), `system` (maintenance). Role-based channel authorization enforced at connect time. Publishers injected at: `verify_incident`, `update_incident`, `correct_verified_incident`, `claim_cluster_command`, `apply_terminal_action_command`, `ingest_eve_file` (Suricata), `analyze_threat_log` (AI), and `update_security_log` (HITL). Frontend consumer hook: `useEventStream.ts`. Nginx configured with `proxy_buffering off` for the SSE location block.

## Behavioral Anomaly Detection (M8)
`src/backend/tasks/anomaly_detection.py` — Celery beat task (60s) running six detectors against `wims.system_audit_trails`:

| Detector | Threshold | Severity | Window | Anomaly Type |
|---|---|---|---|---|
| Bulk delete | >10 delete-class actions/user | HIGH | 5-min sliding | `BULK_DELETE` |
| Off-hours | High-sensitivity actions 22:00–05:59 Asia/Manila | MEDIUM | 60s | `OFF_HOURS` |
| Privilege escalation | `ROLE_CHANGE_TO_%` events | HIGH | 60s | `PRIVILEGE_ESCALATION` |
| Rapid IP switch | 2+ distinct IPs/user | MEDIUM | 10-min sliding | `RAPID_IP_SWITCH` |
| Suspicious query | >10 `PII_EXPORT`/user | HIGH | 5-min sliding | `SUSPICIOUS_QUERY_PATTERN` |
| Password reset abuse | >5 `PASSWORD_RESET`/user | MEDIUM | 15-min sliding | `PASSWORD_RESET_ABUSE` |

High-sensitivity actions for OFF_HOURS: `PII_EXPORT`, `BACKUP_TRIGGERED`, `BREACH_STATUS_UPDATE`, `CREATE_INCIDENT_FROM_ALERT`, `AUDIT_EXPORT`, `ROLE_CHANGE_TO_%`. New anomalies are dual-written to `wims.anomaly_detections` + `wims.security_threat_logs` (suricata_sid=NULL) so they surface in the Threat Telemetry UI. `PASSWORD_RESET_ABUSE` added in AuditMoreGapsFix branch (RP-26) — complements the nginx reset-credentials rate limit (1r/m burst=2) with an app-level anomaly signal.

## Transport Security (TLS)
FRS Module 6 requires TLS 1.2 or higher for all network communication. **Updated 2026-06-26 (M6b #153):** `src/nginx/nginx.conf` allows `TLSv1.2 TLSv1.3`, restoring TLS 1.2 compatibility for legacy clients. TLS 1.3 is preferred when the client supports it. **Cipher suite hardened 2026-05-30 (GH #154):** AES-128-GCM ciphers removed. TLS 1.2 cipher list restricted to AES-256-GCM + ChaCha20-Poly1305 only (`ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305`). TLS 1.3 ciphersuites restricted to `TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256` via `ssl_conf_command`. ChaCha20-Poly1305 provides efficient encryption on mobile devices without AES-NI hardware acceleration.

## Data-at-Rest Encryption
FRS Module 6 requires AES-256-GCM encryption for sensitive incident fields. **Expanded 2026-05-30 (GH #150):** The `SecurityProvider` (AES-256-GCM, AAD-bound per `incident_id:N`) now encrypts:
- PII fields: `caller_name`, `caller_number`, `owner_name`, `occupant_name`
- Narrative: `narrative_report` (plaintext column now NULL; decrypted on read)
- Casualties: `casualty_details` (plaintext JSONB column now NULL; decrypted on read)
- Property damage: `estimated_damage_php` (also stored in encrypted blob; plaintext column retained for backward compatibility)

All write paths updated: `services/afor_import/commit.py` (AFOR commit), `api/routes/regional.py` (manual create/edit), `api/routes/incidents.py` (`upload_incident_bundle`). Read path in `api/routes/regional.py` decrypts blob and injects fields into API responses.

**Remaining GH #150 gaps:** `wims.incident_attachments` filesystem storage unencrypted (GH #151). OpenBao KMS + key rotation partially implemented — Phase 3 done (GH #152).

## OpenBao KMS Provider Metadata (GH #152 Phase 3)

**Implemented 2026-06-11:** Provider metadata schema and dual-read dispatch for multi-KMS support.

- **Migration** `54_openbao_provider_metadata.sql` adds `crypto_provider TEXT NOT NULL DEFAULT 'env_aesgcm'` and `kms_key_name TEXT` to `wims.incident_sensitive_details`. The PII blob consistency constraint is relaxed: OpenBao Transit rows allow `pii_blob_enc IS NOT NULL` with `encryption_iv IS NULL`.
- **Provider dispatch:** `services/kms/__init__.py` exports `get_crypto_provider(row=None)`. Row `crypto_provider` wins over `WIMS_CRYPTO_PROVIDER` env var (defaults `env_aesgcm`). Unknown providers raise a clear error.
- **KmsSecurityProvider:** `services/kms/openbao_client.py` provides a `SecurityProvider`-compatible wrapper around `OpenBaoClient`. `encrypt_json` returns sentinel nonce `"OPENBAO_TRANSIT"` + Transit ciphertext; `decrypt_json` ignores nonce. Key name from `OPENBAO_PII_KEY_NAME` > `OPENBAO_TRANSIT_KEY_NAME` > `wims-incident-pii`.
- **Write paths:** All 5 write paths (`incidents.py` bundle, `encoder_crud.py` create, `field_updates.py`/`helpers.py` re-encrypt, `commit.py` AFOR) now store `crypto_provider` and `kms_key_name` on INSERT/UPDATE. For `env_aesgcm` rows, `encryption_iv` contains the real nonce; for `openbao_transit` rows, `encryption_iv` is NULL.
- **Read paths:** `encoder.py` detail view, `field_updates.py` conflict fetch, `helpers.py` field update, and `encrypt_backlog.py` all dispatch `decrypt_json` by row `crypto_provider`. Legacy rows default to `env_aesgcm` — no migration needed.
- **Tests:** 45 unit tests pass (17 crypto + 9 openbao client + 19 provider dispatch), 3 skipped (requires live OpenBao).
- **Remaining (Phase 6-7):** rewrap-on-rotation, Celery 90-day key rotation, and backup_crypto.py integration are NOT yet implemented. (Phase 5 migration tooling now implemented.)

## OpenBao KMS Flag-Gated New Writes (GH #152 Phase 4)

**Implemented 2026-06-11:** When `WIMS_CRYPTO_PROVIDER=openbao_transit`, new incident PII writes use `KmsSecurityProvider.encrypt_json()` via OpenBao Transit. All write paths now dispatch through `services.kms.get_crypto_provider()`.

- **AFOR commit wiring:** `api/routes/regional/afor.py` and `__init__.py` now wire `get_crypto_provider()` instead of the legacy `helpers.get_security_provider()` singleton. This ensures the AFOR import path (`commit.py`) respects `WIMS_CRYPTO_PROVIDER`.
- **Write behaviour:** When `WIMS_CRYPTO_PROVIDER` is unset or `env_aesgcm`, new rows store `crypto_provider='env_aesgcm'`, `encryption_iv=<real nonce>`, `kms_key_name=NULL` — unchanged legacy behaviour. When `openbao_transit`, new rows store `crypto_provider='openbao_transit'`, `kms_key_name='wims-incident-pii'` (default), `pii_blob_enc=<Transit ciphertext>`, `encryption_iv=NULL`.
- **Response contract:** API/detail responses strip `crypto_provider`, `kms_key_name`, `pii_blob_enc`, `encryption_iv` (encoder detail view already did; conflict fetch `_fetch_incident_edit_fields` now additionally strips `crypto_provider`/`kms_key_name`).
- **Tests:** 10 new unit tests in `tests/test_openbao_new_writes.py` covering env-AES metadata, OpenBao Transit metadata, nonce sentinel guarding, response metadata stripping, and wiring verification. All 57 tests pass (54 passed + 3 skipped for live OpenBao).
- **Non-goals:** No legacy-row migration (Phase 5), no Celery 90-day rotation (Phase 6), no backup_crypto.py (Phase 7), no frontend changes.

## OpenBao KMS Migration Tooling (GH #152 Phase 5)

**Implemented 2026-06-11:** Controlled migration script to convert existing legacy env-AES PII blobs to OpenBao Transit rows in bounded, resumable batches.

- **Script:** `src/backend/scripts/migrate_pii_to_openbao.py` — reads `incident_sensitive_details` rows with `pii_blob_enc IS NOT NULL` and `crypto_provider IS NULL OR crypto_provider = 'env_aesgcm'`. Supports `--dry-run`, `--batch-size N` (default 500), `--incident-id ID`, `--resume-after ID`, `--limit N`.
- **Idempotent:** rows already `crypto_provider='openbao_transit'` are skipped.
- **Error isolation:** one bad row increments errors, logs `incident_id`, continues to next row.
- **Transaction policy:** commit per batch; rollback only current batch on fatal flush error.
- **Key version:** detects `key_version` column dynamically via `information_schema`; updates it from `kms_provider.current_version` when the column exists.
- **Requires:** `DATABASE_URL` (or `SQLALCHEMY_DATABASE_URL`), `WIMS_MASTER_KEY` (legacy decrypt), `OPENBAO_ADDR` + token (OpenBao encrypt).
- **Tests:** `tests/test_migrate_pii_to_openbao.py` — 23 unit tests (no live OpenBao). Covers dry-run, successful migration, idempotent skip, decryption/encryption/update error isolation, CLI flag behavior, key version column detection, and exit codes.
- **Non-goals:** Does NOT implement Celery 90-day rotation (Phase 6 — now implemented). Does NOT implement backup encryption (Phase 7). Does NOT migrate live data automatically. Does NOT alter frontend.

## OpenBao KMS Automated Key Rotation (GH #152 Phase 6)

**Implemented 2026-06-11:** Scheduled daily 90-day OpenBao Transit key rotation + resumable rewrap orchestration.

- **Migration** `55_kms_key_rotation_runs.sql`: creates `wims.kms_key_rotation_runs` table with UUID PK, status enum (RUNNING/SUCCEEDED/FAILED), from/to version tracking, row counters (`rows_scanned`, `rows_rewrapped`, `rows_skipped`, `rows_failed`), and error message. Indexes support active-run guard and last-success lookup. RLS restricts to SYSTEM_ADMIN.
- **Rotation task** `tasks/kms_rotation.py`: Celery task `ensure_pii_key_rotation` checks active RUNNING guard, reads OpenBao key metadata, determines if 90-day rotation is due via `is_rotation_due()`, rotates key, records run row, rewraps `openbao_transit` rows to new key version via `rewrap_openbao_rows()`, and marks run SUCCEEDED or FAILED. Rewrap uses cursor-paginated batches with per-batch commit. Per-row errors increment failure counter and continue. AAD is `incident_id:{id}`.
- **Celery beat** `celery_config.py`: daily schedule entry `ensure-pii-key-rotation-daily` at 03:30 UTC.
- **Env configuration:** `OPENBAO_ROTATION_INTERVAL_DAYS` (default 90), `KMS_REWRAP_BATCH_SIZE` (default 500).
- **Tests:** `tests/test_kms_rotation_task.py` — 17 unit tests (no live OpenBao). Covers rotation-due boundary logic, single-run guard, rotate + run row recording, rewrap row updates, skip already-at-target, per-row rewrap error isolation, UPDATE failure isolation, SUCCEEDED/FAILED status transitions, start_run UUID return, and Celery beat entry verification.
- **Non-goals:** Does NOT delete/disable old OpenBao key versions. Does NOT implement backup_crypto.py integration (Phase 7). Does NOT run live migration/rotation against real data. Does NOT touch frontend.
- **Overall GH #152 status:** Phases 1-7 code paths implemented; #152 remains PARTIAL until live OpenBao integration/ops are complete (live restore drill pending).

## OpenBao KMS Backup Encryption (GH #152 Phase 7)

**Implemented 2026-06-11:** `backup_crypto.py` integrated with OpenBao Transit for new backup encryption, with legacy restore compatibility preserved.

- **Feature flag:** `WIMS_BACKUP_CRYPTO_PROVIDER` (new backup-specific env var) overrides `WIMS_CRYPTO_PROVIDER`. Default: `env_aesgcm` (legacy AES-256-GCM with `WIMS_MASTER_KEY`). Opt in via `WIMS_BACKUP_CRYPTO_PROVIDER=openbao_transit`.
- **Key name:** `OPENBAO_BACKUP_KEY_NAME` env var, default `wims-backup`.
- **New OpenBao format (WIMSBAO1):** versioned envelope with `WIMSBAO1\n` magic header, JSON metadata line (`provider`, `key_name`, `created_at`, `ciphertext_version`), then OpenBao Transit ciphertext as UTF-8 bytes. Header contains no plaintext, raw keys, tokens, or secrets. Files retain `.enc` extension.
- **Legacy compatibility:** `decrypt_backup()` auto-detects format — reads first 8 bytes for `WIMSBAO1\n` magic. If detected, dispatches to OpenBao Transit decrypt. Otherwise treats file as legacy env-AES nonce+ciphertext. `encrypt_backup()` and `decrypt_backup()` signatures unchanged.
- **Context/AAD:** OpenBao Transit encrypt/decrypt uses `b"wims-backup"` as AAD context for encryption binding.
- **Admin routes:** No changes needed — `src/backend/api/routes/admin/backups.py` calls `encrypt_backup()` / `decrypt_backup()` without modification.
- **Tests:** `tests/test_backup_crypto_openbao.py` — 34 unit tests (no live OpenBao). Covers legacy env-AES roundtrip, OpenBao WIMSBAO1 header write/parse, OpenBao roundtrip, header auto-detection on decrypt, legacy decrypt without header, missing/invalid metadata, `OPENBAO_BACKUP_KEY_NAME` honoring, unknown provider error, and signature/output-path preservation.
- **Non-goals:** Does NOT run live OpenBao backup/restore drill. Does NOT remove legacy env-AES restore. Does NOT change frontend.

## OpenBao KMS Phase 8 — Hardening, Runbook, Live Validation Hooks (GH #152)

**Implemented 2026-06-11:** Phase 8 adds production-readiness artifacts and validation hooks for OpenBao KMS operations.

- **Operations runbook:** `docs/operations/openbao-kms-runbook.md` — covers local dev bootstrap, env var reference, production topology, unseal strategy (Shamir M-of-N / platform auto-unseal), least-privilege policy summary, migration runbook (dry run, production run, rollback/resume), rotation runbook (scheduled beat, inspection, triage), backup restore drill (legacy + OpenBao), incident response (down/sealed/auth failure/rotation failure/backup decrypt failure), and explicit secret hygiene rules.
- **Live integration tests:** `src/backend/tests/integration/test_openbao_kms_live.py` — 5 live tests (health, encrypt/decrypt roundtrip, wrong-context rejection, rewrap ciphertext-change + plaintext-preservation, backup encrypt/decrypt roundtrip with WIMSBAO1 header verification). All tests skip cleanly when OpenBao is unavailable or unconfigured. No hard Docker dependency.
- **Smoke script:** intentionally skipped — the integration tests cover the same surface and can be invoked with a single `pytest` command; a separate smoke script would be redundant.
- **No-secret logging verified:** all existing code paths (client, rotation, migration, backup_crypto, rewrap) log only operation metadata; no ciphertext, plaintext, nonces, keys, or tokens appear in log statements.
- **Overall GH #152 status:** Phases 1-8 code paths, runbook, and test hooks implemented. **Live environment validation remains pending** — until live OpenBao is available in this environment and the integration tests pass against it, #152 is PARTIAL. Do not claim #152 or FRS Module 6 fully closed until the live backup restore drill and integration tests are executed in the target environment.

## OpenBao KMS Production Lifecycle Fixes (2026-06-11)

**Health routing fix:** `OpenBaoClient._url_for()` helper ensures sys API paths (e.g. `/sys/health`) bypass the Transit mount prefix. Health calls now correctly hit `/v1/sys/health` instead of the invalid `/v1/transit/sys/health`. Unit tests (`TestOpenBaoClientRouting`) validate URL construction for health, encrypt, decrypt, rewrap, rotate, and metadata endpoints.

**Bootstrap lifecycle rewrite:** `src/openbao/init/bootstrap-openbao.sh` now handles three states:
1. Uninitialised → init (1/1 Shamir for dev), unseal, bootstrap Transit
2. Initialised + sealed → unseal only if `OPENBAO_UNSEAL_KEY` is provided; fail-fast with manual-unseal message otherwise
3. Initialised + unsealed → authenticate with `OPENBAO_TOKEN` env, then persisted root token, then `OPENBAO_DEV_ROOT_TOKEN`

Never prints root token or unseal key to logs. Idempotent for Transit enable and key creation.

**Derived Transit key enforcement:** `wims-incident-pii` and `wims-backup` keys are created with `derived=true` (AES-256-GCM-96). This cryptographically binds every encrypt/decrypt operation to its context/AAD. If a key already exists but is *not* derived, bootstrap fails with an explicit operator message — destructive recreation is forbidden, but silent weakening of context enforcement is also forbidden. `convergent_encryption` is never set.

**Compose healthcheck fix:** `openbao` healthcheck now requires BOTH `initialized=true` AND `sealed=false` — previously only checked `initialized=true`, which passed initialized-but-sealed clusters (the VPS failure state). Bootstrap depends on `service_started` (not `service_healthy`) so first-boot init is not deadlocked by the sealed=false requirement.

**Credential persistence:** On first boot, the bootstrap script persists the generated root token and unseal key to `/vault/file/.bootstrap-creds` (chmod 600) inside the `openbao_data` Docker volume. Subsequent restarts read this file as a fallback when env vars are unset. Token fallback chain for bootstrap auth: env `OPENBAO_TOKEN` > persisted `OPENBAO_ROOT_TOKEN` > `OPENBAO_DEV_ROOT_TOKEN` (default `devroot`). Unseal key fallback chain: env `OPENBAO_UNSEAL_KEY` > persisted. **Dev/single-VPS only** — production must use a proper secrets manager.

**Backend/celery token-file auth:** After writing the `wims-app` policy, bootstrap verifies any existing app token in `/vault/file/.wims-app-token`; if missing or invalid, it creates a replacement policy-scoped orphan token and persists the token value to that file. `backend` and `celery-worker` mount `openbao_data` read-only at `/openbao-creds`, set `OPENBAO_TOKEN_FILE=/openbao-creds/.wims-app-token`, and explicitly clear `OPENBAO_TOKEN` so stale `.env.production` tokens do not override the regenerated token file after an OpenBao volume reset. `OpenBaoClient` supports direct `OPENBAO_TOKEN` first, then `OPENBAO_TOKEN_FILE`, then future AppRole envs.

**Backend/celery env plumbing:** `OPENBAO_ADDR`, `OPENBAO_TOKEN_FILE`, and `OPENBAO_TRANSIT_MOUNT` env vars are plumbed into `backend` and `celery-worker` compose services with safe defaults (default addr/token-file path, empty direct token). `WIMS_CRYPTO_PROVIDER` defaults to `env_aesgcm` — OpenBao is only used when explicitly opted in. No dependency on `openbao` or `openbao-bootstrap` is added to backend/celery (avoids forcing optional infrastructure on default env-aesgcm boot).

**Safe key-delete warning:** The non-derived-key error message now explicitly warns that deleting the key destroys decryptability of any data encrypted with it, and lists migration/restore/reset as prerequisites before deletion.

**Tests:** 8 new unit tests in `TestOpenBaoClientRouting` proving sys paths bypass mount. Existing `test_decrypt_wrong_context_fails_live` remains correct under derived keys — wrong context = decrypt failure by design.

## CSRF Protection

FRS Module 11b requires Cross-Site Request Forgery testing. The following layers are enforced:

- **SameSite=Strict cookies:** Auth cookies (`__Host-access_token`, `__Host-refresh_token`) are set with `Secure; HttpOnly; SameSite=Strict; Path=/`. No `Domain` attribute. Implemented in `src/frontend/src/app/api/auth/sync/route.ts`, `refresh/route.ts`, and `logout/route.ts`.
- **`__Host-` cookie prefix:** Prevents subdomain cookie injection — compliant browsers reject `__Host-` cookies set from any context that does not match the origin exactness requirements (HTTPS, no Domain, Path=/).
- **Origin/Referer validation middleware:** `src/backend/utils/csrf.py` — `csrf_middleware` is registered on the FastAPI app via `app.middleware("http")`. GET/HEAD/OPTIONS bypass (safe methods). POST/PUT/PATCH/DELETE without a valid Origin or Referer matching the configured allowlist are rejected with 403. Allowlist from `CSRF_TRUSTED_ORIGINS` env var, falling back to localhost defaults. **Exemption:** the zero-trust public DMZ path prefix `/api/v1/public/` is explicitly excluded from CSRF validation because these endpoints are unauthenticated (no Keycloak JWT, no cookie dependency) and are protected by rate limiting + Pydantic validation instead.
- **Nginx CORS restricted:** Production `Access-Control-Allow-Origin` uses a deny-by-default `$cors_origin` map (whitelisted origins: `https://wimsbfp.tech`, `https://wims.bfp.gov.ph`). Local dev config uses `$scheme://$host`. Neither echoes `$http_origin`.
- **Pen-test checklist:** `docs/pentest/CSRF-CHECKLIST.md` documents all manual verification procedures.
- **Test coverage:** `src/backend/tests/test_csrf_middleware.py` covers safe methods, invalid/missing Origin, valid Origin, Referer fallback, PUT/PATCH/DELETE variants, and VPS production origin scenarios.

## Export Sanitization (CSV/Excel Formula Injection)

D15 (CSV/Excel formula injection hardening) is implemented in
`src/backend/utils/analytics_validation.py` via `escape_csv_cell()`.

- **Type safety (B1, H1):** Signature `value: object` with `str(value)`
  coercion at top of body — prevents crashes on numeric/None inputs from
  export callers.
- **Leading whitespace bypass (B2):** Formula trigger detection strips
  leading whitespace via `cleaned.lstrip()[:1]` before checking against
  `_FORMULA_TRIGGERS` (`=`, `+`, `-`, `@`). The escaped cell preserves
  original whitespace content; the prepended `'` at position 0 neutralizes
  formula execution regardless.
- **Control character stripping:** Uses `str.translate()` instead of a
  per-character replace loop to remove `\t`, `\r`, `\n`.
- Applied at the export layer (`tasks/exports.py` for CSV, Excel); PDF
  exports are exempt (not spreadsheet-parsed). Does not alter stored data.

## Related
- [[database/schema-overview]]
- [[backend/api-route-map]]
- [[gaps/frs-codebase-gap-register]]
- `docs/pentest/CSRF-CHECKLIST.md`

## Hash-Chain Integrity (Incident Verification History)

**Status:** Implemented (#241)

- **Write path:** `PATCH /api/regional/incidents/{id}/correct` (validator.py) computes and stores `ivh_row_hash`, `prev_ivh_hash`, `new_data_hash`, `old_data_hash`, `corrected_fields` in `wims.incident_verification_history`.
- **Read-path verification:** `verify_incident_hash_chain()` in `services/regional_incidents/helpers.py` recomputes row hashes, verifies chain linking, and checks anchor (`new_data_hash` vs `fire_incidents.data_hash`). Returns `integrity_status`: `"valid"`, `"tampered"`, or `"unverified"` (for legacy rows without hash-chain data).
- **Integration:** Called from `GET /api/regional/incidents/{id}`, `GET /api/regional/validator/incidents/{id}/history`, and `GET /api/incidents/analyst/{id}`. The `integrity_status` field is included in API responses.
- **Audit:** Tampered chains log `INTEGRITY_VIOLATION` rows to `wims.system_audit_trails`.
- **Limitation:** Only correction operations write hash-chain data. Regular verify/approve transitions do not (those rows show `"unverified"`).

## XFF Cleanup + Civilian 429 Specificity + #419 XAI Load Guard (2026-06-22)

Completes the #446 follow-up for the XFF spoofing gap. Three workstreams: (WS1) all app-layer client-IP reads migrate from `get_client_ip` (XFF-first, spoofable) to `trusted_client_ip` (X-Real-IP first, never XFF); (WS2) the civilian 429 error now shows a specific timing message instead of the alarming generic "call 911" boundary; (WS3) regression tests lock in the no-XAI-on-page-load behavior that protects the defense demo from a 504.

**WS1 — XFF → `trusted_client_ip` migration:**
- **16 `get_client_ip` usage call sites migrated** — 1 consent (Tier 1, commit `b19b8092`) + 15 audit-trace (Tier 2, commit `0158babe`). Files: `consent.py`, `incidents.py`, `validator.py` (4 sites), `afor.py`, `encoder_crud.py` (9 sites). All swap `get_client_ip(request)` → `trusted_client_ip(request)`.
- **`get_client_ip` alias retained** with deprecation docstring. Zero production call sites remain. Tier 5 (alias removal) is a follow-up — dead-code hygiene, no security impact.
- **nginx defense-in-depth** (Tier 3, commit `e303438e`): all 3 nginx configs (`nginx.conf`, `nginx.local.conf`, `nginx.ci.conf`) set `X-Real-IP $realip_remote_addr` on every location block with `proxy_pass` — TCP socket peer, immune to realip rewriting. `X-Forwarded-For` directives untouched (`trusted_client_ip` never reads XFF). `/api/auth/callback` is pre-auth PKCE; the old "behind a JWT/session" carve-out no longer applies.
- **`test_nginx_forwarded_headers.py`** rewritten: new parameterized test asserts every proxying location block has the correct directive.

**WS2 — Civilian 429 specificity:**
- **Backend** (`civilian.py:344`, commit `b03a9e26`): detail string includes `"{_retry_minutes} minutes"` derived from `retry_after` via `max(1, ceil(retry_after / 60))`.
- **Frontend transport** (`errors.ts` + `public-transport.ts`, commit `8bd15937`): `ApiRequestError` extracted to shared `errors.ts` with optional `.retryAfter` field. `public-transport.ts` throws `ApiRequestError` with `.status` + `.retryAfter` (parsed from `Retry-After` header) instead of a plain `Error`.
- **Frontend UI** (`page.tsx`, commit `843e6ce7`): renders `"Too many reports from this network. Try again in {minutes} minutes."` on 429. The "call 911" emergency boundary stays for `server`/`unknown` errors.

**WS3 — #419 XAI load guard (regression tests, commits `4311d9c2` + `372cbf7b`):**
- **Backend regression** (`test_security_monitoring.py`): `test_summary_endpoint_does_not_call_xai` patches `analyze_threat_log`, asserts it is never called on the summary endpoint.
- **Frontend regression** (`admin-security-monitoring.test.tsx`, `admin-system-analyze-ai.test.tsx`): no-analyze-on-mount guards for both monitoring and system pages; manual-analyze-called-exactly-once test.
- **Deviation:** #419 bypassed the #415 blocker (justified in spec — #415 needs migration 62, not applied to the running DB; #419's tests lock in existing good behavior).

**CI validation:** All 6 gates green — ruff check (0), ruff format (232 files), pytest (10 new + 1592 pre-existing pass), npm run lint (0 errors), npx vitest run (990 tests, 0 fail), next build (exit 0). Spec: `docs/superpowers/specs/2026-06-22-xff-cleanup-civilian-429-xai-load-guard-design.md`.

## Outbound URL Allowlist (V13.2.4, 2026-06-23)

`ExternalServiceClient` (used by Ollama, OpenBao, and Nominatim) now enforces a
hostname-based outbound URL allowlist for SSRF mitigation:
- **Derivation:** hostnames parsed from `OLLAMA_URL` (default `ollama`),
  `OPENBAO_ADDR` (default `openbao`), `NOMINATIM_URL` (default
  `nominatim.openstreetmap.org`), plus `EXTERNAL_SERVICE_ALLOWED_HOSTS` env var
  (comma-separated, additive), plus Docker internal hostnames (`wims-postgres`,
  `wims-redis`, `wims-keycloak`, `keycloak`, `redis`, `postgres`).
- **Enforcement:** URL hostname checked by string comparison (no DNS)
  at the start of every `request_async`/`request_sync` call. Rejected hosts
  raise `ExternalServiceError("URL host not in allowlist: {host}")`.
- **Audit:** The full derived allowlist is logged at INFO at client init time.
- **Spec:** `docs/superpowers/specs/2026-06-23-asvs-findings-remediation-design.md`,
  Workstream 4.

## ASVS L2 Remediation (2026-06-23)

Six ASVS L2 findings closed in a single remediation batch. All changes
landed in the working tree of `feat/keycloak-brute-force-protection`
(uncommitted — awaiting user review). Subagent reports at
`/tmp/ws{1,4,5,6,23}-report.md`.

| ASVS req | Risk | Fix summary | TDD evidence |
|---|---|---|---|
| **V16.4.1** | HIGH | `raw_payload` + `severity_level` wrapped in `json.dumps()` in `analyze_threat_log()` prompt to prevent delimiter-breakout log injection. Scope: XAI prompt only (highest-risk channel). | `test_analyze_threat_log_escapes_raw_payload` |
| **V16.5.1** | MED | `@app.exception_handler(Exception)` returns generic 500. HTTPException handler NOT overridden. 7 real 5xx leakers cleaned in `sessions.py` (3x) + `admin/backups.py` (4x) — `f-string str(e)` replaced with generic messages, full exception logged server-side. | `test_unhandled_exception_returns_generic_500` + `test_http_exception_4xx_keeps_original_detail` |
| **V16.5.3** | HIGH | `rate_limit_middleware` now fail-closed on Redis down for `/api/auth/callback` POST (returns 503 + `Retry-After: 30`). Dev escape hatch: `RATE_LIMIT_FAIL_OPEN=true`. `blocked_ip_middleware` fail-open deliberately preserved (documented asymmetry). | 3 tests in `test_rate_limit_fail_closed.py` |
| **V13.2.4** | MED | `ExternalServiceClient` hostname allowlist (see section above). | 3 tests in `TestAllowlist` |
| **V14.2.4** | MED | New `docs/compliance/data-retention.md` + migration `68_data_retention.sql` (6 config keys + `data_retention_erased_at` column) + Celery beat task `tasks/data_retention.py` (daily 03:00 UTC, self-registers to avoid editing `main.py`). Per-table strategies: soft-archive VERIFIED `fire_incidents`, hard-delete non-VERIFIED, **real blob-erasure** for `incident_sensitive_details` (NULL all PII + `pii_blob_enc` + `encryption_iv` + `data_retention_erased_at=now()`, preserves FK), no-op for IVH + audit_trails. Deferred: key-destruction crypto-shred. | 5 tests in `test_data_retention.py` |
| **V14.3.3** | MED | `localStorage.setItem` now stores only `{id, role}` (was full user with email/name). `Pick<User, 'id'\|'role'>` type. `serverValidated=false` on offline restore. | 3 tests in `AuthContext.test.tsx` |

**Compliance rate:** 88.93% → 91.07% (224/280 reqs COMPLIANT, 4 NON-COMPLIANT, 21 NOT-VERIFIED, 31 NOT-APPLICABLE). Deferred (NOT-VERIFIED): V13.2.5 (nginx-side, application-layer sufficient), V13.4.4 (TRACE method), V16.2.5 (logger call sites beyond XAI prompt).

**Subagent reports:**
- `/tmp/ws1-report.md` — V16.4.1 XAI prompt fix
- `/tmp/ws4-report.md` — V13.2.4 outbound URL allowlist
- `/tmp/ws5-report.md` — V14.2.4 data retention policy
- `/tmp/ws6-report.md` — V14.3.3 localStorage PII
- `/tmp/ws23-report.md` — V16.5.3 + V16.5.1 (fail-closed + generic error handler)

**Full regression:** 59/59 backend (33 baseline + 14 new + 12 in test_external_service), 19/19 frontend vitest, 0 frontend lint errors, ruff check + format clean. Pre-existing test infrastructure issue found and documented: persistent Redis breaker state (`cb:<service_name>:*` keys) survives between pytest invocations — clear with `docker exec wims-redis redis-cli --scan --pattern 'cb:*' | xargs redis-cli DEL` before test runs.
