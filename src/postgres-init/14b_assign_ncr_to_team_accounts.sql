-- Assign NCR (region_code = 'NCR') to team member encoder and validator accounts.
-- Mirrors 14a_assign_ncr_to_test_users.sql — runs after 14_seed_ncr.sql.
-- Idempotent: safe to re-run.

UPDATE wims.users
SET assigned_region_id = (
    SELECT region_id FROM wims.ref_regions WHERE region_code = 'NCR' LIMIT 1
)
WHERE username IN (
    'n-val', 'n-enc',
    'g-val', 'g-enc',
    'e-val', 'e-enc',
    'r-val', 'r-enc'
)
  AND (
    assigned_region_id IS NULL
    OR assigned_region_id != (
        SELECT region_id FROM wims.ref_regions WHERE region_code = 'NCR' LIMIT 1
    )
  );
