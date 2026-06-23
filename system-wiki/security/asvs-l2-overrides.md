---
title: WIMS-BFP ASVS 5.0 L2 Audit — Project-Specific Overrides
created: 2026-06-23
type: security
tags: [wims-bfp, asvs, security-audit, compliance, overrides]
status: draft
companion_to: ~/.pi/agent/skills/wims-bfp-asvs-l2/SKILL.md
---

# WIMS-BFP ASVS 5.0 L2 — Project-Specific Overrides

This file customizes the **generic** ASVS 5.0 L2 audit framework (`~/.pi/agent/skills/wims-bfp-asvs-l2/SKILL.md`) for the WIMS-BFP codebase. The core skill tells the auditor *what* to check; this file tells them *where* in WIMS-BFP to look.

The overrides cover:
1. **Project metadata** — repo location, branch, commit, keycloak realm
2. **Per-chapter file paths** — exactly which files contain the relevant code
3. **Per-chapter env vars** — `WIMS_MASTER_KEY`, `OPENBAO_*`, etc.
4. **Documented exceptions** — controls that are intentionally NOT-COMPLIANT with a written justification (do not flag as findings)
5. **Cross-references** — links to existing system-wiki pages with the relevant evidence

---

## Project Metadata

| Field | Value |
|---|---|
| Project name | `wims-bfp` |
| Repo path | `~/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE` |
| Keycloak realm | **`bfp`** (NOT `wims` — this is a common mistake) |
| Keycloak admin path | `kcadm.sh` inside `wims-keycloak` container |
| Backend framework | FastAPI (Python 3.10+) |
| Frontend framework | Next.js App Router (TypeScript) |
| Database | PostgreSQL with PostGIS |
| ORM | SQLAlchemy |
| Container orchestration | Docker Compose v2 |

**Audit state file:** `system-wiki/security/asvs-l2-state.json` (version-controlled).

---

## Per-Chapter Overrides

### V1 — Encoding and Sanitization

| Req ID | Where to look | Expected |
|---|---|---|
| V1.1.1, V1.1.2 | `src/backend/main.py` — verify FastAPI default config; ORJSON via Pydantic | COMPLIANT |
| V1.2.4 | `rg "\.execute\(" src/backend/api/ --type py \| grep -v ":\|test\|#"` | expect 0 unparameterized hits |
| V1.2.5 | `rg "subprocess\.\(shell=True\|os\.system\|os\.popen" src/backend/ --type py` | expect 0 hits |
| V1.2.6 | LDAP not used in this stack | NOT-APPLICABLE |
| V1.2.7 | XPath not used in this stack | NOT-APPLICABLE |
| V1.3.1 | No WYSIWYG in this stack | NOT-APPLICABLE |
| V1.3.4 | No SVG upload in this stack | NOT-APPLICABLE |
| V1.3.5 | Markdown/BBCode input: `rg "markdown\|BBCode" src/frontend/` — check for sanitization | review |
| V1.3.6 (SSRF) | `src/backend/api/routes/` — any code that fetches external URLs based on user input? | review; if present, check allowlist |

### V2 — Validation and Business Logic

| Req ID | Where to look |
|---|---|
| V2.1.1, V2.1.2 | `docs/` — input validation rules documentation |
| V2.2.1 | `src/backend/schemas/` — Pydantic models for every write endpoint |
| V2.3.1 | `src/backend/api/routes/regional/validator.py` — verify incident state machine |
| V2.3.2 | `src/backend/services/` — business logic limits |
| V2.4.1 | nginx `limit_req` zones + Redis sliding-window + Keycloak brute force (3 layers) |

### V3 — Web Frontend Security

**Runtime check command:**
```bash
curl -sIk $BASE_URL | grep -iE "^(content-security-policy|x-content-type-options|frame-ancestors|referrer-policy|strict-transport-security):"
```

**Per-cookie check** (post-auth):
```bash
curl -sI -c /tmp/cookies.txt "$FRONTEND_URL/api/auth/sync" -H "Authorization: Bearer $TOKEN" | grep -i set-cookie
```
Expect `__Host-access_token` and `__Host-refresh_token` with `Secure; HttpOnly; SameSite=Strict; Path=/`.

### V4 — API and Web Service

| Req ID | Where to look |
|---|---|
| V4.1.1 | FastAPI default `Content-Type` with charset — confirm via curl |
| V4.1.3 | nginx `proxy_set_header X-Real-IP $realip_remote_addr` in all location blocks — verified by `test_nginx_forwarded_headers.py` |
| V4.2.1 | nginx + FastAPI; see `test_nginx_forwarded_headers.py` for the policy |

**TRACE/CONNECT method rejection:** Suricata custom rules SIDs 1000129, 1000130 (`nocase`).

### V5 — File Handling

| Req ID | Where to look | Notes |
|---|---|---|
| V5.2.1 | `grep "client_max_body_size" src/nginx/nginx.conf` | `50M` |
| V5.2.2 | `src/backend/api/routes/incidents.py` — attachment upload logic | check for extension allowlist + magic byte check |
| V5.3.1 | `incident_attachments_data` Docker volume mounted at `/app/storage` (NOT webroot) | COMPLIANT |
| V5.3.2 | File path construction — must not use user-supplied filenames | review |

**Known gap (per security-baseline.md § GH #150):** `wims.incident_attachments` filesystem storage is unencrypted (GH #151). Flag as MED risk if encryption at rest is required by the project's data classification.

### V6 — Authentication

**Keycloak audit one-liner:**
```bash
jq '{passwordPolicy, bruteForceProtected, failureFactor, maxFailureWaitSeconds, waitIncrementSeconds, accessTokenLifespan, sslRequired, verifyEmail, registrationAllowed, rememberMe, duplicateEmailsAllowed, otpPolicyType}' src/keycloak/bfp-realm.json
```

**Keycloak kcadm (for deeper config):**
```bash
docker exec wims-keycloak /opt/keycloak/bin/kcadm.sh get realms/bfp \
  --no-config --server http://localhost:8080 --realm master \
  --user admin --password "$KC_ADMIN_PASS"
```

**Documented exception — SKIP_MFA role (per security-baseline.md):**
- `SKIP_MFA` realm role exempts test users (`validator_test`, `n-val`, `g-val`, `e-val`, `r-val`) from OTP step
- Direct Grant flow is unaffected
- **Must be removed before production** per `docs/agents/remove-demo-otp-bypass.md`
- For V6.3.3 (MFA required): mark NOT-COMPLIANT with documented exception citing security-baseline.md § SKIP_MFA Role

**Documented exception — verifyEmail: false (per security-baseline.md § Email verification flow):**
- Custom two-step email change flow replaces built-in verification
- For V6.6 controls: assess against the custom flow, not the built-in

| Req ID | Expected verdict | Notes |
|---|---|---|
| V6.1.1 | COMPLIANT | `rg "keycloak\|oidc" src/backend/ --type py -l` is non-zero |
| V6.1.2 | COMPLIANT | Keycloak PBKDF2 default |
| V6.2.1 | COMPLIANT | `length(12)` in `passwordPolicy` (note: ASVS 5.0 L2 requires ≥ 8, recommends 15) |
| V6.2.2 | COMPLIANT | Keycloak flow enabled |
| V6.2.3 | COMPLIANT | `change-email` requires current password |
| V6.2.4 | likely NOT-VERIFIED | Check Keycloak SPI deployment for HaveIBeenPwned integration — not implemented |
| V6.2.5 | COMPLIANT | `passwordPolicy` doesn't restrict character types beyond class requirements |
| V6.2.6 | COMPLIANT | Frontend uses `type=password` |
| V6.2.7 | COMPLIANT | No JS interfering with paste |
| V6.2.8 | COMPLIANT | Backend receives password as-is |
| V6.2.9 | COMPLIANT | Keycloak allows 64+ char passwords |
| V6.2.10 | COMPLIANT | No periodic rotation policy |
| V6.2.11 | NOT-VERIFIED | No documented context-specific word list |
| V6.2.12 | NOT-VERIFIED | HIBP integration not implemented |
| V6.3.1 | COMPLIANT | Keycloak `bruteForceProtected: true`, `failureFactor: 5` |
| V6.3.2 | COMPLIANT | No `admin/admin` or `root/root` in code (except keycloak admin which is in `.env`) |
| V6.3.3 | **NON-COMPLIANT (documented exception)** | SKIP_MFA role exempts test users |
| V6.3.4 | COMPLIANT | Only one auth pathway (Keycloak) |
| V6.5.1 | COMPLIANT | Keycloak TOTP single-use enforced |
| V6.5.2 | COMPLIANT | Keycloak hashes TOTP seeds |
| V6.5.3 | COMPLIANT | Keycloak uses SecureRandom |
| V6.5.5 | COMPLIANT | TOTP 30s, OOB 10min (Keycloak default) |
| V6.6.x | NOT-APPLICABLE | No PSTN/SMS OTP in this stack |
| V6.8.x | COMPLIANT | Keycloak JWT signature validated; OIDC ID token nonce + state checked |

### V7 — Session Management

| Req ID | Where to look | Expected |
|---|---|---|
| V7.2.1 | `src/backend/utils/auth.py` — `jwt.decode` with `verify=True` | COMPLIANT |
| V7.2.2 | Same | COMPLIANT (JWT) |
| V7.2.4 | `verify_exp: True` in jwt decode params | COMPLIANT |
| V7.3.1 | `ssoSessionIdleTimeout` in `bfp-realm.json` (keycloak default 1800s) | COMPLIANT |
| V7.3.2 | `accessTokenLifespan: 300` (5 min), `ssoSessionMaxLifespan: 28800` (8h) | COMPLIANT |
| V7.4.1 | Logout endpoint revokes refresh token | COMPLIANT |
| V7.4.2 | User disable terminates sessions (Keycloak default) | COMPLIANT |
| V7.4.3 | `change-email` requires re-authentication | COMPLIANT |
| V7.4.4 | Logout visible in UI (top-right user menu) | COMPLIANT |
| V7.4.5 | Admin can terminate sessions (`POST /users/{id}/logout`) | COMPLIANT |
| V7.5.1 | Email/MFA changes require re-auth | COMPLIANT |
| V7.5.2 | Users can view/terminate own sessions | review |
| V7.6.x | COMPLIANT | Keycloak handles SSO |

### V8 — Authorization

| Req ID | Where to look |
|---|---|
| V8.1.1 | `wims-bfp-security-review` skill output — authorization matrix |
| V8.2.1 | `rg "@requires\|Depends\|get_current_user" src/backend/api/ --type py -c` — every route has a guard |
| V8.2.2 | RLS policies in `src/postgres-init/10_rls_policies.sql`; per-row `get_db_with_rls` calls |
| V8.3.1 | Same as V8.2.1 — no client-side-only checks |

### V9 — Self-contained Tokens

| Req ID | Where to look | Expected |
|---|---|---|
| V9.1.1 | `src/backend/utils/auth.py` — `jwt.decode(..., verify=True)` | COMPLIANT |
| V9.1.2 | Same — algorithm allowlist | COMPLIANT (no `none` allowed) |
| V9.1.3 | `kid` validation via JWKS | COMPLIANT |
| V9.2.1 | `verify_exp: True` | COMPLIANT |
| V9.2.3 | `aud` validation | COMPLIANT |

### V10 — OAuth and OIDC

| Req ID | Where to look | Expected |
|---|---|---|
| V10.2.1 | `rg "code_challenge\|pkce" src/frontend/ --type ts --type tsx` | COMPLIANT (PKCE S256) |
| V10.4.1 | `kcadm get clients -r bfp \| jq '.[] \| .redirectUris'` | COMPLIANT (explicit allowlist) |
| V10.4.2 | Keycloak default — auth codes single-use | COMPLIANT |
| V10.4.3 | Keycloak default — code lifetime 60s | COMPLIANT |
| V10.4.5 | Keycloak refresh token rotation enabled | COMPLIANT |
| V10.5.1 | `nonce` in OIDC auth request | COMPLIANT |
| V10.5.4 | `aud` validation in OIDC client | COMPLIANT |

### V11 — Cryptography

**Crypto providers:**
- AES-256-GCM via `SecurityProvider` (env-provided key) — `src/backend/services/kms/__init__.py`
- OpenBao Transit via `KmsSecurityProvider` — `src/backend/services/kms/openbao_client.py`
- Provider dispatched by row's `crypto_provider` column in `wims.incident_sensitive_details`

**Env vars:**
- `WIMS_MASTER_KEY` — legacy AES key (44 base64 chars)
- `OPENBAO_ADDR`, `OPENBAO_TOKEN_FILE`, `OPENBAO_TRANSIT_MOUNT` — OpenBao connection
- `OPENBAO_PII_KEY_NAME` — `wims-incident-pii` (default)
- `OPENBAO_BACKUP_KEY_NAME` — `wims-backup` (default)
- `OPENBAO_TIMEOUT_SECONDS` — 2.0 (default)
- `OPENBAO_PII_KEY_NAME` vs `OPENBAO_TRANSIT_KEY_NAME` — the former wins if both set

| Req ID | Expected |
|---|---|
| V11.1.1 | COMPLIANT (key management policy in security-baseline.md + OpenBao runbook) |
| V11.1.2 | COMPLIANT (inventory in security-baseline.md § OpenBao KMS) |
| V11.2.1 | COMPLIANT (industry-validated: AES-256-GCM, Argon2id via Keycloak) |
| V11.2.2 | COMPLIANT (provider dispatch — `crypto_provider` column allows hot-swap) |
| V11.2.3 | COMPLIANT (256-bit key) |
| V11.3.1 | COMPLIANT (GCM mode) |
| V11.3.2 | COMPLIANT |
| V11.4.1 | COMPLIANT (no MD5/SHA1 in code — verify with grep) |
| V11.4.2 | COMPLIANT (Keycloak PBKDF2) |
| V11.4.4 | COMPLIANT |
| V11.5.1 | COMPLIANT (`secrets.token_*` and OpenBao CSPRNG) |

### V12 — Secure Communication

| Req ID | Where to look | Expected |
|---|---|---|
| V12.1.1 | `grep "ssl_protocols" src/nginx/nginx.conf` | `TLSv1.3` only (TLS 1.2 removed 2026-05-30) |
| V12.1.2 | `grep "ssl_ciphers" src/nginx/nginx.conf` | AES-256-GCM + ChaCha20-Poly1305 only |
| V12.1.4 | HSTS: `curl -sIk $BASE_URL \| grep -i strict-transport` | `max-age=31536000; includeSubDomains` |
| V12.2.1 | Frontend always HTTPS in production | COMPLIANT |
| V12.3.1 | Backend→Postgres: `?sslmode=disable` for Docker bridge; prod TBD | depends on env |
| V12.3.2 | No `verify=False` in Python: `rg "verify=False" src/backend/ --type py` | expect 0 hits |

### V13 — Configuration

| Req ID | Where to look | Expected |
|---|---|---|
| V13.1.1 | App communication documentation in `docs/` | review |
| V13.2.4 | External resource allowlist (no implementation; NGINX-level) | NOT-VERIFIED |
| V13.3.1 | `WIMS_MASTER_KEY` in `.env`, OpenBao KMS | COMPLIANT |
| V13.3.2 | Backend uses env vars only | COMPLIANT |
| V13.3.3 | OpenBao = isolated security module | COMPLIANT |
| V13.4.1 | `.git` in repo root — `git ls-files .git 2>&1 \| head -3` should error or be empty | COMPLIANT |
| V13.4.2 | `debug=False` in FastAPI: `rg "debug" src/backend/main.py` | COMPLIANT (env-var gated) |
| V13.4.3 | `autoindex off` in nginx | COMPLIANT |
| V13.4.4 | TRACE method rejected — Suricata SID 1000129 | COMPLIANT |
| V13.4.5 | `/actuator`, `/health` etc. only via authenticated paths | COMPLIANT |
| V13.4.6 | No `Server:` version disclosure: `curl -sIk $BASE_URL \| grep -i ^server:` should be empty | COMPLIANT |
| V13.4.7 | nginx `try_files` only serves specific extensions | COMPLIANT |

### V14 — Data Protection

| Req ID | Where to look | Notes |
|---|---|---|
| V14.1.1, V14.1.2 | security-baseline.md § Data-at-Rest Encryption | COMPLIANT |
| V14.2.1 | `rg "password=\|token=\|api_key=" src/backend/api/ --type py \| grep -v "body\|header"` | expect 0 URL-embedded secrets |
| V14.2.2 | `proxy_cache_bypass` and `Cache-Control: no-store` on sensitive endpoints | review |
| V14.2.5 | Web cache deception test: GET sensitive URL with image extension | review |
| V14.3.1 | Logout response includes `Clear-Site-Data` header | review |
| V14.3.2 | Sensitive responses have `Cache-Control: no-store` | review |
| V14.3.3 | `rg "localStorage\|sessionStorage" src/frontend/ --type ts --type tsx` — check what's stored | expect only `access_token` / `refresh_token` if at all |

### V15 — Secure Coding and Architecture

| Req ID | Where to look |
|---|---|
| V15.1.2 | SBOM: `pip-audit` output or `requirements.txt` + manual inventory |
| V15.2.1 | No breached components: `pip-audit` |
| V15.2.2 | Rate limiting + async processing for slow ops |
| V15.3.3 | Pydantic `BaseModel` with `extra="forbid"` (mass assignment defense) |
| V15.3.4 | `trusted_client_ip` (X-Real-IP, never XFF) — per XFF cleanup PR |
| V15.3.5 | Type checks in critical paths |
| V15.3.6 | `Set()` / `Map()` in frontend, not object literals |
| V15.3.7 | HTTP parameter pollution: framework doesn't merge query/body/cookies |

### V16 — Security Logging and Error Handling

| Req ID | Where to look | Expected |
|---|---|---|
| V16.1.1 | `system-wiki/security/security-baseline.md` § Audit and Immutability | COMPLIANT |
| V16.2.1 | `psql -c "\d+ wims.system_audit_trails"` — log entry schema | COMPLIANT |
| V16.2.2 | `src/backend/utils/audit.py` — UTC timestamps | COMPLIANT |
| V16.3.1 | `rg "log_system_audit" src/backend/api/routes/auth.py` | COMPLIANT |
| V16.3.2 | `rg "log_system_audit.*403\|log_system_audit.*denied" src/backend/ --type py` | COMPLIANT |
| V16.4.1 | `rg "logging.Formatter\|escape" src/backend/utils/logging.py` | review |
| V16.4.2 | `17_immutable_records.sql` — `no_delete_audit`, `no_update_audit` RULEs | COMPLIANT |
| V16.4.3 | Logs sent to a separate system? — review; currently local Suricata logs | review |
| V16.5.1 | `curl -sk $BACKEND_URL/api/v1/incidents/99999999 -H "Authorization: Bearer $TOKEN"` | expect clean JSON, no stack trace |

### V17 — WebRTC

All V17 requirements: **NOT-APPLICABLE** — WIMS-BFP does not use WebRTC.

---

## Documented Exceptions (Do NOT Flag as Findings)

These are controls that are intentionally non-compliant or partially compliant. Document the exception in the audit finding rather than flagging as a gap.

| Control | Exception | Source | Production-ready? |
|---|---|---|---|
| V6.3.3 (MFA required) | `SKIP_MFA` realm role exempts test users | security-baseline.md § SKIP_MFA Role | NO — must be removed before production per `docs/agents/remove-demo-otp-bypass.md` |
| V6.2.4 (top 3000 passwords) | HIBP integration not implemented | gap register | NO — add HIBP SPI for production |
| V6.2.12 (breached passwords) | HIBP integration not implemented | gap register | NO — add HIBP SPI for production |
| V6.6.x (PSTN/SMS OTP) | Not applicable — no PSTN in stack | — | N/A |
| V6.1.x (custom auth pathways) | Only Keycloak; custom email change flow | security-baseline.md § Email verification flow | YES — documented |
| V14.3.x (browser storage) | Custom encrypted offline store in `offlineOps` IndexedDB | security-baseline.md § Offline PWA | review for sensitive data |
| V5.x (attachment encryption) | Filesystem unencrypted (GH #151) | security-baseline.md § GH #150 gaps | NO — add OpenBao Transit for files |
| V13.3.3 (isolated crypto module) | Local OpenBao container (not HSM) | security-baseline.md § OpenBao | review (sufficient for prototype) |

---

## Cross-References to Existing Documentation

- `system-wiki/security/security-baseline.md` — current security posture
- `system-wiki/gaps/frs-codebase-gap-register.md` — known gaps
- `system-wiki/concepts/frs-module-map.md` — FRS-to-implementation traceability
- `docs/agents/remove-demo-otp-bypass.md` — SKIP_MFA removal procedure
- `docs/operations/openbao-kms-runbook.md` — OpenBao KMS runbook

## Audit State

This file is read-only reference. Audit state (per-requirement verdicts, evidence, history) lives in `system-wiki/security/asvs-l2-state.json` and is updated by the skill's operations.
