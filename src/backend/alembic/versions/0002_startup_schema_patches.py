"""Migrate startup schema patches into Alembic

Consolidates all DDL previously run every boot by
main.apply_schema_patches() into a single one-shot migration.

Revision ID: 0002
Revises: 0001
Create Date: 2026-07-09
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _ensure_wims_app_user_role() -> None:
    """Create wims_app / wims_app_user roles if they don't exist."""
    op.execute(
        """
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wims_app') THEN
            CREATE ROLE wims_app NOLOGIN;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wims_app_user') THEN
            CREATE ROLE wims_app_user LOGIN PASSWORD 'wims_app_user' INHERIT;
            GRANT wims_app TO wims_app_user;
          END IF;
        END
        $$
        """
    )
    op.execute("GRANT USAGE ON SCHEMA wims TO wims_app")
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA wims TO wims_app")
    op.execute("GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA wims TO wims_app")


def _ensure_no_update_verified_rule() -> None:
    """no_update_verified rule: allows archival/unarchival on VERIFIED rows."""
    op.execute("DROP RULE IF EXISTS no_update_verified ON wims.fire_incidents")
    op.execute(
        """
        CREATE RULE no_update_verified AS
            ON UPDATE TO wims.fire_incidents
            WHERE (
                OLD.verification_status = 'VERIFIED'
                AND NEW.verification_status != 'REPLACED'
                AND NOT (NEW.is_archived = TRUE AND OLD.is_archived = FALSE)
                AND NOT (NEW.is_archived = FALSE AND OLD.is_archived = TRUE)
                AND NOT (
                    NEW.data_hash IS DISTINCT FROM OLD.data_hash
                    AND NEW.verification_status = 'VERIFIED'
                    AND NEW.is_archived = OLD.is_archived
                )
            )
            DO INSTEAD NOTHING
        """
    )


def _ensure_no_update_ivh_rule() -> None:
    """RP-05: incident_verification_history is append-only (UPDATE block)."""
    op.execute("DROP RULE IF EXISTS no_update_ivh ON wims.incident_verification_history")
    op.execute(
        """
        CREATE RULE no_update_ivh AS
            ON UPDATE TO wims.incident_verification_history
            DO INSTEAD NOTHING
        """
    )


def _ensure_verified_requires_data_hash() -> None:
    """RP-20: VERIFIED incident must carry a data_hash."""
    op.execute(
        "ALTER TABLE wims.fire_incidents DROP CONSTRAINT IF EXISTS verified_requires_data_hash"
    )
    op.execute(
        """
        ALTER TABLE wims.fire_incidents
            ADD CONSTRAINT verified_requires_data_hash
            CHECK (verification_status <> 'VERIFIED' OR data_hash IS NOT NULL)
            NOT VALID
        """
    )


def _ensure_ref_table_rls() -> None:
    """Enable RLS on reference geography tables and create policies."""
    for table in ("wims.ref_regions", "wims.ref_provinces", "wims.ref_cities"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")

    op.execute(
        """
        CREATE OR REPLACE FUNCTION wims.get_first_region_id()
         RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER
         SET search_path = wims, pg_temp
         AS $$ SELECT region_id FROM wims.ref_regions ORDER BY region_id LIMIT 1 $$
        """
    )
    op.execute("REVOKE ALL ON FUNCTION wims.get_first_region_id() FROM PUBLIC")
    op.execute("GRANT EXECUTE ON FUNCTION wims.get_first_region_id() TO wims_app")

    _select_policy = (
        " USING (wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST')"
        " OR (wims.current_user_role() IN ('REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')"
        " AND region_id = wims.current_user_region_id()))"
    )
    _cities_select_policy = (
        " USING (wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST')"
        " OR (wims.current_user_role() IN ('REGIONAL_ENCODER', 'NATIONAL_VALIDATOR')"
        " AND province_id IN (SELECT province_id FROM wims.ref_provinces"
        " WHERE region_id = wims.current_user_region_id())))"
    )
    _write_policy = (
        " USING (wims.current_user_role() = 'SYSTEM_ADMIN')"
        " WITH CHECK (wims.current_user_role() = 'SYSTEM_ADMIN')"
    )

    for table, select_pol, write_pol, select_using in (
        ("wims.ref_regions", "ref_regions_select", "ref_regions_write", _select_policy),
        ("wims.ref_provinces", "ref_provinces_select", "ref_provinces_write", _select_policy),
        ("wims.ref_cities", "ref_cities_select", "ref_cities_write", _cities_select_policy),
    ):
        op.execute(f"DROP POLICY IF EXISTS {select_pol} ON {table}")
        op.execute(f"CREATE POLICY {select_pol} ON {table} FOR SELECT{select_using}")
        op.execute(f"DROP POLICY IF EXISTS {write_pol} ON {table}")
        op.execute(f"CREATE POLICY {write_pol} ON {table} FOR ALL{_write_policy}")


def _ensure_users_rls() -> None:
    """Broaden users SELECT policy for BFP staff roles."""
    op.execute("DROP POLICY IF EXISTS users_self_or_admin_select ON wims.users")
    op.execute(
        """
        CREATE POLICY users_self_or_admin_select
        ON wims.users FOR SELECT USING (
            wims.current_user_role() IN (
                'SYSTEM_ADMIN', 'NATIONAL_VALIDATOR', 'NATIONAL_ANALYST', 'REGIONAL_ENCODER'
            )
            OR user_id = wims.current_user_uuid()
        )
        """
    )


def _ensure_svc_task_user() -> None:
    """Ensure svc_task system service account exists."""
    op.execute(
        """
        INSERT INTO wims.users (user_id, keycloak_id, username, role, is_active)
        VALUES (
            '00000000-0000-0000-0000-000000000002'::uuid,
            '00000000-0000-0000-0000-000000000002'::uuid,
            'svc_task',
            'SYSTEM_ADMIN',
            TRUE
        )
        ON CONFLICT (user_id) DO NOTHING
        """
    )


def _ensure_mv_ownership() -> None:
    """Transfer analytics MV ownership to wims_app_user."""
    for mv in (
        "wims.mv_incident_counts_daily",
        "wims.mv_incident_by_region",
        "wims.mv_incident_type_distribution",
    ):
        op.execute(f"ALTER MATERIALIZED VIEW IF EXISTS {mv} OWNER TO wims_app_user")


def _ensure_analytics_facts_rls() -> None:
    """Rewrite analytics_incident_facts RLS policies."""
    _write_roles = "('REGIONAL_ENCODER', 'NATIONAL_VALIDATOR', 'NATIONAL_ANALYST', 'SYSTEM_ADMIN')"

    for policy in (
        "aif_national_analyst_read",
        "aif_regional_read",
        "aif_validator_read",
        "aif_system_admin_all",
        "aif_staff_write",
        "aif_staff_insert",
        "aif_staff_update",
        "aif_staff_delete",
    ):
        op.execute(f"DROP POLICY IF EXISTS {policy} ON wims.analytics_incident_facts")

    op.execute(
        """
        CREATE POLICY aif_national_analyst_read ON wims.analytics_incident_facts
            FOR SELECT USING (wims.current_user_role() IN ('NATIONAL_ANALYST', 'SYSTEM_ADMIN'))
        """
    )
    op.execute(
        """
        CREATE POLICY aif_regional_read ON wims.analytics_incident_facts
            FOR SELECT USING (
                wims.current_user_role() = 'REGIONAL_ENCODER'
                AND region_id = wims.current_user_region_id()
            )
        """
    )
    op.execute(
        """
        CREATE POLICY aif_validator_read ON wims.analytics_incident_facts
            FOR SELECT USING (
                wims.current_user_role() = 'NATIONAL_VALIDATOR'
                AND region_id = wims.current_user_region_id()
            )
        """
    )
    op.execute(
        f"""
        CREATE POLICY aif_staff_delete ON wims.analytics_incident_facts
            FOR DELETE USING (wims.current_user_role() IN {_write_roles})
        """
    )


def _ensure_rls_helpers_security_definer() -> None:
    """Ensure RLS helper functions are SECURITY DEFINER to prevent recursion."""
    op.execute("ALTER FUNCTION wims.current_user_role() SECURITY DEFINER")
    op.execute("ALTER FUNCTION wims.current_user_uuid() SECURITY DEFINER")
    op.execute("ALTER FUNCTION wims.current_user_region_id() SECURITY DEFINER")


def _ensure_function_execute_grants() -> None:
    """Re-grant EXECUTE on all wims functions to wims_app."""
    op.execute("GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA wims TO wims_app")


def _ensure_province_city_columns() -> None:
    """Add province_district / city_municipality columns."""
    op.execute(
        "ALTER TABLE wims.incident_nonsensitive_details"
        " ADD COLUMN IF NOT EXISTS province_district TEXT,"
        " ADD COLUMN IF NOT EXISTS city_municipality TEXT"
    )


def _ensure_encoder_default_region() -> None:
    """Auto-assign default region to REGIONAL_ENCODER users with NULL assigned_region_id."""
    op.execute(
        """
        UPDATE wims.users
        SET assigned_region_id = (
            SELECT region_id FROM wims.ref_regions ORDER BY region_id ASC LIMIT 1
        )
        WHERE role IN ('REGIONAL_ENCODER', 'ENCODER')
          AND assigned_region_id IS NULL
          AND is_active = TRUE
        """
    )


def upgrade() -> None:
    _ensure_wims_app_user_role()
    _ensure_no_update_verified_rule()
    _ensure_no_update_ivh_rule()
    _ensure_verified_requires_data_hash()
    _ensure_ref_table_rls()
    _ensure_users_rls()
    _ensure_svc_task_user()
    _ensure_mv_ownership()
    _ensure_analytics_facts_rls()
    _ensure_rls_helpers_security_definer()
    _ensure_function_execute_grants()
    _ensure_province_city_columns()
    _ensure_encoder_default_region()


def downgrade() -> None:
    """Reverse the migration — drop rules, policies, functions.

    This is best-effort and may not recover the exact pre-migration state
    if other migrations have since been applied.
    """
    op.execute("DROP RULE IF EXISTS no_update_verified ON wims.fire_incidents")
    op.execute("DROP RULE IF EXISTS no_update_ivh ON wims.incident_verification_history")
    op.execute(
        "ALTER TABLE wims.fire_incidents DROP CONSTRAINT IF EXISTS verified_requires_data_hash"
    )

    for policy in (
        "ref_regions_select",
        "ref_regions_write",
        "ref_provinces_select",
        "ref_provinces_write",
        "ref_cities_select",
        "ref_cities_write",
        "users_self_or_admin_select",
    ):
        op.execute(f"DROP POLICY IF EXISTS {policy} ON wims.users")
        op.execute(f"DROP POLICY IF EXISTS {policy} ON wims.ref_regions")
        op.execute(f"DROP POLICY IF EXISTS {policy} ON wims.ref_provinces")
        op.execute(f"DROP POLICY IF EXISTS {policy} ON wims.ref_cities")

    for policy in (
        "aif_national_analyst_read",
        "aif_regional_read",
        "aif_validator_read",
        "aif_system_admin_all",
        "aif_staff_write",
        "aif_staff_insert",
        "aif_staff_update",
        "aif_staff_delete",
    ):
        op.execute(f"DROP POLICY IF EXISTS {policy} ON wims.analytics_incident_facts")
