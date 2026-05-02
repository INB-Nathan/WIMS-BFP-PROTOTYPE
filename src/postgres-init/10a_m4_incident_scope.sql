-- M4 incident scope update:
-- 1) Encoders operate on incidents they own (encoder_id = current_user_uuid())
-- 2) NATIONAL_VALIDATOR has cross-region read/write for verification workflow
-- 3) SYSTEM_ADMIN/NATIONAL_ANALYST retain global visibility

-- fire_incidents
DROP POLICY IF EXISTS fire_incidents_select ON wims.fire_incidents;
DROP POLICY IF EXISTS fire_incidents_insert ON wims.fire_incidents;
DROP POLICY IF EXISTS fire_incidents_update ON wims.fire_incidents;
DROP POLICY IF EXISTS fire_incidents_delete ON wims.fire_incidents;

CREATE POLICY fire_incidents_select
ON wims.fire_incidents
FOR SELECT
USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'NATIONAL_VALIDATOR')
  OR encoder_id = wims.current_user_uuid()
);

CREATE POLICY fire_incidents_insert
ON wims.fire_incidents
FOR INSERT
WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_VALIDATOR')
  OR (
    wims.current_user_role() IN ('REGIONAL_ENCODER', 'ENCODER')
    AND encoder_id = wims.current_user_uuid()
  )
);

CREATE POLICY fire_incidents_update
ON wims.fire_incidents
FOR UPDATE
USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_VALIDATOR')
  OR encoder_id = wims.current_user_uuid()
)
WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_VALIDATOR')
  OR encoder_id = wims.current_user_uuid()
);

CREATE POLICY fire_incidents_delete
ON wims.fire_incidents
FOR DELETE
USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN')
  OR encoder_id = wims.current_user_uuid()
);

-- incident_nonsensitive_details
DROP POLICY IF EXISTS incident_nonsensitive_details_region_select ON wims.incident_nonsensitive_details;
DROP POLICY IF EXISTS incident_nonsensitive_details_owner_select ON wims.incident_nonsensitive_details;
DROP POLICY IF EXISTS incident_nonsensitive_details_region_insert ON wims.incident_nonsensitive_details;
DROP POLICY IF EXISTS incident_nonsensitive_details_owner_insert ON wims.incident_nonsensitive_details;
DROP POLICY IF EXISTS incident_nonsensitive_details_region_update ON wims.incident_nonsensitive_details;
DROP POLICY IF EXISTS incident_nonsensitive_details_owner_update ON wims.incident_nonsensitive_details;
DROP POLICY IF EXISTS incident_nonsensitive_details_region_delete ON wims.incident_nonsensitive_details;
DROP POLICY IF EXISTS incident_nonsensitive_details_owner_delete ON wims.incident_nonsensitive_details;

CREATE POLICY incident_nonsensitive_details_owner_select
ON wims.incident_nonsensitive_details
FOR SELECT
USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.incident_nonsensitive_details.incident_id
      AND fi.encoder_id = wims.current_user_uuid()
  )
);

CREATE POLICY incident_nonsensitive_details_owner_insert
ON wims.incident_nonsensitive_details
FOR INSERT
WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.incident_nonsensitive_details.incident_id
      AND fi.encoder_id = wims.current_user_uuid()
  )
);

CREATE POLICY incident_nonsensitive_details_owner_update
ON wims.incident_nonsensitive_details
FOR UPDATE
USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.incident_nonsensitive_details.incident_id
      AND fi.encoder_id = wims.current_user_uuid()
  )
)
WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.incident_nonsensitive_details.incident_id
      AND fi.encoder_id = wims.current_user_uuid()
  )
);

CREATE POLICY incident_nonsensitive_details_owner_delete
ON wims.incident_nonsensitive_details
FOR DELETE
USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.incident_nonsensitive_details.incident_id
      AND fi.encoder_id = wims.current_user_uuid()
  )
);

-- incident_sensitive_details
DROP POLICY IF EXISTS incident_sensitive_details_region_select ON wims.incident_sensitive_details;
DROP POLICY IF EXISTS incident_sensitive_details_owner_select ON wims.incident_sensitive_details;
DROP POLICY IF EXISTS incident_sensitive_details_region_insert ON wims.incident_sensitive_details;
DROP POLICY IF EXISTS incident_sensitive_details_owner_insert ON wims.incident_sensitive_details;
DROP POLICY IF EXISTS incident_sensitive_details_region_update ON wims.incident_sensitive_details;
DROP POLICY IF EXISTS incident_sensitive_details_owner_update ON wims.incident_sensitive_details;
DROP POLICY IF EXISTS incident_sensitive_details_region_delete ON wims.incident_sensitive_details;
DROP POLICY IF EXISTS incident_sensitive_details_owner_delete ON wims.incident_sensitive_details;

CREATE POLICY incident_sensitive_details_owner_select
ON wims.incident_sensitive_details
FOR SELECT
USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_ANALYST', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.incident_sensitive_details.incident_id
      AND fi.encoder_id = wims.current_user_uuid()
  )
);

CREATE POLICY incident_sensitive_details_owner_insert
ON wims.incident_sensitive_details
FOR INSERT
WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.incident_sensitive_details.incident_id
      AND fi.encoder_id = wims.current_user_uuid()
  )
);

CREATE POLICY incident_sensitive_details_owner_update
ON wims.incident_sensitive_details
FOR UPDATE
USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.incident_sensitive_details.incident_id
      AND fi.encoder_id = wims.current_user_uuid()
  )
)
WITH CHECK (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.incident_sensitive_details.incident_id
      AND fi.encoder_id = wims.current_user_uuid()
  )
);

CREATE POLICY incident_sensitive_details_owner_delete
ON wims.incident_sensitive_details
FOR DELETE
USING (
  wims.current_user_role() IN ('SYSTEM_ADMIN', 'NATIONAL_VALIDATOR')
  OR EXISTS (
    SELECT 1 FROM wims.fire_incidents fi
    WHERE fi.incident_id = wims.incident_sensitive_details.incident_id
      AND fi.encoder_id = wims.current_user_uuid()
  )
);
