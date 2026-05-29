# WIMS-BFP Roles Reference

Use these exact strings in all code. No legacy values.

| Role | String | Can Do | Cannot Do |
|---|---|---|---|
| Regional Encoder | REGIONAL_ENCODER | Create/edit/import incidents in assigned region, offline mode | Access other regions, approve/reject |
| National Validator | NATIONAL_VALIDATOR | Review/approve/reject incidents cross-region | Create incidents, access admin |
| National Analyst | NATIONAL_ANALYST | Read analytics, export reports | Modify any record |
| System Admin | SYSTEM_ADMIN | Full access, user management, XAI, security logs | Nothing blocked |
| Civilian Reporter | CIVILIAN_REPORTER | Submit public reports, track own report | Access any authenticated route |

## Legacy Role Strings (do not write these in new code)
ENCODER, VALIDATOR, ANALYST, ADMIN — these may exist in old DB rows but must not be written by new code.
