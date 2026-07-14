from __future__ import annotations

from datetime import datetime, timezone

from services.audit_export_pdf import AuditExportPdfGenerator, compute_pdf_hash


def _generate(rows: list[list[object]]) -> bytes:
    return AuditExportPdfGenerator(
        rows=rows,
        columns=["action", "actor"],
        filters={"from": "2026-01-01", "to": "2026-07-14"},
        exported_at=datetime(2026, 7, 14, 12, 0, tzinfo=timezone.utc),
        export_uuid="00000000-0000-0000-0000-000000000001",
        row_count=len(rows),
        export_scope="admin",
    ).generate()


def test_pdf_generation_is_byte_deterministic() -> None:
    rows = [["LOGIN", "O'Brien & <auditor>"], ["EXPORT", "second"]]
    first = _generate(rows)
    second = _generate(rows)

    assert first == second
    assert first.startswith(b"%PDF-")
    assert compute_pdf_hash(first).startswith("sha256:")


def test_pdf_handles_empty_and_multi_page_sized_exports() -> None:
    assert _generate([]).startswith(b"%PDF-")
    assert _generate([[f"ACTION-{index}", f"actor-{index}"] for index in range(100)]).startswith(
        b"%PDF-"
    )
