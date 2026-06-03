"""Email service — render Jinja2 HTML email templates, send via aiosmtplib."""

from __future__ import annotations

import asyncio
import logging
import os
import re
from email.message import EmailMessage
from pathlib import Path
from typing import Any

import aiosmtplib
from jinja2 import Environment, FileSystemLoader, select_autoescape

logger = logging.getLogger(__name__)

SMTP_HOST = os.getenv("SMTP_HOST", "mailhog")
SMTP_PORT = int(os.getenv("SMTP_PORT", "1025"))
SMTP_FROM = os.getenv("SMTP_FROM", "no-reply@bfp.gov.ph")
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_STARTTLS = os.getenv("SMTP_STARTTLS", "false").lower() in ("true", "1", "yes")

_TEMPLATES_DIR = Path(__file__).parent / "templates"

_env = Environment(
    loader=FileSystemLoader(str(_TEMPLATES_DIR)),
    autoescape=select_autoescape(["html", "xml"]),
)

# Cache for raw subject template strings (avoid re-reading template files)
_subject_raw_cache: dict[str, str] = {}


def _html_to_plain_text(html: str) -> str:
    """Convert HTML email body to plain text for multipart/alternative."""
    text = re.sub(r"<style[^>]*>.*?</style>", "", html, flags=re.DOTALL)
    text = re.sub(r"<script[^>]*>.*?</script>", "", text, flags=re.DOTALL)
    text = re.sub(r"<br\s*/?>", "\n", text)
    text = re.sub(r"</?p[^>]*>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</?tr[^>]*>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</td>", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = (
        text.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
    )
    text = re.sub(r"\n\s*\n", "\n\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    return text.strip()


def _load_subject(template_name: str, context: dict[str, Any]) -> str:
    """Extract and Jinja2-render the subject from the {# subject: ... #} header line.

    Caches the raw subject template string so the template file is only read once.
    """
    if template_name not in _subject_raw_cache:
        path = _TEMPLATES_DIR / f"{template_name}.html.j2"
        for line in path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if stripped.startswith("{#"):
                inner = stripped[2:].split("#}")[0].strip()
                if inner.lower().startswith("subject:"):
                    _subject_raw_cache[template_name] = inner[len("subject:"):].strip()
                    break
        if template_name not in _subject_raw_cache:
            _subject_raw_cache[template_name] = ""

    raw = _subject_raw_cache.get(template_name, "")
    if not raw:
        return "WIMS-BFP Notification"
    return _env.from_string(raw).render(context)


def render_email(template_name: str, context: dict[str, Any]) -> tuple[str, str]:
    """Render a Jinja2 HTML email template and return (subject, html_body).

    1. Load <template_name>.html.j2 from services/email/templates/
    2. Extract and Jinja2-render subject from the {# subject: ... #} header
       (passes context so template vars like {{ severity|upper }} resolve)
    3. Jinja2-render the body with context
    """
    template = _env.get_template(f"{template_name}.html.j2")
    subject = _load_subject(template_name, context)
    html = template.render(context)
    return subject, html


async def send_email_async(
    to: str | list[str],
    template_name: str,
    context: dict[str, Any],
) -> None:
    """Render and send a multipart email asynchronously via aiosmtplib.

    Template rendering is performed inside the try/except so render errors
    are logged before propagating.
    """
    try:
        subject, html = render_email(template_name, context)
    except Exception as exc:
        logger.error("Failed to render email template '%s': %s", template_name, exc)
        raise

    if isinstance(to, list):
        to_addrs = to
    else:
        to_addrs = [to]

    msg = EmailMessage()
    msg["From"] = SMTP_FROM
    msg["To"] = ", ".join(to_addrs)
    msg["Subject"] = subject
    msg.set_content(html, subtype="html")
    msg.add_alternative(_html_to_plain_text(html), subtype="plain")

    try:
        await aiosmtplib.send(
            msg,
            hostname=SMTP_HOST,
            port=SMTP_PORT,
            username=SMTP_USER or None,
            password=SMTP_PASSWORD or None,
            start_tls=SMTP_STARTTLS,
        )
        logger.info("Email sent to %s via %s:%d", to_addrs, SMTP_HOST, SMTP_PORT)
    except Exception as exc:
        logger.error("Failed to send email to %s: %s", to_addrs, exc)
        raise


def send_email(to: str | list[str], template_name: str, context: dict[str, Any]) -> None:
    """Synchronous wrapper around send_email_async (for Celery tasks)."""
    asyncio.run(send_email_async(to, template_name, context))
