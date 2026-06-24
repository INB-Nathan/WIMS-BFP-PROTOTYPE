# Platform Notes

Environment-specific setup gotchas and troubleshooting.

## Arch Linux

### pytest requires a venv

On Arch Linux, `pip install` fails with `--break-system-packages` by default. Always create and activate a venv before running pytest locally:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pytest
```

## Docker

### Frontend build env vars

The frontend build requires `NEXT_PUBLIC_AUTH_API_URL` and `NEXT_PUBLIC_BASE_URL` env vars.
Safe dummy values for local development:

```bash
export NEXT_PUBLIC_AUTH_API_URL="http://localhost:8080/auth"
export NEXT_PUBLIC_BASE_URL="http://localhost:3000"
```

### SQL migrations

Apply every `.sql` file in `src/postgres-init/` in strict lexical order with `ON_ERROR_STOP=1`. Common failures:
- Duplicate object names — add `IF NOT EXISTS` / `OR REPLACE`
- Missing schema prefix — use `wims.` before table names
- `CREATE POLICY` on a table without `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`

Full migration details in `docs/agents/ci-preflight.md` (Gate 5).
