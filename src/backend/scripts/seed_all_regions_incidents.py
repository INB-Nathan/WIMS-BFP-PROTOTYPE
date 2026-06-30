#!/usr/bin/env python3
"""Seed synthetic verified incidents across all Philippine regions.

This script is intended for controlled VPS/admin use. It uses the backend's
admin DB session, encryption provider, canonical incident data hash function,
IVH hash-chain serialization, and analytics sync instead of direct SQL-only
seeding.

Default mode is dry-run. Pass --apply to write data.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from database import _AdminSessionLocal
from services.analytics_read_model import sync_incident_to_analytics
from services.kms import get_crypto_provider
from services.regional_incidents.helpers import (
    compute_incident_data_hash,
    verify_incident_hash_chain,
)

VALIDATOR_USER_ID = "22222222-2222-4222-8222-222222222222"
DEFAULT_PREFIX = "AFOR-SYNTH"
DEFAULT_SEED = 20260628

ENCODER_BY_REGION_CODE = {
    "NCR": "11111111-1111-4111-8111-111111111111",
    "CAR": "ee000002-0000-4002-8002-000000000002",
    "I": "ee000003-0000-4003-8003-000000000003",
    "II": "ee000004-0000-4004-8004-000000000004",
    "III": "ee000005-0000-4005-8005-000000000005",
    "IV-A": "ee000006-0000-4006-8006-000000000006",
    "IV-B": "ee000007-0000-4007-8007-000000000007",
    "V": "ee000008-0000-4008-8008-000000000008",
    "VI": "ee000009-0000-4009-8009-000000000009",
    "VII": "ee000010-0000-4010-8010-000000000010",
    "VIII": "ee000011-0000-4011-8011-000000000011",
    "IX": "ee000012-0000-4012-8012-000000000012",
    "X": "ee000013-0000-4013-8013-000000000013",
    "XI": "ee000014-0000-4014-8014-000000000014",
    "XII": "ee000015-0000-4015-8015-000000000015",
    "XIII": "ee000016-0000-4016-8016-000000000016",
    "BARMM": "ee000017-0000-4017-8017-000000000017",
    "NIR": "ee000018-0000-4018-8018-000000000018",
}

CENTROIDS = {
    "NCR": (121.0, 14.58, 0.20),
    "CAR": (120.71, 17.00, 0.60),
    "I": (120.50, 16.00, 0.55),
    "II": (121.70, 17.00, 0.60),
    "III": (120.80, 15.30, 0.55),
    "IV-A": (121.10, 14.10, 0.50),
    "IV-B": (119.00, 10.00, 0.85),
    "V": (123.20, 13.00, 0.55),
    "VI": (122.50, 11.00, 0.55),
    "VII": (123.70, 10.30, 0.50),
    "VIII": (125.00, 11.50, 0.60),
    "IX": (122.00, 7.50, 0.60),
    "X": (124.60, 8.50, 0.55),
    "XI": (125.50, 7.00, 0.60),
    "XII": (124.70, 6.50, 0.55),
    "XIII": (125.50, 8.50, 0.60),
    "BARMM": (124.30, 7.00, 0.60),
    "NIR": (123.00, 10.00, 0.50),
}

NCR_MUNICIPALITIES = [
    (None, "Fire District 1", "Manila"),
    (None, "Fire District 2", "Caloocan"),
    (None, "Fire District 3", "Makati"),
    (None, "Fire District 3", "Muntinlupa"),
    (None, "Fire District 4", "Pasig"),
    (None, "Fire District 5", "Quezon City"),
    (None, "Fire District 5", "Marikina"),
    (None, "Fire District 1", "Pasay"),
    (None, "Fire District 2", "Valenzuela"),
    (None, "Fire District 4", "Taguig"),
]

TYPE_POOL = [
    {
        "code": "STR",
        "category": "STRUCTURAL",
        "sub_categories": [
            "Residential",
            "Commercial",
            "Warehouse",
            "School",
            "Mixed occupancy",
            "Industrial",
            "Hospital",
            "Apartment",
        ],
        "origins": [
            "Electrical ignition",
            "Cooking equipment",
            "Open flame",
            "Candle",
            "LPG leak",
            "Arson",
            "Smoking",
            "Overloaded circuit",
        ],
    },
    {
        "code": "NON",
        "category": "NON_STRUCTURAL",
        "sub_categories": [
            "Grass fire",
            "Rubbish fire",
            "Wildland edge",
            "Brush fire",
            "Roadside fire",
            "Farm waste burn",
        ],
        "origins": ["Open burning", "Grass and brush", "Agricultural burning", "Improper disposal"],
    },
    {
        "code": "VEH",
        "category": "VEHICULAR",
        "sub_categories": ["Vehicle fire", "Truck fire", "Motorcycle fire", "Bus fire", "Van fire"],
        "origins": ["Engine compartment", "Fuel leak", "Electrical short", "Accident-related", "Overheat"],
    },
]

ALARM_LEVELS = ["1", "2", "3", "4", "5", "Task Force Bravo", "General Alarm"]
EXTENTS = ["Contained", "Partial", "Major", "Total", "Minor"]
BARANGAYS = [
    "Poblacion",
    "San Isidro",
    "San Jose",
    "San Antonio",
    "Santa Cruz",
    "Payatas",
    "Batasan Hills",
    "Bagong Silang",
    "Concepcion",
    "Sabang",
]


@dataclass(frozen=True)
class Region:
    region_id: int
    region_code: str
    region_name: str


@dataclass(frozen=True)
class Municipality:
    city_id: int | None
    province_name: str
    city_name: str


@dataclass
class PlanItem:
    region: Region
    target_count: int
    municipalities: list[Municipality]
    existing_count: int
    to_create: int


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write data; default is dry-run")
    parser.add_argument("--min-per-region", type=int, default=20)
    parser.add_argument("--max-per-region", type=int, default=50)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--prefix", default=DEFAULT_PREFIX)
    parser.add_argument("--verify-hash-chain", action="store_true", default=True)
    return parser.parse_args()


def scalar(db: Session, sql: str, params: dict[str, Any] | None = None) -> Any:
    return db.execute(text(sql), params or {}).scalar()


def canonical_encoder_username(region_code: str) -> str:
    return {
        "NCR": "encoder_ncr",
        "CAR": "encoder_car",
        "I": "encoder_r01",
        "II": "encoder_r02",
        "III": "encoder_r03",
        "IV-A": "encoder_r04a",
        "IV-B": "encoder_r04b",
        "V": "encoder_r05",
        "VI": "encoder_r06",
        "VII": "encoder_r07",
        "VIII": "encoder_r08",
        "IX": "encoder_r09",
        "X": "encoder_r10",
        "XI": "encoder_r11",
        "XII": "encoder_r12",
        "XIII": "encoder_r13",
        "BARMM": "encoder_barmm",
        "NIR": "encoder_nir",
    }[region_code]


def ensure_seed_users(db: Session, regions: list[Region]) -> None:
    """Ensure at least one WIMS account per region for encoder ownership.

    These rows are enough for the incident FK pointer (`fire_incidents.encoder_id`).
    They mirror the deterministic bootstrap users from `03_users.sql` and ensure
    `assigned_region_id` is set even if the migrated VPS is missing or partially
    synced user rows.
    """
    region_by_code = {region.region_code: region for region in regions}
    for code, user_id in ENCODER_BY_REGION_CODE.items():
        region = region_by_code.get(code)
        if region is None:
            continue
        db.execute(
            text(
                """
                INSERT INTO wims.users (
                    user_id, keycloak_id, username, role, assigned_region_id, is_active
                ) VALUES (
                    CAST(:uid AS uuid), CAST(:uid AS uuid), :username,
                    'REGIONAL_ENCODER', :region_id, TRUE
                )
                ON CONFLICT (user_id) DO UPDATE SET
                    role = 'REGIONAL_ENCODER',
                    assigned_region_id = EXCLUDED.assigned_region_id,
                    is_active = TRUE,
                    updated_at = now()
                """
            ),
            {
                "uid": user_id,
                "username": canonical_encoder_username(code),
                "region_id": region.region_id,
            },
        )
    db.execute(
        text(
            """
            INSERT INTO wims.users (user_id, keycloak_id, username, role, is_active)
            VALUES (CAST(:uid AS uuid), CAST(:uid AS uuid), 'validator_test', 'NATIONAL_VALIDATOR', TRUE)
            ON CONFLICT (user_id) DO UPDATE SET
                role = 'NATIONAL_VALIDATOR',
                is_active = TRUE,
                updated_at = now()
            """
        ),
        {"uid": VALIDATOR_USER_ID},
    )


def fetch_regions(db: Session) -> list[Region]:
    rows = db.execute(
        text(
            """
            SELECT region_id, region_code, region_name
            FROM wims.ref_regions
            WHERE region_code = ANY(:codes)
            ORDER BY region_id
            """
        ),
        {"codes": list(ENCODER_BY_REGION_CODE.keys())},
    ).fetchall()
    return [Region(row.region_id, row.region_code, row.region_name) for row in rows]


def fetch_municipalities(db: Session, region: Region) -> list[Municipality]:
    if region.region_code == "NCR":
        return [Municipality(city_id, province, city) for city_id, province, city in NCR_MUNICIPALITIES]

    rows = db.execute(
        text(
            """
            SELECT c.city_id, p.province_name, c.city_name
            FROM wims.ref_cities c
            JOIN wims.ref_provinces p ON p.province_id = c.province_id
            WHERE p.region_id = :rid
            ORDER BY p.province_name, c.city_name
            """
        ),
        {"rid": region.region_id},
    ).fetchall()
    if not rows:
        return [Municipality(None, f"{region.region_code} Province", f"{region.region_code} Municipality")]
    return [Municipality(row.city_id, row.province_name, row.city_name) for row in rows]


def choose_municipalities(
    rng: random.Random,
    municipalities: list[Municipality],
    target_count: int,
) -> list[Municipality]:
    shuffled = municipalities[:]
    rng.shuffle(shuffled)
    if len(shuffled) >= target_count:
        return shuffled[:target_count]

    chosen = shuffled[:]
    while len(chosen) < target_count:
        chosen.append(rng.choice(municipalities))
    return chosen


def ref_number(prefix: str, region_code: str, index: int) -> str:
    safe_code = region_code.replace("-", "")
    return f"{prefix}-{safe_code}-{index:04d}"


def build_plan(db: Session, args: argparse.Namespace, rng: random.Random) -> list[PlanItem]:
    plan: list[PlanItem] = []
    for region in fetch_regions(db):
        target_count = rng.randint(args.min_per_region, args.max_per_region)
        municipalities = choose_municipalities(rng, fetch_municipalities(db, region), target_count)
        existing_count = int(
            scalar(
                db,
                """
                SELECT COUNT(*)
                FROM wims.fire_incidents
                WHERE reference_number LIKE :prefix
                  AND region_id = :rid
                """,
                {"prefix": f"{args.prefix}-{region.region_code.replace('-', '')}-%", "rid": region.region_id},
            )
            or 0
        )
        plan.append(
            PlanItem(
                region=region,
                target_count=target_count,
                municipalities=municipalities,
                existing_count=existing_count,
                to_create=max(target_count - existing_count, 0),
            )
        )
    return plan


def random_location(rng: random.Random, region_code: str) -> tuple[float, float]:
    lon, lat, spread = CENTROIDS.get(region_code, (122.0, 12.0, 0.5))
    return lon + rng.uniform(-spread, spread), lat + rng.uniform(-spread, spread)


def random_numbers(rng: random.Random, category: str) -> dict[str, Any]:
    structures = rng.randint(1, 30) if category == "STRUCTURAL" else 0
    households = rng.randint(1, 20) if category == "STRUCTURAL" else 0
    individuals = households * rng.randint(2, 5)
    return {
        "structures": structures,
        "households": households,
        "individuals": individuals,
        "families": max(0, households),
        "civ_inj": rng.randint(0, 4) if category == "STRUCTURAL" else 0,
        "civ_deaths": rng.randint(1, 2) if category == "STRUCTURAL" and rng.random() < 0.15 else 0,
        "ff_inj": rng.randint(1, 3) if rng.random() < 0.25 else 0,
        "ff_deaths": 0,
        "resp_time": rng.randint(5, 90),
        "damage": Decimal(str(round(rng.uniform(10000, 5_000_000), 2)))
        if category == "STRUCTURAL"
        else Decimal(str(round(rng.uniform(1000, 500_000), 2))),
        "floor_area": Decimal(str(rng.randint(30, 500))) if category == "STRUCTURAL" else Decimal("0"),
        "land_area": Decimal(str(round(rng.uniform(0.1, 5.0), 2))) if category == "NON_STRUCTURAL" else Decimal("0"),
        "vehicles": rng.randint(1, 4) if category == "VEHICULAR" else 0,
    }


def ensure_import_batch(db: Session, region: Region, encoder_id: str, prefix: str, target_count: int) -> int:
    checksum = f"{prefix.lower()}-{region.region_code}"
    batch_id = scalar(
        db,
        "SELECT batch_id FROM wims.data_import_batches WHERE batch_checksum_hash = :checksum",
        {"checksum": checksum},
    )
    if batch_id:
        return int(batch_id)
    return int(
        scalar(
            db,
            """
            INSERT INTO wims.data_import_batches (
                region_id, uploaded_by, record_count, batch_checksum_hash, sync_status
            ) VALUES (
                :rid, CAST(:uid AS uuid), :count, :checksum, 'SEEDED'
            ) RETURNING batch_id
            """,
            {"rid": region.region_id, "uid": encoder_id, "count": target_count, "checksum": checksum},
        )
    )


def encrypt_pii(incident_id: int, pii: dict[str, Any]) -> dict[str, Any]:
    provider = get_crypto_provider()
    aad = f"incident_id:{incident_id}".encode("utf-8")
    nonce_b64, ct_b64 = provider.encrypt_json(pii, aad)
    crypto_provider = getattr(provider, "crypto_provider", "env_aesgcm")
    return {
        "pii_blob_enc": ct_b64,
        "encryption_iv": nonce_b64 if crypto_provider == "env_aesgcm" else None,
        "crypto_provider": crypto_provider,
        "kms_key_name": getattr(provider, "kms_key_name", None),
        "key_version": getattr(provider, "current_version", 1),
    }


def compute_ivh_row_hash(
    *,
    prev_ivh_hash: str | None,
    new_data_hash: str,
    corrected_fields: list[str],
    action_timestamp: datetime,
) -> str:
    payload = {
        "prev_ivh_hash": prev_ivh_hash or "",
        "new_data_hash": new_data_hash,
        "corrected_fields": corrected_fields,
        "action_timestamp": action_timestamp.isoformat(),
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def create_incident(
    db: Session,
    *,
    rng: random.Random,
    region: Region,
    municipality: Municipality,
    index: int,
    args: argparse.Namespace,
) -> int | None:
    reference_number = ref_number(args.prefix, region.region_code, index)
    existing_id = scalar(
        db,
        "SELECT incident_id FROM wims.fire_incidents WHERE reference_number = :ref",
        {"ref": reference_number},
    )
    if existing_id:
        return None

    encoder_id = ENCODER_BY_REGION_CODE[region.region_code]
    batch_id = ensure_import_batch(db, region, encoder_id, args.prefix, args.max_per_region)
    type_info = rng.choice(TYPE_POOL)
    category = type_info["category"]
    sub_category = rng.choice(type_info["sub_categories"])
    fire_origin = rng.choice(type_info["origins"])
    alarm_level = rng.choice(ALARM_LEVELS)
    extent = rng.choice(EXTENTS)
    numbers = random_numbers(rng, category)
    lon, lat = random_location(rng, region.region_code)
    created_at = datetime.now(timezone.utc) - timedelta(days=rng.randint(1, 180), minutes=rng.randint(0, 1440))
    notification_dt = created_at + timedelta(minutes=rng.randint(0, 60))
    barangay = rng.choice(BARANGAYS)
    station_name = f"{municipality.city_name} Fire Station"

    incident_id = int(
        scalar(
            db,
            """
            INSERT INTO wims.fire_incidents (
                import_batch_id, encoder_id, region_id, location,
                verification_status, is_archived, reference_number,
                incident_type_code, created_at, updated_at
            ) VALUES (
                :batch_id, CAST(:encoder_id AS uuid), :region_id,
                ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography,
                'PENDING_VALIDATION', FALSE, :reference_number,
                :incident_type_code, :created_at, :created_at
            ) RETURNING incident_id
            """,
            {
                "batch_id": batch_id,
                "encoder_id": encoder_id,
                "region_id": region.region_id,
                "lon": lon,
                "lat": lat,
                "reference_number": reference_number,
                "incident_type_code": type_info["code"],
                "created_at": created_at,
            },
        )
    )

    db.execute(
        text(
            """
            INSERT INTO wims.incident_nonsensitive_details (
                incident_id, city_id, distance_from_station_km, notification_dt,
                alarm_level, general_category, sub_category, occupancy_type,
                estimated_damage_php, civilian_injured, civilian_deaths,
                firefighter_injured, firefighter_deaths, families_affected,
                responder_type, fire_origin, extent_of_damage, structures_affected,
                households_affected, individuals_affected, resources_deployed,
                alarm_timeline, problems_encountered, recommendations,
                fire_station_name, total_response_time_minutes,
                total_gas_consumed_liters, stage_of_fire,
                extent_total_floor_area_sqm, extent_total_land_area_hectares,
                vehicles_affected, province_district, city_municipality,
                barangay
            ) VALUES (
                :incident_id, :city_id, :distance_from_station_km, :notification_dt,
                :alarm_level, :general_category, :sub_category, :occupancy_type,
                :estimated_damage_php, :civilian_injured, :civilian_deaths,
                :firefighter_injured, :firefighter_deaths, :families_affected,
                'BFP', :fire_origin, :extent_of_damage, :structures_affected,
                :households_affected, :individuals_affected, CAST(:resources_deployed AS jsonb),
                CAST(:alarm_timeline AS jsonb), CAST(:problems_encountered AS jsonb), :recommendations,
                :fire_station_name, :total_response_time_minutes,
                :total_gas_consumed_liters, :stage_of_fire,
                :extent_total_floor_area_sqm, :extent_total_land_area_hectares,
                :vehicles_affected, :province_district, :city_municipality,
                :barangay
            )
            """
        ),
        {
            "incident_id": incident_id,
            "city_id": municipality.city_id,
            "distance_from_station_km": Decimal(str(round(rng.uniform(0.5, 15.0), 2))),
            "notification_dt": notification_dt,
            "alarm_level": alarm_level,
            "general_category": category,
            "sub_category": sub_category,
            "occupancy_type": sub_category if category == "STRUCTURAL" else None,
            "estimated_damage_php": numbers["damage"],
            "civilian_injured": numbers["civ_inj"],
            "civilian_deaths": numbers["civ_deaths"],
            "firefighter_injured": numbers["ff_inj"],
            "firefighter_deaths": numbers["ff_deaths"],
            "families_affected": numbers["families"],
            "fire_origin": fire_origin,
            "extent_of_damage": extent,
            "structures_affected": numbers["structures"],
            "households_affected": numbers["households"],
            "individuals_affected": numbers["individuals"],
            "resources_deployed": json.dumps({"engine": rng.randint(1, 3), "ambulance": rng.randint(0, 1)}),
            "alarm_timeline": json.dumps(
                {
                    "notification": notification_dt.isoformat(),
                    "arrival": (notification_dt + timedelta(minutes=numbers["resp_time"])).isoformat(),
                }
            ),
            "problems_encountered": json.dumps([]),
            "recommendations": "Synthetic seed incident for nationwide regional dashboard validation.",
            "fire_station_name": station_name,
            "total_response_time_minutes": numbers["resp_time"],
            "total_gas_consumed_liters": Decimal(str(round(5 + numbers["resp_time"] * 0.3, 2))),
            "stage_of_fire": "Fire Out",
            "extent_total_floor_area_sqm": numbers["floor_area"],
            "extent_total_land_area_hectares": numbers["land_area"],
            "vehicles_affected": numbers["vehicles"],
            "province_district": municipality.province_name,
            "city_municipality": municipality.city_name,
            "barangay": barangay,
        },
    )

    pii = {
        "caller_name": f"Synthetic Caller {region.region_code}-{index:04d}",
        "caller_number": f"09{rng.randint(100000000, 999999999)}",
        "owner_name": f"Synthetic Owner {region.region_code}-{index:04d}",
        "occupant_name": f"Synthetic Occupant {region.region_code}-{index:04d}",
        "narrative_report": (
            f"Synthetic {category} incident in {barangay}, {municipality.city_name}, "
            f"{municipality.province_name}. Fire origin: {fire_origin}."
        ),
        "casualty_details": [
            {
                "civilian_injured": numbers["civ_inj"],
                "civilian_deaths": numbers["civ_deaths"],
                "firefighter_injured": numbers["ff_inj"],
                "firefighter_deaths": numbers["ff_deaths"],
            }
        ],
    }
    enc = encrypt_pii(incident_id, pii)
    db.execute(
        text(
            """
            INSERT INTO wims.incident_sensitive_details (
                incident_id, street_address, landmark,
                caller_name, caller_number, narrative_report,
                prepared_by_officer, noted_by_officer, receiver_name,
                owner_name, occupant_name, establishment_name,
                personnel_on_duty, other_personnel, casualty_details,
                icp_location, is_icp_present, disposition,
                disposition_prepared_by, disposition_noted_by,
                pii_blob_enc, encryption_iv, crypto_provider, kms_key_name, key_version
            ) VALUES (
                :incident_id, :street_address, :landmark,
                NULL, NULL, NULL,
                :prepared_by_officer, :noted_by_officer, :receiver_name,
                NULL, NULL, :establishment_name,
                CAST(:personnel_on_duty AS jsonb), CAST(:other_personnel AS jsonb), NULL::jsonb,
                :icp_location, :is_icp_present, 'Closed',
                :disposition_prepared_by, :disposition_noted_by,
                :pii_blob_enc, :encryption_iv, :crypto_provider, :kms_key_name, :key_version
            )
            """
        ),
        {
            "incident_id": incident_id,
            "street_address": f"{rng.randint(1, 999)} {barangay} Street",
            "landmark": f"Near {station_name}",
            "prepared_by_officer": f"Seed Duty Officer {region.region_code}",
            "noted_by_officer": "Seed Fire Marshal",
            "receiver_name": f"Seed Receiver {region.region_code}",
            "establishment_name": f"{sub_category} Establishment" if category == "STRUCTURAL" else None,
            "personnel_on_duty": json.dumps([{"name": f"Seed Crew {region.region_code}", "role": "Responder"}]),
            "other_personnel": json.dumps([]),
            "icp_location": station_name,
            "is_icp_present": rng.random() < 0.35,
            "disposition_prepared_by": f"Seed Duty Officer {region.region_code}",
            "disposition_noted_by": "Seed Fire Marshal",
            **enc,
        },
    )

    data_hash = compute_incident_data_hash(
        db,
        incident_id,
        encoder_id=encoder_id,
        keycloak_id=encoder_id,
        region_id=region.region_id,
        created_at=created_at,
        verification_status="VERIFIED",
    )
    db.execute(
        text(
            """
            UPDATE wims.fire_incidents
            SET verification_status = 'VERIFIED', data_hash = :data_hash, updated_at = :updated_at
            WHERE incident_id = :incident_id
            """
        ),
        {"data_hash": data_hash, "updated_at": datetime.now(timezone.utc), "incident_id": incident_id},
    )

    action_timestamp = notification_dt + timedelta(hours=2)
    ivh_row_hash = compute_ivh_row_hash(
        prev_ivh_hash=None,
        new_data_hash=data_hash,
        corrected_fields=[],
        action_timestamp=action_timestamp,
    )
    db.execute(
        text(
            """
            INSERT INTO wims.incident_verification_history (
                incident_id, target_type, target_id, action_by_user_id,
                previous_status, new_status, notes, action_label, comments,
                data_hash, sync_status, old_data_hash, new_data_hash,
                corrected_fields, prev_ivh_hash, ivh_row_hash, action_timestamp
            ) VALUES (
                :incident_id, 'OFFICIAL', :incident_id, CAST(:validator_id AS uuid),
                'PENDING_VALIDATION', 'VERIFIED', :notes, 'seed_all_regions_backend', :notes,
                :data_hash, 'SYNCED', NULL, :data_hash,
                :corrected_fields, NULL, :ivh_row_hash, :action_timestamp
            )
            """
        ),
        {
            "incident_id": incident_id,
            "validator_id": VALIDATOR_USER_ID,
            "notes": "Synthetic backend-admin seed: verified for nationwide dashboard validation.",
            "data_hash": data_hash,
            "corrected_fields": "{}",
            "ivh_row_hash": ivh_row_hash,
            "action_timestamp": action_timestamp,
        },
    )

    sync_incident_to_analytics(db, incident_id)
    return incident_id


def print_plan(plan: list[PlanItem]) -> None:
    print("Seed plan:")
    print("region | target | existing synthetic | to create | municipality coverage")
    for item in plan:
        unique_munis = len({m.city_name for m in item.municipalities})
        print(
            f"{item.region.region_code:5} | {item.target_count:6} | "
            f"{item.existing_count:18} | {item.to_create:9} | {unique_munis} distinct"
        )
    total = sum(item.to_create for item in plan)
    print(f"Total new incidents planned: {total}")


def run(args: argparse.Namespace) -> int:
    if args.min_per_region < 1 or args.max_per_region < args.min_per_region:
        print("Invalid min/max per-region values", file=sys.stderr)
        return 2

    rng = random.Random(args.seed)
    db = _AdminSessionLocal()
    created_ids: list[int] = []
    try:
        regions_count = scalar(db, "SELECT COUNT(*) FROM wims.ref_regions")
        print(f"Connected to DB. ref_regions count={regions_count}. apply={args.apply}")
        plan = build_plan(db, args, rng)
        print_plan(plan)

        if not args.apply:
            db.rollback()
            print("Dry-run only. Re-run with --apply to write data.")
            return 0

        ensure_seed_users(db, [item.region for item in plan])
        for item in plan:
            for offset in range(1, item.target_count + 1):
                incident_id = create_incident(
                    db,
                    rng=rng,
                    region=item.region,
                    municipality=item.municipalities[offset - 1],
                    index=offset,
                    args=args,
                )
                if incident_id is not None:
                    created_ids.append(incident_id)

        db.commit()

        if args.verify_hash_chain:
            invalid: list[tuple[int, dict[str, Any]]] = []
            for incident_id in created_ids:
                result = verify_incident_hash_chain(db, incident_id, log_violations=False)
                if result.get("integrity_status") != "valid":
                    invalid.append((incident_id, result))
            if invalid:
                print(f"WARNING: {len(invalid)} created incidents failed hash-chain verification")
                for incident_id, result in invalid[:5]:
                    print(f"  incident_id={incident_id}: {result}")
                return 1

        print(f"Created {len(created_ids)} new incidents.")
        counts = db.execute(
            text(
                """
                SELECT r.region_code, COUNT(f.incident_id) AS count
                FROM wims.fire_incidents f
                JOIN wims.ref_regions r ON r.region_id = f.region_id
                GROUP BY r.region_code
                ORDER BY r.region_code
                """
            )
        ).fetchall()
        print("Post-seed incident counts:")
        for row in counts:
            print(f"  {row.region_code:5} {row.count}")
        return 0
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(run(parse_args()))
