"""Unit tests for the incident data_hash coverage fix (RP-06).

Pure unit tests — no DB, no app startup. They use a stub session so they run
without the Postgres stack and prove the hash now covers substantive detail
fields, so direct DB tampering of those fields is detectable.
"""

from datetime import datetime, timezone

from services.regional_incidents.helpers import (
    HASHED_NSD_FIELDS,
    compute_incident_data_hash,
)


class _FakeResult:
    def __init__(self, row):
        self._row = row

    def fetchone(self):
        return self._row


class _FakeDB:
    """Minimal stand-in for a SQLAlchemy session returning one fixed detail row."""

    def __init__(self, row):
        self._row = row

    def execute(self, *args, **kwargs):
        return _FakeResult(self._row)


_CREATED = datetime(2026, 1, 1, tzinfo=timezone.utc)


def _hash_for(row):
    return compute_incident_data_hash(
        _FakeDB(row),
        1,
        encoder_id="enc",
        keycloak_id="kc",
        region_id=1,
        created_at=_CREATED,
    )


def test_hash_is_deterministic_and_64_hex():
    row = tuple("x" for _ in HASHED_NSD_FIELDS)
    h1 = _hash_for(row)
    h2 = _hash_for(row)
    assert h1 == h2
    assert len(h1) == 64
    int(h1, 16)  # valid hex


def test_detail_field_tampering_changes_hash():
    """RP-06: editing a substantive detail field must change the data_hash."""
    base = tuple("" for _ in HASHED_NSD_FIELDS)
    idx = HASHED_NSD_FIELDS.index("civilian_injured")
    tampered = list(base)
    tampered[idx] = "5"
    assert _hash_for(base) != _hash_for(tuple(tampered))


def test_provenance_still_affects_hash():
    row = tuple("" for _ in HASHED_NSD_FIELDS)
    h_region1 = _hash_for(row)
    h_region2 = compute_incident_data_hash(
        _FakeDB(row),
        1,
        encoder_id="enc",
        keycloak_id="kc",
        region_id=2,
        created_at=_CREATED,
    )
    assert h_region1 != h_region2


def test_missing_detail_row_is_handled():
    """A NULL detail row hashes deterministically (all fields empty)."""
    h_none = _hash_for(None)
    h_empty = _hash_for(tuple("" for _ in HASHED_NSD_FIELDS))
    assert h_none == h_empty
