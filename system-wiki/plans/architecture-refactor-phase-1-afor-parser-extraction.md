---
title: Architecture Refactor Phase 1 AFOR Parser Extraction
created: 2026-05-23
updated: 2026-05-23
type: operations
tags: [wims-bfp, architecture, refactor, afor, regional, parser]
sources: [src/backend/api/routes/regional.py, src/backend/tests/test_afor_import.py, scripts/afor_preview.py, system-wiki/subsystems/regional-dashboard.md]
status: completed
---

# Architecture Refactor Phase 1 AFOR Parser Extraction

Prerequisite: [[plans/architecture-refactor-phase-0-safety-baseline]]
Next phase: [[plans/architecture-refactor-phase-2-afor-commit-extraction]]

## Purpose

Move AFOR upload parsing out of `src/backend/api/routes/regional.py` and into a deeper AFOR Import Module without changing route behavior or database writes.

## Goal

Create a dedicated AFOR parser Module that owns workbook/CSV detection and row mapping while keeping `POST /api/regional/afor/import` behavior unchanged.

Agents should stop this phase before moving any commit/database-write behavior.

## Proposed Module Shape

Create:
- `src/backend/services/afor_import/models.py`
- `src/backend/services/afor_import/parse.py`

Move parser Implementation:
- `AforFormKind`
- `AforParsedRow`
- workbook template detection
- CSV worksheet Adapter
- structural AFOR parser
- wildland AFOR parser
- `parse_csv_content`
- `parse_xlsx_content`
- structural/wildland row mapping

Keep `regional.py` as the HTTP Adapter for `POST /api/regional/afor/import`.

## Interface

Target Interface:
- `parse_afor_upload(content: bytes | str, filename: str, region_id: int) -> AforParseResult`

The route should only know upload metadata and the parse result. Parser tests should import from `services.afor_import.parse`, not from `api.routes.regional`.

## Invariants

- Import preview response shape remains unchanged.
- `form_kind`, `requires_location`, row status, row errors, and row data remain compatible with the frontend.
- Official structural CSV and XLSX behavior remains unchanged.
- Wildland workbook detection and minimum-content validation remain unchanged.
- `scripts/afor_preview.py` should eventually reuse the parser Module instead of mirroring parser code.

## Stop Criteria

Stop when:
- AFOR parser classes/functions are imported from `services.afor_import`, not from `api.routes.regional`;
- `regional.py` still exposes the same import-preview endpoint and response shape;
- parser unit tests and AFOR import preview integration tests pass or failures are documented;
- no AFOR commit/persistence logic has been moved except imports needed to keep behavior working;
- this page and [[system-wiki/log]] are updated with the completed extraction summary.

## Tests

Preserve:
- `src/backend/tests/test_afor_import.py`
- `src/backend/tests/integration/test_regional_afor_unified_import.py`

Add or adjust:
- Parser unit tests import from `services.afor_import.parse`.
- Script parity test or script simplification for `scripts/afor_preview.py`.

## Risks

- Current tests import parser internals from `regional.py`.
- Row dict shape is an implicit Interface with AFOR import UI and manual correction handoff.
- Unicode checkbox detection and shifted-row template support must remain exact.

## Related

- [[subsystems/regional-dashboard]]
- [[backend/api-route-map]]
- [[plans/architecture-refactor-phase-2-afor-commit-extraction]]
