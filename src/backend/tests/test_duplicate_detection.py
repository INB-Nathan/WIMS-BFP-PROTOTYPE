"""Unit tests for the conservative gated duplicate detection system.

These tests cover two layers:

Layer 1 — Python helper functions (no DB required):
  These directly exercise _check_anchor, _is_incompatible_category,
  _score_candidate, and the threshold logic.  They verify the 8 behavioural
  requirements from the design spec.

Layer 2 — check_for_duplicate SQL param construction (mocked DB):
  These mock db.execute() to validate that effective_date derivation, dynamic
  WHERE clauses (exclude_statuses, verified_window_seconds), and the core SQL
  params are constructed correctly.  The DB mock returns fetchall() = [] so the
  Python scoring path is a no-op; these tests care only about the SQL params.

SQL / PostGIS correctness (ST_Distance, ST_DWithin) is covered by integration
tests against a live database; see tests/integration/.
"""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest

from services.duplicate_detection import (
    ANCHOR_DISTANCE_M,
    SCORE_LIKELY,
    SCORE_POSSIBLE,
    _check_anchor,
    _is_incompatible_category,
    _normalize,
    _score_candidate,
    check_for_duplicate,
)


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------


def _make_db(rows=None):
    """Mock DB whose execute().fetchall() returns the given rows list."""
    db = MagicMock()
    db.execute.return_value.fetchall.return_value = rows or []
    return db


def _get_params(db) -> dict:
    positional_args, _ = db.execute.call_args
    return positional_args[1]


def _cand(
    incident_id: int = 99,
    distance_m: float | None = 50.0,
    notification_dt: datetime | None = None,
    general_category: str | None = "STRUCTURAL",
    incident_type_code: str | None = "APT",
    barangay_id: int | None = None,
    barangay: str | None = "Barangay Commonwealth",
    city_municipality: str | None = "Quezon City",
    province_district: str | None = "NCR",
    street_address: str | None = "10 Batangas St",
    landmark: str | None = None,
    establishment_name: str | None = None,
    fire_station_name: str | None = None,
):
    """Return a tuple matching the SQL SELECT column order in check_for_duplicate."""
    return (
        incident_id,
        datetime(2026, 5, 9, tzinfo=timezone.utc),  # updated_at
        distance_m,
        notification_dt,
        general_category,
        incident_type_code,
        barangay_id,
        barangay,
        city_municipality,
        province_district,
        street_address,
        landmark,
        establishment_name,
        fire_station_name,
    )


_BASE_DT = datetime(2026, 5, 9, 14, 30, tzinfo=timezone.utc)

# Common keyword arguments for check_for_duplicate that include all new fields
_COMMON_KWARGS = dict(
    incident_id=1,
    region_id=1,
    incident_date="2026-05-09",
    lat=14.5,
    lon=121.0,
    general_category="STRUCTURAL",
    incident_type_code="APT",
    city_municipality="Quezon City",
    province_district="NCR",
    barangay="Barangay Commonwealth",
    street_address="10 Batangas St",
    notification_dt=_BASE_DT,
)


# ---------------------------------------------------------------------------
# Layer 1a — _normalize
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_normalize_strips_and_lowercases():
    assert _normalize("  Hello World  ") == "hello world"


@pytest.mark.unit
def test_normalize_collapses_whitespace():
    assert _normalize("Barangay  123") == "barangay 123"


@pytest.mark.unit
def test_normalize_none_returns_none():
    assert _normalize(None) is None


@pytest.mark.unit
def test_normalize_empty_string_returns_none():
    assert _normalize("   ") is None


# ---------------------------------------------------------------------------
# Layer 1b — _check_anchor
# ---------------------------------------------------------------------------

_ANCHOR_KWARGS = dict(
    cand_barangay_id=None,
    cand_barangay="Barangay Commonwealth",
    cand_street_address="10 Batangas St",
    cand_landmark=None,
    cand_establishment_name=None,
    query_barangay_id=None,
    query_barangay="Barangay Commonwealth",
    query_street_address="10 Batangas St",
    query_landmark=None,
    query_establishment_name=None,
)


@pytest.mark.unit
def test_anchor_passes_on_close_coords():
    assert _check_anchor(200.0, **_ANCHOR_KWARGS) is True


@pytest.mark.unit
def test_anchor_passes_exactly_at_boundary():
    assert _check_anchor(ANCHOR_DISTANCE_M, **_ANCHOR_KWARGS) is True


@pytest.mark.unit
def test_anchor_fails_on_distant_coords_no_address():
    assert (
        _check_anchor(
            300.0,
            cand_barangay_id=None,
            cand_barangay="Different Barangay",
            cand_street_address="Other St",
            cand_landmark=None,
            cand_establishment_name=None,
            query_barangay_id=None,
            query_barangay="Barangay Commonwealth",
            query_street_address="10 Batangas St",
            query_landmark=None,
            query_establishment_name=None,
        )
        is False
    )


@pytest.mark.unit
def test_anchor_passes_on_address_match_no_coords():
    assert _check_anchor(None, **_ANCHOR_KWARGS) is True


@pytest.mark.unit
def test_anchor_passes_on_landmark_match():
    assert (
        _check_anchor(
            None,
            cand_barangay_id=None,
            cand_barangay="Barangay Commonwealth",
            cand_street_address=None,
            cand_landmark="Near QC Hall",
            cand_establishment_name=None,
            query_barangay_id=None,
            query_barangay="Barangay Commonwealth",
            query_street_address=None,
            query_landmark="Near QC Hall",
            query_establishment_name=None,
        )
        is True
    )


@pytest.mark.unit
def test_anchor_fails_same_barangay_different_street():
    """Same barangay but different street: address anchor requires both."""
    assert (
        _check_anchor(
            400.0,
            cand_barangay_id=None,
            cand_barangay="Barangay Commonwealth",
            cand_street_address="5 Different St",
            cand_landmark=None,
            cand_establishment_name=None,
            query_barangay_id=None,
            query_barangay="Barangay Commonwealth",
            query_street_address="10 Batangas St",
            query_landmark=None,
            query_establishment_name=None,
        )
        is False
    )


@pytest.mark.unit
def test_anchor_passes_establishment_with_close_coords():
    assert (
        _check_anchor(
            300.0,
            cand_barangay_id=None,
            cand_barangay=None,
            cand_street_address=None,
            cand_landmark=None,
            cand_establishment_name="Commonwealth Apts",
            query_barangay_id=None,
            query_barangay=None,
            query_street_address=None,
            query_landmark=None,
            query_establishment_name="Commonwealth Apts",
        )
        is True
    )


@pytest.mark.unit
def test_anchor_fails_establishment_without_location():
    """Establishment name alone (far away, no barangay) must not anchor."""
    assert (
        _check_anchor(
            None,
            cand_barangay_id=None,
            cand_barangay=None,
            cand_street_address=None,
            cand_landmark=None,
            cand_establishment_name="Commonwealth Apts",
            query_barangay_id=None,
            query_barangay=None,
            query_street_address=None,
            query_landmark=None,
            query_establishment_name="Commonwealth Apts",
        )
        is False
    )


@pytest.mark.unit
def test_anchor_passes_barangay_id_match():
    """FK barangay_id match is preferred over text matching."""
    assert (
        _check_anchor(
            None,
            cand_barangay_id=5,
            cand_barangay=None,
            cand_street_address="10 Batangas St",
            cand_landmark=None,
            cand_establishment_name=None,
            query_barangay_id=5,
            query_barangay=None,
            query_street_address="10 Batangas St",
            query_landmark=None,
            query_establishment_name=None,
        )
        is True
    )


# ---------------------------------------------------------------------------
# Layer 1c — _is_incompatible_category
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_incompatible_structural_vs_wildland():
    assert _is_incompatible_category("STRUCTURAL", "WILDLAND") is True


@pytest.mark.unit
def test_compatible_same_category():
    assert _is_incompatible_category("STRUCTURAL", "STRUCTURAL") is False


@pytest.mark.unit
def test_compatible_one_null():
    assert _is_incompatible_category(None, "STRUCTURAL") is False
    assert _is_incompatible_category("WILDLAND", None) is False


@pytest.mark.unit
def test_compatible_both_null():
    assert _is_incompatible_category(None, None) is False


# ---------------------------------------------------------------------------
# Layer 1d — _score_candidate
# ---------------------------------------------------------------------------

_SCORE_BASE = dict(
    query_notification_dt=_BASE_DT,
    query_general_category="STRUCTURAL",
    query_incident_type_code="APT",
    query_barangay_id=None,
    query_barangay="Barangay Commonwealth",
    query_street_address="10 Batangas St",
    query_landmark=None,
    query_establishment_name=None,
    query_fire_station_name=None,
)


@pytest.mark.unit
def test_score_returns_none_when_anchor_fails():
    """No coords, no address match: anchor fails → None."""
    score = _score_candidate(
        800.0,  # far away
        _BASE_DT,
        "STRUCTURAL",
        "APT",
        None,
        "Different Barangay",
        "Other St",
        None,
        None,
        None,
        **_SCORE_BASE,
    )
    assert score is None


@pytest.mark.unit
def test_score_returns_none_for_incompatible_category():
    """Close coords but incompatible category blocks the candidate."""
    score = _score_candidate(
        50.0,
        _BASE_DT,
        "WILDLAND",
        "APT",
        None,
        "Barangay Commonwealth",
        "10 Batangas St",
        None,
        None,
        None,
        **_SCORE_BASE,
    )
    assert score is None


@pytest.mark.unit
def test_score_location_tiers():
    """Location score: ≤100m=3, ≤250m=2, ≤500m=1.

    Uses a candidate with a *different* barangay/street from the query so that
    only coordinate distance contributes to the score.  Beyond 250 m there is no
    address anchor and no coord anchor, so _score_candidate returns None (anchor
    gate blocks the candidate).  The 251–500 m tier is covered separately with an
    address anchor in test_score_weak_coords_with_address_anchor.
    """
    # Candidate has different address — only coord distance scores
    base_cand = dict(
        cand_notification_dt=None,
        cand_general_category=None,
        cand_incident_type_code=None,
        cand_barangay_id=None,
        cand_barangay="Different Barangay",
        cand_street_address="Different Street",
        cand_landmark=None,
        cand_establishment_name=None,
        cand_fire_station_name=None,
    )
    base_q = dict(
        query_notification_dt=None,
        query_general_category=None,
        query_incident_type_code=None,
        query_barangay_id=None,
        query_barangay="Barangay Commonwealth",
        query_street_address="10 Batangas St",
        query_landmark=None,
        query_establishment_name=None,
        query_fire_station_name=None,
    )

    def score_at(d):
        return _score_candidate(d, **base_cand, **base_q)

    # ≤ 100 m: anchor passes (coord ≤ 250m), location score = 3, address = 0
    assert score_at(80.0) == 3
    assert score_at(100.0) == 3
    # 101–250 m: anchor passes, location score = 2
    assert score_at(101.0) == 2
    assert score_at(250.0) == 2
    # > 250 m, no address anchor → anchor gate blocks → None
    assert score_at(251.0) is None
    assert score_at(500.0) is None
    assert score_at(501.0) is None


@pytest.mark.unit
def test_score_weak_coords_with_address_anchor():
    """Distance 251–500 m scores 1 point when address anchor provides entry."""
    # Matching address provides anchor; distance is in the weak (251–500 m) tier
    addr_cand = dict(
        cand_notification_dt=None,
        cand_general_category=None,
        cand_incident_type_code=None,
        cand_barangay_id=None,
        cand_barangay="Barangay Commonwealth",
        cand_street_address="10 Batangas St",
        cand_landmark=None,
        cand_establishment_name=None,
        cand_fire_station_name=None,
    )
    addr_q = dict(
        query_notification_dt=None,
        query_general_category=None,
        query_incident_type_code=None,
        query_barangay_id=None,
        query_barangay="Barangay Commonwealth",
        query_street_address="10 Batangas St",
        query_landmark=None,
        query_establishment_name=None,
        query_fire_station_name=None,
    )

    def score_at(d):
        return _score_candidate(d, **addr_cand, **addr_q)

    # 300 m: location=1 + address=2 (barangay+street) = 3
    assert score_at(300.0) == 3
    # 500 m: same
    assert score_at(500.0) == 3
    # > 500 m: location score drops to 0; address still = 2
    assert score_at(501.0) == 2


@pytest.mark.unit
def test_score_full_match_is_likely():
    """≤100m + same cat+type + ≤30min + same address should exceed SCORE_LIKELY."""
    score = _score_candidate(
        80.0,
        _BASE_DT,
        "STRUCTURAL",
        "APT",
        None,
        "Barangay Commonwealth",
        "10 Batangas St",
        None,
        None,
        None,
        **_SCORE_BASE,
    )
    assert score is not None
    assert score >= SCORE_LIKELY  # 3(loc) + 3(cat) + 2(time) + 2(addr) = 10


@pytest.mark.unit
def test_score_close_coords_no_other_support_below_possible():
    """≤250m coords alone should not reach SCORE_POSSIBLE threshold."""
    score = _score_candidate(
        200.0,
        None,  # no time
        None,  # no category
        None,
        None,
        "Different Barangay",
        "Other St",
        None,
        None,
        None,
        query_notification_dt=None,
        query_general_category=None,
        query_incident_type_code=None,
        query_barangay_id=None,
        query_barangay="Barangay Commonwealth",
        query_street_address="10 Batangas St",
        query_landmark=None,
        query_establishment_name=None,
        query_fire_station_name=None,
    )
    # Anchor passes (200m ≤ 250m), but score = 2 (location only) < SCORE_POSSIBLE (4)
    assert score is not None
    assert score < SCORE_POSSIBLE


@pytest.mark.unit
def test_score_establishment_adds_point():
    """Same establishment_name pushes an otherwise borderline score up by 1."""
    base_q = dict(
        query_notification_dt=_BASE_DT,
        query_general_category="STRUCTURAL",
        query_incident_type_code="APT",
        query_barangay_id=None,
        query_barangay="Barangay Commonwealth",
        query_street_address="10 Batangas St",
        query_landmark=None,
        query_establishment_name="Commonwealth Apts",
        query_fire_station_name=None,
    )
    without_estab = _score_candidate(
        80.0,
        _BASE_DT,
        "STRUCTURAL",
        "APT",
        None,
        "Barangay Commonwealth",
        "10 Batangas St",
        None,
        None,
        None,
        **base_q,
    )
    with_estab = _score_candidate(
        80.0,
        _BASE_DT,
        "STRUCTURAL",
        "APT",
        None,
        "Barangay Commonwealth",
        "10 Batangas St",
        None,
        "Commonwealth Apts",
        None,
        **base_q,
    )
    assert with_estab is not None
    assert without_estab is not None
    assert with_estab == without_estab + 1


# ---------------------------------------------------------------------------
# Layer 1e — 8 behavioural test cases from design spec
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_no_dup_same_day_category_different_location():
    """Test 1: Same region + day + category, different address/location → NOT dup."""
    score = _score_candidate(
        900.0,  # far away — no coord anchor
        _BASE_DT,
        "STRUCTURAL",
        "APT",
        None,
        "Completely Different Barangay",
        "Different Street",
        None,
        None,
        None,
        query_notification_dt=_BASE_DT,
        query_general_category="STRUCTURAL",
        query_incident_type_code="APT",
        query_barangay_id=None,
        query_barangay="Barangay Commonwealth",
        query_street_address="10 Batangas St",
        query_landmark=None,
        query_establishment_name=None,
        query_fire_station_name=None,
    )
    assert score is None  # anchor failed


@pytest.mark.unit
def test_no_dup_near_time_different_address():
    """Test 2: Same region + day + near time, completely different address → NOT dup."""
    close_dt = datetime(2026, 5, 9, 14, 45, tzinfo=timezone.utc)  # 15 min later
    score = _score_candidate(
        1200.0,
        close_dt,
        "STRUCTURAL",
        "APT",
        None,
        "Far Away Barangay",
        "Other St 99",
        None,
        None,
        None,
        query_notification_dt=_BASE_DT,
        query_general_category="STRUCTURAL",
        query_incident_type_code="APT",
        query_barangay_id=None,
        query_barangay="Barangay Commonwealth",
        query_street_address="10 Batangas St",
        query_landmark=None,
        query_establishment_name=None,
        query_fire_station_name=None,
    )
    assert score is None  # no anchor (>250m, different address)


@pytest.mark.unit
def test_no_dup_nearby_coords_only():
    """Test 3: Nearby coords (≤250m) without any other supporting evidence → NOT dup."""
    score = _score_candidate(
        200.0,
        None,  # no fire time
        None,  # no category
        None,
        None,
        "Different Barangay",  # different address
        "Different Street",
        None,
        None,
        None,
        query_notification_dt=None,
        query_general_category=None,
        query_incident_type_code=None,
        query_barangay_id=None,
        query_barangay="Barangay Commonwealth",
        query_street_address="10 Batangas St",
        query_landmark=None,
        query_establishment_name=None,
        query_fire_station_name=None,
    )
    # Anchor passes (200m ≤ 250m), but score = 2 < SCORE_POSSIBLE (4)
    assert score is not None
    assert score < SCORE_POSSIBLE


@pytest.mark.unit
def test_dup_very_close_type_time_address():
    """Test 4: ≤100m + same type + ≤30min + matching address → LIKELY duplicate."""
    score = _score_candidate(
        80.0,
        _BASE_DT,
        "STRUCTURAL",
        "APT",
        None,
        "Barangay Commonwealth",
        "10 Batangas St",
        None,
        None,
        None,
        **_SCORE_BASE,
    )
    # 3 (dist) + 3 (cat+type) + 2 (time ≤30min) + 2 (barangay+street) = 10
    assert score is not None
    assert score >= SCORE_LIKELY


@pytest.mark.unit
def test_no_dup_weak_coords_without_address_anchor():
    """Test 5: 300m coords alone fail anchor gate (> ANCHOR_DISTANCE_M)."""
    score = _score_candidate(
        300.0,
        _BASE_DT,
        "STRUCTURAL",
        "APT",
        None,
        "Different Barangay",
        "Other St",
        None,
        None,
        None,
        **_SCORE_BASE,
    )
    assert score is None  # 300m > 250m anchor threshold, no address/estab match


@pytest.mark.unit
def test_weak_coords_with_address_anchor_can_reach_possible():
    """Test 5b: 300m + address anchor + matching category → POSSIBLE."""
    score = _score_candidate(
        300.0,
        _BASE_DT,
        "STRUCTURAL",
        "APT",
        None,
        "Barangay Commonwealth",  # barangay matches
        "10 Batangas St",  # street matches → address anchor
        None,
        None,
        None,
        **_SCORE_BASE,
    )
    # 1 (dist ≤500m) + 3 (cat+type) + 2 (time) + 2 (addr) = 8 → LIKELY
    assert score is not None
    assert score >= SCORE_POSSIBLE


@pytest.mark.unit
def test_no_dup_establishment_without_compatible_location():
    """Test 6 / anchor 3: Same establishment but no coords and no barangay → anchor fails."""
    score = _score_candidate(
        None,  # no coordinates
        _BASE_DT,
        "STRUCTURAL",
        "APT",
        None,
        None,  # no barangay on candidate
        None,
        None,
        "Commonwealth Apts",
        None,
        query_notification_dt=_BASE_DT,
        query_general_category="STRUCTURAL",
        query_incident_type_code="APT",
        query_barangay_id=None,
        query_barangay=None,
        query_street_address=None,
        query_landmark=None,
        query_establishment_name="Commonwealth Apts",
        query_fire_station_name=None,
    )
    assert score is None  # establishment alone, no location compatibility


@pytest.mark.unit
def test_establishment_increases_confidence():
    """Test 7: Same establishment + barangay match pushes score above POSSIBLE."""
    score = _score_candidate(
        300.0,  # >250m — too far for coord anchor
        _BASE_DT,
        "STRUCTURAL",
        "APT",
        None,
        "Barangay Commonwealth",
        "10 Batangas St",
        None,
        "Commonwealth Apts",
        None,
        query_notification_dt=_BASE_DT,
        query_general_category="STRUCTURAL",
        query_incident_type_code="APT",
        query_barangay_id=None,
        query_barangay="Barangay Commonwealth",
        query_street_address="10 Batangas St",
        query_landmark=None,
        query_establishment_name="Commonwealth Apts",
        query_fire_station_name=None,
    )
    # Address anchor (barangay+street); score = 1 + 3 + 2 + 2 + 1(estab) = 9 → LIKELY
    assert score is not None
    assert score >= SCORE_POSSIBLE


@pytest.mark.unit
def test_no_dup_same_barangay_different_street():
    """Test 8: Same barangay + different street → anchor fails (no coord proximity either)."""
    score = _score_candidate(
        400.0,  # > ANCHOR_DISTANCE_M
        _BASE_DT,
        "STRUCTURAL",
        "APT",
        None,
        "Barangay Commonwealth",
        "99 Different St",  # different street
        None,
        None,
        None,
        query_notification_dt=_BASE_DT,
        query_general_category="STRUCTURAL",
        query_incident_type_code="APT",
        query_barangay_id=None,
        query_barangay="Barangay Commonwealth",
        query_street_address="10 Batangas St",
        query_landmark=None,
        query_establishment_name=None,
        query_fire_station_name=None,
    )
    assert score is None  # barangay match only, no street match → anchor fails


# ---------------------------------------------------------------------------
# Layer 2 — check_for_duplicate return type
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_returns_none_when_no_candidates():
    db = _make_db(rows=[])
    result = check_for_duplicate(
        db, incident_id=1, region_id=1, incident_date="2026-05-01", lat=14.5, lon=121.0
    )
    assert result is None


@pytest.mark.unit
def test_returns_tuple_with_confidence_when_match():
    """When a row passes the anchor+scoring, returns (matched_id, confidence)."""
    dt = datetime(2026, 5, 1, 14, 0, tzinfo=timezone.utc)
    row = _cand(
        incident_id=42,
        distance_m=80.0,
        notification_dt=dt,
        general_category="STRUCTURAL",
        incident_type_code="APT",
        barangay="Barangay Commonwealth",
        street_address="10 Batangas St",
    )
    db = _make_db(rows=[row])
    result = check_for_duplicate(
        db,
        incident_id=1,
        region_id=1,
        incident_date="2026-05-01",
        notification_dt=dt,
        lat=14.5,
        lon=121.0,
        general_category="STRUCTURAL",
        incident_type_code="APT",
        barangay="Barangay Commonwealth",
        street_address="10 Batangas St",
    )
    assert result is not None
    matched_id, confidence = result
    assert matched_id == 42
    assert confidence in ("LIKELY", "POSSIBLE")


@pytest.mark.unit
def test_returns_likely_on_high_score():
    """Score ≥ SCORE_LIKELY yields 'LIKELY' confidence."""
    dt = datetime(2026, 5, 1, 14, 0, tzinfo=timezone.utc)
    row = _cand(
        incident_id=42,
        distance_m=50.0,
        notification_dt=dt,
        general_category="STRUCTURAL",
        incident_type_code="APT",
        barangay="Barangay Commonwealth",
        street_address="10 Batangas St",
    )
    db = _make_db(rows=[row])
    result = check_for_duplicate(
        db,
        incident_id=1,
        region_id=1,
        incident_date="2026-05-01",
        notification_dt=dt,
        lat=14.5,
        lon=121.0,
        general_category="STRUCTURAL",
        incident_type_code="APT",
        barangay="Barangay Commonwealth",
        street_address="10 Batangas St",
    )
    assert result is not None
    assert result[1] == "LIKELY"


@pytest.mark.unit
def test_returns_possible_on_borderline_score():
    """Score in [SCORE_POSSIBLE, SCORE_LIKELY) yields 'POSSIBLE'."""
    dt = datetime(2026, 5, 1, 14, 0, tzinfo=timezone.utc)
    far_dt = datetime(2026, 5, 1, 17, 0, tzinfo=timezone.utc)  # 3 hrs later → time score 0
    row = _cand(
        incident_id=42,
        distance_m=200.0,  # ≤250m = 2 pts
        notification_dt=far_dt,
        general_category="STRUCTURAL",
        incident_type_code="APT",
        barangay="Barangay Commonwealth",
        street_address=None,  # no street → barangay only (1 pt)
        landmark=None,
    )
    db = _make_db(rows=[row])
    result = check_for_duplicate(
        db,
        incident_id=1,
        region_id=1,
        incident_date="2026-05-01",
        notification_dt=dt,
        lat=14.5,
        lon=121.0,
        general_category="STRUCTURAL",
        incident_type_code="APT",
        barangay="Barangay Commonwealth",
        street_address=None,
    )
    # Score = 2(loc) + 3(cat) + 0(time >2hr) + 1(barangay) = 6 → POSSIBLE (< LIKELY=7)
    assert result is not None
    assert result[1] == "POSSIBLE"


@pytest.mark.unit
def test_picks_highest_scoring_candidate():
    """Returns the candidate with the higher score when multiple qualify."""
    dt = datetime(2026, 5, 1, 14, 0, tzinfo=timezone.utc)
    weak = _cand(
        incident_id=10,
        distance_m=200.0,  # 2 pts
        notification_dt=datetime(2026, 5, 1, 17, 0, tzinfo=timezone.utc),
        general_category="STRUCTURAL",
        incident_type_code="APT",
        barangay="Barangay Commonwealth",
        street_address=None,
    )
    strong = _cand(
        incident_id=20,
        distance_m=50.0,  # 3 pts
        notification_dt=dt,
        general_category="STRUCTURAL",
        incident_type_code="APT",
        barangay="Barangay Commonwealth",
        street_address="10 Batangas St",
    )
    db = _make_db(rows=[weak, strong])
    result = check_for_duplicate(
        db,
        incident_id=1,
        region_id=1,
        incident_date="2026-05-01",
        notification_dt=dt,
        lat=14.5,
        lon=121.0,
        general_category="STRUCTURAL",
        incident_type_code="APT",
        barangay="Barangay Commonwealth",
        street_address="10 Batangas St",
    )
    assert result is not None
    assert result[0] == 20  # strong candidate wins


# ---------------------------------------------------------------------------
# Layer 2 — effective_date derivation
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_effective_date_derived_from_notification_dt_when_incident_date_none():
    db = _make_db()
    notif = datetime(2026, 5, 9, 14, 30, tzinfo=timezone.utc)
    check_for_duplicate(
        db,
        incident_id=1,
        region_id=1,
        incident_date=None,
        notification_dt=notif,
        lat=14.5,
        lon=121.0,
    )
    assert _get_params(db)["fire_date"] == "2026-05-09"


@pytest.mark.unit
def test_explicit_incident_date_takes_precedence_over_notification_dt():
    db = _make_db()
    notif = datetime(2026, 5, 9, 14, 30, tzinfo=timezone.utc)
    check_for_duplicate(
        db,
        incident_id=1,
        region_id=1,
        incident_date="2026-05-15",
        notification_dt=notif,
        lat=14.5,
        lon=121.0,
    )
    assert _get_params(db)["fire_date"] == "2026-05-15"


# ---------------------------------------------------------------------------
# Layer 2 — SQL parameter construction
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_region_id_and_cur_id_always_in_params():
    db = _make_db()
    check_for_duplicate(
        db,
        incident_id=77,
        region_id=5,
        incident_date="2026-05-09",
        lat=14.5,
        lon=121.0,
    )
    params = _get_params(db)
    assert params["rid"] == 5
    assert params["cur_id"] == 77


@pytest.mark.unit
def test_null_lat_lon_passes_none_to_params():
    db = _make_db()
    check_for_duplicate(
        db,
        incident_id=1,
        region_id=1,
        incident_date="2026-05-09",
        lat=None,
        lon=None,
    )
    params = _get_params(db)
    assert params["lat"] is None
    assert params["lon"] is None


@pytest.mark.unit
def test_notif_dt_serialized_to_isoformat():
    db = _make_db()
    notif = datetime(2026, 5, 9, 14, 30, 0, tzinfo=timezone.utc)
    check_for_duplicate(
        db,
        incident_id=1,
        region_id=1,
        incident_date="2026-05-09",
        notification_dt=notif,
        lat=14.5,
        lon=121.0,
    )
    assert _get_params(db)["notif_dt"] == notif.isoformat()


@pytest.mark.unit
def test_null_notification_dt_passes_none_notif_dt_param():
    db = _make_db()
    check_for_duplicate(
        db,
        incident_id=1,
        region_id=1,
        incident_date="2026-05-09",
        notification_dt=None,
        lat=14.5,
        lon=121.0,
    )
    assert _get_params(db)["notif_dt"] is None


# ---------------------------------------------------------------------------
# Layer 2 — extra_where clause construction
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_exclude_statuses_adds_skip_statuses_param():
    db = _make_db()
    check_for_duplicate(
        db,
        incident_id=1,
        region_id=1,
        incident_date="2026-05-09",
        lat=14.5,
        lon=121.0,
        exclude_statuses=("DRAFT", "REJECTED"),
    )
    assert set(_get_params(db)["skip_statuses"]) == {"DRAFT", "REJECTED"}


@pytest.mark.unit
def test_no_exclude_statuses_does_not_add_skip_statuses_param():
    db = _make_db()
    check_for_duplicate(
        db,
        incident_id=1,
        region_id=1,
        incident_date="2026-05-09",
        lat=14.5,
        lon=121.0,
        exclude_statuses=(),
    )
    assert "skip_statuses" not in _get_params(db)


@pytest.mark.unit
def test_verified_window_seconds_adds_window_param():
    db = _make_db()
    check_for_duplicate(
        db,
        incident_id=1,
        region_id=1,
        incident_date="2026-05-09",
        lat=14.5,
        lon=121.0,
        verified_window_seconds=60,
    )
    assert _get_params(db)["window_seconds"] == 60


@pytest.mark.unit
def test_no_verified_window_does_not_add_window_param():
    db = _make_db()
    check_for_duplicate(
        db,
        incident_id=1,
        region_id=1,
        incident_date="2026-05-09",
        lat=14.5,
        lon=121.0,
        verified_window_seconds=None,
    )
    assert "window_seconds" not in _get_params(db)


@pytest.mark.unit
def test_combined_exclude_statuses_and_window():
    db = _make_db()
    check_for_duplicate(
        db,
        incident_id=1,
        region_id=1,
        incident_date="2026-05-09",
        lat=14.5,
        lon=121.0,
        exclude_statuses=("DRAFT", "REJECTED", "REPLACED"),
        verified_window_seconds=60,
    )
    params = _get_params(db)
    assert "skip_statuses" in params
    assert params["window_seconds"] == 60
