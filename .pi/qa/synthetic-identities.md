# Synthetic QA Identities (LOCAL-ONLY placeholders)

> **LOCAL-ONLY.** Everything in this file is a **placeholder** for the local
> Keycloak dev realm only. These values must NEVER be used as real
> credentials, and real secrets must never be committed to this file or any
> other repository file. Before any authenticated QA scenario runs, the
> operator must seed these identities via the Keycloak Admin API or the
> existing keycloak-bootstrap (see "Seeding" below), and should rotate the
> placeholder passwords for any environment that is not a throwaway local
> stack.

This file documents the static set of well-known synthetic identities used by
browser/API QA against the local WIMS stack. They exist in the local Keycloak
realm `bfp` (imported from `src/keycloak/import/bfp-realm.json`, 38 users).
The browser QA harness (`.pi/extensions/wims-browser`) logs in as one of these
identities to exercise authenticated scenarios such as report submission and
permission fallbacks.

## Placeholder credentials

The local realm import file defines two shared placeholder passwords
(plaintext values in the dev realm import only — never use for anything else):

| Placeholder password | Used by |
|---|---|
| `Password123!` | 22 users: the `encoder_*` regional encoders plus `validator_test`, `analyst_test`, `analyst1_test`, `admin_test` |
| `WimsBFP2026!` | 16 users: the `n-*`, `g-*`, `e-*`, `r-*` regional-role matrix users |

Both are dev-only placeholders; treat them as unverified until the operator
re-seeds them through the Keycloak Admin API.

## Identity table

| Username | Realm role(s) | Purpose |
|---|---|---|
| `encoder_ncr`, `encoder_car`, `encoder_r01`–`encoder_r13`, `encoder_barmm`, `encoder_nir` | `REGIONAL_ENCODER` | Regional encoders per region (18 users); report intake/submission QA |
| `validator_test` | `NATIONAL_VALIDATOR`, `SKIP_MFA` | Validation workflow QA |
| `analyst_test`, `analyst1_test` | `NATIONAL_ANALYST` | Analysis workflow QA |
| `admin_test` | `SYSTEM_ADMIN` | Admin/console QA |
| `n-val`, `g-val`, `e-val`, `r-val` | `NATIONAL_VALIDATOR`, `SKIP_MFA` | Role-matrix validator (national/grants/executive/regional) |
| `n-enc`, `g-enc`, `e-enc`, `r-enc` | `REGIONAL_ENCODER` | Role-matrix encoder |
| `n-ana`, `g-ana`, `e-ana`, `r-ana` | `NATIONAL_ANALYST` | Role-matrix analyst |
| `n-sys`, `g-sys`, `e-sys`, `r-sys` | `SYSTEM_ADMIN` | Role-matrix system admin |

Region prefix convention for the role-matrix users: `n-` national, `g-`
grants, `e-` executive, `r-` regional.

## Seeding

The identities are **not** created by the browser QA harness. They must be
seeded into the local Keycloak realm before authenticated scenarios run:

- **Bootstrap path (local stack):** the `keycloak-bootstrap` Compose service
  (`src/docker-compose.yml`, `src/docker-compose.local-demo.yml`) runs
  `src/keycloak/bootstrap/bootstrap-master-realm.sh` against the Keycloak
  container and imports `src/keycloak/import/bfp-realm.json` (realm `bfp`),
  which contains the synthetic users above.
- **Admin API path (any local environment):** use the Keycloak Admin REST API
  (`kcadm.sh` or the admin console) to (re)create users, assign the realm
  roles above, and set their passwords. This is the required path when the
  realm import has not run or when placeholder passwords must be rotated.

The frontend realm client is `wims-web` (see `src/keycloak/import/bfp-realm.json`);
local Keycloak is reachable at `http://localhost:8180` (see
`src/docker-compose.local-demo.yml`).

## Rules

- Never put production, staging, or personally identifying credentials in
  this file or anywhere in the repository.
- Never copy these placeholders into non-local configuration.
- If an environment needs real credentials, provide them out-of-band (secrets
  manager, operator tooling) — never through repository files.
