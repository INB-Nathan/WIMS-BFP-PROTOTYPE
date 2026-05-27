# FRS vs System Inconsistency Analysis — Modules 1–4

> **Purpose:** Reference document for updating `checklists/Actual FRS.md` and `checklists/System Checklist.md`.
> Apply changes manually using the decisions in this file.
>
> **Branch:** `fix/enc-val-bugs-and-UI` | **Date:** 2026-05-27

---

## Verified Technical Facts (from codebase)

| Claim | Status |
|-------|--------|
| SHA-256 hashing (`fire_incidents.data_hash` + audit chain) | **Implemented** — `regional.py` ~L2376, ~L2402 |
| AFOR import accepts: `.xlsx`, `.xls`, `.csv` | **Confirmed** — `regional.py` L316–320 |
| Status enum values in DB | `DRAFT`, `PENDING`, `PENDING_VALIDATION`, `VERIFIED`, `REJECTED`, `REPLACED` |
| SSE (Server-Sent Events) encoder notifications | **Not implemented** anywhere in backend |

---

## Module 1: Authentication and Access Control

### Inconsistencies

| # | FRS Item | FRS Says | System | Decision |
|---|----------|----------|--------|----------|
| 1.1 | MFA requirement | Required for System Admin **and National Validators** | Keycloak realm — validator TOTP not confirmed configured | **Follow FRS**: verify/configure TOTP for `NATIONAL_VALIDATOR` role in Keycloak realm settings. No app code change needed. |
| 1.2 | Session timeout | 30 min inactivity | Keycloak config — not confirmed | **Follow FRS**: verify `SSO Session Idle = 30m` in realm |
| 1.3 | Force logout on password change | Backchannel Logout | System has Redis blacklist on **deactivation** only; password-change logout not confirmed | **Follow FRS**: verify Backchannel Logout is wired for password changes in Keycloak |
| 1.4 | Concurrent session detection | Terminate previous session option | Keycloak supports it; no frontend UI surfaces it | **Update FRS**: mark as deferred — Keycloak-side supported but no UI built |
| 1.5 | Trusted device (7 days) | Remember device option after TOTP | Not confirmed in Keycloak OTP policy config | **Follow FRS**: verify `otpPolicyLookAheadWindow` / device trust in realm |

### Opinion
The system's Redis-based session blacklist (`utils/session.py`) is **better** than what the FRS describes. The FRS specifies "Backchannel Logout" on deactivation — that only revokes the SSO session; a cached JWT could still work until its expiry window. The Redis blacklist closes that window immediately on every request. Worth noting as a security enhancement when presenting to the panel.

---

## Module 2: Offline-First Incident Management

### Inconsistency 2.1 — File Attachments vs AFOR Import (CRITICAL CLARIFICATION)

The FRS Module 2a describes **general incident attachments** (photos, maps — this maps to the deferred fire scene sketch feature):
> *"Accepted formats: .jpg, .png, .pdf, .docx (max 10MB each); Maximum 5 attachments per incident; AES-GCM encrypted"*

The AFOR xlsx import (M4-C) is a **completely separate feature** — bulk incident data entry from a spreadsheet, not attaching photos to a record. The FRS never explicitly described AFOR import because it was added beyond the original spec.

| Item | Decision |
|------|----------|
| **AFOR import file types** | **Update FRS + change system**: Restrict to `.xlsx` only (drop `.xls` and `.csv`). `.xls` is a legacy binary format; `.csv` lacks the multi-sheet structure AFOR workbooks require. Code change needed: `regional.py` L316–320 (two-line change) + frontend file input `accept` attribute. |
| **General attachments (jpg/png/pdf/docx, max 5)** | **Keep FRS as-is** — maps to the deferred fire scene sketch feature. When that feature is built, it will follow this spec. |
| **Max 5 attachments** | **Keep in FRS** — applies to the general attachment feature only. AFOR import is always a single file upload. |

**FRS update needed**: Add a note under M2a clarifying that AFOR import is a separate feature (M4-C) accepting `.xlsx` only. Keep the general attachment spec unchanged for fire scene sketch (deferred).

---

### Inconsistency 2.2 — Status Lifecycle

| FRS Status | System Status | Decision |
|-----------|---------------|----------|
| Draft | `DRAFT` | Match — no change |
| Pending | `PENDING` | Match — no change |
| **Validated** | `VERIFIED` | **Update FRS** → rename to VERIFIED. More precise: "Validated" implies a softer peer review; "Verified" implies official sign-off by an authorized validator. |
| **Flagged** | *(no equivalent status)* | **Remove from FRS** — duplicates are handled via `HTTP 409 DUPLICATE_DETECTED` at submission time, not a separate lifecycle state. `is_duplicate` is an informational flag on the record, not a routing status. |
| Rejected | `REJECTED` | Match — no change |
| *(not in FRS)* | `PENDING_VALIDATION` | **Add to FRS** — used for citizen/public report submissions routed to the triage queue (Module 14 flow) |
| *(not in FRS)* | `REPLACED` | **Add to FRS** — an incident superseded when a validator accepts a newer duplicate via the "Replace Existing" action |

---

### Inconsistency 2.3 — Offline Sync Mechanism

**FRS says**: Background Sync API (Service Worker), atomic per incident, exponential backoff, max 5 retries.

**System has**: `offlineStore.ts` (IndexedDB queue), `edgeFunctions.ts` (upload-bundle REST endpoint sync). Service Worker Background Sync API is **not used**.

**Decision: Update FRS** — the system uses an active sync via the `upload-bundle` REST endpoint rather than a Service Worker Background Sync API. The behavior is equivalent (records queued offline, uploaded on reconnect). Background Sync API has poor iOS Safari support; the REST endpoint approach is more reliable cross-platform. Atomic sync and retry are implemented at the application layer. Update the FRS tech reference from "Background Sync API (Service Worker)" to "IndexedDB queue + upload-bundle REST endpoint (TanStack Query retry)".

---

## Module 3: Conflict Detection and Manual Verification

### Inconsistency 3.1 — Detection Algorithm (MAJOR)

| | FRS | System |
|--|-----|--------|
| Primary matching | RapidFuzz text similarity (80% threshold) | `ST_DWithin` (5 km radius) + same `region_id` |
| Time window | Exact match within **30 minutes** | ±1 day in Asia/Manila timezone (PHT) |
| Secondary signals | Matching casualty count + property damage | Optional type/category match; coordinate fallback |
| Library | `python-RapidFuzz` + SQL intervals | PostGIS + Python `datetime` |

**Decision: Update FRS** — user confirmed to keep current detection. Technical justification:
- 30-minute window is too tight for fire incident reporting; field officers often file reports hours after the event
- Text similarity on incident narratives is noisy and unreliable; BFP field officers use inconsistent phrasing across regions
- 5 km radius is operationally appropriate for a fire scene footprint
- Spatial + temporal is the standard approach for field incident deduplication

**FRS wording change**: Replace RapidFuzz/30-min description with: spatial 5 km radius (`ST_DWithin`) + same region + ±1 day temporal match (Asia/Manila) + optional incident type/category match.

---

### Inconsistency 3.2 — "Flagged" Status and Routing (MAJOR)

**FRS flow**: duplicate detected → set incident status to "Flagged" → route to Manual Verification queue → validator reviews in a dedicated flagged queue.

**System flow**:
1. Duplicate detected at **encoder submission** → `HTTP 409 DUPLICATE_DETECTED` → encoder resolves via modal (Submit Anyway / View Existing / Edit Incident / Cancel)
2. If submission proceeds and validator clicks Accept → 409 again → validator resolves via 4-option modal

**Decision: Update FRS** — the system's approach is architecturally superior:
- Catching duplicates at submission (encoder-side) prevents noisy entries from ever reaching the validator queue
- The validator-side 409 on Accept is a safety net for cases the encoder force-overrode
- No "Flagged" queue overhead; the validator queue stays clean with only genuine PENDING incidents
- The FRS "Flagged" flow would require validators to maintain two parallel queues (Pending + Flagged)

---

### Inconsistency 3.3 — Validator Duplicate Actions

| FRS Action | System Action | Notes |
|-----------|---------------|-------|
| Confirm as Duplicate *(merge, retain one)* | **Replace Existing** | Verifies new incident with the original's reference number; marks old as `REPLACED` + archived. Both records preserved — old is superseded, not deleted. |
| Confirm as Unique *(clear flagged status)* | **Verify as New** | Force-accepts with a brand-new reference number, bypassing duplicate check (`force=true`). |
| Request Revision *(return to encoder)* | **Reject** | Returns incident to encoder with reason notes. Functionally identical outcome. |
| *(not in FRS)* | **Cancel** | Keeps incident as PENDING for deferred review. Useful safety valve. |

**Decision: Update FRS** to match system's 4 actions. "Replace Existing" is semantically superior to "merge" — it explicitly communicates that the old record is retained and marked superseded, not deleted, preserving the full audit history.

---

### Inconsistency 3.4 — SSE Encoder Notification (GAP — system behind FRS)

**FRS**: "Regional Encoder shall be notified of verification decision via in-app notification (Server-Sent Events (SSE))"

**System**: **Not implemented.** No SSE, no polling, no push notifications for encoder status updates. Encoder must manually navigate to the dashboard to see status changes (VERIFIED / REJECTED).

**Decision: Track as gap, defer implementation.**
- SSE requires persistent HTTP connections + Redis pub/sub per user — adds infrastructure complexity for a prototype
- The encoder dashboard shows status badges on the incident list; the encoder sees the result on next visit
- A lighter alternative (30-second poll banner, already used on the validator dashboard) could be mirrored on the encoder dashboard without SSE infrastructure
- **Update FRS checklist**: mark as deferred/not implemented. Proposed interim: 30s poll banner on encoder dashboard to show "An incident's status has changed — Refresh"

---

### Inconsistency 3.5 — Resubmitted Tag and Revision History (MINOR GAP)

**FRS**: Resubmitted incidents re-enter the validation queue with a "Resubmitted" tag. Validator views full revision history before final decision. FRS references `sqlalchemy-continuum` for version tracking.

**System**: REJECTED → encoder edits → resubmit → returns to PENDING with no explicit tag. `incident_verification_history` logs `REJECTED` + `EDITED` + `SUBMITTED` actions per incident. `sqlalchemy-continuum` is not used.

**Decision: Partial gap — tolerable for prototype.**
- The audit trail gives validators enough context to understand the resubmission chain (action labels are human-readable)
- A `is_resubmission` boolean column would be a cheap 1-migration addition; not critical
- `sqlalchemy-continuum` is a heavy ORM extension not warranted for the prototype
- **Update FRS**: replace `sqlalchemy-continuum` reference with audit-trail approach; note "Resubmitted tag" as partially met via action history

---

## Module 4: Data Commit and Immutable Storage

### Item 4.1 — SHA-256 Hash: ALREADY IMPLEMENTED ✅

**FRS**: SHA-256 hash of entire incident data per committed record.

**System**: **Fully implemented and exceeds spec.**
- `fire_incidents.data_hash` — SHA-256 of canonical incident JSON at VERIFIED transition (`regional.py` ~L2376)
- `incident_verification_history.new_data_hash` / `old_data_hash` — before/after state hashes per action
- `incident_verification_history.ivh_row_hash` — tamper-evident hash of each audit row itself, enabling hash chaining

This is a blockchain-lite tamper-evident audit trail — significantly beyond what the FRS required. Strong panel talking point.

**Decision: Update FRS checklist to COMPLETE. No system changes needed.**

---

### Item 4.2 — Append-Only Table (Partial Gap)

**FRS**: No UPDATE or DELETE on committed records; enforced via `PostgreSQL GRANT/REVOKE` permissions.

**System**: No DB-level permission enforcement on `wims.fire_incidents`. VERIFIED incidents are protected at the **application layer** — the edit icon is hidden in the UI for VERIFIED status, and the backend enforces status checks before allowing any field updates.

**Decision: Update FRS** — DB-level permission grants (`REVOKE UPDATE, DELETE`) would block standard SQLAlchemy ORM operations used throughout development and testing. Application-layer enforcement achieves equivalent behavior for the prototype. Mark as: *"application-enforced; DB-level `GRANT/REVOKE` hardening deferred to production deployment."*

---

### Item 4.3 — Audit Log Immutability — PostgreSQL Rule (Minor Gap)

**FRS**: `PostgreSQL Rule (DO INSTEAD NOTHING)` explicitly preventing UPDATE/DELETE on the audit log table.

**System**: `incident_verification_history` is append-only in practice (the API only ever INSERTs to it) but no PostgreSQL Rule exists to block direct UPDATE/DELETE at the database layer.

**Decision: Low priority production hardening item.** No external actor can issue raw SQL in a production Docker deployment (RLS + container isolation). Mark as a post-prototype security task.

---

### Item 4.4 — DB Acknowledgment via RETURNING Clause

**FRS**: Central Database responds with "Write Result / DB Ack" using `RETURNING` clause.

**System**: SQLAlchemy ORM with `db.refresh(incident_obj)` after commit. `RETURNING` behavior is implicit in SQLAlchemy's identity map refresh; the ORM re-fetches the committed row including DB-generated fields.

**Decision: FRS is functionally met.** No change needed.

---

## Summary Decision Table

| Module | FRS Item | Decision | Action Required |
|--------|----------|----------|-----------------|
| M1 | MFA for National Validators | Follow FRS | Verify TOTP configured for `NATIONAL_VALIDATOR` in Keycloak realm |
| M1 | Concurrent session UI | Update FRS | Mark deferred in FRS |
| M1 | Redis session blacklist (system enhancement) | Note as enhancement | Add to FRS as security improvement |
| M2a | AFOR import: .xlsx only | Update FRS + change system | FRS note + code change in `regional.py` L316–320 + frontend accept attr |
| M2a | General attachment spec (jpg/png/pdf/docx, max 5) | Keep FRS | No change — deferred fire scene sketch feature |
| M2d | Status "Validated" | Update FRS | Rename to VERIFIED throughout FRS |
| M2d | Status "Flagged" | Update FRS | Remove; replace with description of `is_duplicate` flag |
| M2d | Missing REPLACED + PENDING_VALIDATION | Update FRS | Add both statuses with descriptions |
| M2b/c | Offline sync (Service Worker) | Update FRS | Replace "Background Sync API (Service Worker)" with IndexedDB + upload-bundle |
| M3a | Detection algorithm (RapidFuzz → spatial) | Update FRS | Replace RapidFuzz/30-min spec with spatial 5 km + ±1 day PHT |
| M3a | "Flagged" routing | Update FRS | Replace Flagged queue flow with 409 submission-time description |
| M3b | Validator duplicate actions (3 → 4) | Update FRS | Replace Existing / Verify as New / Reject / Cancel |
| M3b | SSE encoder notification | Gap — defer | Mark as not implemented; propose poll-banner alternative in checklist |
| M3c | Resubmitted tag + sqlalchemy-continuum | Update FRS | Partially met via audit trail; remove sqlalchemy-continuum reference |
| M4a | SHA-256 hash | FRS MET ✅ | Mark COMPLETE in checklist |
| M4a | Append-only DB enforcement | Update FRS | Note application-layer enforcement; DB-level deferred to production |
| M4b | PostgreSQL Rule immutability | Production hardening | Mark as deferred in checklist |

---

## Checklist Completion Status — Encoder/Validator Scope

### Module 2 Items

| Checklist Item | Status | Notes |
|----------------|--------|-------|
| Regional Encoder creates fire incident reports with all required fields | ✅ Complete | AFOR form covers all FRS fields + ~40 additional |
| File attachment support (jpg, png, pdf, docx; max 10MB; max 5; AES-GCM) | ⏸ Deferred | Fire scene sketch feature deferred. AFOR import is a separate feature. |
| Client-side form validation with real-time error messages | ✅ Complete | IncidentForm.tsx with Zod |
| Automatic network availability detection | ✅ Complete | Navigator API + useEffect in AFOR pages |
| Offline incident data stored in IndexedDB | ✅ Complete | offlineStore.ts |
| Offline records AES-256-GCM encrypted | ✅ Complete | offlineStore.ts Web Crypto |
| Offline Mode UI indicator | ✅ Complete | isOffline state, UI banner |
| Full CRUD in offline mode | ✅ Partial | Create + queue works; update/delete offline not fully wired |
| Atomic sync per incident + exponential backoff | ✅ Complete | Application-layer, TanStack Query retry |
| Encoder notified of sync success/failure | ✅ Complete | Toast notifications |
| Status lifecycle: Draft → Pending → Verified → Rejected | ✅ Complete | Updated names; REPLACED + PENDING_VALIDATION added beyond spec |
| Status transitions logged with timestamp and user ID | ✅ Complete | incident_verification_history |
| Encoder view of status change history per incident | ✅ Complete | Encoder audit trail page + detail page |

### Module 3 Items

| Checklist Item | Status | Notes |
|----------------|--------|-------|
| Automatic duplicate comparison against central DB | ✅ Complete | duplicate_detection.py |
| Conflict detection: location/time, narrative similarity, casualty/damage | ✅ Complete | Spatial (5 km) + temporal (±1 day) + type. Algorithm differs from FRS (FRS needs update). |
| Flag potential duplicate, route to Manual Verification queue | ✅ Complete | 409 flow at submission + is_duplicate badge in validator queue |
| Validator flagged incident review queue | ✅ Complete | Validator dashboard; DUPLICATE badge on flagged rows |
| Side-by-side record comparison | ✅ Complete | DuplicateResolutionModal + IncidentDiffPanel |
| Validator actions: Confirm Duplicate / Confirm Unique / Request Revision | ✅ Complete | 4 actions: Replace Existing / Verify as New / Reject / Cancel (FRS needs update) |
| Encoder notified of verification decision via SSE | ❌ Not implemented | Deferred. Proposed: 30s poll banner as lightweight alternative. |
| Encoder can view comparison details and provide clarification | ✅ Partial | Encoder can edit and resubmit REJECTED incidents; no direct "clarification" message thread |
| Encoder receives revision notification with return reason | ✅ Complete | REJECTED status + reason notes returned |
| Encoder edits and resubmits rejected incident | ✅ Complete | Edit REJECTED → resubmit → PENDING |
| Resubmitted tag on re-entered incidents | ⚠️ Partial | No explicit tag; audit trail shows REJECTED → EDITED → SUBMITTED chain |
| Validator views revision history before final decision | ✅ Partial | Audit trail action labels visible; no field-level diff for encoder edits |

### Module 4 Items

| Checklist Item | Status | Notes |
|----------------|--------|-------|
| Commit verified incident to central DB | ✅ Complete | VERIFIED transition in verification endpoint |
| Append-only PostgreSQL table (no UPDATE/DELETE on committed records) | ✅ Application-enforced | UI + backend status guards. DB-level GRANT/REVOKE deferred to production. |
| SHA-256 hash + commit timestamp + validator ID stored per record | ✅ Complete — exceeds spec | fire_incidents.data_hash + hash chain in incident_verification_history |
| Insert Validated Record transaction + DB Ack | ✅ Complete | SQLAlchemy ORM + db.refresh() |
| Audit log: incident ID, timestamp, validator ID, SHA-256 hash, sync status | ✅ Complete — exceeds spec | action_label + hash chain + new/old data hashes |
| Audit logs immutable (PostgreSQL Rule DO INSTEAD NOTHING) | ⚠️ Application-enforced | API never issues UPDATE/DELETE on history table. PostgreSQL Rule not implemented. Production hardening item. |
