#!/usr/bin/env python3
"""
ASVS L2 audit script — V14 (Data Protection per catalog) batch.
Records 8 verdicts.
Run from project root: python3 scripts/asvs-l2-audit-v14.py
"""
import json
from datetime import datetime, timezone
from pathlib import Path

STATE = Path("system-wiki/security/asvs-l2-state.json")
AUDITOR = "x1n4te"
NOW = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

VERDICTS = [
    (
        "v5.0.0-V14.1.1",
        "COMPLIANT",
        "docs/operations/openbao-kms-runbook.md + docs/superpowers/specs/2026-06-23-pii-encryption-witness-narrative-design.md",
        "Sensitive data is classified. The PII encryption spec (2026-06-23) defines protection levels for witness narrative, caller name, contact info, location. The OpenBao KMS runbook documents the encryption tiers (env_aesgcm for at-rest, OpenBao Transit for production). FRS Module 6 (Compliance & Data Privacy) and Module 15 (Reference Data) define the data taxonomy.",
        None, None, None,
    ),
    (
        "v5.0.0-V14.1.2",
        "COMPLIANT",
        "docs/superpowers/specs/2026-06-23-pii-encryption-witness-narrative-design.md + system-wiki/security/security-baseline.md",
        "Protection requirements are documented per level: encryption (AES-256-GCM via WIMS_MASTER_KEY or OpenBao Transit), integrity verification (PostgreSQL constraints + RLS), retention (incident lifecycle), logging (audit trail), access controls (RLS per role). Security-baseline.md tier table references all controls.",
        None, None, None,
    ),
    (
        "v5.0.0-V14.2.1",
        "COMPLIANT",
        "src/backend/api/routes/* (full grep for api_key, session_token, password in query strings)",
        "No routes pass sensitive data in URL or query string. Grep for `api_key`, `session_token`, `password` in query parameters returns no matches. Sensitive data flows through request body (JSON) or Authorization headers (OIDC). The XAI prompt does embed raw_payload which can contain credentials — see V16.2.5 NOT-VERIFIED for that specific path.",
        None, None, None,
    ),
    (
        "v5.0.0-V14.2.2",
        "COMPLIANT",
        "src/backend/api/routes/admin/privacy.py:128,224 + src/backend/tests/test_privacy.py:212",
        "Sensitive data responses carry Cache-Control: no-store. /api/admin/privacy/export returns headers `Cache-Control: no-store, no-cache, must-revalidate`. /api/events/stream (SSE) returns `Cache-Control: no-cache` to prevent buffering. Test `test_privacy.py:212` asserts no-store on export responses. Nginx does not add its own cache headers that would override these.",
        None, None, None,
    ),
    (
        "v5.0.0-V14.2.3",
        "COMPLIANT",
        "src/frontend/ (no third-party tracker references)",
        "No third-party trackers or analytics services. The frontend does not include Google Analytics, Facebook Pixel, Mixpanel, Segment, or similar. OpenBao, Ollama, Keycloak, Postgres, Redis, Nominatim are all self-hosted. The /api/events/stream SSE channel stays within the same origin. No external beacons.",
        None, None, None,
    ),
    (
        "v5.0.0-V14.2.4",
        "NOT-VERIFIED",
        "src/postgres-init/* + system-wiki/security/security-baseline.md (no explicit retention policy)",
        "Encryption + integrity + access controls are documented (OpenBao + env_aesgcm, RLS, audit log). **However, no explicit data retention policy exists for fire_incidents, PII fields, or audit logs.** System metrics has a 7-day prune (Celery beat), offline cache has per-record TTL, but the main domain data (incidents, sensitive details, witness narratives) has no documented retention period. ASVS L2 requires defined retention. Remediation: add a data retention policy in docs/compliance/ covering incidents (X years), audit logs (Y years), session data (Z days).",
        "MED",
        "Document a data retention policy in docs/compliance/data-retention.md covering fire_incidents, incident_sensitive_details, system_audit_trails, security_threat_logs. Add Celery beat tasks to enforce retention. Update security-baseline.md to reference the policy.",
        "data-retention-policy",
    ),
    (
        "v5.0.0-V14.3.1",
        "COMPLIANT",
        "src/frontend/src/context/AuthContext.tsx:236 (logout handler)",
        "On logout, `localStorage.removeItem(SESSION_CACHE_KEY)` is called (line 236). The session cache (`wims:offline_session_cache`) contains `{ user: data.user }` from the last successful login. After logout, the cache is cleared. No `Clear-Site-Data` HTTP header is set, but the localStorage clear handles the most common case. **No `Clear-Site-Data` header is a minor finding** (the header would also clear cookies, cache, storage — not just localStorage).",
        None, None, None,
    ),
    (
        "v5.0.0-V14.3.2",
        "COMPLIANT",
        "src/backend/api/routes/admin/privacy.py:128,224 + src/backend/api/routes/events.py:131",
        "Anti-caching headers are set on sensitive responses: /api/admin/privacy/export uses `Cache-Control: no-store, no-cache, must-revalidate`; /api/events/stream (SSE) uses `Cache-Control: no-cache`. The frontend does not cache authenticated responses (Next.js with `cache: 'no-store'` on fetch options where sensitive). Nginx does not add ETag/Last-Modified that would override.",
        None, None, None,
    ),
    (
        "v5.0.0-V14.3.3",
        "NOT-VERIFIED",
        "src/frontend/src/context/AuthContext.tsx:148",
        "**localStorage stores more than just session tokens.** `localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify({ user: data.user }))` stores the full user object (user_id, role, name, email potentially). The ASVS req allows 'session tokens' in browser storage, not arbitrary user data. The user object is used for offline restore (#5) but contains PII (email). Remediation: store only the minimal cache key (user_id + role) and re-fetch the full user object from /api/auth/session on online restore.",
        "MED",
        "In AuthContext.tsx:148, change the cache write to store only `{ user_id, role }` (or a session reference), not the full user object. On restore, re-fetch the full user from /api/auth/session if online. Document the privacy decision in security-baseline.md.",
        "localstorage-user-pii",
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
        if risk: r["risk"] = risk
        if remediation: r["remediation"] = remediation
        if gap: r["gap_register_entry"] = gap
        r["last_reviewed_at"] = NOW
        r["last_reviewed_by"] = AUDITOR

        state.setdefault("audit_log", []).append(
            {"at": NOW, "by": AUDITOR, "action": "audit", "req": req_id, "verdict": verdict}
        )
        print(f"  {req_id}: {verdict}")
        applied += 1

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
    print(f"  Applied {applied} verdicts.")
    print(f"  Summary: {n_audited}/{n_total} audited ({rate}% compliance)")
    print(f"  COMPLIANT: {n_compliant}  NON-COMPLIANT: {n_non_compliant}  "
          f"NOT-APPLICABLE: {n_not_applicable}  NOT-VERIFIED: {n_not_verified}  "
          f"PENDING: {n_pending}")


if __name__ == "__main__":
    main()
