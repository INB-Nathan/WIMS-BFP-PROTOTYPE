from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

import pytest

from services.audit_export import (
    AuditExportTooLargeError,
    CanonicalCsvWriter,
    compute_csv_hash,
    inspect_csv_hash_chain,
    verify_csv_hash_chain,
)


def test_csv_writer_golden_bytes_and_chain() -> None:
    rows = [{"action": "x,y", "actor": 'q"z'}, {"action": None, "actor": True}]
    csv_bytes, final_hash, count = CanonicalCsvWriter(["action", "actor"]).write(rows)

    assert csv_bytes == (
        b"row_hash,action,actor\n"
        b'51fe85487b1eab32e1f5a0795ba8572c07af8c9f3486f4ec3d4aa96829802b1a,"x,y","q""z"\n'
        b"272f95383632eda9a6c14f3fbf5faa46fd728e0f41f82b560a06926d64b89165,,true\n"
    )
    assert final_hash == "sha256:b66b67daa4ce9e692cf793fdba627aa7df73879e640ad342130f7e2958fdda58"
    assert count == 2
    assert (
        compute_csv_hash(csv_bytes)
        == "sha256:83c250b0ef41bf45510868c248b22909a5244323acf5286f7ef062b8ab3af535"
    )
    assert verify_csv_hash_chain(csv_bytes, final_hash)
    assert inspect_csv_hash_chain(csv_bytes, final_hash).rows_verified == 2


def test_csv_chain_rejects_byte_tampering_and_reordering() -> None:
    csv_bytes, final_hash, _ = CanonicalCsvWriter(["id"]).write([["one"], ["two"]])

    tampered = csv_bytes.replace(b"two", b"bad")
    assert not verify_csv_hash_chain(tampered, final_hash)

    records = csv_bytes.splitlines(keepends=True)
    reordered = records[:1] + records[2:] + records[1:]
    assert not verify_csv_hash_chain(b"".join(reordered), final_hash)


def test_csv_preserves_embedded_newlines_in_quoted_values() -> None:
    csv_bytes, final_hash, _ = CanonicalCsvWriter(["message"]).write([["first\nsecond"]])

    assert b'"first\nsecond"' in csv_bytes
    assert verify_csv_hash_chain(csv_bytes, final_hash)


def test_csv_canonicalizes_common_database_values() -> None:
    rows = [
        [
            UUID("00000000-0000-0000-0000-000000000001"),
            datetime(2026, 7, 14, 12, tzinfo=timezone.utc),
        ]
    ]
    csv_bytes, final_hash, _ = CanonicalCsvWriter(["id", "created_at"]).write(rows)

    assert b"00000000-0000-0000-0000-000000000001,2026-07-14T12:00:00Z" in csv_bytes
    assert verify_csv_hash_chain(csv_bytes, final_hash)


def test_csv_canonicalizes_arbitrary_bytes_as_base64() -> None:
    csv_bytes, final_hash, _ = CanonicalCsvWriter(["payload"]).write([[b"\xff\x00"]])

    assert b"base64:/wA=" in csv_bytes
    assert verify_csv_hash_chain(csv_bytes, final_hash)


def test_boolean_csv_verifier_rejects_oversized_input() -> None:
    csv_bytes, final_hash, _ = CanonicalCsvWriter(["id"], max_rows=1).write([[1]])
    assert not verify_csv_hash_chain(csv_bytes, final_hash, max_rows=0)


def test_csv_row_limit_is_enforced() -> None:
    writer = CanonicalCsvWriter(["id"], max_rows=1)
    with pytest.raises(AuditExportTooLargeError):
        writer.write([[1], [2]])
