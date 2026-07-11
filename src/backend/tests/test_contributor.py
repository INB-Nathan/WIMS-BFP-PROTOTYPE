"""Table-driven tests for the normalized contributor reliability model."""

from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest

from services.contributor import (
    FORMULA_VERSION,
    _score,
    badge_for_score,
    compute_trust_score,
    get_contributor_profile,
)


class FakeRow:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


def _row(roots=0, decided=0, actioned=0, pending=0, evidence=0, active=0, last=None):
    return FakeRow(
        root_reports=roots,
        decided=decided,
        actioned=actioned,
        pending=pending,
        evidence_total=evidence,
        active_months=active,
        first_report_at=None,
        last_report_at=last,
    )


def _db(row):
    db = MagicMock()
    result = MagicMock()
    result.fetchone.return_value = row
    db.execute.return_value = result
    return db


class TestBadgeForScore:
    @pytest.mark.parametrize(
        "score, expected",
        [
            (0, "NOVICE"),
            (19, "NOVICE"),
            (20, "REGULAR"),
            (49, "REGULAR"),
            (50, "TRUSTED"),
            (79, "TRUSTED"),
            (80, "GUARDIAN"),
            (100, "GUARDIAN"),
        ],
    )
    def test_boundaries(self, score, expected):
        assert badge_for_score(score) == expected


class TestNormalizedReliability:
    @pytest.mark.parametrize(
        "name, row, expected",
        [
            ("zero decided reports", _row(), 0),
            ("one pending report", _row(1, pending=1, active=1), 7),
            ("ten decided mixed outcomes", _row(10, 10, 6, active=6), 58),
            # Appended/linked reports are excluded by the aggregation; only roots count.
            ("root versus append", _row(2, 2, 1, pending=1, active=1), 14),
            ("active month pattern", _row(6, active=3), 20),
            ("evidence photo weight", _row(1, evidence=0.25, active=1), 12),
            ("evidence GPS weight", _row(1, evidence=0.35, active=1), 14),
            ("evidence distance weight", _row(1, evidence=0.20, active=1), 11),
            ("all evidence weights", _row(1, evidence=0.80, active=1), 23),
            ("clamp at zero", _row(1, evidence=0, active=1, last=datetime(2020, 1, 1)), 0),
            ("clamp at one hundred", _row(100, 100, 100, active=6, evidence=100), 100),
        ],
    )
    def test_score_cases(self, name, row, expected):
        assert compute_trust_score("user-1", _db(row)) == expected, name

    def test_decay(self):
        # Twelve calendar months ago is at least the capped 20-point decay.
        now = datetime.now(timezone.utc)
        old = now.replace(year=now.year - 1).replace(tzinfo=None)
        baseline = _score(_row(10, 10, 6, active=6))
        assert (
            compute_trust_score("user-1", _db(_row(10, 10, 6, active=6, last=old))) == baseline - 20
        )

    def test_profile_contract_includes_formula_version(self):
        row = _row(1, pending=1, active=1)
        profile = get_contributor_profile("user-1", _db(row))
        assert profile["trust_score"] == 7
        assert profile["total_reports"] == 1
        assert profile["pending_reports"] == 1
        assert profile["formula_version"] == FORMULA_VERSION
