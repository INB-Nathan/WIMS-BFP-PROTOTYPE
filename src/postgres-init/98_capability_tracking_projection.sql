-- Capability-authorized civilian tracking projection.
-- Keeps anonymous citizen-report RLS strict while allowing a bearer capability
-- to read only its explicitly public tracking fields.

BEGIN;

CREATE FUNCTION wims.get_capability_tracking_projection(
    p_report_id INTEGER,
    p_token_hash TEXT
)
RETURNS TABLE (
    report_id INTEGER,
    category TEXT,
    sub_category TEXT,
    safety_status TEXT,
    status TEXT,
    created_at TIMESTAMPTZ,
    routing_distance_m DOUBLE PRECISION,
    routing_duration_s DOUBLE PRECISION,
    routing_data_source TEXT,
    routing_geometry JSONB,
    nearest_station_name TEXT,
    nearest_station_phone TEXT,
    photo_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = wims, pg_temp
AS $$
    SELECT cr.report_id,
           cr.category::TEXT,
           cr.sub_category::TEXT,
           cr.safety_status::TEXT,
           cr.status::TEXT,
           cr.created_at,
           cr.routing_distance_m,
           cr.routing_duration_s,
           cr.routing_data_source::TEXT,
           public.ST_AsGeoJSON(cr.routing_geometry)::jsonb,
           fs.station_name::TEXT,
           fs.phone::TEXT,
           (SELECT COUNT(*) FROM wims.report_photos rp WHERE rp.report_id = cr.report_id)
    FROM wims.report_tracking_tokens tt
    JOIN wims.citizen_reports cr ON cr.report_id = tt.report_id
    LEFT JOIN wims.ref_fire_stations fs ON fs.station_id = cr.nearest_station_id
    WHERE tt.report_id = p_report_id
      AND tt.token_hash = p_token_hash
      AND tt.is_active = TRUE
      AND tt.revoked_at IS NULL
      AND (tt.expires_at IS NULL OR tt.expires_at > now())
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION wims.get_capability_tracking_projection(INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wims.get_capability_tracking_projection(INTEGER, TEXT) TO wims_app;

COMMIT;
