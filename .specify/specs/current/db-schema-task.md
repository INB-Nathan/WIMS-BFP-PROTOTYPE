# WIMS-BFP Database Schema Specification
**Status:** DRAFT
**Domain:** PostgreSQL Data Layer

## 1. Identity & Actors (wims.users)
- `user_id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `keycloak_id UUID UNIQUE NOT NULL`
- `username VARCHAR(50) NOT NULL UNIQUE`
- `role VARCHAR(20) NOT NULL CHECK (role IN ('ENCODER', 'VALIDATOR', 'ANALYST', 'ADMIN', 'SYSTEM_ADMIN'))`

## 2. Verified Incidents (wims.fire_incidents)
- `incident_id SERIAL PRIMARY KEY`
- `location GEOGRAPHY(POINT, 4326) NOT NULL`
- `encoder_id UUID REFERENCES wims.users(user_id)`
- `verification_status VARCHAR(20) DEFAULT 'DRAFT' CHECK (verification_status IN ('DRAFT', 'PENDING', 'VERIFIED', 'REJECTED'))`
- `is_archived BOOLEAN DEFAULT FALSE`

## 3. Community Triage (wims.citizen_reports)
- `report_id SERIAL PRIMARY KEY`
- `location GEOGRAPHY(POINT, 4326) NOT NULL`
- `status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'VERIFIED', 'FALSE_ALARM', 'DUPLICATE'))`
- `trust_score INTEGER DEFAULT 0 CHECK (trust_score >= -100 AND trust_score <= 100)`
- `validated_by UUID REFERENCES wims.users(user_id) NULL`
- `verified_incident_id INTEGER REFERENCES wims.fire_incidents(incident_id) NULL`
- **Cardinality:** Many-to-One (Multiple reports can link to one official incident).
- **Validation Rule:** `validated_by` MUST be populated via application logic before `status` transitions out of 'PENDING'.

## 4. Forensic Audit & Security
- **wims.incident_verification_history:**
  - Captures status changes for BOTH `fire_incidents` and `citizen_reports`.
  - `history_id SERIAL PRIMARY KEY`
  - `target_type VARCHAR(20) NOT NULL CHECK (target_type IN ('OFFICIAL', 'CITIZEN'))`
  - `target_id INTEGER NOT NULL`
  - `action_by_user_id UUID NOT NULL REFERENCES wims.users(user_id)`
  - `previous_status VARCHAR(20)`, `new_status VARCHAR(20) NOT NULL`
  - `action_timestamp TIMESTAMPTZ NOT NULL DEFAULT now()`

- **wims.security_threat_logs:**
  - `log_id BIGSERIAL PRIMARY KEY`
  - `event_timestamp TIMESTAMPTZ NOT NULL DEFAULT now()`
  - `source_ip VARCHAR(45) NOT NULL` (Supports up to IPv6 lengths)
  - `suricata_sid INTEGER NULL CHECK (suricata_sid > 0)` (Must be a positive integer)
  - `severity_level VARCHAR(10) NOT NULL CHECK (severity_level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'))`
  - `raw_payload VARCHAR(65535) NULL` (Hard boundary to prevent oversized payload DoS)
  - `xai_narrative VARCHAR(10000) NULL` (Hard boundary for Qwen2.5-3B text generation limit)