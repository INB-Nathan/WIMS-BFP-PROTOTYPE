"""Add fire-incident perimeters, civilian report links, and perimeter history.

Wayfinder ticket #634: manually-drawn fire perimeters (National Validator only)
with full TSTZRANGE edit history, plus a junction table linking civilian reports
to validated fire incidents.

Revision ID: 0021
Revises: 0020
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "0021"
down_revision: Union[str, None] = "0020"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS wims.fire_incident_perimeters (
            perimeter_id SERIAL PRIMARY KEY,
            incident_id  INTEGER NOT NULL REFERENCES wims.fire_incidents(incident_id),
            perimeter    GEOGRAPHY(POLYGON, 4326) NOT NULL,
            gis_acres    DOUBLE PRECISION,
            map_method   VARCHAR(25) CHECK (
                map_method IN (
                    'GPS-Driven',
                    'GPS-Flight',
                    'GPS-Walked',
                    'GPS-Walked/Driven',
                    'GPS-Unknown',
                    'Hand-Sketch',
                    'Digitized-Image',
                    'Digitized-Topo',
                    'Digitized-Other',
                    'Image-Interpretation',
                    'Infrared-Image',
                    'Modeled',
                    'Mixed-Methods',
                    'Remote-Sensing-Derived',
                    'Survey/GCDB/Cadastral',
                    'Vector',
                    'Phone/Tablet',
                    'Other'
                )
            ),
            created_by   UUID REFERENCES wims.users(user_id),
            created_at   TIMESTAMPTZ DEFAULT now(),
            updated_at   TIMESTAMPTZ DEFAULT now(),
            UNIQUE (incident_id)
        );

        CREATE INDEX IF NOT EXISTS idx_fire_incident_perimeters_perimeter
            ON wims.fire_incident_perimeters USING GIST (perimeter);
        CREATE INDEX IF NOT EXISTS idx_fire_incident_perimeters_incident
            ON wims.fire_incident_perimeters (incident_id);

        CREATE TABLE IF NOT EXISTS wims.fire_incident_civilian_links (
            incident_id INTEGER NOT NULL REFERENCES wims.fire_incidents(incident_id),
            report_id   INTEGER NOT NULL REFERENCES wims.citizen_reports(report_id),
            linked_by   UUID REFERENCES wims.users(user_id),
            linked_at   TIMESTAMPTZ DEFAULT now(),
            PRIMARY KEY (incident_id, report_id)
        );

        CREATE INDEX IF NOT EXISTS idx_fire_incident_civilian_links_report
            ON wims.fire_incident_civilian_links (report_id);

        CREATE TABLE IF NOT EXISTS wims.fire_incident_perimeters_history (
            history_id   BIGSERIAL PRIMARY KEY,
            perimeter_id INTEGER NOT NULL,
            incident_id  INTEGER NOT NULL,
            perimeter    GEOGRAPHY(POLYGON, 4326),
            gis_acres    DOUBLE PRECISION,
            map_method   VARCHAR(25),
            created_by   UUID,
            created_at   TIMESTAMPTZ,
            valid_range  TSTZRANGE NOT NULL,
            deleted_by   UUID REFERENCES wims.users(user_id)
        );

        CREATE INDEX IF NOT EXISTS idx_fire_incident_perimeters_history_perimeter
            ON wims.fire_incident_perimeters_history USING GIST (perimeter);
        CREATE INDEX IF NOT EXISTS idx_fire_incident_perimeters_history_id
            ON wims.fire_incident_perimeters_history (perimeter_id);
        CREATE INDEX IF NOT EXISTS idx_fire_incident_perimeters_history_range
            ON wims.fire_incident_perimeters_history USING GIST (valid_range);

        CREATE OR REPLACE FUNCTION wims.fire_incident_perimeters_history_trigger()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            IF (TG_OP = 'INSERT') THEN
                INSERT INTO wims.fire_incident_perimeters_history (
                    perimeter_id, incident_id, perimeter, gis_acres, map_method,
                    created_by, created_at, valid_range, deleted_by
                ) VALUES (
                    NEW.perimeter_id, NEW.incident_id, NEW.perimeter, NEW.gis_acres, NEW.map_method,
                    NEW.created_by, NEW.created_at, tstzrange(now(), NULL), NULL
                );
                RETURN NEW;
            ELSIF (TG_OP = 'UPDATE') THEN
                UPDATE wims.fire_incident_perimeters_history
                SET valid_range = tstzrange(lower(valid_range), now())
                WHERE perimeter_id = OLD.perimeter_id
                  AND upper_inf(valid_range);
                INSERT INTO wims.fire_incident_perimeters_history (
                    perimeter_id, incident_id, perimeter, gis_acres, map_method,
                    created_by, created_at, valid_range, deleted_by
                ) VALUES (
                    NEW.perimeter_id, NEW.incident_id, NEW.perimeter, NEW.gis_acres, NEW.map_method,
                    NEW.created_by, NEW.created_at, tstzrange(now(), NULL), NULL
                );
                RETURN NEW;
            ELSIF (TG_OP = 'DELETE') THEN
                UPDATE wims.fire_incident_perimeters_history
                SET valid_range = tstzrange(lower(valid_range), now()),
                    deleted_by  = OLD.created_by
                WHERE perimeter_id = OLD.perimeter_id
                  AND upper_inf(valid_range);
                RETURN OLD;
            END IF;
            RETURN NULL;
        END;
        $$;

        DROP TRIGGER IF EXISTS fire_incident_perimeters_history_trg
            ON wims.fire_incident_perimeters;
        CREATE TRIGGER fire_incident_perimeters_history_trg
            AFTER INSERT OR UPDATE OR DELETE ON wims.fire_incident_perimeters
            FOR EACH ROW
            EXECUTE FUNCTION wims.fire_incident_perimeters_history_trigger();

        ALTER TABLE wims.fire_incident_perimeters ENABLE ROW LEVEL SECURITY;
        ALTER TABLE wims.fire_incident_perimeters FORCE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS fire_incident_perimeters_select ON wims.fire_incident_perimeters;
        CREATE POLICY fire_incident_perimeters_select ON wims.fire_incident_perimeters
            FOR SELECT USING (
                wims.current_user_role() IN ('NATIONAL_VALIDATOR', 'SYSTEM_ADMIN', 'REGIONAL_ENCODER')
            );

        DROP POLICY IF EXISTS fire_incident_perimeters_insert ON wims.fire_incident_perimeters;
        CREATE POLICY fire_incident_perimeters_insert ON wims.fire_incident_perimeters
            FOR INSERT WITH CHECK (
                wims.current_user_role() IN ('NATIONAL_VALIDATOR', 'SYSTEM_ADMIN')
            );

        DROP POLICY IF EXISTS fire_incident_perimeters_update ON wims.fire_incident_perimeters;
        CREATE POLICY fire_incident_perimeters_update ON wims.fire_incident_perimeters
            FOR UPDATE WITH CHECK (
                wims.current_user_role() IN ('NATIONAL_VALIDATOR', 'SYSTEM_ADMIN')
            );

        DROP POLICY IF EXISTS fire_incident_perimeters_delete ON wims.fire_incident_perimeters;
        CREATE POLICY fire_incident_perimeters_delete ON wims.fire_incident_perimeters
            FOR DELETE USING (
                wims.current_user_role() IN ('NATIONAL_VALIDATOR', 'SYSTEM_ADMIN')
            );

        ALTER TABLE wims.fire_incident_civilian_links ENABLE ROW LEVEL SECURITY;
        ALTER TABLE wims.fire_incident_civilian_links FORCE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS fire_incident_civilian_links_select ON wims.fire_incident_civilian_links;
        CREATE POLICY fire_incident_civilian_links_select ON wims.fire_incident_civilian_links
            FOR SELECT USING (
                wims.current_user_role() IN ('NATIONAL_VALIDATOR', 'SYSTEM_ADMIN', 'REGIONAL_ENCODER')
            );

        DROP POLICY IF EXISTS fire_incident_civilian_links_insert ON wims.fire_incident_civilian_links;
        CREATE POLICY fire_incident_civilian_links_insert ON wims.fire_incident_civilian_links
            FOR INSERT WITH CHECK (
                wims.current_user_role() IN ('NATIONAL_VALIDATOR', 'SYSTEM_ADMIN')
            );

        DROP POLICY IF EXISTS fire_incident_civilian_links_delete ON wims.fire_incident_civilian_links;
        CREATE POLICY fire_incident_civilian_links_delete ON wims.fire_incident_civilian_links
            FOR DELETE USING (
                wims.current_user_role() IN ('NATIONAL_VALIDATOR', 'SYSTEM_ADMIN')
            );

        ALTER TABLE wims.fire_incident_perimeters_history ENABLE ROW LEVEL SECURITY;
        ALTER TABLE wims.fire_incident_perimeters_history FORCE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS fire_incident_perimeters_history_select ON wims.fire_incident_perimeters_history;
        CREATE POLICY fire_incident_perimeters_history_select ON wims.fire_incident_perimeters_history
            FOR SELECT USING (
                wims.current_user_role() IN ('NATIONAL_VALIDATOR', 'SYSTEM_ADMIN')
            );
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TRIGGER IF EXISTS fire_incident_perimeters_history_trg
            ON wims.fire_incident_perimeters;
        DROP FUNCTION IF EXISTS wims.fire_incident_perimeters_history_trigger();

        DROP TABLE IF EXISTS wims.fire_incident_perimeters_history;
        DROP TABLE IF EXISTS wims.fire_incident_civilian_links;
        DROP TABLE IF EXISTS wims.fire_incident_perimeters;
        """
    )
