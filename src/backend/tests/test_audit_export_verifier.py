import base64
from datetime import datetime, timezone
from uuid import uuid4
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo
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
    ArchiveTooLargeError,
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


def _build_valid_export_zip() -> bytes:
    """Build a structurally valid 3-member export package (no signature needed)."""
    payload = BytesIO()
    with ZipFile(payload, "w", ZIP_DEFLATED) as archive:
        archive.writestr("export.csv", b"action\nLOGIN\n")
        archive.writestr("export.pdf", b"%PDF-1.7 test payload\n")
        archive.writestr("export.audit.sig", b"{}")
    return payload.getvalue()


def _patch_central_directory_member(
    zip_bytes: bytes,
    name: str,
    *,
    compress_size: int | None = None,
    file_size: int | None = None,
    corrupt_crc: bool = False,
    set_flag_bits: int | None = None,
) -> bytes:
    """Mutate a central-directory record's size/CRC/flag fields without rewriting data.

    ``writestr`` always recomputes ``file_size``/``compress_size`` and resets
    ``flag_bits`` from the actual member data, so the compression-ratio, CRC,
    and encrypted-member guards must be exercised by patching the stored
    central-directory metadata directly.
    """
    cd_signature = b"PK\x01\x02"
    data = bytearray(zip_bytes)
    pos = 0
    while True:
        i = zip_bytes.find(cd_signature, pos)
        if i == -1:
            break
        fn_len = int.from_bytes(zip_bytes[i + 28 : i + 30], "little")
        fname = zip_bytes[i + 46 : i + 46 + fn_len]
        if fname == name.encode():
            if compress_size is not None:
                data[i + 20 : i + 24] = compress_size.to_bytes(4, "little")
            if file_size is not None:
                data[i + 24 : i + 28] = file_size.to_bytes(4, "little")
            if corrupt_crc:
                data[i + 16] ^= 0xFF
            if set_flag_bits is not None:
                data[i + 8 : i + 10] = set_flag_bits.to_bytes(2, "little")
            break
        pos = i + 46
    return bytes(data)


def test_zip_rejects_compression_bomb():
    valid = _build_valid_export_zip()
    bomb = _patch_central_directory_member(
        valid, "export.csv", compress_size=1, file_size=1_000_000
    )
    with pytest.raises(ArchiveTooLargeError):
        validate_zip_package(bomb)


def test_zip_rejects_directory_member():
    payload = BytesIO()
    with ZipFile(payload, "w", ZIP_DEFLATED) as archive:
        info = ZipInfo("export.csv/")
        archive.writestr(info, b"")
        archive.writestr("export.pdf", b"%PDF-1.7\n")
        archive.writestr("export.audit.sig", b"{}")
    with pytest.raises(ArchiveValidationError):
        validate_zip_package(payload.getvalue())


def test_zip_rejects_encrypted_member():
    valid = _build_valid_export_zip()
    encrypted = _patch_central_directory_member(valid, "export.csv", set_flag_bits=0x1)
    with pytest.raises(ArchiveValidationError):
        validate_zip_package(encrypted)


def test_zip_rejects_crc_failure():
    valid = _build_valid_export_zip()
    corrupted = _patch_central_directory_member(valid, "export.csv", corrupt_crc=True)
    with pytest.raises(ArchiveValidationError):
        validate_zip_package(corrupted)


def test_zip_rejects_non_zip():
    with pytest.raises(ArchiveValidationError):
        validate_zip_package(b"not a zip file")


def test_zip_rejects_duplicate_names():
    payload = BytesIO()
    with ZipFile(payload, "w", ZIP_DEFLATED) as archive:
        archive.writestr("export.csv", b"a")
        archive.writestr("export.csv", b"b")
        archive.writestr("export.pdf", b"c")
    with pytest.raises(ArchiveValidationError):
        validate_zip_package(payload.getvalue())


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
