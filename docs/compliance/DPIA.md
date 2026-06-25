# Data Protection Impact Assessment (DPIA)
## WIMS-BFP: Secured Web Offline-First Incident Monitoring System

**Document reference:** WIMS-BFP/DPIA/2026-001
**Version:** 1.0
**Date:** 2026-06-26
**Prepared by:** WatchDogs Development Team
**Reviewed by:** Project Adviser — Dr. Kirk Alvin S. Awat
**Applicable regulation:** Republic Act No. 10173 (Data Privacy Act of 2012) and its IRR

---

## 1. Purpose and Scope

This DPIA documents the privacy risks inherent in deploying WIMS-BFP on a cloud Virtual Private Server (VPS) and describes the technical and organisational measures applied to mitigate those risks. It covers all personal data processed by the system from collection through archival.

**In scope:**
- Collection of personal data via incident report submissions (public, civilian, and regional encoder paths)
- Storage and processing of user account data (BFP personnel)
- Audit logging of all system actions
- AI/XAI analysis of security threat logs
- Export and reporting of aggregated incident statistics

**Out of scope:**
- Data held exclusively in BFP National Headquarters paper records
- Processing by third-party identity providers beyond the WIMS-BFP Keycloak integration

---

## 2. Data Processing Activities

| Activity | Data Categories | Legal Basis | Retention Period |
|---|---|---|---|
| Incident report intake (public) | Location, incident type, severity (no PII required) | Public interest / official authority (RA 10173 §12(e)) | Indefinite (operational record) |
| Incident report intake (civilian/regional) | Caller name, caller number, owner name, occupant name, incident details | Public interest / official authority | Indefinite (operational record) |
| User account management | Full name, email address, role, contact number | Contractual / consent (BFP personnel) | Duration of employment + 7 years |
| Authentication and session audit | User ID, IP address (hashed), timestamp, action type | Legitimate interest (security) | 7 years |
| Security threat logging | Source IP, destination IP, alert payload, XAI narrative | Legitimate interest (security) | 7 years |
| Analytics and reporting | Aggregated, de-identified incident statistics | Public interest | Indefinite |
| Breach notification | Date/time, affected data categories, estimated scope | Legal obligation (RA 10173 §20) | 7 years |

---

## 3. Identified Privacy Risks and Mitigations

| # | Risk | Likelihood | Impact | Mitigation | Residual Risk |
|---|---|---|---|---|---|
| R-01 | Unauthorised access to PII fields (caller name/number, owner/occupant) via database breach | Medium | High | AES-256-GCM encryption of all PII fields at rest; OpenBao key management with 90-day auto-rotation; plaintext columns set NULL | Low |
| R-02 | Token/session hijacking allowing impersonation | Medium | High | OIDC session tokens (httpOnly, Secure, SameSite=Strict cookies); 30-min idle timeout; backchannel logout on role change/password reset; Redis session revocation list | Low |
| R-03 | Insider threat — privileged user exfiltrating data | Low | High | Role-based access control (5 roles, least privilege); Row-Level Security (PostgreSQL GUC per request); immutable audit trail; behavioural anomaly detection (BULK_DELETE, SUSPICIOUS_QUERY_PATTERN detectors) | Low |
| R-04 | Cloud VPS compromise exposing database | Low | Critical | TLS 1.2/1.3 in transit; AES-256-GCM at rest; Suricata IDS monitoring all host-interface traffic; network anomaly detection | Low–Medium |
| R-05 | Offline IndexedDB cache on lost/stolen device | Low | Medium | AES-256-GCM encryption of all locally cached incidents via Web Crypto API before IndexedDB storage; per-user key isolation | Low |
| R-06 | Anonymous public endpoint abuse collecting incidental PII | Medium | Low | Data minimisation enforced by Pydantic schema (no PII required); Redis rate limiting (3 req/IP/hour); no CAPTCHA to avoid accessibility barriers | Low |
| R-07 | AI/XAI logs retaining sensitive security context | Low | Medium | XAI narratives stored in the same append-only `security_threat_logs` table subject to RLS; SYSTEM_ADMIN access only; 7-year retention then archival | Low |
| R-08 | Undetected breach with delayed notification | Low | High | Automated breach record creation on CONFIRM_THREAT (HIGH/CRITICAL); `npc_deadline_at` computed as detected_at + 72 hours; breach alert email dispatched immediately; admin breach tracking UI | Low |

---

## 4. Legal Basis for Processing

Processing under WIMS-BFP is grounded in:
- **RA 10173 §12(e)** — processing necessary for the performance of a function of a government agency (BFP fire suppression operations and national statistics).
- **RA 10173 §12(b)** — processing pursuant to legal mandate (BFP mandate under RA 9514, Fire Code of the Philippines).
- Sensitive personal information (if incidentally collected) is processed only as operationally necessary under §13(d) — medical and health information for casualty reporting.

---

## 5. Data Minimisation Statement

The system collects only the minimum data required for each intake path:
- **Public endpoint** (`POST /api/v1/public/report`): no PII fields required; location and incident type only.
- **Civilian staging**: structured fields limited to operationally necessary contact details for incident follow-up.
- **Regional AFOR import**: fields defined by BFP AFOR form (official record format); no additional PII collected.
- Audit logs retain IP address only as a salted SHA-256 hash (`ip_hash`), not raw.

---

## 6. Individual Rights

| Right | Implementation |
|---|---|
| Right to access | Users may request a copy of their submitted incidents via the encoder/civilian portal; admin may export via audit log query |
| Right to rectification | Encoders may edit draft/returned incidents; validators may request revision before commit |
| Right to erasure | Soft-delete (archive flag) with full audit trail preserved; hard deletion prohibited to maintain forensic integrity |
| Right to data portability | Incident data exportable in CSV and XLSX formats by National Analyst |
| Right to object | Handled via DPO process; no automated profiling performed |

---

## 7. Retention Periods

| Data Category | Active Retention | Archive / Purge |
|---|---|---|
| Fire incident records | Indefinite (operational record) | Transfer to BFP archives on system decommission |
| User accounts | Duration of employment | Deactivated (soft-delete); hard deletion prohibited |
| Audit logs | 7 years from event | PostgreSQL archival or pg_dump |
| Security threat logs | 7 years from event | Archival |
| Offline IndexedDB cache | Until sync confirmed | Automatically cleared post-sync |
| Breach records | 7 years | Archival |

---

## 8. Review Schedule

This DPIA shall be reviewed:
- **Annually** — scheduled for June 2027.
- **Upon major infrastructure changes**, including: VPS provider change, database migration, new data category collection, Keycloak version upgrade, or AI model replacement.

The review shall be documented as a new versioned DPIA revision and retained alongside this document.

---

## 9. Approvals

| Role | Name | Signature | Date |
|---|---|---|---|
| Project Manager | Cabrales, Nathan Josua C. | ______________ | ________ |
| QA Engineer | Cabrales, Nathan Josua C. | ______________ | ________ |
| Project Adviser | Dr. Kirk Alvin S. Awat | ______________ | ________ |
| Data Protection Officer (designated) | TBD — BFP NHQ | ______________ | ________ |
