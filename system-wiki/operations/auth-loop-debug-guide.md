# Auth Loop Debug Guide

## Symptom

After Keycloak login, browser loops back to login page. `GET /api/auth/session` returns HTTP 500.

```
GET /api/auth/session HTTP/1.1" 500 23
```

---

## Diagnosis Walkthrough

### Step 1 — Confirm the failure point

Nginx access logs show which route is returning 500:
```bash
docker compose logs --tail=100 nginx-gateway 2>&1 | grep "500\|403\|400"
```

The 500 originates from the Next.js session route handler, not from FastAPI directly.

### Step 2 — Trace the session route's server-side probe

The session route (`src/frontend/src/app/api/auth/session/route.ts`) calls `fetch(BACKEND_URL + '/api/user/me')` on the **server side** to probe whether the user's JWT is valid.

Check what `BACKEND_URL` is baked into the frontend image:
```bash
docker compose exec frontend printenv BACKEND_URL
```

**Failure mode:** If `BACKEND_URL=http://nginx-gateway:80`, the Next.js API route handler calls nginx (same Docker network), which force-redirects HTTP→HTTPS (nginx redirects all HTTP to `https://localhost`). The server-side fetch follows the redirect, fails silently, and the route handler returns 500.

**Correct value:** `BACKEND_URL=http://backend:8000` — Next.js API routes call FastAPI directly inside Docker, bypassing nginx for this probe.

### Step 3 — Distinguish server-side vs client-side failures

| Signal | Layer | Meaning |
|---|---|---|
| `GET /api/auth/session 500` | Server-side | Session route probe failed |
| Browser redirect loop (auth URL hits 400) | Client-side | OIDC flow broken at Keycloak or redirect URI |

### Step 4 — Server-side probe failure checklist

1. `docker compose exec frontend printenv BACKEND_URL`
2. If `http://nginx-gateway:80` → rebuild frontend:
   ```bash
   docker compose build frontend && docker compose up -d frontend
   ```
3. If `http://backend:8000` → check FastAPI is up:
   ```bash
   docker compose exec backend curl -s http://localhost:8000/health
   ```
4. Check nginx logs for HTTPS redirect:
   ```bash
   docker compose logs --tail=50 nginx-gateway | grep "301\|308"
   ```

### Step 5 — OIDC auth URL going to wrong host (client-side)

1. Check `NEXT_PUBLIC_AUTH_API_URL` in running container:
   ```bash
   docker compose exec frontend printenv NEXT_PUBLIC_AUTH_API_URL
   ```

2. If it's `http://localhost:8080` → frontend image is stale, rebuild:
   ```bash
   docker compose build frontend && docker compose up -d frontend
   ```

3. If it's `/auth` → check nginx config has `/auth/` proxy block, then check Keycloak realm JSON for `webOrigins` and `redirectUris`

### Step 6 — Keycloak returning 400 on auth request

1. Decode the error URL in browser console — look for `error=invalid_redirect_uri` or `error=invalid_client`
2. Check `bfp-realm.json` for the `wims-web` client:
   - `redirectUris` must include the exact `redirect_uri` being sent
   - `webOrigins` must NOT contain `"+"` (literal string, not a wildcard in Keycloak 24 — causes all origin validation to fail)
   - `clientAuthenticatorType` must be absent on public clients (`publicClient: true` should be enough)
3. Fix then restart Keycloak:
   ```bash
   docker compose restart keycloak
   ```

### Step 7 — JWT `azp` mismatch (500 on `/api/user/me`)

1. Decode the JWT at jwt.io — check `azp` claim
2. Compare to `KEYCLOAK_CLIENT_ID` in running backend container:
   ```bash
   docker compose exec backend python -c "import os; print('CLIENT_ID:', os.environ.get('KEYCLOAK_CLIENT_ID')); print('AUDIENCE:', os.environ.get('KEYCLOAK_AUDIENCE')); print('ISSUER:', os.environ.get('KEYCLOAK_ISSUER'))"
   ```
3. If `azp` in token ≠ `KEYCLOAK_CLIENT_ID` env → rebuild backend image (env vars baked at build time):
   ```bash
   docker compose build backend && docker compose up -d backend
   ```

### Step 8 — Confirm env vars are live

```bash
# Backend
docker compose exec backend python -c "import os; print('CLIENT_ID:', os.environ.get('KEYCLOAK_CLIENT_ID')); print('AUDIENCE:', os.environ.get('KEYCLOAK_AUDIENCE')); print('ISSUER:', os.environ.get('KEYCLOAK_ISSUER'))"

# Frontend
docker compose exec frontend printenv NEXT_PUBLIC_AUTH_API_URL
docker compose exec frontend printenv NEXT_PUBLIC_API_URL
docker compose exec frontend printenv BACKEND_URL
```

---

## Restart Order (after realm or compose env changes)

```bash
docker compose restart keycloak          # reload realm JSON
docker compose build frontend && docker compose up -d frontend  # rebake env vars
docker compose restart backend           # pick up any new env vars
```

---

## Root Causes Encountered

### RC-1: Session route called nginx instead of backend directly

**Symptom:** `GET /api/auth/session 500` from Next.js API route handler.

**Root cause:** `BACKEND_URL=http://nginx-gateway:80` baked into frontend image. Server-side `fetch()` through nginx triggers HTTPS redirect. Fetch follows redirect but fails in the server-side context, causing a 500 from the route handler.

**Fix:** `BACKEND_URL=http://backend:8000` in `docker-compose.yml`. Rebuild frontend.

---

### RC-2: `NEXT_PUBLIC_AUTH_API_URL` stale in frontend image

**Symptom:** Auth URL goes to `http://localhost:8080` (Keycloak direct) instead of `https://localhost/auth/`.

**Root cause:** `NEXT_PUBLIC_*` env vars are baked at build time. Changing them in `docker-compose.yml` without rebuilding leaves the old value in the image.

**Fix:** `docker compose build frontend && docker compose up -d frontend`

---

### RC-3: `webOrigins: "+"` in Keycloak realm JSON

**Symptom:** Keycloak returns 400 Bad Request on auth request.

**Root cause:** In Keycloak 24, `+` is not a valid wildcard — it's treated as a literal string. All origin validation fails silently.

**Fix:** Replace `"+"` in `webOrigins` with explicit origin list:
```json
"webOrigins": [
  "https://localhost",
  "http://localhost",
  "https://165-22-101-73.nip.io",
  "https://wims.bfp.gov.ph"
]
```

---

### RC-4: `clientAuthenticatorType: "client-secret"` on public client

**Symptom:** Keycloak rejects client configuration or issues tokens rejected by backend.

**Root cause:** A public client (PKCE flow, `publicClient: true`) should not have `clientAuthenticatorType`. Having it contradicts the public client model.

**Fix:** Remove `clientAuthenticatorType` from the client JSON in `bfp-realm.json`. For PKCE public clients, this field should be absent.

---

### RC-5: `security-admin-console` — master realm vs application realm

**Symptom:** Navigating to `https://localhost/auth/admin` redirects to Keycloak login but shows "invalid parameter: redirect_url". Going back to application presents a working login page.

**Root cause:** The `security-admin-console` client exists in two separate realms:

- **`master` realm** — Keycloak's internal bootstrap realm, stored in Keycloak's own PostgreSQL DB (`keycloak` database, not the `wims` app DB). Persists across `docker compose down -v`.
- **`bfp` realm** — The application realm exported in `bfp-realm.json`. Only exists in the imported realm data.

The admin console login flow uses the **`master` realm's** `security-admin-console` client. I initially patched the `bfp` realm copy (which is a different client, different UUID), never touching the master realm copy.

**kcadm targeting error:** Running `kcadm.sh get clients` without `-r master` defaults to the authenticated realm (from `kcadm.sh config credentials --realm`). If credentials were made against `bfp`, the command edits the wrong realm's client.

**redirect_uri mismatch:** The `master` realm's `security-admin-console` had `redirectUris: ["/admin/master/console/*"]` (relative). When nginx proxies `https://localhost/auth/admin` to Keycloak, Keycloak sees `X-Forwarded-Proto: https` and `X-Forwarded-Host: localhost`, building an absolute `redirect_uri=https://localhost/auth/admin/master/console/` — which the relative pattern did not match.

**Fix (kcadm, live):**
```bash
# Authenticate against master realm explicitly
kcadm.sh config credentials --server http://localhost:8080/auth --realm master --user admin --password admin

# Get correct client ID from master realm
kcadm.sh get clients -r master

# Update master realm's security-admin-console with absolute redirect URIs
kcadm.sh update clients/<master-realm-security-admin-console-id> -r master \
  -s redirectUris='["https://localhost/auth/admin/master/console/*","https://165-22-101-73.nip.io/auth/admin/master/console/*","http://localhost:8080/auth/admin/master/console/*"]' \
  -s webOrigins='["https://localhost","https://165-22-101-73.nip.io","http://localhost","https://wims.bfp.gov.ph"]'
```

**Key insight:** `bfp-realm.json` only exports the `bfp` realm. The `master` realm and its clients are **never** in this file. They are Keycloak's internal data and must be patched via kcadm or the Keycloak Admin UI directly.

---

### RC-6: `docker compose down -v` does not wipe Keycloak's master realm data

**Symptom:** After `docker compose down -v` and fresh rebuild, the same Keycloak admin console error recurs.

**Root cause:** The `master` realm's clients (including `security-admin-console`) are stored in Keycloak's own PostgreSQL database at `postgres:5432/keycloak` — not in a Docker named volume from the compose file. `docker compose down -v` wipes named volumes declared in the compose file, but Keycloak uses a bind mount or internal volume for its DB that survives `down -v`.

**Fix:** Let `keycloak-bootstrap` run `src/keycloak/bootstrap/bootstrap-master-realm.sh` after Keycloak is healthy. The script uses `kcadm.sh` against `-r master`, finds the master realm `security-admin-console` client, and patches the absolute redirect URIs/web origins. Backend startup waits for the one-shot service to exit successfully.

**2026-05-24 verification:** Mounting `src/keycloak/import/master-realm.json` into `/opt/keycloak/data/import` is not sufficient. Keycloak 24 initializes the `master` realm first, then startup import runs with `IGNORE_EXISTING` and logs `Realm 'master' already exists. Import skipped`. The implemented `keycloak-bootstrap` service patched the live master realm `security-admin-console`; live `kcadm` inspection showed the absolute redirect URI list including `https://localhost/auth/admin/master/console/*`.

---

## Key Learnings

1. **Next.js server-side `fetch()` respects nginx HTTPS redirects.** When `BACKEND_URL` routes through nginx from inside a Next.js API route handler, nginx redirects HTTP→HTTPS. The fetch follows the redirect but fails in the server-side context, surfacing as a 500. Always call `http://backend:8000` directly from Next.js server-side route handlers — nginx is for browser traffic only.

2. **`NEXT_PUBLIC_*` env vars are baked at build time, not at runtime.** Changing them in `docker-compose.yml` requires `docker compose build <service>` to take effect. A running container or an image built before the change will have stale values.

3. **`webOrigins: "+"` is not a valid wildcard in Keycloak 24.** Use explicit origin arrays.

4. **`clientAuthenticatorType: "client-secret"` contradicts `publicClient: true`.** Remove it from public clients in the realm JSON.

5. **Verify env vars in the running container, not just in the compose file.** Use `docker compose exec <service> printenv <VAR>` to confirm actual runtime values.

---

## Files Involved

| File | Role |
|---|---|
| `src/frontend/src/app/api/auth/session/route.ts` | Server-side session probe — calls `BACKEND_URL + /api/user/me` |
| `src/frontend/src/app/api/auth/sync/route.ts` | PKCE token exchange via backend |
| `src/frontend/src/lib/oidc.ts` | OIDC client config, PKCE redirect URI resolution |
| `src/docker-compose.yml` | `BACKEND_URL`, `NEXT_PUBLIC_AUTH_API_URL`, `NEXT_PUBLIC_API_URL` build args |
| `src/nginx/nginx.conf` | `/auth/` proxy to `keycloak:8080/auth/`, HTTPS redirect for app domain |
| `src/keycloak/bfp-realm.json` | `wims-web` and `bfp-client` client configs — `webOrigins`, `redirectUris`, `clientAuthenticatorType` |
| `src/backend/auth.py` | JWT validation — `azp` check against `CLIENT_ID`, JWKS caching |
| `src/backend/main.py` | `/api/user/me` endpoint — JIT user provisioning |
