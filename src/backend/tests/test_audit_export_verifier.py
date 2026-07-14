import base64
from datetime import datetime, timezone
from uuid import uuid4
from zipfile import ZIP_DEFLATED, ZipFile
from io import BytesIO

from unittest.mock import MagicMock

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from sqlalchemy.orm import Session

from schemas.audit_export import (
    AuditExportCsvDialect,
    AuditExportIdentity,
    AuditExportManifest,
    AuditExportSigningKey,
)
from services.audit_export import (
    CanonicalCsvWriter,
    canonical_manifest_bytes,
    compute_csv_hash,
    compute_filter_hash,
    create_export_zip,
    public_key_fingerprint,
)
from services.audit_export_pdf import compute_pdf_hash
from services.audit_export_orchestration import _admin_where
from services.audit_export_verifier import (
    ArchiveValidationError,
    validate_zip_package,
    verify_local_package,
    verify_online_package,
)
from services.kms.openbao_client import OpenBaoClient, OpenBaoClientError


def _package() -> tuple[bytes, bytes]:
    private_key = ec.generate_private_key(ec.SECP256R1())
    public_key = private_key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    csv_bytes, chain_hash, row_count = CanonicalCsvWriter(["action"]).write([["LOGIN"]])
    pdf_bytes = b"%PDF-1.7\nsecure-test\n"
    export_uuid = uuid4()
    filters = {"export_scope": "admin", "actor_user_id": str(export_uuid)}
    manifest = AuditExportManifest(
        version=1,
        export_uuid=export_uuid,
        exported_at=datetime.now(timezone.utc),
        exported_by=AuditExportIdentity(user_id=export_uuid, username="admin", role="SYSTEM_ADMIN"),
        export_scope="admin",
        filters=filters,
        filter_hash=compute_filter_hash(filters),
        row_count=row_count,
        csv_hash=compute_csv_hash(csv_bytes),
        csv_chain_final_hash=chain_hash,
        csv_dialect=AuditExportCsvDialect(columns=["action"]),
        pdf_hash=compute_pdf_hash(pdf_bytes),
        signing_key=AuditExportSigningKey(
            provider="openbao_transit",
            key_name="audit-export-signer",
            key_version=1,
            algorithm="sha2-256",
            key_fingerprint=public_key_fingerprint(public_key),
        ),
        signature="pending",
    )
    signature = private_key.sign(canonical_manifest_bytes(manifest), ec.ECDSA(hashes.SHA256()))
    manifest = manifest.model_copy(
        update={"signature": "vault:v1:" + base64.b64encode(signature).decode("ascii")}
    )
    return create_export_zip(
        csv_bytes, pdf_bytes, canonical_manifest_bytes(manifest, include_signature=True)
    ), public_key


def _rebuild(package: bytes, **overrides: bytes) -> bytes:
    """Rebuild a ZIP from a valid package, replacing named members."""
    members: dict[str, bytes] = {}
    with ZipFile(BytesIO(package), "r") as archive:
        for name in archive.namelist():
            members[name] = archive.read(name)
    members.update(overrides)
    out = BytesIO()
    with ZipFile(out, "w", ZIP_DEFLATED) as archive:
        for name, data in members.items():
            archive.writestr(name, data)
    return out.getvalue()


def test_offline_verifier_accepts_valid_package():
    package, public_key = _package()
    verified, warnings, checks, _ = verify_local_package(package, public_key)
    assert verified is True
    assert "Freshness unavailable in offline mode" in warnings
    assert checks["csv_hash_chain"].status == "pass"


def test_offline_verifier_rejects_mismatched_fingerprint_anchor():
    package, public_key = _package()
    verified, warnings, checks, _ = verify_local_package(
        package, public_key, trusted_fingerprint="sha256:deadbeef"
    )
    assert verified is False
    assert checks["public_key"].status == "fail"


def test_offline_verifier_accepts_valid_fingerprint_anchor():
    package, public_key = _package()
    trusted = public_key_fingerprint(public_key)
    verified, warnings, checks, _ = verify_local_package(
        package, public_key, trusted_fingerprint=trusted
    )
    assert verified is True
    assert checks["public_key"].status == "pass"


def test_zip_rejects_path_traversal():
    payload = BytesIO()
    with ZipFile(payload, "w", ZIP_DEFLATED) as archive:
        archive.writestr("../export.csv", b"bad")
        archive.writestr("export.pdf", b"bad")
        archive.writestr("export.audit.sig", b"{}")
    with pytest.raises(ArchiveValidationError):
        validate_zip_package(payload.getvalue())


def test_admin_filter_ignores_whitespace_query():
    where_sql, params = _admin_where({"q": "   "})
    assert where_sql == ""
    assert params == {}


def test_public_key_errors_are_attributed_to_public_key():
    client = OpenBaoClient.__new__(OpenBaoClient)
    client._request = lambda *_args, **_kwargs: {"data": {"keys": {}}}
    with pytest.raises(OpenBaoClientError) as error:
        client.public_key("audit-export-signer", 1)
    assert error.value.method == "public_key"


# --- Group A: online verify (mocked OpenBaoClient + Session) ---


def test_online_verifier_accepts_valid_package():
    package, public_key = _package()
    client = MagicMock(spec=OpenBaoClient)
    client.verify.return_value = True
    client.public_key.return_value = public_key
    db = MagicMock(spec=Session)
    db.execute.return_value.fetchone.return_value = None
    verified, _warnings, checks, _manifest = verify_online_package(package, client=client, db=db)
    assert verified is True
    assert all(check.status == "pass" for check in checks.values())
    assert checks["freshness"].status == "pass"


def test_online_verifier_rejects_bad_signature():
    package, _public_key = _package()
    client = MagicMock(spec=OpenBaoClient)
    client.verify.return_value = False
    db = MagicMock(spec=Session)
    db.execute.return_value.fetchone.return_value = None
    verified, _warnings, checks, _manifest = verify_online_package(package, client=client, db=db)
    assert verified is False
    assert checks["signature"].status == "fail"


def test_online_verifier_detects_freshness_warning():
    package, public_key = _package()
    client = MagicMock(spec=OpenBaoClient)
    client.verify.return_value = True
    client.public_key.return_value = public_key
    db = MagicMock(spec=Session)
    db.execute.return_value.fetchone.return_value = (str(uuid4()),)
    verified, _warnings, checks, _manifest = verify_online_package(package, client=client, db=db)
    assert verified is True
    assert checks["freshness"].status == "warn"


# --- Group B: package tamper detection (verify_local_package) ---


def test_offline_verifier_rejects_tampered_csv():
    package, public_key = _package()
    tampered = _rebuild(package, **{"export.csv": b"garbage,data\n"})
    verified, _warnings, checks, _manifest = verify_local_package(tampered, public_key)
    assert verified is False
    assert checks["csv_hash"].status == "fail"


def test_offline_verifier_rejects_tampered_pdf():
    package, public_key = _package()
    tampered = _rebuild(package, **{"export.pdf": b"%PDF-1.7\ncorrupted\n"})
    verified, _warnings, checks, _manifest = verify_local_package(tampered, public_key)
    assert verified is False
    assert checks["pdf_hash"].status == "fail"


def test_offline_verifier_rejects_corrupt_manifest():
    package, public_key = _package()
    tampered = _rebuild(package, **{"export.audit.sig": b"not json"})
    with pytest.raises(ArchiveValidationError):
        verify_local_package(tampered, public_key)
