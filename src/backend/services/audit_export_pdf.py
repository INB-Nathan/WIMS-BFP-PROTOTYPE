"""Deterministic human-readable PDF generation for audit exports."""

from __future__ import annotations

import io
import json
from collections.abc import Iterable, Mapping, Sequence
from datetime import datetime
from typing import Any
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import landscape, letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas
from reportlab.platypus import LongTable, Paragraph, SimpleDocTemplate, Spacer, TableStyle

from services.audit_export import _canonical_cell, _row_values


def compute_pdf_hash(pdf_bytes: bytes) -> str:
    """Return the SHA-256 digest of complete PDF bytes."""
    import hashlib

    return f"sha256:{hashlib.sha256(pdf_bytes).hexdigest()}"


def _pdf_text(value: Any) -> str:
    """Return deterministic text representable by PDF base-14 fonts.

    Helvetica uses WinAnsi in ReportLab.  Replacing characters outside that
    encoding is deliberate: embedding an external font would make output
    dependent on host resources and violate the export's no-resource contract.
    """
    text = _canonical_cell(value).replace("\x00", "�")
    return text.encode("cp1252", errors="replace").decode("cp1252")


def _paragraph_text(value: Any) -> str:
    return escape(_pdf_text(value)).replace("\r\n", "\n").replace("\r", "\n").replace("\n", "<br/>")


class _InvariantCanvas(canvas.Canvas):
    """ReportLab canvas with reproducible metadata and object ordering."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        kwargs["invariant"] = 1
        super().__init__(*args, **kwargs)


class AuditExportPdfGenerator:
    """Generate a deterministic, text-only BFP audit report."""

    def __init__(
        self,
        *,
        rows: Iterable[Mapping[str, Any] | Sequence[Any]],
        columns: Sequence[str],
        filters: Mapping[str, Any],
        exported_at: datetime,
        export_uuid: str,
        row_count: int,
        export_scope: str,
    ) -> None:
        self.rows = list(rows)
        self.columns = tuple(str(column) for column in columns)
        self.filters = dict(filters)
        self.exported_at = exported_at
        self.export_uuid = str(export_uuid)
        self.row_count = row_count
        self.export_scope = export_scope

    def _styles(self) -> tuple[ParagraphStyle, ParagraphStyle, ParagraphStyle]:
        base = getSampleStyleSheet()
        title = ParagraphStyle(
            "AuditExportTitle",
            parent=base["Title"],
            fontName="Helvetica-Bold",
            fontSize=16,
            leading=19,
            alignment=TA_LEFT,
            textColor=colors.HexColor("#153B50"),
            spaceAfter=8,
        )
        body = ParagraphStyle(
            "AuditExportBody",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=7,
            leading=9,
            alignment=TA_LEFT,
            wordWrap="LTR",
        )
        header = ParagraphStyle(
            "AuditExportHeader",
            parent=body,
            fontName="Helvetica-Bold",
            textColor=colors.white,
        )
        return title, body, header

    def generate(self) -> bytes:
        buffer = io.BytesIO()
        document = SimpleDocTemplate(
            buffer,
            pagesize=landscape(letter),
            leftMargin=0.45 * inch,
            rightMargin=0.45 * inch,
            topMargin=0.45 * inch,
            bottomMargin=0.42 * inch,
            title="WIMS Audit Export",
            author="WIMS-BFP",
            subject="Tamper-proof audit log export",
            creator="WIMS-BFP",
        )
        title_style, body_style, header_style = self._styles()
        story: list[Any] = [Paragraph("BUREAU OF FIRE PROTECTION — WIMS AUDIT EXPORT", title_style)]

        metadata = [
            [Paragraph("Export UUID", body_style), Paragraph(escape(self.export_uuid), body_style)],
            [
                Paragraph("Export scope", body_style),
                Paragraph(escape(self.export_scope), body_style),
            ],
            [
                Paragraph("Exported at", body_style),
                Paragraph(escape(self.exported_at.isoformat()), body_style),
            ],
            [Paragraph("Row count", body_style), Paragraph(str(self.row_count), body_style)],
            [
                Paragraph("Filters", body_style),
                Paragraph(
                    _paragraph_text(
                        json.dumps(
                            self.filters,
                            ensure_ascii=False,
                            sort_keys=True,
                            separators=(",", ":"),
                        )
                    ),
                    body_style,
                ),
            ],
        ]
        metadata_table = LongTable(metadata, colWidths=[1.1 * inch, 8.8 * inch])
        metadata_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#E8F1F5")),
                    ("BOX", (0, 0), (-1, -1), 0.35, colors.HexColor("#9BB7C5")),
                    ("INNERGRID", (0, 0), (-1, -1), 0.2, colors.HexColor("#C7D8DF")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 4),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                    ("TOPPADDING", (0, 0), (-1, -1), 3),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ]
            )
        )
        story.extend([metadata_table, Spacer(1, 0.16 * inch)])

        header_row = [Paragraph(escape(column), header_style) for column in self.columns]
        table_rows: list[list[Any]] = [header_row]
        for row in self.rows:
            values = _row_values(row, self.columns)
            table_rows.append([Paragraph(_paragraph_text(value), body_style) for value in values])

        available_width = landscape(letter)[0] - document.leftMargin - document.rightMargin
        column_width = available_width / max(len(self.columns), 1)
        audit_table = LongTable(
            table_rows,
            repeatRows=1,
            colWidths=[column_width] * len(self.columns),
            splitByRow=1,
        )
        audit_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#153B50")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("BOX", (0, 0), (-1, -1), 0.35, colors.HexColor("#6D8792")),
                    ("INNERGRID", (0, 0), (-1, -1), 0.2, colors.HexColor("#C7D8DF")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 3),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 3),
                    ("TOPPADDING", (0, 0), (-1, -1), 3),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                    (
                        "ROWBACKGROUNDS",
                        (0, 1),
                        (-1, -1),
                        [colors.white, colors.HexColor("#F4F8FA")],
                    ),
                ]
            )
        )
        story.append(audit_table)

        def draw_footer(pdf_canvas: canvas.Canvas, _document: SimpleDocTemplate) -> None:
            pdf_canvas.saveState()
            pdf_canvas.setFont("Helvetica", 7)
            pdf_canvas.setFillColor(colors.HexColor("#53666F"))
            footer = f"WIMS-BFP • {self.export_uuid} • Page {pdf_canvas.getPageNumber()}"
            pdf_canvas.drawString(document.leftMargin, 0.22 * inch, footer)
            pdf_canvas.restoreState()

        document.build(
            story, onFirstPage=draw_footer, onLaterPages=draw_footer, canvasmaker=_InvariantCanvas
        )
        return buffer.getvalue()


__all__ = ["AuditExportPdfGenerator", "compute_pdf_hash"]
