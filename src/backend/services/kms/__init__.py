"""KMS service package — provider dispatch and OpenBao Transit adapter."""

from __future__ import annotations

import logging
import os
from typing import Any

from services.kms.openbao_client import KmsSecurityProvider, OpenBaoClientError
from utils.crypto import SecurityProvider

logger = logging.getLogger("wims.kms")

# ── Lazy singletons ───────────────────────────────────────────────────────────

_env_aesgcm: SecurityProvider | None = None
_openbao: KmsSecurityProvider | None = None


def _get_env_aesgcm() -> SecurityProvider:
    global _env_aesgcm
    if _env_aesgcm is None:
        _env_aesgcm = SecurityProvider()
    return _env_aesgcm


def _get_openbao() -> KmsSecurityProvider:
    global _openbao
    if _openbao is None:
        _openbao = KmsSecurityProvider()
    return _openbao


# ── Public dispatch ───────────────────────────────────────────────────────────


def get_crypto_provider(
    row: dict[str, Any] | None = None,
) -> SecurityProvider | KmsSecurityProvider:
    """Return the correct crypto provider for a sensitive-details row.

    Dispatch rules (first match wins):

    1. If *row* has ``crypto_provider == 'openbao_transit'``, return
       ``KmsSecurityProvider`` — row-level metadata always wins.
    2. Otherwise, check the ``WIMS_CRYPTO_PROVIDER`` env var (defaults to
       ``env_aesgcm``).
    3. Unknown provider values raise ``OpenBaoClientError``.

    Parameters
    ----------
    row : dict | None
        A ``wims.incident_sensitive_details`` row as a dict (e.g.
        ``Row._mapping``).  When ``None``, only env dispatch is used (default
        ``env_aesgcm``).

    Returns
    -------
    SecurityProvider | KmsSecurityProvider

    Raises
    ------
    OpenBaoClientError
        If ``WIMS_CRYPTO_PROVIDER`` or row ``crypto_provider`` names an
        unrecognised provider.
    """
    if row is not None:
        row_provider = row.get("crypto_provider")
        if row_provider == "openbao_transit":
            return _get_openbao()
        if row_provider == "env_aesgcm":
            return _get_env_aesgcm()
        if row_provider is not None:
            raise OpenBaoClientError(
                f"Unknown row crypto_provider={row_provider!r} — expected "
                f"'env_aesgcm' or 'openbao_transit'"
            )

    env_provider = os.environ.get("WIMS_CRYPTO_PROVIDER", "env_aesgcm")
    if env_provider == "env_aesgcm":
        return _get_env_aesgcm()
    if env_provider == "openbao_transit":
        return _get_openbao()

    raise OpenBaoClientError(
        f"Unknown WIMS_CRYPTO_PROVIDER={env_provider!r} — expected "
        f"'env_aesgcm' or 'openbao_transit'"
    )
