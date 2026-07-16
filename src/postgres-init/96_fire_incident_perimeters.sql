-- 96_fire_incident_perimeters.sql
-- Manually-drawn fire perimeters (National Validator only) + civilian report -> incident
-- junction + trigger-based TSTZRANGE edit-history audit trail.
-- Dependencies: 04_import_incidents.sql (wims.fire_incidents), 05_citizen_reports.sql
--               (wims.citizen_reports), 03_users.sql (wims.users)
-- Idempotent: YES
--
-- Scope:
--   * wims.fire_incident_perimeters        : one active perimeter per incident
--   * wims.fire_incident_civilian_links    : junction linking civilian reports to
--                                            validated fire incidents
--   * wims.fire_incident_perimeters_history: append-only TSTZRANGE history of the
--                                            live perimeter table (audit trail)
--
-- Perimeter geometry is GEOGRAPHY(POLYGON, 4326) to mirror fire_incidents.location
-- (GEOGRAPHY(POINT, 4326)). gis_acres is computed from ST_Area on write and may be NULL.

BEGIN;

-- ─── fire_incident_perimeters ──────────────────────────────────────────────────
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

-- ─── fire_incident_civilian_links (junction) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS wims.fire_incident_civilian_links (
    incident_id INTEGER NOT NULL REFERENCES wims.fire_incidents(incident_id),
    report_id   INTEGER NOT NULL REFERENCES wims.citizen_reports(report_id),
    linked_by   UUID REFERENCES wims.users(user_id),
    linked_at   TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (incident_id, report_id)
);

CREATE INDEX IF NOT EXISTS idx_fire_incident_civilian_links_report
    ON wims.fire_incident_civilian_links (report_id);

-- ─── fire_incident_perimeters_history (audit trail) ────────────────────────────
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

-- ─── history trigger function (PostGIS workshop TSTZRANGE pattern) ─────────────
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
        -- Close the currently-open row for this perimeter.
        UPDATE wims.fire_incident_perimeters_history
        SET valid_range = tstzrange(lower(valid_range), now())
        WHERE perimeter_id = OLD.perimeter_id
          AND upper_inf(valid_range);
        -- Open a new row mirroring the updated live row.
        INSERT INTO wims.fire_incident_perimeters_history (
            perimeter_id, incident_id, perimeter, gis_acres, map_method,
            created_by, created_at, valid_range, deleted_by
        ) VALUES (
            NEW.perimeter_id, NEW.incident_id, NEW.perimeter, NEW.gis_acres, NEW.map_method,
            NEW.created_by, NEW.created_at, tstzrange(now(), NULL), NULL
        );
        RETURN NEW;
    ELSIF (TG_OP = 'DELETE') THEN
        -- Close the currently-open row and record who deleted it.
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

-- ─── RLS ───────────────────────────────────────────────────────────────────────
-- fire_incident_perimeters: read NATIONAL_VALIDATOR, SYSTEM_ADMIN, REGIONAL_ENCODER;
--                           write NATIONAL_VALIDATOR, SYSTEM_ADMIN.
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

-- fire_incident_civilian_links: read NATIONAL_VALIDATOR, SYSTEM_ADMIN, REGIONAL_ENCODER;
--                               write (insert/delete) NATIONAL_VALIDATOR, SYSTEM_ADMIN.
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

-- fire_incident_perimeters_history: auditors read only; immutable (no write policies).
ALTER TABLE wims.fire_incident_perimeters_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE wims.fire_incident_perimeters_history FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fire_incident_perimeters_history_select ON wims.fire_incident_perimeters_history;
CREATE POLICY fire_incident_perimeters_history_select ON wims.fire_incident_perimeters_history
    FOR SELECT USING (
        wims.current_user_role() IN ('NATIONAL_VALIDATOR', 'SYSTEM_ADMIN')
    );

COMMIT;
