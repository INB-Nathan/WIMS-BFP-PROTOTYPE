"""Regional Office API — stats endpoints (encoder + validator)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from auth import get_national_validator, get_regional_encoder
from auth import get_db_with_rls
from schemas.regional import RegionalStatsResponse

router = APIRouter()


@router.get("/validator/stats")
def get_validator_stats(
    user: Annotated[dict, Depends(get_national_validator)],
    db: Annotated[Session, Depends(get_db_with_rls)],
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
):
    """Counts of verified incidents for validator dashboard cards — all regions, filterable by fire date."""
    # ── Date filter on fire date (notification_dt, Asia/Manila TZ) ────────────
    date_params: dict = {}
    date_clause = ""
    if date_from:
        date_clause += (
            " AND DATE(nd.notification_dt AT TIME ZONE 'Asia/Manila') >= CAST(:date_from AS date)"
        )
        date_params["date_from"] = date_from
    if date_to:
        date_clause += (
            " AND DATE(nd.notification_dt AT TIME ZONE 'Asia/Manila') <= CAST(:date_to AS date)"
        )
        date_params["date_to"] = date_to

    by_cat_rows = db.execute(
        text(
            f"""
            SELECT nd.general_category, COUNT(*) AS cnt
            FROM wims.fire_incidents fi
            JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = fi.incident_id
            WHERE fi.verification_status = 'VERIFIED' AND fi.is_archived = FALSE
              {date_clause}
            GROUP BY nd.general_category
            ORDER BY cnt DESC
            """
        ),
        date_params,
    ).fetchall()

    # Pending count is always current (not date-filtered)
    pending_count = (
        db.execute(
            text("""
            SELECT COUNT(*) FROM wims.fire_incidents
            WHERE verification_status IN ('PENDING', 'PENDING_VALIDATION') AND is_archived = FALSE
            """),
        ).scalar()
        or 0
    )

    wildland_total = (
        db.execute(
            text(
                f"""
                SELECT COUNT(*)
                FROM wims.incident_wildland_afor iwa
                JOIN wims.fire_incidents fi ON fi.incident_id = iwa.incident_id
                LEFT JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = fi.incident_id
                WHERE fi.verification_status = 'VERIFIED' AND fi.is_archived = FALSE
                  {date_clause}
                """
            ),
            date_params,
        ).scalar()
        or 0
    )

    affected_row = db.execute(
        text(
            f"""
            SELECT
                COALESCE(SUM(nd.structures_affected), 0),
                COALESCE(SUM(nd.households_affected), 0),
                COALESCE(SUM(nd.families_affected), 0),
                COALESCE(SUM(nd.individuals_affected), 0),
                COALESCE(SUM(nd.vehicles_affected), 0)
            FROM wims.fire_incidents fi
            JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = fi.incident_id
            WHERE fi.verification_status = 'VERIFIED' AND fi.is_archived = FALSE
              {date_clause}
            """
        ),
        date_params,
    ).fetchone()

    total_verified = sum(r[1] for r in by_cat_rows)
    return {
        "total_verified": total_verified,
        "pending_validation": pending_count,
        "wildland_total": wildland_total,
        "by_category": [{"category": r[0], "count": r[1]} for r in by_cat_rows],
        "structures_affected": int(affected_row[0]) if affected_row else 0,
        "households_affected": int(affected_row[1]) if affected_row else 0,
        "families_affected": int(affected_row[2]) if affected_row else 0,
        "individuals_affected": int(affected_row[3]) if affected_row else 0,
        "vehicles_affected": int(affected_row[4]) if affected_row else 0,
    }


@router.get("/stats", response_model=RegionalStatsResponse)
def get_regional_stats(
    user: Annotated[dict, Depends(get_regional_encoder)],
    db: Annotated[Session, Depends(get_db_with_rls)],
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
):
    """Summary stats for the encoder's region — verified incidents only, filterable by fire date."""
    encoder_id = user["user_id"]
    region_id = user.get("assigned_region_id")

    # ── Date filter on fire date (notification_dt, Asia/Manila TZ) ────────────
    date_params: dict = {}
    date_clause = ""
    if date_from:
        date_clause += (
            " AND DATE(nd.notification_dt AT TIME ZONE 'Asia/Manila') >= CAST(:date_from AS date)"
        )
        date_params["date_from"] = date_from
    if date_to:
        date_clause += (
            " AND DATE(nd.notification_dt AT TIME ZONE 'Asia/Manila') <= CAST(:date_to AS date)"
        )
        date_params["date_to"] = date_to

    # ── Region-wide VERIFIED card stats ──────────────────────────────────────
    verified_params: dict = {"rid": region_id, **date_params}

    total = (
        db.execute(
            text(
                f"""
                SELECT COUNT(*)
                FROM wims.fire_incidents fi
                LEFT JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = fi.incident_id
                WHERE fi.region_id = :rid
                  AND fi.verification_status = 'VERIFIED'
                  AND fi.is_archived = FALSE
                  {date_clause}
                """
            ),
            verified_params,
        ).scalar()
        or 0
    )

    by_cat_rows = db.execute(
        text(
            f"""
            SELECT nd.general_category, COUNT(*) AS cnt
            FROM wims.fire_incidents fi
            JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = fi.incident_id
            WHERE fi.region_id = :rid
              AND fi.verification_status = 'VERIFIED'
              AND fi.is_archived = FALSE
              {date_clause}
            GROUP BY nd.general_category
            ORDER BY cnt DESC
            """
        ),
        verified_params,
    ).fetchall()

    wildland_total = (
        db.execute(
            text(
                f"""
                SELECT COUNT(*)
                FROM wims.incident_wildland_afor iwa
                JOIN wims.fire_incidents fi ON fi.incident_id = iwa.incident_id
                LEFT JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = fi.incident_id
                WHERE fi.region_id = :rid
                  AND fi.verification_status = 'VERIFIED'
                  AND fi.is_archived = FALSE
                  {date_clause}
                """
            ),
            verified_params,
        ).scalar()
        or 0
    )

    wildland_type_rows = db.execute(
        text(
            f"""
            SELECT lower(trim(iwa.wildland_fire_type)) AS wildland_fire_type, COUNT(*) AS cnt
            FROM wims.incident_wildland_afor iwa
            JOIN wims.fire_incidents fi ON fi.incident_id = iwa.incident_id
            LEFT JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = fi.incident_id
            WHERE fi.region_id = :rid
              AND fi.verification_status = 'VERIFIED'
              AND fi.is_archived = FALSE
              {date_clause}
            GROUP BY lower(trim(iwa.wildland_fire_type))
            ORDER BY cnt DESC
            """
        ),
        verified_params,
    ).fetchall()

    affected_row = db.execute(
        text(
            f"""
            SELECT
                COALESCE(SUM(nd.structures_affected), 0),
                COALESCE(SUM(nd.households_affected), 0),
                COALESCE(SUM(nd.families_affected), 0),
                COALESCE(SUM(nd.individuals_affected), 0),
                COALESCE(SUM(nd.vehicles_affected), 0)
            FROM wims.fire_incidents fi
            JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = fi.incident_id
            WHERE fi.region_id = :rid
              AND fi.verification_status = 'VERIFIED'
              AND fi.is_archived = FALSE
              {date_clause}
            """
        ),
        verified_params,
    ).fetchone()

    # ── Encoder-personal status counts (for rejection banner only) ────────────
    hide_seeded_sql = """
      AND NOT (
          COALESCE(fi.reference_number, '') LIKE 'AFOR-SEED-%'
          OR EXISTS (
              SELECT 1
              FROM wims.data_import_batches dib
              WHERE dib.batch_id = fi.import_batch_id
                AND (
                  dib.sync_status = 'SEEDED'
                  OR COALESCE(dib.batch_checksum_hash, '') LIKE 'seed-incidents-%'
                )
          )
      )
    """

    by_status_rows = db.execute(
        text(
            """
            SELECT verification_status, COUNT(*) AS cnt
            FROM wims.fire_incidents fi
            WHERE fi.encoder_id = CAST(:eid AS uuid)
              AND fi.is_archived = FALSE
              """
            + hide_seeded_sql
            + """
              AND NOT EXISTS (
                  SELECT 1
                  FROM wims.incident_verification_history ivh
                  WHERE ivh.target_id = fi.incident_id
                    AND ivh.action_label = 'DELETED_DRAFT'
              )
            GROUP BY verification_status
            ORDER BY cnt DESC
            """
        ),
        {"eid": str(encoder_id)},
    ).fetchall()

    by_alarm_rows = db.execute(
        text(
            """
            SELECT nd.alarm_level, COUNT(*) AS cnt
            FROM wims.fire_incidents fi
            JOIN wims.incident_nonsensitive_details nd ON nd.incident_id = fi.incident_id
            WHERE fi.encoder_id = CAST(:eid AS uuid) AND fi.is_archived = FALSE
            """
            + hide_seeded_sql
            + """
            GROUP BY nd.alarm_level
            ORDER BY cnt DESC
            """
        ),
        {"eid": str(encoder_id)},
    ).fetchall()

    return RegionalStatsResponse(
        total_incidents=total,
        total_incidents_this_week=total,
        by_category=[{"category": r[0], "count": r[1]} for r in by_cat_rows],
        by_alarm_level=[{"alarm_level": r[0], "count": r[1]} for r in by_alarm_rows],
        by_status=[{"status": r[0], "count": r[1]} for r in by_status_rows],
        wildland_total=wildland_total,
        by_wildland_type=[{"fire_type": r[0], "count": r[1]} for r in wildland_type_rows],
        structures_affected=int(affected_row[0]) if affected_row else 0,
        households_affected=int(affected_row[1]) if affected_row else 0,
        families_affected=int(affected_row[2]) if affected_row else 0,
        individuals_affected=int(affected_row[3]) if affected_row else 0,
        vehicles_affected=int(affected_row[4]) if affected_row else 0,
    )
