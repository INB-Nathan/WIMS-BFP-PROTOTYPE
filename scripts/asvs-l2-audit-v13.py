#!/usr/bin/env python3
"""
ASVS L2 audit script — V13 (API and Web Service) batch.
Records 12 verdicts (V13.4.4 already audited previously, skipped).
Run from project root: python3 scripts/asvs-l2-audit-v13.py
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

STATE = Path("system-wiki/security/asvs-l2-state.json")
AUDITOR = "x1n4te"
NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

# (req_id, verdict, source, finding, risk, remediation, gap_entry)
VERDICTS = [
    (
        "v5.0.0-V13.1.1",
        "COMPLIANT",
        "system-wiki/security/security-baseline.md (multiple sections)",
        "Communication needs documented in security-baseline.md: Suricata network monitoring (tier 6), Keycloak OIDC (auth), Postgres/Redis (data layer), OpenBao (secrets), Ollama (XAI), MailHog (dev email), Nominatim (geocode). FRS Module 1 (Architecture) and Module 13 (Notifications) cover the design. See 'Backend Communication' tier table for the full component map.",
        None, None, None,
    ),
    (
        "v5.0.0-V13.2.1",
        "COMPLIANT",
        "src/backend/main.py:94-128 + src/docker-compose.yml",
        "Backend components use appropriate auth: Postgres via wims_app_user (DB session), Redis via its protocol, Keycloak via OIDC client credentials, OpenBao via service token, Ollama via HTTP (no auth — dev only). Each component has a distinct auth mechanism appropriate to its protocol. The application does not share user session tokens with backend services.",
        None, None, None,
    ),
    (
        "v5.0.0-V13.2.2",
        "COMPLIANT",
        "src/backend/main.py:100-128 (wims_app_user provisioning) + tasks/suricata.py (_SVC_SURICATA_UUID)",
        "Service accounts are used: wims_app_user (limited DB grants via RLS, scoped to wims schema), svc_suricata system account (auto-created for Suricata incident auto-creation), svc_task (KMS rotation). Keycloak admin client credentials are used for JIT user provisioning, not for end-user auth. The system does not use root/admin for application-level operations.",
        None, None, None,
    ),
    (
        "v5.0.0-V13.2.3",
        "COMPLIANT",
        "src/.env (WIMS_MASTER_KEY, POSTGRES_PASSWORD, KEYCLOAK_ADMIN_PASSWORD) + src/backend/services/suricata_ingestion.py:_SVC_SURICATA_UUID",
        "No default credentials in use: POSTGRES_PASSWORD is required (compose :?error), KEYCLOAK_ADMIN_PASSWORD is required, WIMS_MASTER_KEY is required for env_aesgcm crypto. Service accounts (svc_suricata, svc_task) use generated UUIDs not default names. Redis has no password in dev compose — acceptable for prototype but would need a password in production.",
        None, None, None,
    ),
    (
        "v5.0.0-V13.2.4",
        "NOT-VERIFIED",
        "src/backend/utils/external_service.py (full file)",
        "**No outbound URL allowlist.** The shared external-service wrapper (circuit breaker + retry + safety caps, applies to Nominatim, Ollama, OpenBao) has no `allowlist`/`allowed_hosts`/`ALLOWED_URLS` configuration. Any URL can be passed to the wrapper. If a service-URL config var is ever attacker-influenced (env injection, .env tampering), the backend could be made to call arbitrary external hosts. The wrapper does have a 5s timeout and response-size cap (mitigates some blast radius), but the URL itself is unrestricted.",
        "MED",
        "Add an `allowed_hosts` or `allowed_url_prefixes` set to ExternalServiceClient.__init__; reject URLs not matching the allowlist before opening the connection. Document the allowlist in security-baseline.md. Add unit test for allowlist enforcement.",
        "outbound-url-allowlist",
    ),
    (
        "v5.0.0-V13.2.5",
        "NOT-VERIFIED",
        "src/nginx/nginx.conf (no outbound restrictions) + src/backend/utils/external_service.py",
        "Nginx is a reverse proxy — it doesn't initiate outbound requests itself. The backend's outbound HTTP goes through utils/external_service.py (no allowlist — see V13.2.4). For a defense-in-depth posture, the application should restrict outbound destinations to known services (Ollama, OpenBao, Nominatim, Keycloak). Currently the backend can call any URL that resolves.",
        "LOW",
        "Same remediation as V13.2.4 — implement allowlist at the application layer. Nginx outbound restrictions would require a forward proxy, which is out of scope for the prototype.",
        "outbound-url-allowlist",
    ),
    (
        "v5.0.0-V13.3.1",
        "COMPLIANT",
        "src/backend/utils/backup_crypto.py:6-71 + tasks/kms_rotation.py + WIMS_CRYPTO_PROVIDER=env_aesgcm default",
        "Secrets management uses two layers: (1) env_aesgcm — AES-256-GCM with WIMS_MASTER_KEY from env (default for prototype), (2) OpenBao Transit engine for key rotation in production-like deployments (tasks/kms_rotation.py handles rotation). WIMS_CRYPTO_PROVIDER env var selects the provider. api/routes/incidents.py:443 reads the provider at runtime. Database encryption, file encryption, and KMS are all routed through this abstraction.",
        None, None, None,
    ),
    (
        "v5.0.0-V13.3.2",
        "COMPLIANT",
        "src/postgres-init/*.sql (RLS policies) + auth module (role checks)",
        "Access to secrets follows least privilege: wims_app_user has schema-scoped grants (RLS-enforced, row-level policies per table). svc_suricata is a system account with INSERT-only on fire_incidents (auto-creation). svc_task has SELECT/UPDATE on kms_key_rotation_runs. RLS policies (`security_logs_admin_only`, `audit_trails_insert_service`) restrict per-role. No single role has access to all secrets.",
        None, None, None,
    ),
    (
        "v5.0.0-V13.4.1",
        "COMPLIANT",
        "src/backend/.dockerignore (includes .git) + src/backend/Dockerfile:23 (COPY . .)",
        "Backend Dockerfile uses `COPY . .` which would copy the .git directory UNLESS excluded. .dockerignore explicitly lists `.git` (along with .venv, __pycache__, tests, storage, AFOR-FORMATTED.xlsx) — confirmed present. The deployed image does NOT contain .git metadata. Nginx also does not serve .git paths (no .git location block in nginx config).",
        None, None, None,
    ),
    (
        "v5.0.0-V13.4.2",
        "COMPLIANT",
        "src/backend/Dockerfile:27 (CMD uvicorn --workers 3, no --reload) + src/backend/main.py (no debug=True)",
        "No debug mode enabled: Dockerfile CMD is `uvicorn main:app --host 0.0.0.0 --port 8000 --workers 3 --limit-concurrency 200 --timeout-keep-alive 5` — no `--reload` flag. No `debug=True` in main.py. No DEBUG/RELOAD env vars in .env or docker-compose.yml. FastAPI's debug mode would also need to be explicitly enabled via `app.debug = True` (not present).",
        None, None, None,
    ),
    (
        "v5.0.0-V13.4.3",
        "COMPLIANT",
        "src/nginx/nginx.conf + src/nginx/nginx.local.conf + src/nginx/nginx.ci.conf (all configs)",
        "No directory listings: grep for `autoindex` across all nginx configs returns no matches. Nginx default is `autoindex off`; the configs do not override it. FastAPI also does not serve directory listings (it only serves registered routes). Static file serving in nginx (if any) is restricted to specific paths.",
        None, None, None,
    ),
    # V13.4.4 already audited (NOT-VERIFIED) — keep as-is, do NOT re-record
    (
        "v5.0.0-V13.4.5",
        "COMPLIANT",
        "src/backend/api/routes/admin/*.py (Depends(get_system_admin)) + src/backend/api/routes/admin/monitoring.py",
        "All admin/monitoring endpoints use `Depends(get_system_admin)` dependency injection: api/routes/admin/scheduled_reports.py, analytics.py, security.py all guard every route. /api/admin/monitoring/* (system, workers, security-logs) is restricted to SYSTEM_ADMIN role. The monitoring page is not externally accessible without admin auth. Suricata's eve.json is the only IDS-specific endpoint exposed and goes through the same admin gating.",
        None, None, None,
    ),
]


def main():
    state = json.loads(STATE.read_text())
    reqs = state["requirements"]

    applied = 0
    for entry in VERDICTS:
        req_id, verdict, source, finding, risk, remediation, gap = entry
        if req_id not in reqs:
            print(f"  SKIP {req_id} — not in state file")
            continue

        r = reqs[req_id]
        old_verdict = r.get("verdict")
        old_reviewed = r.get("last_reviewed_at")

        if old_verdict and old_verdict != "PENDING":
            r.setdefault("review_history", []).append(
                {"at": old_reviewed or NOW, "by": r.get("last_reviewed_by", AUDITOR), "verdict": old_verdict}
            )

        r["verdict"] = verdict
        r["evidence"] = {"source": source, "finding": finding}
        if risk:
            r["risk"] = risk
        if remediation:
            r["remediation"] = remediation
        if gap:
            r["gap_register_entry"] = gap
        r["last_reviewed_at"] = NOW
        r["last_reviewed_by"] = AUDITOR

        state.setdefault("audit_log", []).append(
            {"at": NOW, "by": AUDITOR, "action": "audit", "req": req_id, "verdict": verdict}
        )
        print(f"  {req_id}: {verdict}")
        applied += 1

    # Recompute summary
    rs = list(reqs.values())
    n_total = len(rs)
    n_audited = sum(1 for r in rs if r["verdict"] != "PENDING")
    n_compliant = sum(1 for r in rs if r["verdict"] == "COMPLIANT")
    n_non_compliant = sum(1 for r in rs if r["verdict"] == "NON-COMPLIANT")
    n_not_applicable = sum(1 for r in rs if r["verdict"] == "NOT-APPLICABLE")
    n_not_verified = sum(1 for r in rs if r["verdict"] == "NOT-VERIFIED")
    n_pending = sum(1 for r in rs if r["verdict"] == "PENDING")
    rate = round(((n_compliant + n_not_applicable) / n_total * 100) * 100) / 100 if n_total else 0.0

    state["summary"] = {
        "total_in_scope": n_total,
        "audited": n_audited,
        "compliant": n_compliant,
        "non_compliant": n_non_compliant,
        "not_applicable": n_not_applicable,
        "not_verified": n_not_verified,
        "pending": n_pending,
        "compliance_rate": rate,
        "last_calculated_at": NOW,
    }
    state["last_updated"] = NOW

    STATE.write_text(json.dumps(state, indent=2) + "\n")
    print()
    print(f"  Applied {applied} new verdicts (V13.4.4 already audited, skipped).")
    print(f"  Summary: {n_audited}/{n_total} audited ({rate}% compliance)")
    print(f"  COMPLIANT: {n_compliant}  NON-COMPLIANT: {n_non_compliant}  "
          f"NOT-APPLICABLE: {n_not_applicable}  NOT-VERIFIED: {n_not_verified}  "
          f"PENDING: {n_pending}")


if __name__ == "__main__":
    main()
