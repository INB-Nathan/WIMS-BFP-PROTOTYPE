---
title: Security Baseline
created: 2026-05-14
updated: 2026-05-30
type: security
tags: [wims-bfp, security, auth, rbac, rls, audit-log, ids, xai, privacy, fail-closed]
sources: [raw/frs/frs-auth.md, raw/frs/frs-complianceanddataprivacy.md, raw/frs/frs-intrusiondetectionandnetworkingmonitoring.md, raw/frs/frs-threatdetectionwithexplainableai.md, raw/codebase/codebase-snapshot-2026-05-14.md]
status: draft
---

# Security Baseline

## Auth and RBAC
FRS Module 1 defines Keycloak-backed authentication, MFA for privileged roles, session timeout, password policy, and role-based access control. Relevant implementation surfaces: `admin.py`, `sessions.py`, `user.py`, frontend auth API routes, and Keycloak config.

Development Keycloak realm config in `src/keycloak/bfp-realm.json` enables the built-in `reset credentials` flow, `resetPasswordAllowed`, and MailHog SMTP defaults (`mailhog:1025`, `noreply@wims-bfp.local`) for local forgot-password testing. `src/docker-compose.yml` includes a MailHog service exposing SMTP on `1025` and the web/API UI on `8025`.

## Fail-Closed Rule
Any missing authentication context defaults to deny. Public unauthenticated behavior is limited to the explicit public DMZ submission route in `public_dmz.py`; all adjacent APIs should require valid role context.

## RLS and Data Privacy
FRS Module 10 requires minimization, purpose limitation, rectification/erasure handling, breach notification, DPIA, and RoPA. Database enforcement must be verified in `src/postgres-init/09_rls_helpers.sql`, `10_rls_policies.sql`, and route dependencies.

## Audit and Immutability
FRS Module 4 requires SHA-256 data hashes, append-only audit logs, and immutable commit records. Verification/correction workflow remains a high-risk area; see [[gaps/frs-codebase-gap-register]].

## IDS/XAI
FRS Modules 7 and 8 define Suricata network monitoring and Qwen2.5-3B explainability. Relevant code/config: `src/suricata/`, admin security-log routes, and AI service paths. Real-time security event push via SSE (`GET /api/events/stream`) notifies SYSTEM_ADMIN clients of threat detection, AI analysis completion, and HITL confirmations.

## Real-Time Notifications (SSE)
FRS Module 13 defines a notification system. The SSE event stream (`GET /api/events/stream`) provides real-time push via Redis pub/sub. Channels: `incident` (status changes/corrections), `verification` (triage cluster workflow), `security` (threat/HITL events), `system` (maintenance). Role-based channel authorization enforced at connect time. Publishers injected at: `verify_incident`, `update_incident`, `correct_verified_incident`, `claim_cluster_command`, `apply_terminal_action_command`, `ingest_eve_file` (Suricata), `analyze_threat_log` (AI), and `update_security_log` (HITL). Frontend consumer hook: `useEventStream.ts`. Nginx configured with `proxy_buffering off` for the SSE location block.

## Transport Security (TLS)
FRS Module 6 requires TLS 1.3-only for all network communication. **Enforced 2026-05-30:** `src/nginx/nginx.conf` restricts `ssl_protocols` to `TLSv1.3`, dropping TLS 1.2 support. **Cipher suite hardened 2026-05-30 (GH #154):** AES-128-GCM ciphers removed. TLS 1.2 cipher list restricted to AES-256-GCM + ChaCha20-Poly1305 only (`ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305`). TLS 1.3 ciphersuites restricted to `TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256` via `ssl_conf_command`. ChaCha20-Poly1305 provides efficient encryption on mobile devices without AES-NI hardware acceleration.

## Data-at-Rest Encryption
FRS Module 6 requires AES-256-GCM encryption for sensitive incident fields. **Expanded 2026-05-30 (GH #150):** The `SecurityProvider` (AES-256-GCM, AAD-bound per `incident_id:N`) now encrypts:
- PII fields: `caller_name`, `caller_number`, `owner_name`, `occupant_name`
- Narrative: `narrative_report` (plaintext column now NULL; decrypted on read)
- Casualties: `casualty_details` (plaintext JSONB column now NULL; decrypted on read)
- Property damage: `estimated_damage_php` (also stored in encrypted blob; plaintext column retained for backward compatibility)

All write paths updated: `services/afor_import/commit.py` (AFOR commit), `api/routes/regional.py` (manual create/edit), `api/routes/incidents.py` (`upload_incident_bundle`). Read path in `api/routes/regional.py` decrypts blob and injects fields into API responses.

**Remaining GH #150 gaps:** `wims.incident_attachments` filesystem storage unencrypted (GH #151). OpenBao KMS + key rotation pending (GH #152).

## CSRF Protection

FRS Module 11b requires Cross-Site Request Forgery testing. The following layers are enforced:

- **SameSite=Strict cookies:** Auth cookies (`__Host-access_token`, `__Host-refresh_token`) are set with `Secure; HttpOnly; SameSite=Strict; Path=/`. No `Domain` attribute. Implemented in `src/frontend/src/app/api/auth/sync/route.ts`, `refresh/route.ts`, and `logout/route.ts`.
- **`__Host-` cookie prefix:** Prevents subdomain cookie injection — compliant browsers reject `__Host-` cookies set from any context that does not match the origin exactness requirements (HTTPS, no Domain, Path=/).
- **Origin/Referer validation middleware:** `src/backend/utils/csrf.py` — `csrf_middleware` is registered on the FastAPI app via `app.middleware("http")`. GET/HEAD/OPTIONS bypass (safe methods). POST/PUT/PATCH/DELETE without a valid Origin or Referer matching the configured allowlist are rejected with 403. Allowlist from `CSRF_TRUSTED_ORIGINS` env var, falling back to localhost defaults. **Exemption:** the zero-trust public DMZ path prefix `/api/v1/public/` is explicitly excluded from CSRF validation because these endpoints are unauthenticated (no Keycloak JWT, no cookie dependency) and are protected by rate limiting + Pydantic validation instead.
- **Nginx CORS restricted:** `Access-Control-Allow-Origin` set to `$scheme://$host` (not `$http_origin` reflection) in both production and local nginx configs.
- **Pen-test checklist:** `docs/pentest/CSRF-CHECKLIST.md` documents all manual verification procedures.
- **Test coverage:** `src/backend/tests/test_csrf_middleware.py` covers safe methods, invalid/missing Origin, valid Origin, Referer fallback, PUT/PATCH/DELETE variants, and VPS production origin scenarios.

## Related
- [[database/schema-overview]]
- [[backend/api-route-map]]
- [[gaps/frs-codebase-gap-register]]
- `docs/pentest/CSRF-CHECKLIST.md`
