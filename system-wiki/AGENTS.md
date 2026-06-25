# system-wiki Agent Instructions

## Read First

- `system-wiki/SCHEMA.md`
- `system-wiki/index.md`
- `system-wiki/mocs/system-map.md`

Key reference pages (read on demand for the relevant subsystem):

| Page | Content |
|------|---------|
| `system-wiki/operations/agent-routing-guide.md` | Subsystem-specific context packs (auth, incidents, validation, immutable records, analytics, DMZ, reference data) |
| `system-wiki/concepts/frs-module-map.md` | 15-module FRS-to-code routing map |
| `system-wiki/backend/api-route-map.md` | FastAPI route ownership snapshot |
| `system-wiki/frontend/route-map.md` | Next.js route surface map |
| `system-wiki/database/schema-overview.md` | PostgreSQL/PostGIS table and migration map |
| `system-wiki/security/security-baseline.md` | Auth/RBAC/RLS/audit/IDS/XAI baseline |
| `system-wiki/gaps/frs-codebase-gap-register.md` | Known gaps and verification targets |
| `system-wiki/decisions/` | Recorded architecture decisions |

Raw FRS files: `system-wiki/raw/frs/`. Treated as source material — do not edit unless replacing with a newer authoritative batch.

## Wiki Update Rule

For any non-trivial change to code, workflow, schema, infrastructure, test behavior, or documentation sources, agents MUST update the system wiki:

1. **Update** the relevant `system-wiki/` synthesis page.
2. **Append** an entry to `system-wiki/log.md`.
3. **Update** `system-wiki/gaps/frs-codebase-gap-register.md` only when the change creates, closes, or modifies an FRS/codebase gap.
4. **Do not edit** `system-wiki/raw/` unless replacing it with a newer authoritative source batch.

**Update required when:** new feature/endpoint, new API route, DB migration, new Docker service, auth/RBAC/RLS change, workflow/behavioral change, config/env var change, documentation source change.

**Not required when:** bugfix under 20 LOC, typo fixes, refactoring without behavior change, test-only maintenance, dependency version bumps.

If unsure, default to updating — a brief `log.md` entry is cheap and prevents drift.

## Before Final Response

Explicitly confirm whether the wiki was updated, or briefly state why no wiki update was needed.
