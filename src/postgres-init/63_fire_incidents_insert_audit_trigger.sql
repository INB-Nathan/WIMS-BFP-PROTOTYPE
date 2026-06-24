-- 63_fire_incidents_insert_audit_trigger.sql
-- RP-20: detect direct-database INSERT into wims.fire_incidents.
-- When an INSERT occurs WITHOUT the app.audit_source GUC set to 'app' (i.e. via
-- psql, an admin tool, or any path that bypasses get_db / get_db_with_rls),
-- the trigger records a DIRECT_DB_INSERT row in wims.system_audit_trails.
-- Idempotent: CREATE OR REPLACE FUNCTION + DROP/CREATE TRIGGER.

CREATE OR REPLACE FUNCTION wims.detect_direct_fire_incident_insert()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = wims, pg_catalog
AS $$
BEGIN
  -- GUC 'app.audit_source' = 'app' means the INSERT came through a trusted
  -- application session (get_db / get_db_with_rls).  Skip the audit row.
  IF current_setting('app.audit_source', true) = 'app' THEN
    RETURN NEW;
  END IF;

  INSERT INTO wims.system_audit_trails (
    user_id,
    action_type,
    table_affected,
    record_id,
    ip_address,
    user_agent,
    new_values,
    result
  ) VALUES (
    NULL,
    'DIRECT_DB_INSERT',
    'wims.fire_incidents',
    NEW.incident_id,
    NULL,
    NULL,
    jsonb_build_object(
      'incident_id', NEW.incident_id,
      'region_id',   NEW.region_id
    ),
    'success'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_detect_direct_fire_incident_insert ON wims.fire_incidents;

CREATE TRIGGER trg_detect_direct_fire_incident_insert
  AFTER INSERT ON wims.fire_incidents
  FOR EACH ROW
  EXECUTE FUNCTION wims.detect_direct_fire_incident_insert();
