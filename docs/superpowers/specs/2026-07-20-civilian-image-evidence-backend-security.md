# Civilian Image Evidence — Backend and Security Execution Specification

**Date:** 2026-07-20

**Status:** Approved decomposition of the canonical design

**Canonical behavioral contract:**
`docs/superpowers/specs/2026-07-20-civilian-image-evidence-workspace-design.md`

This document translates the canonical behavior into backend, schema, security,
and audit work. It does not redefine product behavior. If this document conflicts
with the canonical contract, the canonical contract wins until the conflict is
resolved explicitly.

## 1. Scope

This execution specification owns:

- reporter-identity request and persistence contracts;
- reporter-versus-eyewitness separation;
- coarse GeoIP evidence collection and PostGIS calculations;
- validator workspace evidence projections;
- sanitized-image decryption and serving;
- explicit contact reveal;
- RBAC, RLS, crypto, audit, and privacy tests;
- Alembic and clean-bootstrap schema alignment.

It does not own frontend layout, offline browser implementation, deployment smoke
procedures, or operations documentation.

## 2. Domain boundaries

### 2.1 Reporter identity

Reporter identity answers **who submitted the report**. Direct-eyewitness fields
answer **who directly witnessed the incident**. They are separate concepts and
must remain separate in schemas, services, persistence, API responses, and UI
labels.

Anonymous request fields:

- `reporter_name`: required for every report;
- `reporter_phone`: required for normal reports and optional for
  `I_NEED_HELP`/`SOMEONE_ELSE_NEEDS_HELP` fast submit.

Authenticated `CIVILIAN_REPORTER` behavior:

- derive contributor ID, display name, and contact number from the authenticated
  server-side profile;
- ignore caller-supplied reporter identity;
- do not overwrite `witness_name` or `witness_phone`;
- normal reports require a complete profile;
- life-safety reports remain submittable if only the phone number is missing.

### 2.2 Encrypted reporter snapshot

`wims.citizen_reports` receives a dedicated encrypted reporter-identity envelope.
The implementation plan may adapt exact column names to existing crypto naming,
but the envelope must contain:

- ciphertext;
- nonce/IV;
- crypto provider;
- key version;
- KMS key name when applicable.

Required AAD:

```text
civilian-report:{report_id}:reporter-identity:v1
```

Invariants:

- plaintext reporter name/phone columns are prohibited;
- encryption failure rejects the identity-dependent write rather than falling back
  to plaintext;
- the snapshot is immutable submission evidence; later profile edits do not alter
  it;
- existing witness encryption and AAD remain unchanged;
- response models never expose crypto metadata or ciphertext.

### 2.3 Coarse IP location evidence

GeoIP is resolved from the trusted client-address boundary already used for abuse
controls. Persist only:

- municipality/city;
- province/region label when available;
- centroid as PostGIS geography;
- accuracy radius in meters;
- source/provider;
- lookup timestamp.

The raw address is discarded after deriving the approved coarse evidence and the
existing salted abuse-control hash. It must not be written to application tables,
audits, exceptions, or ordinary logs.

GeoIP lookup failure is non-blocking. Existing rows remain valid with unavailable
IP evidence and receive no speculative backfill.

PostGIS calculates persisted or projected distances between:

- report pin and device GPS;
- report pin and image EXIF GPS;
- report pin and IP centroid;
- device GPS and image EXIF GPS.

IP evidence is always marked approximate and cannot independently recommend or
apply a terminal outcome.

## 3. Service boundaries

### 3.1 Reporter identity service

Owns:

- anonymous validation based on life-safety status;
- authenticated profile derivation;
- canonical reporter snapshot construction;
- crypto-provider encryption/decryption using the dedicated AAD;
- neutral handling for unauthorized contact access.

Routes parse/authenticate and invoke the service. They do not construct crypto
providers or write encrypted columns directly.

### 3.2 GeoIP evidence service

Owns:

- trusted address input;
- provider/database adapter invocation;
- normalization to approved coarse fields;
- explicit unavailable result;
- PostGIS-ready centroid output.

External lookup orchestration must use an existing service/adapter pattern. No
network or database lookup is embedded directly in the route body.

### 3.3 Photo read service

Extends the existing `services/report_photos.py` boundary or a focused adjacent
service without duplicating upload validation/encryption constants.

Before returning sanitized bytes, it must:

1. load the photo through an RLS-scoped session;
2. validate report/photo association and caller authorization;
3. validate the stored path resolves beneath the configured civilian photo root;
4. reject symlinks, traversal, unrecognized artifact names, and non-regular files;
5. enforce bounded stored size;
6. read the encrypted sanitized artifact;
7. decrypt with `civilian-photo:{photo_id}:sanitized:v1`;
8. verify the sanitized plaintext hash and expected MIME contract;
9. return only sanitized bytes.

A failure never falls back to the original artifact. Original-artifact path,
crypto metadata, and unrestricted EXIF never enter API responses.

## 4. API execution contracts

Exact Pydantic model names may follow repository conventions; these behavioral
contracts are fixed.

### 4.1 `GET /api/triage/clusters/{cluster_id}/workspace`

Authorization: National Validator workspace roles through the existing server-side
role and RLS dependencies.

Returns safe cluster/report evidence, location comparisons, image metadata/content
URLs, contributor credibility summaries, follow-ups, activity, and
civilian-visible feedback history.

It does not return image bytes, reporter contact PII, raw IPs, raw device IDs,
storage paths, ciphertext, key metadata, original filenames, or unrestricted EXIF.

### 4.2 `GET /api/triage/reports/{report_id}/photos/{photo_id}/content`

Authorization and report/photo association failures use the established neutral
not-found behavior. Successful responses return only sanitized JPEG/PNG content
with:

- `Cache-Control: no-store`;
- `Pragma: no-cache`;
- `X-Content-Type-Options: nosniff`;
- inline disposition with a server-owned generic filename.

### 4.3 `POST /api/triage/reports/{report_id}/contact-reveal`

The service decrypts the reporter snapshot only after role, RLS, and report-scope
checks. A transaction-bound sensitive audit record is written before contact data
is returned. If the audit write fails, the reveal fails closed.

Audit payloads contain identifiers and outcome only. They exclude contact values,
raw IPs, ciphertext, and key material.

## 5. Database and migration contract

The implementation requires a new Alembic revision for persistent deployments and
aligned clean-bootstrap SQL.

Migration work must explicitly cover:

- nullable coarse GeoIP fields;
- encrypted reporter-identity envelope fields;
- PostGIS geography type and required indexes, if query evidence justifies them;
- column comments describing precision and privacy limits;
- existing-table grants/RLS implications;
- upgrade and clean-bootstrap parity;
- downgrade behavior that does not silently discard live encrypted identity.

No new public policy, `BYPASSRLS`, or admin-session domain query is permitted.
Final-schema audit and verification-history immutability must not be weakened.

## 6. Error and transaction invariants

- Report submission and reporter snapshot persistence are one consistency unit.
- A reporter-identity encryption failure never produces plaintext persistence.
- GeoIP failure does not block report submission.
- Photo upload retains its existing database/audit/filesystem compensation model.
- Photo read failures affect only the requested image; workspace metadata may mark
  it unavailable without hiding the remaining cluster.
- Missing, corrupt, quarantined, out-of-root, hash-mismatched, or undecryptable
  sanitized artifacts are never replaced with original bytes.
- Workspace authorization failures do not disclose object existence.
- Contact reveal returns no PII unless the sensitive audit succeeds.

## 7. Backend validation checklist

### Reporter identity

- anonymous normal report requires reporter name and phone;
- anonymous life-safety report requires name and permits missing phone;
- authenticated identity is server-derived and caller identity is ignored;
- reporter and eyewitness values remain distinct through round-trip tests;
- provider failure leaves no plaintext reporter PII;
- profile-completion and life-safety exceptions match the canonical contract.

### GeoIP and spatial evidence

- trusted client-address source is used;
- raw IP is absent from rows, audit values, and logs;
- success stores only approved coarse fields;
- failure stores unavailable state and accepts the report;
- PostGIS distance calculations handle missing sources and geography casts;
- response labels carry centroid accuracy/approximation.

### Photo access

- allowed validator role retrieves sanitized bytes;
- unauthorized/cross-scope access receives neutral denial;
- report/photo mismatch is denied;
- sanitized AAD, hash, size, MIME, path containment, symlink, missing, and corrupt
  cases are covered;
- no original route or fallback exists;
- responses carry no-store/nosniff headers.

### Contact reveal and projection privacy

- ordinary workspace load contains no contact PII;
- reveal is role- and report-scoped;
- sensitive audit and reveal share the required transaction semantics;
- audit failure blocks the reveal;
- queue and workspace contracts exclude forbidden fields.

### Minimum implementation gates

From `src/backend/`:

```bash
ruff check .
ruff format --check .
pytest -q tests/test_report_photos.py tests/test_contributor.py tests/test_civilian_triage_module.py
```

Append every new focused identity, GeoIP, photo-read, workspace, and contact-reveal
test file to this baseline command during implementation.

Migration/bootstrap, RLS, crypto-provider, and infrastructure-heavy tests must be
run according to `.github/workflows/ci.yml` and `docs/agents/ci-preflight.md` before
push or PR. An unrun suite must be reported, not described as passing.

## 8. Stop conditions

Implementation must pause for a product/security decision if it would require:

- raw-IP retention;
- exact IP-derived location;
- original-image access;
- a broader RLS policy than the current staff-read contract;
- plaintext PII fallback;
- automatic terminal decisions from mismatch signals;
- a change to the official-incident boundary.
