#!/usr/bin/env python3
"""Convert the device-token abuse controls design spec to a formatted PDF."""

import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm, cm
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, ListFlowable, ListItem, HRFlowable, KeepTogether,
)
from reportlab.lib.colors import HexColor

# --- Read the markdown spec ---
spec_path = Path("docs/superpowers/specs/2026-07-06-device-token-abuse-controls-design.md")
md_text = spec_path.read_text()

OUTPUT = "docs/superpowers/specs/2026-07-06-device-token-abuse-controls-design.pdf"

# --- Styles ---
BFP_MAROON = HexColor("#991B1B")
BFP_MAROON_LIGHT = HexColor("#FDF2F2")
DARK_GRAY = HexColor("#1F2937")
MED_GRAY = HexColor("#4B5563")
LIGHT_GRAY = HexColor("#F3F4F6")
BORDER_GRAY = HexColor("#D1D5DB")
PURPLE = HexColor("#7C3AED")
GREEN = HexColor("#059669")
TABLE_HEADER = HexColor("#991B1B")

styles = getSampleStyleSheet()

title_style = ParagraphStyle(
    "SpecTitle", parent=styles["Title"],
    fontSize=22, leading=28, textColor=BFP_MAROON,
    spaceAfter=6*mm, alignment=TA_LEFT, fontName="Helvetica-Bold",
)

subtitle_style = ParagraphStyle(
    "SpecSubtitle", parent=styles["Normal"],
    fontSize=11, leading=14, textColor=MED_GRAY,
    spaceAfter=4*mm, fontName="Helvetica",
)

h1_style = ParagraphStyle(
    "SpecH1", parent=styles["Heading1"],
    fontSize=16, leading=20, textColor=BFP_MAROON,
    spaceBefore=8*mm, spaceAfter=4*mm, fontName="Helvetica-Bold",
    borderWidth=0, borderColor=BFP_MAROON, borderPadding=0,
)

h2_style = ParagraphStyle(
    "SpecH2", parent=styles["Heading2"],
    fontSize=13, leading=17, textColor=DARK_GRAY,
    spaceBefore=5*mm, spaceAfter=3*mm, fontName="Helvetica-Bold",
)

h3_style = ParagraphStyle(
    "SpecH3", parent=styles["Heading3"],
    fontSize=11, leading=14, textColor=DARK_GRAY,
    spaceBefore=3*mm, spaceAfter=2*mm, fontName="Helvetica-Bold",
)

body_style = ParagraphStyle(
    "SpecBody", parent=styles["Normal"],
    fontSize=10, leading=14, textColor=DARK_GRAY,
    spaceAfter=3*mm, alignment=TA_JUSTIFY, fontName="Helvetica",
)

bullet_style = ParagraphStyle(
    "SpecBullet", parent=body_style,
    leftIndent=8*mm, bulletIndent=2*mm,
    spaceBefore=1*mm, spaceAfter=1*mm,
)

code_style = ParagraphStyle(
    "SpecCode", parent=body_style,
    fontName="Courier", fontSize=8.5, leading=11,
    leftIndent=4*mm, spaceAfter=2*mm, spaceBefore=1*mm,
    backColor=LIGHT_GRAY, borderWidth=0.5, borderColor=BORDER_GRAY,
    borderPadding=3,
)

note_style = ParagraphStyle(
    "SpecNote", parent=body_style,
    fontSize=9, leading=12, textColor=MED_GRAY,
    leftIndent=4*mm, spaceAfter=2*mm, fontName="Helvetica-Oblique",
)

table_header_style = ParagraphStyle(
    "TableHeader", parent=body_style,
    fontSize=9, leading=11, textColor=colors.white,
    fontName="Helvetica-Bold", alignment=TA_CENTER,
)

table_cell_style = ParagraphStyle(
    "TableCell", parent=body_style,
    fontSize=9, leading=11, textColor=DARK_GRAY,
    fontName="Helvetica",
)

meta_style = ParagraphStyle(
    "MetaLabel", parent=body_style,
    fontSize=9, leading=12, textColor=MED_GRAY,
    fontName="Helvetica", spaceAfter=0,
)

meta_value_style = ParagraphStyle(
    "MetaValue", parent=body_style,
    fontSize=9, leading=12, textColor=DARK_GRAY,
    fontName="Helvetica-Bold", spaceAfter=0,
)


def make_table(headers, rows, col_widths=None):
    """Create a styled table."""
    header_cells = [Paragraph(h, table_header_style) for h in headers]
    data = [header_cells]
    for row in rows:
        data.append([Paragraph(str(c), table_cell_style) for c in row])

    t = Table(data, colWidths=col_widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), TABLE_HEADER),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
        ("TOPPADDING", (0, 0), (-1, 0), 6),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 4),
        ("TOPPADDING", (0, 1), (-1, -1), 4),
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER_GRAY),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 1), (-1, -1), colors.white),
    ]))
    # Alternating row colors
    for i in range(1, len(data)):
        if i % 2 == 0:
            t.setStyle(TableStyle([("BACKGROUND", (0, i), (-1, i), HexColor("#FAFAFA"))]))
    return t


def create_hr():
    return HRFlowable(width="100%", thickness=0.5, color=BORDER_GRAY, spaceAfter=4*mm, spaceBefore=2*mm)


# --- Parse sections ---
# Simple parser: ## = section, ### = subsection, #### = subsubsection
lines = md_text.split("\n")

elements = []

# Title page
elements.append(Paragraph("Device Token Abuse Controls", title_style))
elements.append(Paragraph("Design Specification", ParagraphStyle("Sub", parent=subtitle_style, fontSize=14, leading=18, textColor=BFP_MAROON)))
elements.append(Spacer(1, 4*mm))
elements.append(create_hr())
elements.append(Paragraph(f"<b>Date:</b> 2026-07-06", meta_style))
elements.append(Paragraph(f"<b>Status:</b> Draft", meta_style))
elements.append(Paragraph(f"<b>Sources:</b> Defense panel feedback, design grill with grill-with-docs skill, Oracle + Reviewer subagent consultations", meta_style))
elements.append(Paragraph(f"<b>Glossary:</b> See CONTEXT.md (Device Token, Device Blocklist, Shadow Throttle, Registered Device Enrollment)", meta_style))

elements.append(Spacer(1, 8*mm))

# Track current section
current_section = None
in_code_block = False
code_buffer = []
in_table = False
table_lines = []

# We need to handle markdown tables, code blocks, lists
i = 0
while i < len(lines):
    line = lines[i]
    stripped = line.strip()

    # Code block handling
    if stripped.startswith("```"):
        if in_code_block:
            in_code_block = False
            code_text = "\n".join(code_buffer)
            elements.append(Paragraph(code_text.replace("\n", "<br/>"), code_style))
            code_buffer = []
            i += 1
            continue
        else:
            in_code_block = True
            code_buffer = []
            i += 1
            continue

    if in_code_block:
        # Escape HTML for code
        escaped = stripped.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        code_buffer.append(escaped)
        i += 1
        continue

    # Skip frontmatter lines
    if stripped.startswith("# ") or stripped.startswith("**Date:**") or stripped.startswith("**Status:**") or stripped.startswith("**Sources:**") or stripped.startswith("**Glossary:**"):
        i += 1
        continue

    # H1 (title) — already done
    if stripped.startswith("# "):
        i += 1
        continue

    # H2 (## Section title)
    if stripped.startswith("## "):
        section_title = stripped.replace("## ", "")
        elements.append(Paragraph(section_title, h1_style))
        current_section = section_title
        i += 1
        continue

    # H3 (### Subsection)
    if stripped.startswith("### "):
        sub_title = stripped.replace("### ", "")
        elements.append(Paragraph(sub_title, h2_style))
        i += 1
        continue

    # H4 (#### Sub-subsection)
    if stripped.startswith("#### "):
        subsub_title = stripped.replace("#### ", "")
        elements.append(Paragraph(subsub_title, h3_style))
        i += 1
        continue

    # Markdown table detection (line contains | and ---)
    if "|" in stripped and "---" in stripped:
        i += 1
        continue  # skip the separator row

    if "|" in stripped and stripped.startswith("|"):
        # Parse table
        table_rows = []
        header_row = None
        # Collect all table lines
        while i < len(lines) and lines[i].strip().startswith("|"):
            row = lines[i].strip()
            cells = [c.strip() for c in row.split("|")[1:-1]]
            if header_row is None:
                header_row = cells
            else:
                # Skip separator rows
                if all("-" in c for c in cells if c):
                    i += 1
                    continue
                table_rows.append(cells)
            i += 1
        if header_row and table_rows:
            # Calculate column widths based on number of columns
            ncols = len(header_row)
            avail = 170*mm
            col_widths = [avail / ncols] * ncols
            # Give more width to content-heavy columns
            if ncols == 2:
                col_widths = [35*mm, 135*mm]
            elif ncols == 3:
                col_widths = [40*mm, 60*mm, 70*mm]
            elif ncols == 4:
                col_widths = [35*mm, 40*mm, 40*mm, 55*mm]
            elif ncols == 5:
                col_widths = [30*mm, 35*mm, 35*mm, 35*mm, 35*mm]
            elif ncols == 6:
                col_widths = [25*mm, 30*mm, 30*mm, 30*mm, 30*mm, 25*mm]

            elements.append(make_table(header_row, table_rows, col_widths))
            elements.append(Spacer(1, 3*mm))
        continue

    # Bullet list
    if stripped.startswith("- ") or stripped.startswith("* "):
        bullet_items = []
        while i < len(lines):
            s = lines[i].strip()
            if s.startswith("- ") or s.startswith("* "):
                text = s[2:] if s.startswith("- ") else s[2:]
                # Bold markers: **text**
                text = re.sub(r'\*\*(.*?)\*\*', r'<b>\1</b>', text)
                # Inline code: `text`
                text = re.sub(r'`([^`]+)`', r'<font face="Courier" color="#991B1B">\1</font>', text)
                bullet_items.append(Paragraph(f"<bullet>&bull;</bullet>{text}", bullet_style))
                i += 1
            elif s.startswith("  ") or s == "":
                # Continue sub-bullets or blank lines
                if s.startswith("  ") and s.strip():
                    text = s.strip()
                    text = re.sub(r'\*\*(.*?)\*\*', r'<b>\1</b>', text)
                    text = re.sub(r'`([^`]+)`', r'<font face="Courier" color="#991B1B">\1</font>', text)
                    bullet_items.append(Paragraph(f"<bullet>-</bullet>{text}", bullet_style))
                    i += 1
                elif s == "":
                    i += 1
                    continue
                else:
                    break
            else:
                break
        if bullet_items:
            elements.append(ListFlowable(bullet_items, bulletType='bullet', start='\u2022', leftIndent=8, bulletFontSize=8))
        continue

    # Numbered list (1. ..., 2. ...)
    if re.match(r'^\d+\.\s', stripped):
        numbered_items = []
        while i < len(lines):
            s = lines[i].strip()
            match = re.match(r'^(\d+)\.\s+(.*)', s)
            if match:
                text = match.group(2)
                text = re.sub(r'\*\*(.*?)\*\*', r'<b>\1</b>', text)
                text = re.sub(r'`([^`]+)`', r'<font face="Courier" color="#991B1B">\1</font>', text)
                numbered_items.append(Paragraph(f"<bullet>{match.group(1)}.</bullet>{text}", bullet_style))
                i += 1
            else:
                break
        if numbered_items:
            elements.append(ListFlowable(numbered_items, bulletType='bullet', start='1.', leftIndent=8, bulletFontSize=8))
        continue

    # Horizontal rule
    if stripped.startswith("---") and len(stripped) >= 3:
        elements.append(create_hr())
        i += 1
        continue

    # Blank line
    if not stripped:
        i += 1
        continue

    # Regular paragraph
    text = stripped
    # Bold markers
    text = re.sub(r'\*\*(.*?)\*\*', r'<b>\1</b>', text)
    # Inline code
    text = re.sub(r'`([^`]+)`', r'<font face="Courier" color="#991B1B">\1</font>', text)
    elements.append(Paragraph(text, body_style))
    i += 1

# --- Build PDF ---
doc = SimpleDocTemplate(
    OUTPUT,
    pagesize=A4,
    topMargin=20*mm,
    bottomMargin=20*mm,
    leftMargin=20*mm,
    rightMargin=20*mm,
    title="Device Token Abuse Controls — Design Spec",
    author="WIMS-BFP",
)

# Page numbering
def add_page_number(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(MED_GRAY)
    page_num = canvas.getPageNumber()
    text = f"WIMS-BFP — Device Token Abuse Controls — Page {page_num}"
    canvas.drawCentredString(A4[0] / 2, 12*mm, text)
    canvas.restoreState()

doc.build(elements, onFirstPage=add_page_number, onLaterPages=add_page_number)
print(f"PDF generated: {OUTPUT}")
