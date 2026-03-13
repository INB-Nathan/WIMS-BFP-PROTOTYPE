# WIMS-BFP System Constitution
**Version:** 1.0
**Enforcement:** STRICT (All AI agents must abide by these rules).

## 1. Stack & Infrastructure
- **Frontend:** Next.js (App Router), React, TailwindCSS.
- **Backend:** FastAPI (Python 3.10+).
- **Database:** PostgreSQL with PostGIS extension.
- **Authentication:** Keycloak (OIDC/JWT). **SUPABASE IS STRICTLY FORBIDDEN.**
- **AI/ML:** Qwen2.5-3B via local inference (Ollama/llama.cpp).

## 2. Data Integrity & Forensics (The Immutability Law)
- **NO HARD DELETES:** Records in core tables (`fire_incidents`, `users`, `security_threat_logs`) must never be DELETEd. Use `is_archived = TRUE` or a `status` enum to logically remove records.
- **Chain of Custody:** Every state change in a verification workflow must log the `user_id` of the actor.

## 3. Geospatial Mandate
- Any table representing a physical event (citizen reports, fire incidents) MUST use PostGIS `GEOGRAPHY(POINT, 4326)` for coordinates. String-based location approximations are invalid.

## 4. Agentic Workflow (Tier 3)
- No code shall be generated without a passing Spec Audit (`@reviewer`).
- No implementation shall be written without a failing test (`@qa-agent`).