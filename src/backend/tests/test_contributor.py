"""Unit tests for the Civilian Contributor trust score engine.

Covers:
- badge_for_score boundary values
- compute_trust_score with mocked DB queries
- get_contributor_profile response structure
- get_contributor_reports pagination logic
- get_leaderboard response structure

Run:
  cd src/backend && pytest tests/test_contributor.py -v
"""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest

from services.contributor import (
    badge_for_score,
    compute_trust_score,
    get_contributor_profile,
    get_contributor_reports,
    get_leaderboard,
)


# ═══════════════════════════════════════════════════════════════════════════════
# badge_for_score — boundary tests
# ═══════════════════════════════════════════════════════════════════════════════


class TestBadgeForScore:
    """Verify every boundary (inclusive lower) across all four tiers."""

    @pytest.mark.parametrize(
        "score,expected",
        [
            (0, "NOVICE"),
            (1, "NOVICE"),
            (19, "NOVICE"),
            (20, "REGULAR"),
            (21, "REGULAR"),
            (49, "REGULAR"),
            (50, "TRUSTED"),
            (51, "TRUSTED"),
            (79, "TRUSTED"),
            (80, "GUARDIAN"),
            (81, "GUARDIAN"),
            (100, "GUARDIAN"),
        ],
    )
    def test_boundary(self, score: int, expected: str) -> None:
        assert badge_for_score(score) == expected, f"badge_for_score({score}) should be {expected}"

    @pytest.mark.parametrize("score", [-1, -100])
    def test_negative_clamps_to_novice(self, score: int) -> None:
        """Negative scores (floor enforced by compute_trust_score) return NOVICE."""
        assert badge_for_score(score) == "NOVICE"

    @pytest.mark.parametrize("score", [101, 200])
    def test_above_maximum_returns_guardian(self, score: int) -> None:
        """Scores above 100 (ceil enforced by compute_trust_score) return GUARDIAN."""
        assert badge_for_score(score) == "GUARDIAN"


# ═══════════════════════════════════════════════════════════════════════════════
# compute_trust_score — mocked DB
# ═══════════════════════════════════════════════════════════════════════════════


class FakeRow:
    """Minimal row-like object that supports attribute access and iteration."""

    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)


def _make_mock_db(
    stats_row: FakeRow | None,
    report_ids: list[int] | None = None,
    photo_bonus_values: list[int] | None = None,
    *,
    profile_mode: bool = False,
) -> MagicMock:
    """Build a mock DB session that returns canned data for contributor queries.

    Uses a call counter to dispatch successive ``db.execute()`` calls to the
    correct return value.

    When ``profile_mode=True`` the mock includes TWO stats rows because
    ``get_contributor_profile`` runs its own stats query and then calls
    ``compute_trust_score`` which also runs a stats query.

    Call order expected by ``compute_trust_score``:
        1. Lifetime stats query (``fetchone()``)
        2. Report ID list query (``fetchall()``)
        3..N  Photo bonus scalar query per report (``scalar()``)
    """
    db = MagicMock()
    call_index = [0]  # mutable counter for side effect closure

    def _make_stats_mock():
        m = MagicMock()
        m.fetchone.return_value = stats_row
        m.scalar.return_value = 0 if stats_row is None else int(stats_row.total_reports)
        return m

    return_values: list = []

    if profile_mode:
        # First query in get_contributor_profile, then again in
        # compute_trust_score which it calls internally.
        return_values.append(_make_stats_mock())

    # Lifetime stats query
    return_values.append(_make_stats_mock())

    if report_ids is not None:
        # Report ID list query
        report_mock = MagicMock()
        report_mock.fetchall.return_value = [FakeRow(report_id=rid) for rid in report_ids]
        return_values.append(report_mock)

        # Per-report photo bonus queries
        if photo_bonus_values is None:
            photo_bonus_values = [0] * len(report_ids)
        for bonus_val in photo_bonus_values:
            photo_mock = MagicMock()
            photo_mock.scalar.return_value = bonus_val
            return_values.append(photo_mock)

    def execute_side_effect(*args, **kwargs):
        idx = call_index[0]
        if idx < len(return_values):
            call_index[0] += 1
            return return_values[idx]
        return MagicMock()

    db.execute.side_effect = execute_side_effect
    return db


class TestComputeTrustScore:
    """Trust score computation with mocked database."""

    def test_zero_reports_returns_zero(self) -> None:
        """A contributor with no reports should score 0."""
        db = _make_mock_db(
            stats_row=FakeRow(
                total_reports=0,
                actioned_reports=0,
                pending_reports=0,
                last_report_at=None,
                first_report_at=None,
            ),
            report_ids=[],
        )
        score = compute_trust_score("user-1", db)
        assert score == 0

    def test_volume_only_no_actions(self) -> None:
        """5 reports, none ACTIONED → volume 10, no accuracy, no decay."""
        now = datetime.now(timezone.utc)
        db = _make_mock_db(
            stats_row=FakeRow(
                total_reports=5,
                actioned_reports=0,
                pending_reports=5,
                last_report_at=now,
                first_report_at=now,
            ),
            report_ids=[1, 2, 3, 4, 5],
            photo_bonus_values=[0, 0, 0, 0, 0],
        )
        score = compute_trust_score("user-1", db)
        # volume_credit = min(40, 5*2) = 10
        assert score == 10

    def test_volume_cap_at_20_reports(self) -> None:
        """25 reports → volume capped at 40 (20*2)."""
        now = datetime.now(timezone.utc)
        db = _make_mock_db(
            stats_row=FakeRow(
                total_reports=25,
                actioned_reports=0,
                pending_reports=25,
                last_report_at=now,
                first_report_at=now,
            ),
            report_ids=list(range(1, 26)),
            photo_bonus_values=[0] * 25,
        )
        score = compute_trust_score("user-1", db)
        # volume_credit = min(40, 25*2) = 40
        assert score == 40

    def test_accuracy_bonus(self) -> None:
        """10 reports, 3 ACTIONED → volume 20 + accuracy 15 = 35."""
        now = datetime.now(timezone.utc)
        db = _make_mock_db(
            stats_row=FakeRow(
                total_reports=10,
                actioned_reports=3,
                pending_reports=7,
                last_report_at=now,
                first_report_at=now,
            ),
            report_ids=list(range(1, 11)),
            photo_bonus_values=[0] * 10,
        )
        score = compute_trust_score("user-1", db)
        # volume_credit = min(40, 10*2) = 20
        # accuracy_bonus = 3 * 5 = 15
        # total = 35
        assert score == 35

    def test_photo_bonus(self) -> None:
        """2 reports, each with 1 photo bonus of 2 → volume 4 + photo 4 = 8."""
        now = datetime.now(timezone.utc)
        db = _make_mock_db(
            stats_row=FakeRow(
                total_reports=2,
                actioned_reports=0,
                pending_reports=2,
                last_report_at=now,
                first_report_at=now,
            ),
            report_ids=[1, 2],
            photo_bonus_values=[2, 2],  # each returns 2 (e.g., 1 agreed photo * 2)
        )
        score = compute_trust_score("user-1", db)
        # volume_credit = min(40, 2*2) = 4
        # photo_bonus = 2 + 2 = 4
        # total = 8
        assert score == 8

    def test_decay(self) -> None:
        """12 months inactive → decay = 24, floor at 0."""
        old_date = datetime(2025, 1, 1, tzinfo=timezone.utc)
        db = _make_mock_db(
            stats_row=FakeRow(
                total_reports=2,
                actioned_reports=1,
                pending_reports=1,
                last_report_at=old_date,
                first_report_at=old_date,
            ),
            report_ids=[1, 2],
            photo_bonus_values=[0, 0],
        )
        score = compute_trust_score("user-1", db)
        # volume_credit = min(40, 2*2) = 4
        # accuracy_bonus = 1 * 5 = 5
        # photo_bonus = 0
        # decay: ~18 months from Jan 2025 to Jul 2026 => 18 months * 2 = 36
        # score = 4 + 5 + 0 - 36 = -27 → floor 0
        assert score == 0

    def test_full_guardian_score(self) -> None:
        """20+ reports, 12 ACTIONED, photo bonus, no decay → ceil 100."""
        now = datetime.now(timezone.utc)
        db = _make_mock_db(
            stats_row=FakeRow(
                total_reports=20,
                actioned_reports=12,
                pending_reports=8,
                last_report_at=now,
                first_report_at=now,
            ),
            report_ids=list(range(1, 21)),
            photo_bonus_values=[2] * 20,  # 2 bonus per report
        )
        score = compute_trust_score("user-1", db)
        # volume_credit = min(40, 20*2) = 40
        # accuracy_bonus = 12 * 5 = 60
        # photo_bonus = 20 * 2 = 40
        # total = 140 → ceil 100
        assert score == 100


# ═══════════════════════════════════════════════════════════════════════════════
# get_contributor_profile — structure
# ═══════════════════════════════════════════════════════════════════════════════


class TestGetContributorProfile:
    """Profile response structure and edge cases."""

    def test_zero_reports_structure(self) -> None:
        db = _make_mock_db(
            stats_row=FakeRow(
                total_reports=0,
                actioned_reports=0,
                pending_reports=0,
                last_report_at=None,
                first_report_at=None,
            ),
            report_ids=[],
            profile_mode=True,
        )
        profile = get_contributor_profile("user-empty", db)
        assert isinstance(profile, dict)
        assert profile["trust_score"] == 0
        assert profile["badge"] == "NOVICE"
        assert profile["total_reports"] == 0
        assert profile["actioned_reports"] == 0
        assert profile["pending_reports"] == 0
        assert profile["first_report_at"] is None
        assert profile["last_report_at"] is None

    def test_has_reports_structure(self) -> None:
        now = datetime.now(timezone.utc)
        db = _make_mock_db(
            stats_row=FakeRow(
                total_reports=5,
                actioned_reports=2,
                pending_reports=3,
                last_report_at=now,
                first_report_at=now,
            ),
            report_ids=[1, 2, 3, 4, 5],
            photo_bonus_values=[0] * 5,
            profile_mode=True,
        )
        profile = get_contributor_profile("user-active", db)
        assert isinstance(profile, dict)
        assert "trust_score" in profile
        assert "badge" in profile
        assert "total_reports" in profile
        assert "actioned_reports" in profile
        assert "pending_reports" in profile
        assert "first_report_at" in profile
        assert "last_report_at" in profile
        # 5 reports * 2 = volume_credit 10
        assert profile["total_reports"] == 5
        assert profile["actioned_reports"] == 2
        assert profile["pending_reports"] == 3


# ═══════════════════════════════════════════════════════════════════════════════
# get_leaderboard — structure
# ═══════════════════════════════════════════════════════════════════════════════


class TestGetLeaderboard:
    """Leaderboard response structure."""

    def test_empty_leaderboard(self) -> None:
        db = MagicMock()
        db.execute.return_value.fetchall.return_value = []

        entries = get_leaderboard(limit=10, db=db)
        assert isinstance(entries, list)
        assert len(entries) == 0

    def test_has_entries_structure(self) -> None:
        db = MagicMock()
        row1 = FakeRow(
            user_id="u1",
            display_name="Alice",
            trust_score=85,
            badge="GUARDIAN",
            report_count=20,
        )
        row2 = FakeRow(
            user_id="u2",
            display_name="Bob",
            trust_score=45,
            badge="REGULAR",
            report_count=8,
        )
        db.execute.return_value.fetchall.return_value = [row1, row2]

        entries = get_leaderboard(limit=10, db=db)
        assert len(entries) == 2
        assert entries[0]["rank"] == 1
        assert entries[0]["user_id"] == "u1"
        assert entries[0]["display_name"] == "Alice"
        assert entries[0]["trust_score"] == 85
        assert entries[0]["badge"] == "GUARDIAN"
        assert entries[0]["report_count"] == 20

        assert entries[1]["rank"] == 2
        assert entries[1]["user_id"] == "u2"
        assert entries[1]["display_name"] == "Bob"


# ═══════════════════════════════════════════════════════════════════════════════
# get_contributor_reports — pagination
# ═══════════════════════════════════════════════════════════════════════════════


class TestGetContributorReports:
    """Pagination and response structure."""

    def test_empty_reports(self) -> None:
        db = MagicMock()
        db.execute.return_value.scalar.return_value = 0
        db.execute.return_value.fetchall.return_value = []

        result = get_contributor_reports("user-empty", page=1, limit=20, db=db)
        assert result["total"] == 0
        assert result["reports"] == []
        assert result["page"] == 1
        assert result["pages"] == 1
