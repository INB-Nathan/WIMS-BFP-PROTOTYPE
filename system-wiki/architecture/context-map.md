---
title: Context Map
created: 2026-05-14
updated: 2026-05-27
type: architecture
tags: [wims-bfp, frs, codebase, source-index]
sources: [raw/frs, raw/codebase/codebase-snapshot-2026-05-14.md, CONTEXT.md]
status: draft
---

# Context Map

## Authority Hierarchy
1. User-supplied FRS files in `raw/frs/` define intended final features where content exists.
2. Live code under `src/` defines current implementation reality.
3. This wiki synthesizes both for agent routing and gap detection.

## Root Domain Glossary
`CONTEXT.md` is the implementation-free domain glossary for resolved WIMS-BFP terms. It currently defines the public reporting distinction between civilian reports, civilian report clusters, public fire report areas, report-count intensity, and official fire incidents.

Root-map design language should use "public fire report area" for public civilian cluster map labels. Do not call these areas "incidents" or "severity" markers unless a later domain decision explicitly changes the glossary.

## FRS Source Availability
| File | Lines | First content line |
|---|---:|---|
| `frs-analyticsandreporting.md` | 0 | EMPTY / knowledge gap |
| `frs-auth.md` | 34 | Module 1: Authentication and Access Control |
| `frs-complianceanddataprivacy.md` | 33 | Module 10: Compliance and Data Privacy |
| `frs-conflictdetectionandmanualverification.md` | 31 | Module 3: Conflict Detection and Manual Verification |
| `frs-cryptographicsecurity.md` | 0 | EMPTY / knowledge gap |
| `frs-datacommitandimmutablestorage.md` | 22 | Module 4: Data Commit and Immutable Storage |
| `frs-intrusiondetectionandnetworkingmonitoring.md` | 21 | Module 7: Intrusion Detection and Network Monitoring |
| `frs-notificationsystem.md` | 21 | Module 13: Notification System |
| `frs-offlinefirst.md` | 46 | Module 2: Offline-First Incident Management |
| `frs-penentrationtestingandsecurityvalidation.md` | 26 | Module 11: Penetration Testing and Security Validation |
| `frs-publicanonymousincidentsubmission.md` | 0 | EMPTY / knowledge gap |
| `frs-referencedataservice.md` | 15 | Module 15: Reference Data Service |
| `frs-systemmonitoringandhealthdashboard.md` | 0 | EMPTY / knowledge gap |
| `frs-threatdetectionwithexplainableai.md` | 33 | Module 8: Threat Detection with Explainable AI (XAI) |
| `frs-usermanagementandadministration.md` | 24 | Module 12: User Management and Administration |

## Knowledge Gaps Identified
Empty FRS files exist for modules that project memory indicates are real modules. These must be re-supplied or reconstructed from the canonical source before making final compliance claims:
- `frs-analyticsandreporting.md`
- `frs-cryptographicsecurity.md`
- `frs-publicanonymousincidentsubmission.md`
- `frs-systemmonitoringandhealthdashboard.md`

See [[gaps/frs-codebase-gap-register]] for operational handling.
