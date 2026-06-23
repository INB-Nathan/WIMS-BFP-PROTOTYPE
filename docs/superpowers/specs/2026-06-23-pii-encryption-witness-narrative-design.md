# Encrypt Witness PII & AI Narratives at Rest

**Date:** 2026-06-23  
**Status:** Design (v2, post-review)  
**Pattern:** AES-256-GCM via existing `SecurityProvider` + `get_crypto_provider()`  
**Review:** Verified against current source — fixes applied for migration numbers, UUID serialization, AAD binding, decrypt-failure policy, and ai_service read-back.

---

## Files to Change

| # | File | Action | Change |
|---|---|---|---|
| 1 | `src/postgres-init/69_citizen_reports_pii_encryption.sql` | **Create** | Add 4 blob columns to `citizen_reports` |
| 2 | `src/postgres-init/70_incident_ai_narrative_encryption.sql` | **Create** | Add 4 encryption columns to `fire_incidents` |
| 3 | `src/backend/models/citizen_report.py` | **Edit** | Add blob columns to SA model |
| 4 | `src/backend/api/routes/civilian.py` | **Edit** | Encrypt on submit + append; decrypt on read |
| 5 | `src/backend/services/ai_service.py` | **Edit** | Encrypt narrative before DB write; decrypt on read-back |
| 6 | `src/backend/api/routes/admin/privacy.py` | **Edit** | Decrypt witness blob in export path |
| 7 | `src/backend/scripts/encrypt_citizen_reports_backlog.py` | **Create** | Backfill existing plaintext witness rows |
| 8 | `src/backend/scripts/encrypt_ai_narratives_backlog.py` | **Create** | Backfill existing plaintext narrative rows |
| 9 | `src/backend/tests/test_privacy.py` | **Edit** | Assert encrypted witness PII in export + decrypt-failure |
| 10 | `src/backend/tests/test_incident_narrative.py` | **Edit** | Assert encrypted narrative in DB |

---

## DB Schema Changes

### Migration 69 — citizen_reports

```sql
ALTER TABLE wims.citizen_reports
    ADD COLUMN IF NOT EXISTS witness_pii_blob_enc TEXT,
    ADD COLUMN IF NOT EXISTS witness_encryption_iv TEXT,
    ADD COLUMN IF NOT EXISTS witness_crypto_provider VARCHAR(64),
    ADD COLUMN IF NOT EXISTS witness_key_version INTEGER;
```

Blob JSON shape: `{"witness_name": "...", "witness_phone": "...", "device_id": "...", "ip_hash": "..."}`  
AAD namespace: `citizen_report:{report_id}` (unique — no other blob uses this prefix)

### Migration 70 — fire_incidents

```sql
ALTER TABLE wims.fire_incidents
    ADD COLUMN IF NOT EXISTS ai_narrative_enc TEXT,
    ADD COLUMN IF NOT EXISTS ai_narrative_encryption_iv TEXT,
    ADD COLUMN IF NOT EXISTS ai_narrative_crypto_provider VARCHAR(64),
    ADD COLUMN IF NOT EXISTS ai_narrative_key_version INTEGER;
```

Encrypted payload: `{"narrative": "..."}`  
AAD namespace: `incident_id:{incident_id}:ai_narrative` (distinct from `incident_sensitive_details.pii_blob_enc` which uses `incident_id:{id}` — prevents ciphertext swap attack)

---

## Write Path

### civilian.py — submit_civilian_report()

```
pii_dict = {
    "witness_name": body.witness_name,
    "witness_phone": body.witness_phone,
    "device_id": str(body.device_id) if body.device_id else None,
    "ip_hash": ip_hash,
}
# Strip None values so encrypt_json doesn't choke on raw UUID
pii_for_blob = {k: v for k, v in pii_dict.items() if v is not None}

if pii_for_blob:
    aad = f"citizen_report:{temp_id}".encode("utf-8")
    provider = get_crypto_provider()
    nonce_b64, ct_b64 = provider.encrypt_json(pii_for_blob, aad)
    # INSERT with witness_pii_blob_enc=ct_b64, witness_encryption_iv=nonce_b64,
    # witness_crypto_provider=provider.crypto_provider,
    # witness_key_version=provider.current_version,
    # witness_name=NULL, witness_phone=NULL, device_id=NULL, ip_hash=NULL
else:
    # INSERT with all blob columns NULL, plaintext kept NULL too
```

Same pattern for `append_civilian_report()`.

**Note:** `device_id` is `UUID(as_uuid=True)` in the model — must `str()` it before building the JSON blob. `ip_hash` is already a string. `witness_name` and `witness_phone` are strings.

### ai_service.py — generate_incident_narrative()

```
1. SELECT includes fi.ai_narrative_enc (renamed from fi.ai_narrative)
2. Generate narrative from Ollama (no change)
3. aad = f"incident_id:{incident_id}:ai_narrative".encode("utf-8")
4. provider = get_crypto_provider()
5. nonce_b64, ct_b64 = provider.encrypt_json({"narrative": narrative}, aad)
6. UPDATE: ai_narrative_enc=ct_b64, ai_narrative_encryption_iv=nonce_b64,
   ai_narrative_crypto_provider=provider.crypto_provider,
   ai_narrative_key_version=provider.current_version,
   ai_narrative=NULL
7. Return plaintext narrative in response dict
```

### SELECT read-back in ai_service.py

The existing SELECT at line ~282 reads `fi.ai_narrative`. Replace with `fi.ai_narrative_enc, fi.ai_narrative_encryption_iv, fi.ai_narrative_crypto_provider, fi.ai_narrative_key_version`. If the function needs to check whether a narrative already exists (regeneration guard), decrypt the blob. For the generation flow, this read-back is only used to detect whether a narrative already exists — decrypt with `provider.decrypt_json(...)`, fall back to `ai_narrative` legacy column if `ai_narrative_enc` is NULL.

---

## Read Path

### civilian.py — _response_from_row()

Apply fail-closed pattern matching `_decrypt_sensitive_details` (privacy.py):

```
witness_pii_blob_enc = getattr(row, "witness_pii_blob_enc", None)
decryption_failed = False
witness_name = row.witness_name   # legacy fallback
witness_phone = row.witness_phone  # legacy fallback

if witness_pii_blob_enc:
    try:
        aad = f"citizen_report:{row.report_id}".encode("utf-8")
        provider = get_crypto_provider(
            {"crypto_provider": row.witness_crypto_provider}
        )
        decrypted = provider.decrypt_json(
            row.witness_encryption_iv,
            witness_pii_blob_enc,
            aad,
            row.witness_key_version or 1,
        )
        witness_name = decrypted.get("witness_name")
        witness_phone = decrypted.get("witness_phone")
    except Exception:
        logger.error("...")
        decryption_failed = True
        # PII fields remain as the NULL fallback — fail-closed

# Build response with decrypted values
# Do NOT expose blob columns in response
```

### _fetch_report_response() — SELECT

Add to the existing SELECT:
```sql
cr.witness_pii_blob_enc,
cr.witness_encryption_iv,
cr.witness_crypto_provider,
cr.witness_key_version
```

---

## Decrypt-Failure Policy

Every decrypt site follows the same contract (matching `_decrypt_sensitive_details`):

| Condition | Behavior |
|---|---|
| Blob NULL (no PII / anonymized) | Short-circuit — no decrypt attempted |
| Blob present, decrypt succeeds | Return decrypted PII values |
| Blob present, decrypt raises | Log CRITICAL, set `decryption_failed` sentinel, PII fields stay NULL |

No raw blob columns (`*_blob_enc`, `*_iv`, `*_crypto_provider`, `*_key_version`) are ever exposed in API responses.

---

## Privacy Export

### admin/privacy.py — export_subject_data() report branch

Add blob columns to the citizen_reports SELECT. Inline decrypt:
```
if report.get("witness_pii_blob_enc"):
    try:
        aad = f"citizen_report:{report_id}".encode("utf-8")
        provider = get_crypto_provider(...)
        pii = provider.decrypt_json(...)
        report["witness_name"] = pii.get("witness_name")
        report["witness_phone"] = pii.get("witness_phone")
    except Exception:
        logger.error("CRITICAL: ...")
        report["decryption_failed"] = True

# Strip blob columns
for col in ("witness_pii_blob_enc", "witness_encryption_iv", ...):
    report.pop(col, None)
```

---

## Backlog Scripts

### encrypt_citizen_reports_backlog.py

```
SELECT report_id, witness_name, witness_phone, device_id, ip_hash
FROM wims.citizen_reports
WHERE (witness_name IS NOT NULL OR witness_phone IS NOT NULL
       OR device_id IS NOT NULL OR ip_hash IS NOT NULL)
  AND witness_pii_blob_enc IS NULL

For each row:
  Convert device_id to string if UUID
  encrypt_json({"witness_name": ..., ...}, aad=f"citizen_report:{report_id}")
  UPDATE: set blob columns, NULL plaintext columns
```

### encrypt_ai_narratives_backlog.py

```
SELECT incident_id, ai_narrative
FROM wims.fire_incidents
WHERE ai_narrative IS NOT NULL
  AND ai_narrative_enc IS NULL

For each row:
  encrypt_json({"narrative": ai_narrative}, aad=f"incident_id:{incident_id}:ai_narrative")
  UPDATE: set enc columns, ai_narrative = NULL
```

---

## Test Changes

### test_privacy.py

- `test_export_report_decrypts_pii`: mock `get_crypto_provider` to return decrypted witness fields; assert decrypted values in response; assert blob columns stripped
- `test_export_after_anonymize_returns_no_pii`: update to assert witness blob short-circuits when NULL
- New: `test_export_report_decrypt_failure_sets_sentinel` — assert `decryption_failed: true` when decrypt raises

### test_incident_narrative.py

- `test_narrative_stores_in_db`: mock encryption provider; assert DB has `ai_narrative_enc` set and `ai_narrative` NULL; assert response has plaintext `ai_narrative`

---

## Scope Notes

- **In scope:** `citizen_reports` (witness_name, witness_phone, device_id, ip_hash) and `fire_incidents.ai_narrative`
- **Not in scope (already encrypted):** `incident_sensitive_details.*` and `incident_attachments.*`
- **Not in scope (plaintext, deliberate deferral):** `security_threat_logs.xai_narrative` — also AI-generated and can echo raw payload, but left as-is for now

---

## Implementation Order

1. DB migrations (69, 70)
2. Model update (citizen_report.py)
3. Write path (civilian.py submit + append)
4. Read path (civilian.py fetch + response)
5. Write path + read-back (ai_service.py)
6. Privacy export (admin/privacy.py)
7. Backlog scripts
8. Test updates
9. Run full CI pre-flight
10. Wiki update (system-wiki/log.md + gaps register)
