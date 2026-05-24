"""AFOR import module — workbook/CSV parsing and row mapping."""

from services.afor_import.models import (
    AforFormKind,
    AforCommitRequest,
    AforCommitResponse,
    AforParsedRow,
    AforParseResponse,
    RowResolution,
    WildlandRowSource,
)
from services.afor_import.parse import (
    ALARM_LEVEL_MAP,
    BfpXlsxParser,
    WildlandXlsxParser,
    detect_afor_template_kind,
    parse_afor_report_data,
    parse_wildland_afor_report_data,
    parse_csv_content,
    parse_xlsx_content,
)

__all__ = [
    # types
    "AforFormKind",
    "AforCommitRequest",
    "AforCommitResponse",
    "AforParsedRow",
    "AforParseResponse",
    "RowResolution",
    "WildlandRowSource",
    # parsers
    "ALARM_LEVEL_MAP",
    "BfpXlsxParser",
    "WildlandXlsxParser",
    # detection
    "detect_afor_template_kind",
    # row mappers (also used as commit-step validators)
    "parse_afor_report_data",
    "parse_wildland_afor_report_data",
    # file-level entry points
    "parse_csv_content",
    "parse_xlsx_content",
]
