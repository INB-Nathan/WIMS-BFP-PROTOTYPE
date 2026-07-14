import base64
from datetime import datetime, timezone
from uuid import uuid4
from zipfile import ZIP_DEFLATED, ZipFile
from io import BytesIO

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec

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


def test_offline_verifier_accepts_valid_package():
    package, public_key = _package()
    verified, warnings, checks, _ = verify_local_package(package, public_key)
    assert verified is True
    assert "Freshness unavailable in offline mode" in warnings
    assert checks["csv_hash_chain"].status == "pass"


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
