# WIMS-BFP — Web-based Incident Management System for the Bureau of Fire Protection

A full-stack incident management platform for the Philippine Bureau of Fire Protection (BFP), featuring crowdsourced fire report triage, geospatial incident tracking, Keycloak OIDC authentication, AI-powered security threat analysis, and Suricata-based intrusion detection.

## Documentation

- [Architecture Overview](docs/ARCHITECTURE.md) — system stack, data flow, Docker services, auth flow
- [API & Function Reference](docs/API_AND_FUNCTIONS.md) — backend endpoints, edge functions, frontend pages
- [Changelog](CHANGELOG.md) — version history and notable changes

## Project Layout

Primary implementation lives under `src/`:

- `src/frontend` — Next.js app (App Router); static AFOR templates under `src/frontend/public/templates/` (e.g. structural and wildland `.xlsx` files linked from `/afor/import` and `/afor/create`)
- `src/backend` — FastAPI API + Celery task modules
- `src/postgres-init` — PostgreSQL bootstrap SQL
- `src/keycloak` — realm import configuration
- `src/docker-compose.yml` — local multi-service orchestration

## Prerequisites

- **Docker** and **Docker Compose** (v3.8+)
- **Node.js** 18+ (for local frontend development)
- **Python** 3.10+ (for local backend development)
- **Git**

## Quick Start

1. **Clone the repository:**
   ```bash
   git clone https://github.com/INB-Nathan/WIMS-BFP-PROTOTYPE.git
   cd WIMS-BFP-PROTOTYPE
   ```

2. **Configure environment variables:**
   Copy the example env file if provided, or verify the dev defaults in `src/docker-compose.yml`.
   The Docker Compose file uses development placeholders — never use these in production.

3. **Start all services:**
   ```bash
   cd src
   docker compose up --build
   ```

4. **Access the application:**
   - **Frontend:** http://localhost
   - **Keycloak Admin:** http://localhost/auth (admin / admin)
   - **Backend API:** http://localhost/api

## Rebuilding Docker containers

Use this after changing Dockerfiles, `requirements.txt`, `package.json`, or when you want a clean image rebuild (not just restarting containers).

**Rebuild all application images and recreate containers:**
```bash
cd src
docker compose build --no-cache
docker compose up -d
```

**Shorter option** (rebuild images that changed, then start):
```bash
cd src
docker compose up --build -d
```

To stop the stack: `docker compose down` (add `-v` only if you intend to drop named volumes such as Postgres data).

## Environment Variables

All service configuration is managed through `src/docker-compose.yml` environment blocks. Key variables:

| Variable | Service | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | backend, celery | PostgreSQL connection string |
| `KEYCLOAK_REALM_URL` | backend | Keycloak OIDC realm endpoint |
| `KEYCLOAK_CLIENT_ID` | backend | OIDC client identifier |
| `REDIS_URL` | backend, celery | Redis broker for Celery and rate limiting |
| `OLLAMA_URL` | backend | Local LLM inference endpoint |
| `NEXT_PUBLIC_API_URL` | frontend | Backend API base URL (browser-resolvable) |
| `NEXT_PUBLIC_OIDC_AUTHORITY` | frontend | Keycloak realm URL for OIDC |

## Project Structure

```
src/
├── backend/          # FastAPI + Celery
├── frontend/         # Next.js (App Router)
├── postgres-init/    # DB initialization scripts (`01` + thin `02` + seed)
├── keycloak/         # Realm import configuration
├── suricata/         # IDS rules and logs
├── nginx/            # Reverse proxy configuration
└── docker-compose.yml
```

## Testing

**Backend (inside Docker or with dependencies installed):**
```bash
cd src/backend
pytest -v
```

**Frontend tests (Vitest):**
```bash
cd src/frontend
npx vitest run
```

**Frontend lint (ESLint):**
```bash
cd src/frontend
npm run lint
```

## Security Architecture

> ⚠️ This system is a **capstone prototype** — not used for real emergency operations.

### Encryption at Rest

- **AES-256-GCM (active):** PII fields in `wims.incident_sensitive_details` — specifically `caller_name`, `caller_number`, `owner_name`, and `occupant_name` — are encrypted at rest via AES-256-GCM blob (`pii_blob_enc`) with a 12-byte nonce (`encryption_iv`), bound to each record via Additional Authenticated Data (AAD = `incident_id`). Plaintext columns are always `NULL` for new writes. Key is loaded from the `WIMS_MASTER_KEY` environment variable at backend startup.
- **Fail-closed read path:** If decryption fails for a row that claims to have a blob, the system logs a `CRITICAL` event with `incident_id` only (never nonce, ciphertext, or plaintext) and falls back to legacy plaintext columns.
- **Key generation:** `python3 -c "import secrets,base64; print(base64.b64encode(secrets.token_bytes(32)).decode())"`

### Authentication & Authorization

- Keycloak OIDC/PKCE — JWT tokens with role-based access (`SYSTEM_ADMIN`, `NATIONAL_ANALYST`, `REGIONAL_ENCODER`, `VALIDATOR`, `ENCODER`)
- Rate limiting: Redis sliding-window on `POST /api/auth/login` (5 requests / 15 minutes per IP)
- OTP required for admin and validator roles on trusted-device login (7-day window)

### OWASP ASVS Alignment (Level 2 target)

Session management, input validation, output encoding, cryptography, and access controls implemented per OWASP ASVS L2 where applicable. Formal ASVS L2 audit is pending.

## License

This project is developed for academic and government use by the Bureau of Fire Protection.
