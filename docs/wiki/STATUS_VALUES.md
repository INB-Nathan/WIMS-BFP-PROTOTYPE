# Incident Status Values

Source of truth: src/postgres-init/04_import_incidents.sql CHECK constraint

| Value | Written By | Meaning |
|---|---|---|
| DRAFT | Encoder (create action) | Not submitted, not visible to validators |
| PENDING | Encoder (submit action) OR validator (unpend action) | Awaiting validator review |
| PENDING_VALIDATION | public_dmz.py only (civilian reports) | Civilian-submitted, not encoder-linked |
| VERIFIED | Validator (approve action) | Approved — immutable after this point |
| REJECTED | Validator (reject action) | Returned with reason |

## What Does NOT Exist
- PENDING_REVIEW — not in DB constraint, not in codebase. Do not write this string.

## Validator Action Map (from regional.py _VALIDATOR_ACTION_MAP)
- "accept" → writes VERIFIED
- "pending" → writes PENDING  
- "reject" → writes REJECTED

## Immutability
VERIFIED records will be immutable once 17_immutable_records.sql is applied (not yet applied).
Until then, immutability is enforced only at application level (403 on edit of VERIFIED).
