# WIMS-BFP System Constitution

## 1. Core Architectural Mandates
- **Hybrid Single-Segmented VPS:** The system operates on a single VPS with strict logical isolation. The public edge (Next.js public routes) and the Sovereign Core (FastAPI, PostGIS, Keycloak, AI) MUST remain firewalled via Docker networks and Nginx.
- **Offline-First Resilience:** The Next.js PWA for internal users MUST prioritize local persistence using `Dexie.js` and Service Workers. Network failure is a standard state, not an exception.
- **Zero-Trust Enforcement:** Every backend API route MUST be protected by Keycloak JSON Web Tokens (JWT). There is no "internal trust."

## 2. Tech Stack Boundaries
- **Frontend:** Next.js (React), TypeScript, TailwindCSS, Dexie.js (Offline storage), Leaflet/Mapbox (Geospatial).
- **Backend:** FastAPI (Python), SQLAlchemy + GeoAlchemy2 (ORM), Celery + Redis (Async Task Queue).
- **Database:** PostgreSQL with the PostGIS extension.
- **Security & IAM:** Keycloak (RBAC/OIDC), Suricata (IDS logging), AES-256-GCM (Offline bundle encryption).
- **AI/ML:** Locally hosted Qwen2.5-3B via Ollama. 

## 3. Immutable Engineering Rules
- **No Hard Deletes:** Data is never destroyed. All database schemas MUST implement soft-deletes (`deleted_at` timestamp).
- **Strict Role Boundaries:** Do not mix user capabilities. The `National Validator` is the ONLY role authorized to alter the `is_verified` status of an incident.
- **Asynchronous Heavy Lifting:** Any process taking > 500ms (e.g., PostGIS complex geospatial clustering, AI narrative generation, bulk CSV parsing) MUST be offloaded to Celery workers.
- **Explainability, Not Autonomy:** The AI (Qwen2.5) is strictly an *Explainable AI (XAI)* for human-in-the-loop (HITL) diagnostics. It CANNOT execute code, block IP addresses, or alter database states.
- **RA 10173 Compliance:** PII (Personally Identifiable Information) from Civilian Reporters must be minimized, encrypted at rest, and subjected to PostgreSQL Row-Level Security (RLS).