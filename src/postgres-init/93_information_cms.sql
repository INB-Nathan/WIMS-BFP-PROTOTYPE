-- 93_information_cms.sql
-- CMS tables for civilian-facing announcements and emergency information.
--
-- These tables power the public Information page (announcements tab,
-- emergencies tab) as well as the landing-page ticker / emergency grid.
-- Public reads go through an admin-session endpoint; write access is
-- restricted to SYSTEM_ADMIN (announcements) and NATIONAL_VALIDATOR
-- (promote-from-incident) via the API layer.
--
-- Dependencies: 03_users.sql, postgis init (for incidents FK)
-- Idempotent: YES

BEGIN;

CREATE TABLE IF NOT EXISTS wims.information_announcements (
    id            SERIAL PRIMARY KEY,
    title         TEXT NOT NULL,
    body          TEXT NOT NULL,
    urgency       TEXT NOT NULL DEFAULT 'general'
                  CHECK (urgency IN ('urgent', 'advisory', 'general')),
    image_path    TEXT,
    published     BOOLEAN NOT NULL DEFAULT false,
    published_at  TIMESTAMPTZ,
    created_by    TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wims.information_emergencies (
    id                        SERIAL PRIMARY KEY,
    title                     TEXT NOT NULL,
    location                  TEXT NOT NULL,
    description               TEXT NOT NULL,
    severity                  TEXT NOT NULL DEFAULT 'moderate'
                              CHECK (severity IN ('critical', 'high', 'moderate', 'low')),
    status                    TEXT NOT NULL DEFAULT 'ongoing'
                              CHECK (status IN ('ongoing', 'contained', 'monitoring', 'resolved')),
    promoted_from_incident_id INTEGER REFERENCES wims.incidents(id),
    published                 BOOLEAN NOT NULL DEFAULT false,
    published_at              TIMESTAMPTZ,
    created_by                TEXT NOT NULL,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE
    ON wims.information_announcements TO wims_app;
GRANT SELECT, INSERT, UPDATE, DELETE
    ON wims.information_emergencies TO wims_app;

COMMIT;
