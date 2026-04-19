## Pull Request — WIMS-BFP

### Description
Implements the full Encoder -> Validator workflow for region-scoped validation.

Primary focus in this PR is encoder reliability and usability improvements:
- improved encoder Excel ingestion/parsing reliability across more real-world AFOR variations
- encoder search bar for faster incident lookup and filtering
- frontend incident detail representation fixes for clearer and more accurate review context
- commit/submit flow fix so encoder actions persist reliably

This PR also introduces NATIONAL_VALIDATOR review capabilities end-to-end:
- validator-only queue endpoint with strict region isolation
- validator decision endpoint (accept/pending/reject)
- verification audit trail writes
- DB/ORM alignment for `PENDING_VALIDATION`
- validator dashboard UI + typed frontend API client
- dev seeding/migration updates for role normalization

Why:
- Encoder workflows needed stronger import resilience, better discoverability, and reliable submission behavior.
- Encoded incidents need a clear validator review path before final verification.
- Region boundaries must be enforced for both read and status-change operations.
- Existing DB usage already produced `PENDING_VALIDATION`, but ORM/constraints were not fully aligned.

### What Changed
Encoder improvements (primary):
- Improved encoder-side Excel reading to handle more real-world AFOR input variations.
- Added search bar support in encoder incident listing and lookup flows.
- Fixed frontend representation of incident details for clearer and more accurate display.
- Fixed commit and submit behavior so encoder actions persist and transition correctly.

Validator workflow support:
- Added validator auth dependency and validator endpoints.
- Added validator dashboard page and typed validator API client in frontend.
- Added verification history write path and status flow support for validator actions.

Data and role alignment:
- Added/updated DB migration SQL for validator workflow and legacy IVH compatibility.
- Updated role handling and seeding to use `NATIONAL_VALIDATOR` while accounting for legacy values.

Documentation:
- Added validator workflow changelog documentation.

### Type of Change
- [x] Bug fix
- [x] New feature
- [ ] Refactor / code cleanup
- [x] Documentation update
- [ ] CI/CD change
- [x] Database migration

### Linked Issue
Submission using import module and reflection of submitted incidents to validator.

### Testing Done
- [ ] Frontend builds without errors (`npm run build`)
- [ ] ESLint passes (`npm run lint`)
- [ ] Ruff linter passes (`ruff check .`)
- [ ] Ruff formatter check passes (`ruff format --check .`)
- [ ] pytest passes (`pytest -v`)
- [x] Manual smoke test (describe what you tested)

Manual verification performed:
- Confirmed encoder-related workflow updates are included in this branch (Excel import handling, search, details rendering, and submit reliability fixes).
- Confirmed validator workflow files are present in canonical locations:
  - `src/backend/auth.py`
  - `src/backend/api/routes/regional.py`
  - `src/backend/models/fire_incident.py`
  - `src/backend/models/incident_verification_history.py`
  - `src/postgres-init/002_validator_workflow.sql`
  - `src/postgres-init/002a_fix_ivh_legacy.sql`
  - `src/frontend/src/app/dashboard/validator/page.tsx`
  - `src/frontend/src/lib/validator-api.ts`
  - `scripts/seed-dev-users.sh`

Recommended runtime validation steps after checkout:
- run migration SQL
- re-seed dev users
- restart backend
- login as validator user and verify queue/action flows

### Screenshots / Recordings
Attach validator dashboard screenshots and action modal/error-state captures.

### Anything the reviewer should know?
- Migration is intended to be idempotent.
- The role normalization path includes legacy `VALIDATOR` -> `NATIONAL_VALIDATOR` handling.
- Status transition auditing is transactional with the incident status update.
- Region scoping is enforced in endpoint logic (and mirrored by policy/migration intent).

Apply steps:
```bash
docker compose exec -T postgres psql -U postgres -d wims \
  < src/postgres-init/002_validator_workflow.sql

./scripts/seed-dev-users.sh

docker compose restart backend
```

### Checklist
- [ ] My code follows the project's style guidelines (ESLint + Ruff)
- [x] I have performed a self-review of my own code
- [ ] I have commented hard-to-understand code
- [x] I have updated documentation if needed
- [ ] My changes do not introduce new warnings or lint errors
- [ ] Tests added/updated where appropriate
- [ ] All CI checks pass before requesting review
