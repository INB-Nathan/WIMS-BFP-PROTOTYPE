-- ---------------------------------------------------------------------------
-- 05_analytics_facts_expand.sql
-- Expand analytics_incident_facts with casualty, damage, and locality columns.
-- Create materialized views for analytics dashboards.
-- ---------------------------------------------------------------------------

-- Expand analytics_incident_facts
ALTER TABLE wims.analytics_incident_facts
  ADD COLUMN IF NOT EXISTS civilian_injured INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS civilian_deaths INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS firefighter_injured INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS firefighter_deaths INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_response_time_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS estimated_damage_php NUMERIC,
  ADD COLUMN IF NOT EXISTS fire_station_name TEXT,
  ADD COLUMN IF NOT EXISTS barangay_name TEXT;

CREATE INDEX IF NOT EXISTS idx_aif_barangay_name ON wims.analytics_incident_facts (barangay_name);
CREATE INDEX IF NOT EXISTS idx_aif_fire_station  ON wims.analytics_incident_facts (fire_station_name);

-- Materialized View: daily incident counts by region, type, alarm
CREATE MATERIALIZED VIEW IF NOT EXISTS wims.mv_incident_counts_daily AS
SELECT
  notification_date,
  region_id,
  general_category,
  alarm_level,
  COUNT(*) AS incident_count
FROM wims.analytics_incident_facts
WHERE notification_date IS NOT NULL
GROUP BY notification_date, region_id, general_category, alarm_level;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_daily_unique
  ON wims.mv_incident_counts_daily (notification_date, region_id, general_category, alarm_level);

-- Materialized View: incidents aggregated by region
CREATE MATERIALIZED VIEW IF NOT EXISTS wims.mv_incident_by_region AS
SELECT
  region_id,
  COUNT(*) AS total_incidents,
  AVG(total_response_time_minutes) AS avg_response_time,
  MIN(total_response_time_minutes) AS min_response_time,
  MAX(total_response_time_minutes) AS max_response_time
FROM wims.analytics_incident_facts
GROUP BY region_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_region_unique
  ON wims.mv_incident_by_region (region_id);

-- Materialized View: incidents by barangay
CREATE MATERIALIZED VIEW IF NOT EXISTS wims.mv_incident_by_barangay AS
SELECT
  barangay_name,
  COUNT(*) AS incident_count
FROM wims.analytics_incident_facts
WHERE barangay_name IS NOT NULL
GROUP BY barangay_name;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_barangay_unique
  ON wims.mv_incident_by_barangay (barangay_name);

-- Materialized View: incident type distribution
CREATE MATERIALIZED VIEW IF NOT EXISTS wims.mv_incident_type_distribution AS
SELECT
  general_category,
  COUNT(*) AS incident_count
FROM wims.analytics_incident_facts
WHERE general_category IS NOT NULL
GROUP BY general_category;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_type_unique
  ON wims.mv_incident_type_distribution (general_category);
