# Clarification Questions: Seeding Incidents on VPS (194.233.81.162)

## Codebase Context Gathered

### Existing Seed Infrastructure
- **`src/postgres-init/29_seed_incidents.sql`** — Deterministic seed for 12 verified incidents across NCR, CALABARZON, and Bicol. Runs as part of Docker Compose bootstrap (lexical SQL order). Idempotent (ON CONFLICT / WHERE NOT EXISTS patterns). Seeds all related tables: `fire_incidents`, `incident_nonsensitive_details`, `incident_sensitive_details`, `incident_verification_history`, `analytics_incident_facts`, plus refreshes materialized views.
- **`scripts/seed-analytics-incidents.sql` / `.sh`** — Random synthetic seed for 100 verified incidents for analyst dashboard testing. Uses random location/params within NCR/CALABARZON/Bicol. Runs against a running Docker Compose stack.
- **`scripts/seed-dev-users.sh`** — Creates 36+ Keycloak users + syncs to `wims.users`. Key for seeding because `fire_incidents.encoder_id` FK references `wims.users`.

### Tables That Must Be Populated (per incident)
| Table | Purpose | RLS Enforcement |
|---|---|---|
| `wims.data_import_batches` | Import batch grouping | FORCE ROW LEVEL SECURITY |
| `wims.fire_incidents` | Core incident record | FORCE ROW LEVEL SECURITY |
| `wims.incident_nonsensitive_details` | Public incident details | FORCE ROW LEVEL SECURITY |
| `wims.incident_sensitive_details` | PII/encrypted incident details | FORCE ROW LEVEL SECURITY |
| `wims.incident_verification_history` | Status change audit trail | FORCE ROW LEVEL SECURITY |
| `wims.analytics_incident_facts` | Denormalized analytics rows | FORCE ROW LEVEL SECURITY |

### RLS Constraint for Seeding
All tables have `FORCE ROW LEVEL SECURITY` enabled. Direct SQL inserts will fail unless the session has `wims.current_user_id` GUC set to a `SYSTEM_ADMIN` user's UUID. The seed scripts use deterministic user UUIDs (`11111111-1111-4111-8111-111111111111` for encoder, `22222222-2222-4222-8222-222222222222` for validator).

### VPS / Deployment Context
- No VPS-specific documentation exists in the repo (no references to `194.233.81.162` or any VPS infrastructure).
- The stack runs as a 14-service Docker Compose deployment (PostgreSQL 16 + PostGIS, Keycloak, Redis, OpenBao, FastAPI, Celery, Next.js, Ollama, Suricata, Nginx).
- Two patterns exist for seeding:
  1. **Bootstrap seed** (`postgres-init/29_seed_incidents.sql`) — runs during `docker compose up` via SQL init order.
  2. **Ad-hoc manual seed** (`scripts/seed-analytics-incidents.sh`) — runs against a running stack via `docker compose exec`.

---

## Questions for the User

**1. Where is the incident data coming from?**

- A local dev DB dump (pg_dump from your machine)
- CSV/XLSX files
- Generate synthetic data (like the existing seed scripts)
- Copy from a different WIMS environment

**2. What is the current state of the VPS at 194.233.81.162?**

- Fresh VPS — no incidents yet (needs initial seed)
- Already running with some data — needs more incidents added
- Needs a complete copy of your local environment's data

**3. Volume, scope, and fidelity — what needs to be included?**

- How many incidents? (e.g. 12, 100, thousands)
- Include sensitive/PII data in `incident_sensitive_details`?
- Include attachments in `incident_attachments`?
- Include full `incident_verification_history` with hash chain records?
- Populate `analytics_incident_facts` (required for the analyst dashboard)?

**4. One-time or repeatable?**

- One-time seed, or do you need a reusable script you can re-run?

**5. Your workflow — are you SSH'd into the VPS or working from your local dev machine?**

- SSH'd into the VPS now, can run commands directly
- Working from your local machine, need to push data to the VPS

---

## Implementation Planning Notes

Once the above is clarified, the approach will be one of:

- **Option A (bootstrap injection):** Add new SQL to `src/postgres-init/` so incidents seed on next Docker Compose restart. Best for repeatable greenfield deployments.
- **Option B (remote seed script):** Create a script that SSHs to the VPS and runs `docker compose exec postgres psql ... -c "INSERT ..."` or pipes a SQL file through. Best for one-off ad-hoc seeding of an already-running VPS.
- **Option C (pg_dump/pg_restore):** Dump from local, transfer to VPS, restore. Best for copying an entire environment.
- **Option D (CSV import via API):** Upload CSV through the WIMS import API. Best if no direct DB access is available.
