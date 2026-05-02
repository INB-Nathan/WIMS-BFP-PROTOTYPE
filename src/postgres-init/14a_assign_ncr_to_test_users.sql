-- Ensure test encoder and validator users are assigned to NCR.
-- Idempotent: safe to re-run.

UPDATE wims.users
SET assigned_region_id = (
    SELECT region_id FROM wims.ref_regions WHERE region_code = 'NCR' LIMIT 1
)
WHERE username IN ('encoder_test', 'validator_test')
  AND (
    assigned_region_id IS NULL
    OR assigned_region_id != (
        SELECT region_id FROM wims.ref_regions WHERE region_code = 'NCR' LIMIT 1
    )
  );
