# infra Agent Instructions

## Docker Stack — 14 Services

| Service | Directory | Purpose |
|---------|-----------|---------|
| `postgres` | — | PostgreSQL 15 + PostGIS 3.4 |
| `redis` | — | Celery broker, rate limiting, session blacklist |
| `mailhog` | — | SMTP capture for dev (not for production) |
| `keycloak` | `keycloak/` | Auth server with WIMS-BFP realm |
| `keycloak-bootstrap` | `keycloak/` | One-shot realm import (`--import-realm`, `IGNORE_EXISTING`) |
| `openbao` | `openbao/` | KMS (secrets engine) |
| `openbao-bootstrap` | `openbao/` | One-shot OpenBao init |
| `ollama` | — | Local LLM (Qwen2.5-3B) |
| `ollama-model-pull` | — | One-shot model download |
| `backend` | `backend/` | FastAPI application |
| `celery-worker` | `backend/` | Celery async workers |
| `frontend` | `frontend/` | Next.js production build |
| `wims-suricata` | `suricata/` | IDS/IPS with EVE JSON output |
| `nginx-gateway` | `nginx/` | Edge gateway (TLS, rate limiting) |

## Infrastructure Rules

- **Lexical SQL order.** All `.sql` files in `postgres-init/` execute in strict `LC_ALL=C sort` order with `ON_ERROR_STOP=1`.
- **Keycloak imports once.** Realm JSON uses `IGNORE_EXISTING` strategy. After first boot, the realm is not re-imported.
- **Frontend build requires env vars.** `NEXT_PUBLIC_AUTH_API_URL` and `NEXT_PUBLIC_BASE_URL` must be set at build time.
- **Two issuer URLs.** Backend fetches JWKS from `keycloak:8080` (Docker internal). Token `iss` validation uses `localhost` (browser-visible, `KC_HOSTNAME=localhost`).

## Platform Notes

### Arch Linux — pytest requires a venv

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pytest
```

### SQL Migration Gotchas

| Symptom | Fix |
|---------|-----|
| Duplicate object names | Add `IF NOT EXISTS` / `OR REPLACE` |
| Missing schema prefix | Use `wims.` before table names |
| `CREATE POLICY` fails | Ensure `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` runs first |

## Key Environment Variables

| Variable | Service | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | backend, celery | PostgreSQL connection |
| `DATABASE_ADMIN_URL` | backend | Postgres superuser (DDL patches) |
| `WIMS_MASTER_KEY` | backend | AES-256-GCM PII encryption key |
| `KEYCLOAK_REALM_URL` | backend | JWKS endpoint (Docker internal) |
| `KEYCLOAK_ISSUER` | backend | JWT `iss` validation (browser-visible) |
| `REDIS_URL` | backend, celery | Redis connection |
| `OLLAMA_URL` | backend | Local LLM endpoint |
| `NEXT_PUBLIC_AUTH_API_URL` | frontend | Keycloak auth URL |

## CI/CD

Full CI pre-flight with detailed gates 1-5: `docs/agents/ci-preflight.md`
