-- FCM push notification opt-in tokens for citizen reports.
-- Zero-trust table: no user identity, keyed only by report_id + fcm_token.
-- UNIQUE(report_id, fcm_token) blocks exact duplicates but allows multiple
-- devices per report (user opens on phone + desktop).

BEGIN;

CREATE TABLE IF NOT EXISTS wims.report_notification_tokens (
    token_id   SERIAL PRIMARY KEY,
    report_id  INTEGER NOT NULL
               REFERENCES wims.citizen_reports(report_id) ON DELETE CASCADE,
    fcm_token  TEXT    NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_report_notification_token UNIQUE (report_id, fcm_token)
);

CREATE INDEX IF NOT EXISTS idx_rnt_report_id
    ON wims.report_notification_tokens (report_id);

COMMIT;
