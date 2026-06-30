---
description: Verify alignment between FRS requirements and implementation, update the gap register, and trace requirements to source files.
---

# FRS Alignment

Use this skill when the agent needs to verify alignment between FRS requirements and implementation, update the gap register, or make claims about what an FRS module requires.

## Principles

- The FRS module map (`system-wiki/concepts/frs-module-map.md`) is a **routing index** with abbreviated names — not proof of completion and not a requirements summary.
- Module names are misleading (e.g., M15 "Reference Data Service" is not about offline-first).
- **Never claim "FRS Module N requires X"** without reading the actual FRS source file (`system-wiki/raw/frs/frs-*.md`) and quoting the exact line.
- Some FRS source files are empty in the supplied batch. Track unknowns in `system-wiki/gaps/frs-codebase-gap-register.md` — do not infer requirements from absence.

## The 15 FRS Modules

| # | Name | Source file |
|---|------|-------------|
| M1 | Authentication and Access Control | `raw/frs/frs-auth.md` |
| M2 | Offline-First Incident Management | `raw/frs/frs-offlinefirst.md` |
| M3 | Conflict Detection and Manual Verification | `raw/frs/frs-conflictdetectionandmanualverification.md` |
| M4 | Data Commit and Immutable Storage | `raw/frs/frs-datacommitandimmutablestorage.md` |
| M5 | Analytics and Reporting | `raw/frs/frs-analyticsandreporting.md` |
| M6 | Cryptographic Security | `raw/frs/frs-cryptographicsecurity.md` |
| M7 | Intrusion Detection and Network Monitoring | `raw/frs/frs-intrusiondetectionandnetworkingmonitoring.md` |
| M8 | Threat Detection with Explainable AI (XAI) | `raw/frs/frs-threatdetectionwithexplainableai.md` |
| M9 | System Monitoring and Health Dashboard | `raw/frs/frs-systemmonitoringandhealthdashboard.md` |
| M10 | Compliance and Data Privacy | `raw/frs/frs-complianceanddataprivacy.md` |
| M11 | Penetration Testing and Security Validation | `raw/frs/frs-penentrationtestingandsecurityvalidation.md` |
| M12 | User Management and Administration | `raw/frs/frs-usermanagementandadministration.md` |
| M13 | Notification System | `raw/frs/frs-notificationsystem.md` |
| M14 | Public Anonymous Incident Submission | `raw/frs/frs-publicanonymousincidentsubmission.md` |
| M15 | Reference Data Service | `raw/frs/frs-referencedataservice.md` |

## Steps

1. When an FRS requirement is relevant, read the source file at `system-wiki/raw/frs/frs-<module>.md` and extract the exact requirement lines.
2. Compare against current implementation using code anchors from `system-wiki/concepts/frs-module-map.md`.
3. If a gap is found or closed, update `system-wiki/gaps/frs-codebase-gap-register.md` with the date, finding, and disposition.
4. If alignment changed, update the gap register's `updated` frontmatter field.
