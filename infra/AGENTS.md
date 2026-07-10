# Infrastructure Instruction Routing

## Scope

This directory currently contains instruction/routing material, while the actual
runtime infrastructure lives under `src/`.

For changes to Compose, PostgreSQL bootstrap/Alembic, Keycloak, Nginx, OpenBao,
Suricata, Dockerfiles, or CI/CD:

1. Read the root `AGENTS.md`.
2. Read `src/AGENTS.md` (the canonical scoped infrastructure rules).
3. Read the relevant system-wiki architecture/security/database page.
4. Read every environment-specific config or overlay affected by the change.

Do not duplicate service inventories, image versions, port maps, environment
variables, or migration counts here; derive them from current configuration.
If implementation files are later added under `infra/`, extend this file only
with rules specific to that subtree and do not weaken `src/AGENTS.md` safeguards.
