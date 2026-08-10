# Records of Processing Activities (RoPA)
## WIMS-BFP: Secured Web Offline-First Incident Monitoring System

**Document reference:** WIMS-BFP/RoPA/2026-001
**Version:** 1.0
**Date:** 2026-06-26
**Prepared by:** WatchDogs Development Team
**Controller:** Bureau of Fire Protection — National Headquarters
**Applicable regulation:** Republic Act No. 10173 (Data Privacy Act of 2012), §16 and §47; NPC Circular 16-03

---

## Part 1 — Controller Identity

| Field | Value |
|---|---|
| Name of controller | Bureau of Fire Protection (BFP) — National Headquarters |
| Address | BFP National Headquarters, Agham Road, Diliman, Quezon City |
| Contact (DPO) | To be designated per NPC requirement |
| System name | WIMS-BFP Incident Monitoring System |
| System environment | Cloud VPS (Docker-based, 14-container stack) |

---

## Part 2 — Categories of Data Subjects

| # | Category | Description |
|---|---|---|
| DS-01 | Regional Encoder | BFP field personnel encoding AFOR incident reports |
| DS-02 | National Validator | BFP national-level personnel reviewing incident records |
| DS-03 | National Analyst | BFP statisticians querying aggregated data |
| DS-04 | System Administrator | IT personnel administering the WIMS-BFP system |
| DS-05 | Citizen Reporter | Members of the public submitting anonymous fire reports |
| DS-06 | Incident-involved persons | Callers, property owners, and occupants named in incident reports |

---

## Part 3 — Processing Activities

### 3.1 User Account Management

| Attribute | Detail |
|---|---|
| Processing activity | Creation, maintenance, deactivation of BFP personnel accounts |
| Data subjects | DS-01 through DS-04 |
| Personal data collected | Full name, email address (username), assigned role, contact number (optional) |
| Sensitive personal information | None |
| Purpose | Authentication, RBAC enforcement, audit trail attribution |
| Legal basis | RA 10173 §12(e) — government agency function; employment relationship |
| Recipients | System Administrator (internal); Keycloak Identity Provider (internal) |
| Third-country transfers | None |
| Retention | Duration of employment; accounts deactivated (not deleted) on separation |
| Security measures | Keycloak OIDC; MFA (TOTP) for all roles; bcrypt password hashing; RLS |

### 3.2 Incident Report Intake — Public Anonymous Path

| Attribute | Detail |
|---|---|
| Processing activity | Intake of crowdsourced fire reports via unauthenticated public endpoint |
| Data subjects | DS-05 (Citizen Reporter) |
| Personal data collected | Location coordinates, incident type, severity estimate |
| Sensitive personal information | None — system enforces data minimisation; no PII fields on public path |
| Purpose | Rapid incident awareness; triage routing to regional encoders |
| Legal basis | RA 10173 §12(e) |
| Recipients | National Validator (internal) |
| Third-country transfers | None |
| Retention | Indefinite (operational fire record) |
| Security measures | Redis rate limiting (3 req/IP/hr); Pydantic schema validation; no attachment upload |

### 3.3 Incident Report Intake — Civilian Staging Path

| Attribute | Detail |
|---|---|
| Processing activity | Structured fire reports from registered citizens or forwarded calls |
| Data subjects | DS-05 (Citizen Reporter); DS-06 (Incident-involved persons) |
| Personal data collected | Caller name, caller contact number, owner name, occupant name, incident details, location |
| Sensitive personal information | Casualty details (injury/fatality type) may qualify as health information under RA 10173 |
| Purpose | Structured intake for validation and official record creation |
| Legal basis | RA 10173 §12(e); §13(d) for health information |
| Recipients | National Validator, Regional Encoder (internal) |
| Third-country transfers | None |
| Retention | Indefinite (official BFP fire record) |
| Security measures | AES-256-GCM encryption of PII fields (caller name/number, owner/occupant); OpenBao key management; plaintext columns set NULL; RLS |

### 3.4 Regional AFOR Import

| Attribute | Detail |
|---|---|
| Processing activity | Batch import of official AFOR workbooks (.xlsx) submitted by regional encoders |
| Data subjects | DS-06 (Incident-involved persons) |
| Personal data collected | All fields from BFP AFOR form (official format) including caller PII |
| Sensitive personal information | Casualty details |
| Purpose | Conversion of paper AFOR forms to structured digital records |
| Legal basis | RA 10173 §12(e); RA 9514 |
| Recipients | National Validator, National Analyst, System Administrator |
| Third-country transfers | None |
| Retention | Indefinite |
| Security measures | As per §3.3; file type validation (.xlsx only); 10MB per attachment limit |

### 3.5 Authentication and Session Audit Logging

| Attribute | Detail |
|---|---|
| Processing activity | Logging of all authenticated actions for security and forensic purposes |
| Data subjects | DS-01 through DS-04 |
| Personal data collected | User ID (UUID), action type, table affected, record ID, IP address hash (salted SHA-256), user agent, timestamp, correlation ID |
| Sensitive personal information | None — raw IP is hashed; no content logged |
| Purpose | Non-repudiation; anomaly detection; incident response |
| Legal basis | RA 10173 §12(e); legitimate interest (security) |
| Recipients | System Administrator (query via admin audit log UI) |
| Third-country transfers | None |
| Retention | 7 years |
| Security measures | Immutable append-only partitioned table (parent-level BEFORE UPDATE/DELETE triggers raise an error on any prohibited mutation; enforced on current and future partitions, including against superuser-capable maintenance paths); RLS (read: SYSTEM_ADMIN or own records); partitioned by year |

### 3.6 Security Threat Logging and XAI Analysis

| Attribute | Detail |
|---|---|
| Processing activity | Storage and AI analysis of Suricata IDS alerts and behavioural anomalies |
| Data subjects | Any system user whose traffic triggers an IDS signature |
| Personal data collected | Source IP, destination IP, alert payload (may include request URI/headers), XAI narrative |
| Sensitive personal information | None |
| Purpose | Intrusion detection; explainable threat intelligence for HITL review |
| Legal basis | Legitimate interest (security of critical government IT) |
| Recipients | System Administrator |
| Third-country transfers | None — AI inference runs on on-premise VPS Ollama (Qwen2.5-3B) |
| Retention | 7 years |
| Security measures | RLS (SYSTEM_ADMIN + NATIONAL_ANALYST only); append-only via immutability rule; AI model does not exfiltrate data |

### 3.7 Analytics and Statistical Reporting

| Attribute | Detail |
|---|---|
| Processing activity | Aggregated query and export of fire incident statistics |
| Data subjects | None directly — data is aggregated and de-identified |
| Personal data collected | None (aggregates only: count, region, type, period) |
| Sensitive personal information | None |
| Purpose | National fire statistics; resource planning; policy support |
| Legal basis | RA 10173 §12(e); RA 9514 |
| Recipients | National Analyst (internal); BFP management |
| Third-country transfers | None |
| Retention | Exported reports retained per BFP records management policy |
| Security measures | Materialized views; export logged in audit trail; Analyst role cannot modify records |

---

## Part 4 — Security Measures Summary

| Control | Implementation |
|---|---|
| Encryption at rest (PII) | AES-256-GCM via `SecurityProvider`; keys via OpenBao Transit; 90-day rotation |
| Encryption at rest (offline) | AES-256-GCM via Web Crypto API in browser IndexedDB |
| Encryption in transit | TLS 1.2/1.3; HSTS (max-age=31536000, includeSubDomains); Nginx edge gateway |
| Access control | RBAC (5 roles); Keycloak OIDC; Row-Level Security (PostgreSQL GUC) |
| Authentication | Min. 8-char password; TOTP MFA; account lockout after 5 attempts; 30-min idle timeout |
| Audit and non-repudiation | Immutable `system_audit_trails` (partitioned, append-only; parent-level UPDATE/DELETE triggers raise an error); SHA-256 commit hash |
| Intrusion detection | Suricata IDS (AF_PACKET host-mode); custom BFP rules + weekly ET Open ruleset; Qwen2.5-3B XAI |
| Vulnerability management | Monthly Nmap/OWASP ZAP/sqlmap scanning; severity-SLA remediation; quarterly post-deployment |
| Incident response | Automated breach record; 72h NPC notification window enforced; HITL threat review |

---

## Part 5 — Accessibility

This RoPA is maintained in the `docs/compliance/` directory of the WIMS-BFP source repository and is accessible to:
- System Administrator (via repository access)
- Designated Data Protection Officer (BFP NHQ)
- Project Adviser and Course Adviser (FEU Institute of Technology)

---

## Part 6 — Review Schedule

This RoPA shall be reviewed annually or upon any change to:
- Data categories collected or their purpose
- Third-party processors or service providers
- Applicable legislation or NPC circulars
- Major system architecture changes

**Next scheduled review:** June 2027
