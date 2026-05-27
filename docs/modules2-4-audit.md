# WIMS-BFP — System Checklist Audit (Modules 2–4)

**Audit date:** 2026-05-27
**Scope:** Modules 2, 3, 4 (offline-first, cryptography/PII, commit/audit)

Summary: each checklist line is mapped to one of: Verified / Inconsistency found (+explanation) / Not implemented. Evidence links point to repository files. One-line remediation recommendations follow each item. Highest priority items are listed first.

---
**Metadata**
- Audit date: 2026-05-27
- Scope: Modules 2, 3, 4 (offline-first, cryptography/PII, commit/audit)
- Repo evidence inspected: [src/backend/utils/crypto.py](src/backend/utils/crypto.py), [src/backend/api/routes/incidents.py](src/backend/api/routes/incidents.py), [src/backend/api/routes/regional.py](src/backend/api/routes/regional.py), [src/frontend/src/lib/offlineStore.ts](src/frontend/src/lib/offlineStore.ts), [src/frontend/src/lib/syncEngine.ts](src/frontend/src/lib/syncEngine.ts), [src/frontend/public/sw.js](src/frontend/public/sw.js), system wiki and docs ([system-wiki/](system-wiki/), [docs/](docs/)).

---

## Module 2 — Offline-first, Bundles, Sync, Attachments

- **2.1 Attachments encrypted before storage**
  - Status: Inconsistency found
  - Evidence: server saves uploads to disk and records path/hash without encrypting attachment blobs: [src/backend/api/routes/incidents.py](src/backend/api/routes/incidents.py). SW and offline flows do not encrypt attachments prior to local storage: [src/frontend/public/sw.js](src/frontend/public/sw.js).
  - Explanation: attachments are written as plaintext files on server and uploaded from client without prior AEAD sealing.
  - Remediation: Add client-side AES‑GCM encryption for attachments before local/offline storage and accept encrypted attachment blobs on server (or perform server-side AES‑GCM sealing on ingest). Priority: P0.

- **2.2 Offline-captured records encrypted (AES‑256‑GCM) before local storage**
  - Status: Not implemented
  - Evidence: `offlineStore` writes JSON payloads directly into IndexedDB without encryption: [src/frontend/src/lib/offlineStore.ts](src/frontend/src/lib/offlineStore.ts).
  - Explanation: FR requires AEAD sealing of offline records before persistence; current code stores raw JSON.
  - Remediation: Implement Web Crypto AES‑GCM encryption on client before writing to IndexedDB; store nonce + ciphertext + metadata. Priority: P0.

- **2.3 Verify cryptographic integrity (AEAD tag) on decrypt**
  - Status: Partially implemented
  - Evidence: Backend `SecurityProvider` verifies AEAD on decrypt: [src/backend/utils/crypto.py](src/backend/utils/crypto.py); client-side decrypt/verify absent for offline records.
  - Explanation: server-side AEAD verification exists, but offline records are not sealed so integrity checks cannot run end‑to‑end for PWA bundles.
  - Remediation: Ensure client creates AEAD-encrypted records and server verifies tag on ingestion; treat tag failures as auditable errors (reject or escalate). Priority: P0.

- **2.4 Background Sync & service-worker processing of pending items**
  - Status: Verified
  - Evidence: SW registers `sync` handler and `syncEngine` exists: [src/frontend/public/sw.js](src/frontend/public/sw.js), [src/frontend/src/lib/syncEngine.ts](src/frontend/src/lib/syncEngine.ts).
  - Explanation: Background Sync logic is present in SW and app-level sync engine.
  - Remediation: Harden retries with exponential backoff + jitter; add durable retry counters and per-item status reporting. Priority: P1.

- **2.5 Atomic per‑incident synchronization & conflict handling (LWW)**
  - Status: Partially implemented
  - Evidence: `syncEngine.ts` processes items sequentially and implements 409 LWW retry logic; SW sync posts and deletes on success but lacks full conflict resolution parity: [src/frontend/src/lib/syncEngine.ts](src/frontend/src/lib/syncEngine.ts), [src/frontend/public/sw.js](src/frontend/public/sw.js).
  - Explanation: Conflict handling exists at app level (LWW) but SW/cellular sync lacks transactional guarantees and server may need idempotency endpoints.
  - Remediation: Implement identical conflict resolution in SW and ensure server provides idempotent commit endpoint per incident (or idempotency keys) to support atomic sync. Priority: P1.

- **2.6 Offline bundle (.wims) generation sealed with AES‑GCM**
  - Status: Not implemented
  - Evidence: FR spec exists in wiki, no frontend generator found in `src/frontend/src`: [system-wiki/raw/frs/frs-offlinefirst.md](system-wiki/raw/frs/frs-offlinefirst.md).
  - Explanation: No `.wims` packager or sealed bundle generator detected.
  - Remediation: Implement bundle assembly in PWA: include JSON manifest, attachments (encrypted), nonce, tag and metadata; use Web Crypto AES‑GCM and clear guidelines for key derivation. Priority: P1.

- **2.7 Attachments included & encrypted inside offline bundle**
  - Status: Not implemented
  - Evidence: Attachments handled separately and stored/plain uploaded: [src/backend/api/routes/incidents.py](src/backend/api/routes/incidents.py), SW/offline store lacks bundle composition.
  - Explanation: Attachments are not packaged/sealed into offline bundles.
  - Remediation: Integrate attachments into `.wims` sealed bundles with AEAD; include manifest with SHA‑256 of each attachment. Priority: P1.

---

## Module 3 — Cryptography, PII, Key Management

- **3.1 AES‑256‑GCM PII at rest (AAD = incident_id)**
  - Status: Verified
  - Evidence: `SecurityProvider` implements AES‑256‑GCM with nonce and AAD usage in backend: [src/backend/utils/crypto.py](src/backend/utils/crypto.py); regional commit uses provider: [src/backend/api/routes/regional.py](src/backend/api/routes/regional.py).
  - Explanation: Backend uses AESGCM via cryptography library, returns nonce + ciphertext; docs assert AAD binds to incident.
  - Remediation: Maintain tests and CI for crypto code; document expected AAD usage in system-wiki. Priority: P0 (maintain).

- **3.2 Plaintext PII columns must be NULL for new writes**
  - Status: Inconsistency found
  - Evidence: Compatibility ingestion endpoint `upload_incident_bundle` writes plaintext PII into `wims.incident_sensitive_details` (populates `caller_name`, `owner_name`, etc.): [src/backend/api/routes/incidents.py](src/backend/api/routes/incidents.py).
  - Explanation: Policy requires new writes leave plaintext columns NULL and use `pii_blob_enc`; ingestion bypasses `SecurityProvider`.
  - Remediation: Refactor ingestion endpoints to call `SecurityProvider.encrypt_json()` and store `pii_blob_enc` + `encryption_iv`, set plaintext columns NULL. Add unit tests asserting plaintext columns NULL for new writes. Priority: P0.

- **3.3 Decryption failure policy**
  - Status: Verified / documented
  - Evidence: `SecurityProvider` logs and raises on decryption/auth failures; docs mention fallback to legacy plaintext columns for compatibility: [src/backend/utils/crypto.py](src/backend/utils/crypto.py), [CLAUDE.md](CLAUDE.md).
  - Explanation: Decrypt failures are logged and handled with controlled fallback.
  - Remediation: Ensure audit trail records every fallback and alert thresholds for repeated failures. Priority: P1.

- **3.4 Key management: `WIMS_MASTER_KEY`, 32‑byte base64**
  - Status: Verified
  - Evidence: `.env.example` documents a 32‑byte base64 key; `SecurityProvider` reads env var at init: [.env.example](.env.example), [src/backend/utils/crypto.py](src/backend/utils/crypto.py).
  - Explanation: Key currently sourced from env; rotation/KMS not implemented.
  - Remediation: Move key to KMS/HSM for production; add rotation process and key id versioning in metadata. Priority: P2.

- **3.5 Backup encryption for DB dumps (.sql.enc)**
  - Status: Verified
  - Evidence: `backup_crypto.py` encrypts SQL dumps with AES‑GCM: [src/backend/utils/backup_crypto.py](src/backend/utils/backup_crypto.py).
  - Explanation: Backup encryption implemented; admin docs reference `pg_dump` -> `.sql.enc`.
  - Remediation: Add automated test for backup/restore and access controls for backup artifacts. Priority: P2.

---

## Module 4 — Commit, Append-only, IVH, Hashing, Audit

- **4.1 Commit/officialization: append-only storage & IVH**
  - Status: Partially implemented
  - Evidence: IVH insertion functions exist and adapt to schema variants: [src/backend/api/routes/regional.py](src/backend/api/routes/regional.py); SQL `postgres-init/` contains structures suggesting append-only intent.
  - Explanation: IVH and commit flows exist, but DB-level enforcement (triggers/policies to make finalized records append-only) need verification.
  - Remediation: Add DB triggers or RLS policies to enforce append-only behavior for `fire_incidents` once `VERIFIED` or `OFFICIAL`, and require IVH entries for any changes with enforced chaining. Priority: P0.

- **4.2 SHA‑256 hashing of commit snapshots and IVH chaining**
  - Status: Partially implemented / gap
  - Evidence: regional code checks presence of hash columns and supports chaining when present: [src/backend/api/routes/regional.py](src/backend/api/routes/regional.py). I could not find consistent automatic SHA‑256 computation on every commit across all flows.
  - Explanation: Support code exists, but enforcement and consistent population across all commit endpoints is not demonstrably present.
  - Remediation: Implement consistent server-side computation of SHA‑256 snapshots for before/after commit states and populate IVH `old_data_hash`, `new_data_hash`, `prev_ivh_hash`, `ivh_row_hash`. Add unit tests and DB constraints ensuring non-null hashes for IVH rows. Priority: P0.

- **4.3 Audit trails & append-only system audit**
  - Status: Verified
  - Evidence: Audit utilities and calls exist; `system-wiki/log.md` and audit utilities referenced in routes: [system-wiki/log.md](system-wiki/log.md), `utils.audit` references in regional routes.
  - Explanation: Audit logging is present; ensure immutability/retention enforced at infra level.
  - Remediation: Store audit logs in append-only storages (WORM), enforce retention, and add CI checks that audit events are emitted for key flows (commits, key rotation, fallback decrypts). Priority: P1.

---

## Cross-cutting Risks & Process Gaps

- **RLS dependency ordering risk**
  - Status: Risk identified
  - Evidence: `get_db_with_rls` and `get_current_wims_user` are used as separate dependencies in routes (ordering matters): see multiple routes, e.g., [src/backend/api/routes/incidents.py](src/backend/api/routes/incidents.py), [src/backend/api/routes/regional.py](src/backend/api/routes/regional.py).
  - Explanation: If DB-with-RLS dependency runs before request state user is set, `wims.current_user_id` may be unset and policies could be bypassed.
  - Remediation: Implement a composite FastAPI dependency that ensures user extraction runs before DB session with RLS context is created; add tests for ordering. Priority: P0.

- **CI enforcement of mandatory `system-wiki` updates**
  - Status: Not implemented
  - Evidence: `AGENTS.md` requires wiki updates for non-trivial changes but no CI hook found.
  - Explanation: Process rule is documented but not enforced.
  - Remediation: Add CI job that checks PRs for non-trivial changes and verifies `system-wiki/` update or requires a checklist item in PR description. Priority: P2.

---

## Prioritized Remediation Summary (Top 6)
1. (P0) Fix PII ingestion: refactor `upload_incident_bundle` and other ingest endpoints to use `SecurityProvider.encrypt_json()` and store `pii_blob_enc` + `encryption_iv`; set plaintext PII columns NULL. See [src/backend/api/routes/incidents.py](src/backend/api/routes/incidents.py) and [src/backend/api/routes/regional.py](src/backend/api/routes/regional.py).
2. (P0) Implement client-side AES‑GCM sealing for offline records and attachments before IndexedDB and SW storage; update sync to post sealed bundles. See [src/frontend/src/lib/offlineStore.ts](src/frontend/src/lib/offlineStore.ts), [src/frontend/public/sw.js](src/frontend/public/sw.js).
3. (P0) Add DB triggers/RLS policies to enforce append-only for finalized records; compute and store SHA‑256 commit snapshots in IVH rows. See `postgres-init/` scripts.
4. (P0) Create composite FastAPI dependency to ensure `get_current_wims_user` runs before `get_db_with_rls`.
5. (P1) Harden SW and `syncEngine` with exponential backoff, jitter, and UI-visible error reporting; ensure SW uses same conflict-resolve policy as the app.
6. (P2) Move `WIMS_MASTER_KEY` to KMS/HSM and document rotation plan; add CI tests for backup encryption/decryption.

---

Progress note: this audit maps Modules 2–4 items to repo evidence and provides prioritized remediation recommendations. If you want I can (A) open a PR with the top P0 fixes, or (B) extend the audit to the rest of the checklist once provided.

**Wiki update:** I did not update `system-wiki/` for this documentation-only audit. If you want this audit mirrored into the wiki synthesis pages, tell me which target page to update.
