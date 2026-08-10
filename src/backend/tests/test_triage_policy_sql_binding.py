"""Issue #718 — triage proximity policy is the single source for SQL callers.

Unit-level proof that every SQL seam (intake trust, duplicate suggestions,
queue projection, merge candidate discovery, merge revalidation) binds policy
values through SQLAlchemy parameters, and that a changed TRIAGE_POLICY flows
into every seam consistently. No live Postgres required.
"""

from dataclasses import FrozenInstanceError
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from api.routes.civilian import _trust_score, suggest_duplicate_reports
from schemas.civilian import CivilianReportCreate
from services.civilian_triage import policies
from services.civilian_triage import queue_projection
from services.civilian_triage import workflow
from services.civilian_triage.models import ClusterMergeRequest
from services.civilian_triage.queue_projection import get_queue
from services.civilian_triage.workflow import (
    get_merge_candidates_command,
    merge_clusters_command,
)

WKT = "SRID=4326;POINT(121.05 14.6)"

QUEUE_FILTERS = {
    "needs_help": False,
    "someone_else_needs_help": False,
    "aging": False,
    "timeout_risk": False,
    "danger": False,
    "confidence": None,
    "unreviewed": False,
    "claimed_by_me": False,
    "actioned_today": False,
    "rejected_today": False,
    "source": None,
}


def _user():
    return {"user_id": "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", "role": "NATIONAL_VALIDATOR"}


# ── Policy interface ─────────────────────────────────────────────────────────


def test_triage_policy_interface_defaults():
    assert isinstance(policies.TRIAGE_POLICY, policies.TriagePolicy)
    assert policies.TRIAGE_POLICY.related_report_radius_meters == 100
    assert policies.TRIAGE_POLICY.related_report_window_hours == 1
    assert policies.TRIAGE_POLICY.merge_candidate_radius_meters == 250
    assert policies.TRIAGE_POLICY.merge_candidate_window_seconds == 3600
    assert policies.TRIAGE_POLICY.gps_mismatch_meters == 200


def test_triage_policy_is_frozen_and_only_source():
    with pytest.raises(FrozenInstanceError):
        policies.TRIAGE_POLICY.related_report_radius_meters = 500
    # The old module-level constants must not survive as a second source.
    for name in (
        "RELATED_REPORT_RADIUS_METERS",
        "RELATED_REPORT_WINDOW_HOURS",
        "MERGE_CANDIDATE_RADIUS_METERS",
        "MERGE_CANDIDATE_WINDOW_SECONDS",
        "GPS_MISMATCH_METERS",
    ):
        assert not hasattr(policies, name), f"duplicate constant {name} must be removed"


# ── Fake sessions ────────────────────────────────────────────────────────────


class _CapturingDB:
    """Records (sql, params) per execute; routes canned results by call shape."""

    def __init__(self):
        self.calls: list[tuple[str, dict]] = []

    def execute(self, statement, params=None):
        sql = str(statement)
        self.calls.append((sql, params or {}))
        result = MagicMock()
        if "SELECT COUNT(*)" in sql:
            result.scalar.return_value = 0
        elif "within_range" in sql:
            result.scalar.return_value = True
        elif "FROM wims.citizen_report_clusters c" in sql and "LATERAL" not in sql:
            result.fetchone.return_value = SimpleNamespace(anchor_report_id=1)
        else:
            result.fetchall.return_value = []
            result.fetchone.return_value = None
        return result


class _MergeDB:
    """Routes the merge proximity revalidation result; records all calls."""

    def __init__(self, within_range=True):
        self.calls: list[tuple[str, dict]] = []
        self.within_range = within_range

    def execute(self, statement, params=None):
        sql = str(statement)
        self.calls.append((sql, params or {}))
        result = MagicMock()
        if "within_range" in sql:
            result.scalar.return_value = self.within_range
        elif "WITH moved AS" in sql:
            result.fetchone.return_value = SimpleNamespace(moved_ids=[])
        return result

    def commit(self):
        pass

    def rollback(self):
        pass


class _QueueCaptureDB:
    """get_queue runs materialization writes then the final SELECT."""

    def __init__(self, rows):
        self.calls: list[tuple[str, dict]] = []
        self.rows = rows

    def execute(self, statement, params=None):
        sql = str(statement)
        self.calls.append((sql, params or {}))
        result = MagicMock()
        if "station_info" in sql and "province_name" in sql and "SELECT" in sql:
            result.fetchall.return_value = self.rows
        else:
            result.fetchall.return_value = []
            result.fetchone.return_value = None
        return result

    def commit(self):
        pass


def _queue_row(gps_distance_m=None):
    """39-column row aligned to the queue projection SELECT (see index map)."""
    now = datetime(2024, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
    return (
        1,  # 0 report_id
        14.5868,  # 1 lat
        120.9838,  # 2 lon
        "FIRE",  # 3 category
        "STRUCTURE",  # 4 sub_category
        "WITNESS",  # 5 reporting_context
        "I_NEED_HELP",  # 6 safety_status
        "PENDING",  # 7 status
        None,  # 8 status_explanation
        "Smoke seen",  # 9 description
        None,  # 10 linked_to_report_id
        80,  # 11 trust_score
        gps_distance_m,  # 12 gps_distance_m
        0,  # 13 link_count
        now,  # 14 created_at
        now,  # 15 reported_at
        None,  # 16 previous_report_id
        True,  # 17 has_category
        True,  # 18 has_sub_category
        True,  # 19 has_reported_at
        True,  # 20 has_device_id
        False,  # 21 has_witness_name
        False,  # 22 has_witness_phone
        False,  # 23 nearest_500m
        False,  # 24 nearest_2km
        False,  # 25 nearest_5km
        None,  # 26 cluster_id
        None,  # 27 cluster_status
        None,  # 28 assigned_to
        None,  # 29 review_started_at
        None,  # 30 anchor_report_id
        0,  # 31 related_count
        "Manila City Fire Station",  # 32 station_name
        123.4,  # 33 distance_m
        "0281234567",  # 34 phone
        "Metro Manila",  # 35 province_name
        0,  # 36 dup_count_30m
        0,  # 37 followup_count
        None,  # 38 followups_json
    )


# ── Intake trust (civilian.py _trust_score) ──────────────────────────────────


def test_trust_score_binds_related_report_policy_defaults():
    db = _CapturingDB()
    _trust_score(
        db,
        CivilianReportCreate(latitude=14.6, longitude=121.05, category="STRUCTURAL"),
        WKT,
        100.0,
    )
    sql, params = db.calls[0]
    assert "ST_DWithin(location, ST_GeogFromText(:wkt), :related_radius_m)" in sql
    assert "make_interval(hours => :related_window_hours)" in sql
    assert "ST_DWithin(location, ST_GeogFromText(:wkt), 100)" not in sql
    assert params["related_radius_m"] == 100
    assert params["related_window_hours"] == 1


def test_trust_score_policy_change_flows_into_bound_params(monkeypatch):
    monkeypatch.setattr(
        policies,
        "TRIAGE_POLICY",
        policies.TriagePolicy(related_report_radius_meters=321, related_report_window_hours=2),
    )
    db = _CapturingDB()
    _trust_score(
        db,
        CivilianReportCreate(latitude=14.6, longitude=121.05, category="STRUCTURAL"),
        WKT,
        None,
    )
    sql, params = db.calls[0]
    assert params["related_radius_m"] == 321
    assert params["related_window_hours"] == 2
    assert ", 100)" not in sql and "interval '1 hour'" not in sql


def test_trust_score_gps_threshold_follows_policy(monkeypatch):
    body = CivilianReportCreate(
        latitude=14.6, longitude=121.05, category="STRUCTURAL", gps_distance_m=150.0
    )
    score_default = _trust_score(_CapturingDB(), body, WKT, 100.0)
    monkeypatch.setattr(policies, "TRIAGE_POLICY", policies.TriagePolicy(gps_mismatch_meters=100))
    score_tight = _trust_score(_CapturingDB(), body, WKT, 100.0)
    assert score_default - score_tight == 10


# ── Duplicate suggestions (civilian.py suggest_duplicate_reports) ────────────


def test_duplicate_suggestions_bind_related_policy(monkeypatch):
    body = CivilianReportCreate(latitude=14.6, longitude=121.05, category="STRUCTURAL")

    db = _CapturingDB()
    suggest_duplicate_reports(body, db)
    sql, params = db.calls[0]
    assert (
        "ST_DWithin(cr.location::geography, ST_GeogFromText(:wkt)::geography, :related_radius_m)"
        in sql
    )
    assert "make_interval(hours => :related_window_hours)" in sql
    assert params["related_radius_m"] == 100
    assert params["related_window_hours"] == 1

    monkeypatch.setattr(
        policies,
        "TRIAGE_POLICY",
        policies.TriagePolicy(related_report_radius_meters=432, related_report_window_hours=3),
    )
    db2 = _CapturingDB()
    suggest_duplicate_reports(body, db2)
    sql2, params2 = db2.calls[0]
    assert params2["related_radius_m"] == 432
    assert params2["related_window_hours"] == 3
    assert ", 100)" not in sql2 and "interval '1 hour'" not in sql2


# ── Queue projection (queue_projection.get_queue) ────────────────────────────


def _run_queue(db, monkeypatch):
    monkeypatch.setattr(queue_projection, "_table_exists", lambda *a, **k: False)
    monkeypatch.setattr(queue_projection, "set_rls_context", lambda *a, **k: None)
    return get_queue(_user(), db, **QUEUE_FILTERS)


def test_queue_projection_binds_related_policy_and_gps_threshold(monkeypatch):
    db = _QueueCaptureDB([_queue_row(gps_distance_m=250.0)])
    resp = _run_queue(db, monkeypatch)
    sql, params = db.calls[-1]
    assert "ST_DWithin(r.location::geography, r2.location::geography, :related_radius_m)" in sql
    assert "make_interval(hours => :related_window_hours)" in sql
    assert params["related_radius_m"] == 100
    assert params["related_window_hours"] == 1
    # Default GPS mismatch policy is 200m: 250m > 200m is flagged.
    assert resp.clusters[0].reports[0].trust_breakdown.gps_mismatch is True

    monkeypatch.setattr(
        policies,
        "TRIAGE_POLICY",
        policies.TriagePolicy(
            related_report_radius_meters=321,
            related_report_window_hours=2,
            gps_mismatch_meters=300,
        ),
    )
    db2 = _QueueCaptureDB([_queue_row(gps_distance_m=250.0)])
    resp2 = _run_queue(db2, monkeypatch)
    sql2, params2 = db2.calls[-1]
    assert params2["related_radius_m"] == 321
    assert params2["related_window_hours"] == 2
    # 250m is within the widened 300m policy: not flagged.
    assert resp2.clusters[0].reports[0].trust_breakdown.gps_mismatch is False


# ── Merge candidate discovery (workflow.get_merge_candidates_command) ────────


def test_merge_candidates_bind_merge_policy_defaults():
    db = _CapturingDB()
    resp = get_merge_candidates_command(1, db)
    sql, params = db.calls[1]
    assert "ST_DWithin(a.location::geography, target.location::geography, :merge_radius_m)" in sql
    assert "<= :merge_window_seconds" in sql
    assert ", 250)" not in sql and "<= 3600" not in sql
    assert params["merge_radius_m"] == 250
    assert params["merge_window_seconds"] == 3600
    assert resp.candidates == []


# ── Merge revalidation (workflow.merge_clusters_command) ────────────────────


def _run_merge(db, monkeypatch, within_range=True):
    monkeypatch.setattr(
        workflow,
        "ensure_cluster_claim",
        lambda _db, cid, user: (
            "target",
            "CLUSTER_UNDER_REVIEW",
            user["user_id"],
            None,
            None,
            "note",
            "u",
        ),
    )
    monkeypatch.setattr(
        workflow,
        "fetch_cluster_for_update",
        lambda _db, cid: ("src", "CLUSTER_MONITORING", "someone-else", None, None, "note", "u"),
    )
    monkeypatch.setattr(workflow, "log_system_audit", lambda *a, **k: None)
    return merge_clusters_command(
        1,
        ClusterMergeRequest(source_cluster_id=2, internal_note="merge test"),
        MagicMock(),
        _user(),
        db,
    )


def test_merge_revalidation_binds_merge_policy_defaults(monkeypatch):
    db = _MergeDB(within_range=True)
    _run_merge(db, monkeypatch)
    reval_sql, reval_params = next(c for c in db.calls if "within_range" in c[0])
    assert (
        "ST_Distance(sa.location::geography, ta.location::geography) < :merge_radius_m" in reval_sql
    )
    assert "<= :merge_window_seconds" in reval_sql
    assert "< 250" not in reval_sql and "<= 3600" not in reval_sql
    assert reval_params["merge_radius_m"] == 250
    assert reval_params["merge_window_seconds"] == 3600


def test_merge_discovery_and_revalidation_share_one_policy(monkeypatch):
    monkeypatch.setattr(
        policies,
        "TRIAGE_POLICY",
        policies.TriagePolicy(
            merge_candidate_radius_meters=777, merge_candidate_window_seconds=999
        ),
    )
    cand_db = _CapturingDB()
    get_merge_candidates_command(1, cand_db)
    cand_sql, cand_params = cand_db.calls[1]

    reval_db = _MergeDB(within_range=True)
    _run_merge(reval_db, monkeypatch)
    reval_sql, reval_params = next(c for c in reval_db.calls if "within_range" in c[0])

    assert cand_params["merge_radius_m"] == reval_params["merge_radius_m"] == 777
    assert cand_params["merge_window_seconds"] == reval_params["merge_window_seconds"] == 999
    assert ":merge_radius_m" in cand_sql and ":merge_radius_m" in reval_sql


def test_merge_revalidation_error_detail_is_derived_from_policy(monkeypatch):
    monkeypatch.setattr(
        policies,
        "TRIAGE_POLICY",
        policies.TriagePolicy(
            merge_candidate_radius_meters=500, merge_candidate_window_seconds=5400
        ),
    )
    db = _MergeDB(within_range=False)
    with pytest.raises(HTTPException) as exc:
        _run_merge(db, monkeypatch)
    assert exc.value.status_code == 422
    assert "500m / 5400 seconds proximity" in exc.value.detail
    assert "250m" not in exc.value.detail
