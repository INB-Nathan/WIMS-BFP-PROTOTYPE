"""Table-driven tests for the normalized contributor reliability model."""

import math
from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest

from services.contributor import (
    ACTIONED_CITIZEN_REPORT_STATUSES,
    CITIZEN_REPORT_STATUS_OUTCOMES,
    DECIDED_CITIZEN_REPORT_STATUSES,
    LIVE_CITIZEN_REPORT_STATUSES,
    PENDING_CITIZEN_REPORT_STATUSES,
    TRUST_SCORE_FORMULA_VERSION,
    _normalized_breakdown,
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


class TestContributorStatusMappings:
    def test_live_status_mapping_matches_root_report_constraint(self):
        expected = {
            "PENDING": "pending",
            "UNDER_REVIEW": "pending",
            "LINKED": "pending",
            "ACTIONED": "actioned",
            "REJECTED_BOGUS": "rejected",
            "REJECTED_DUPLICATE": "rejected",
            "REJECTED_INSUFFICIENT": "rejected",
            "REJECTED_TIMEOUT": "rejected",
        }
        assert LIVE_CITIZEN_REPORT_STATUSES == tuple(expected)
        assert CITIZEN_REPORT_STATUS_OUTCOMES == expected
        assert PENDING_CITIZEN_REPORT_STATUSES == ("PENDING", "UNDER_REVIEW", "LINKED")
        assert ACTIONED_CITIZEN_REPORT_STATUSES == ("ACTIONED",)
        assert DECIDED_CITIZEN_REPORT_STATUSES == (
            "ACTIONED",
            "REJECTED_BOGUS",
            "REJECTED_DUPLICATE",
            "REJECTED_INSUFFICIENT",
            "REJECTED_TIMEOUT",
        )


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

    def test_profile_contract_includes_breakdown_and_formula_version(self):
        row = _row(1, pending=1, evidence=0.25, active=1)
        profile = get_contributor_profile("user-1", _db(row))
        assert profile["trust_score"] == 12
        assert profile["total_reports"] == 1
        assert profile["pending_reports"] == 1
        assert profile["formula_version"] == TRUST_SCORE_FORMULA_VERSION
        assert profile["decided_reports"] == 0
        assert profile["active_months"] == 1
        assert profile["decay"] == 0
        assert profile["volume_progress"] == pytest.approx(math.log1p(1) / math.log(21))
        assert profile["outcome_accuracy"] == 0.0
        assert profile["evidence_quality"] == pytest.approx(0.25)
        assert profile["consistency"] == pytest.approx(1 / 6)

    def test_reliability_query_counts_all_pending_statuses(self):
        db = _db(_row(1, pending=1, active=1))
        get_contributor_profile("user-1", db)
        statement = str(db.execute.call_args.args[0])
        assert (
            "COUNT(*) FILTER (WHERE status IN ('PENDING', 'UNDER_REVIEW', 'LINKED')) AS pending"
            in statement
        )

    def test_one_decided_report_gets_only_ten_percent_confidence(self):
        breakdown = _normalized_breakdown(_row(roots=1, decided=1, actioned=1, active=1))
        assert breakdown["outcome_accuracy"] == pytest.approx(0.1)

    def test_ten_decided_reports_get_full_confidence(self):
        breakdown = _normalized_breakdown(_row(roots=10, decided=10, actioned=6, active=6))
        assert breakdown["outcome_accuracy"] == pytest.approx(0.6)

    def test_timestamp_signal_can_raise_per_report_evidence_to_one(self):
        breakdown = _normalized_breakdown(_row(roots=1, evidence=1.0, active=1))
        assert breakdown["evidence_quality"] == pytest.approx(1.0)

    def test_reliability_query_uses_24_hour_timestamp_tolerance(self):
        db = _db(_row(1, evidence=1.0, active=1))
        get_contributor_profile("user-1", db)
        statement = str(db.execute.call_args.args[0])
        assert "p.exif_datetime_original IS NOT NULL" in statement
        assert (
            "ABS(EXTRACT(EPOCH FROM (p.exif_datetime_original - r.report_timestamp)))" in statement
        )
        assert "<= 86400" in statement

    def test_reliability_query_uses_utc_six_calendar_month_window(self):
        db = _db(_row(1, active=1))
        get_contributor_profile("user-1", db)
        statement = str(db.execute.call_args.args[0])
        assert "COUNT(DISTINCT date_trunc('month', created_at AT TIME ZONE 'UTC'))" in statement
        assert "date_trunc('month', now() AT TIME ZONE 'UTC') - interval '5 months'" in statement
