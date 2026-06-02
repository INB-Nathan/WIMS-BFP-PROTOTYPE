"""Email service — render Jinja2 HTML email templates, send via aiosmtplib."""

from __future__ import annotations

import asyncio
import logging
import os
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

_TEMPLATES_DIR = Path(__file__).parent / "templates"

_env = Environment(
    loader=FileSystemLoader(str(_TEMPLATES_DIR)),
    autoescape=select_autoescape(["html", "xml"]),
)


def _load_subject(template_name: str, context: dict[str, Any]) -> str:
    """Extract and Jinja2-render the subject from the {# subject: ... #} header line."""
    path = _TEMPLATES_DIR / f"{template_name}.html.j2"
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped.startswith("{#"):
            inner = stripped[2:].split("#}")[0].strip()
            if inner.lower().startswith("subject:"):
                subject_raw = inner[len("subject:") :].strip()
                return _env.from_string(subject_raw).render(context)
    return "WIMS-BFP Notification"


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
    """Render and send an email asynchronously via aiosmtplib."""
    subject, html = render_email(template_name, context)

    if isinstance(to, list):
        to_addrs = to
    else:
        to_addrs = [to]

    msg = EmailMessage()
    msg["From"] = SMTP_FROM
    msg["To"] = ", ".join(to_addrs)
    msg["Subject"] = subject
    msg.set_content(html, subtype="html")

    try:
        await aiosmtplib.send(
            msg,
            hostname=SMTP_HOST,
            port=SMTP_PORT,
            username=SMTP_USER or None,
            password=SMTP_PASSWORD or None,
            start_tls=False,
        )
        logger.info("Email sent to %s via %s:%d", to_addrs, SMTP_HOST, SMTP_PORT)
    except Exception as exc:
        logger.error("Failed to send email to %s: %s", to_addrs, exc)
        raise


def send_email(to: str | list[str], template_name: str, context: dict[str, Any]) -> None:
    """Synchronous wrapper around send_email_async (for Celery tasks)."""
    asyncio.run(send_email_async(to, template_name, context))
