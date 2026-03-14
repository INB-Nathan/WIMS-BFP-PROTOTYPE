-- Migration: Add NHQ Users to wims.users
-- Description: Links provided Auth UUIDs to wims.users with NHQ roles (NULL region).

-- Encoder: ac90c0e1-a5a6-4332-bab1-d817cc484243
INSERT INTO wims.users (user_id, username, role, assigned_region_id, is_active)
VALUES (
    'ac90c0e1-a5a6-4332-bab1-d817cc484243',
    'nhq_encoder',
    'ENCODER',
    NULL, -- NULL means NHQ / National Scope
    TRUE
)
ON CONFLICT (user_id) DO UPDATE
SET role = 'ENCODER', assigned_region_id = NULL;

-- Validator: 0231f88d-a873-46e2-91d5-8b48de9eb8d9
INSERT INTO wims.users (user_id, username, role, assigned_region_id, is_active)
VALUES (
    '0231f88d-a873-46e2-91d5-8b48de9eb8d9',
    'nhq_validator',
    'VALIDATOR',
    NULL, -- NULL means NHQ / National Scope
    TRUE
)
ON CONFLICT (user_id) DO UPDATE
SET role = 'VALIDATOR', assigned_region_id = NULL;
