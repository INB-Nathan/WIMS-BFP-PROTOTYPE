-- 84_photo_idempotency_key.sql
-- Civilian Photo Enhancement Phase D — client_photo_id for idempotent retry.
-- Adds a UUID column that the client generates before upload. The partial
-- unique index guarantees that only rows with a non-null client_photo_id
-- are checked for duplicate detection, so legacy uploads without one are
-- unaffected.
--
-- Used by the offline sync engine to replay photo uploads safely: if the
-- server already has a photo with the same client_photo_id, the INSERT
-- silently becomes a no-op (ON CONFLICT DO NOTHING) and RETURNING returns
-- NULL, signalling "this was a duplicate".
--
-- Dependencies: 83_photo_exif_metadata.sql (table must have EXIF columns)
--
-- Idempotent: YES (uses IF NOT EXISTS)

BEGIN;

ALTER TABLE wims.report_photos ADD COLUMN IF NOT EXISTS client_photo_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_report_photos_client_id
    ON wims.report_photos(client_photo_id)
    WHERE client_photo_id IS NOT NULL;

COMMENT ON COLUMN wims.report_photos.client_photo_id IS
  'Client-generated UUID for idempotent retry. Unique only when non-null.';

COMMIT;
