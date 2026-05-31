# Code Context

Read-only master-delta scout for PR #182. Only this artifact was written by this scout. Note: the initial scout started from clean detached `HEAD` `ad2bd03`; a later status recheck showed the worktree had advanced to `c1c5a9b` with source conflicts, likely from an external rebase/merge started after the scout began. Findings below are based on the original requested base/master comparison.

## Exact commands run

```bash
git status --short --branch
git merge-base origin/master HEAD
git rev-parse --short HEAD
git rev-parse --short origin/master

BASE=$(git merge-base origin/master HEAD)
git diff --name-status "$BASE"..origin/master
git diff --name-status "$BASE"..HEAD
git diff --stat "$BASE"..origin/master
git diff --stat "$BASE"..HEAD
comm -12 <(git diff --name-only "$BASE"..origin/master | sort) <(git diff --name-only "$BASE"..HEAD | sort)

git log --oneline --decorate --no-merges "$BASE"..origin/master
git merge-tree --write-tree HEAD origin/master >/tmp/pr182-merge-tree-write.txt 2>/tmp/pr182-merge-tree-write.err
TREE=$(sed -n '1p' /tmp/pr182-merge-tree-write.txt)
git show "$TREE:src/backend/main.py" | nl -ba | sed -n '55,142p'
git show origin/master:src/backend/main.py | nl -ba | sed -n '55,125p'
```

Original refs/results:
- Original merge-base: `5e7717483f16c75d4f04b083a15f87fd0c68f6f2`
- Original PR HEAD: `ad2bd03`
- `origin/master`: `c70fee8`
- Master delta: 90 files, 5288 insertions, 702 deletions.
- PR delta: 104 files, 6621 insertions, 1943 deletions.
- Overlap: 19 files.
- `git merge-tree --write-tree HEAD origin/master` exited `1`; content conflicts in 11 files.

Master commits since the original merge-base:
```text
c70fee8 fix(slice5): auth — temp password email via Keycloak, auth callback integration tests (#217)
0f74d4b fix(slice4): perf & quality — Redis pooling, defer PII, frontend cleanup, autodiscover, lazy psutil (#216)
cd28efd fix(slice3): backend bugs — async Redis, session DELETE, stub login, docstring, attachment ID, logger, bundle failures (#215)
35aa44a fix(slice1): security hardening — JWT fallback, CORS, master key, legacy roles, hardcoded secrets (#213)
1d9a828 fix(#28): profile email editing with EmailStr validation, DB username sync, and comprehensive tests (#207)
36ab0b9 feat(M14): restore public report endpoint — rate limit, nearest-centroid, Retry-After (#177) (#210)
1b35018 feat(M13b): email infrastructure — Jinja2 HTML templates + SMTP + Celery retry (#176) (#211)
866cff4 fix(#127): Redis connection pooling, timeouts, error logging, and test cleanup for report-clusters API (#212)
bf4553d Feature/m11b csrf protection (#223)
4651d53 fix(slice2): infra & config — pin images, nginx local dev, audience fix, rate limit PKCE callback (#214)
938cce4 feat(M7b): OWASP Top 10 + BFP custom Suricata detection rules (#155) (#208)
367c615 fix(backend): normalize UUID encoder_id in incident create response (#218)
```

## Files Retrieved

1. `origin/master:src/backend/main.py` (lines 55-67, 70-112, 125-138, 209-214, 289-305, 512-514) - upstream CSRF registration, startup-patch note, Celery autodiscovery, PKCE callback rate limit, lazy `psutil`, analytics note.
2. `origin/master:src/backend/utils/csrf.py` (lines 78-129) - new Origin/Referer CSRF middleware and public-DMZ exemption.
3. `origin/master:src/backend/auth.py` (lines 22-30, 190-223, 301-309, 382-389) - `wims-web` audience, JWK `to_pem` guard, async revocation check, `__Host-access_token`, email in current user dict.
4. `origin/master:src/backend/api/routes/user.py` (lines 44-70, 101-128, 136-237, 240-270) - profile email self-editing, current-password step-up, strict phone validation, Direct Grant password verification comments.
5. `origin/master:src/backend/api/routes/incidents.py` (lines 115-189, 361-375, 418-450, 510-515) - bundle partial-failure return shape, attachment `RETURNING attachment_id`, string encoder ID response.
6. `origin/master:src/backend/services/keycloak_admin.py` (lines 125-136, 202-235, 273-280) - temp-password email via Keycloak and profile email/attributes preservation.
7. `origin/master:src/postgres-init/44_add_email_to_users.sql` (lines 1-12) - new `wims.users.email` migration and unique index.
8. `origin/master:src/docker-compose.yml` (lines 11-14, 60-66, 127-140, 195-218, 224-246) - strict secret interpolation, CSRF origins, Firebase placeholders, pinned images, production TLS mount removed from base.
9. `origin/master:.env.example` (lines 43-80) - placeholder Firebase and SMTP variables for strict compose.
10. `origin/master:src/nginx/nginx.conf` (lines 9-14, 92-115) - production CORS whitelist map and `$cors_origin` use.
11. `origin/master:src/docker-compose.override.yml` (lines 1-5), `origin/master:src/docker-compose.prod.yml` (lines 1-32), `origin/master:src/docker-compose.ci.yml` (lines 1-17), `origin/master:src/nginx/nginx.ci.conf` (lines 16-23) - upstream local/prod/CI nginx split.
12. `origin/master:.github/workflows/ci.yml` (lines 221-236, 255-287, 330-358) - CI uses `wims-web`, creates `.env`, adds security scan to merge gate.
13. `origin/master:src/backend/api/routes/public_dmz.py` (lines 39-67, 72-147, 156-217, 229-252) - restored public incident endpoint, sliding-window Redis, nearest fire station routing.
14. `origin/master:src/backend/api/routes/civilian.py` (lines 38-65, 589-598, 669-778) - Redis pooling and report-cluster cache/stale fallback hardening.
15. `origin/master:src/backend/celery_config.py` (lines 18-54), `origin/master:src/backend/tasks/notifications.py` (lines 154-202), `origin/master:src/backend/services/email/sender.py` (lines 81-140) - Celery autodiscovery and email infrastructure.
16. `origin/master:src/keycloak/import/bfp-realm.json` (lines 88-118, 1514-1524) - canonical Keycloak roles only and SMTP boolean/reply-to fix.
17. Merge-tree synthetic `src/backend/api/routes/incidents.py` (lines 350-368), `src/backend/api/routes/user.py` (lines 10-30), `src/backend/main.py` (lines 55-142), `src/docker-compose.yml` (lines 120-180), `src/nginx/nginx.conf` (lines 172-194) - direct conflict regions.

## Key Code

### Auth/CSRF/rate limit

```python
# origin/master:src/backend/main.py lines 55-67
from utils.csrf import csrf_middleware
logger = logging.getLogger("wims.rate_limit")
app = FastAPI(title="WIMS-BFP Backend")
app.middleware("http")(csrf_middleware)
```

```python
# origin/master:src/backend/main.py lines 209-214
@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    """Sliding-window rate limiter applied before every request."""
    # Rate-limit the PKCE callback endpoint (real auth flow)
    if request.url.path != "/api/auth/callback" or request.method != "POST":
        return await call_next(request)
```

```python
# origin/master:src/backend/auth.py lines 27-30
CLIENT_ID = os.environ.get("KEYCLOAK_CLIENT_ID", "wims-web")
AUDIENCE = os.environ.get("KEYCLOAK_AUDIENCE", os.environ.get("KEYCLOAK_CLIENT_ID", "wims-web"))
```

```python
# origin/master:src/backend/auth.py lines 301-309
token = request.cookies.get("__Host-access_token")
```

### Profile email step-up

```python
# origin/master:src/backend/api/routes/user.py lines 178-185
if body.email:
    if not body.current_password or not body.current_password.strip():
        raise HTTPException(
            status_code=400,
            detail="Current password is required to change email/login identity",
        )
    _verify_current_password_for_profile_email_change(current_user, body.current_password)
```

### Incident bundle/attachment fixes

```python
# origin/master:src/backend/api/routes/incidents.py lines 361-375
for iid in results["imported"]:
    try:
        sync_incident_to_analytics(db, iid)
    except Exception:
        logger.warning("Failed to sync incident %s to analytics read model", iid)
db.commit()

return {
    "status": "ok",
    "batch_id": batch_id,
    "imported": results["imported"],
    "incident_ids": results["imported"],
    "failed": results["failed"],
    "message": f"Committed {len(results['imported'])} incident(s), {len(results['failed'])} failed.",
}
```

### Production CORS and compose strict env

```nginx
# origin/master:src/nginx/nginx.conf lines 9-14
map $http_origin $cors_origin {
    default "";
    "https://wimsbfp.tech" $http_origin;
    "https://wims.bfp.gov.ph" $http_origin;
}
```

```yaml
# origin/master:src/docker-compose.yml lines 127-140
- DATABASE_URL=postgresql://postgres:${POSTGRES_PASSWORD:?error}@postgres:5432/wims
- KEYCLOAK_ADMIN_USER=${KEYCLOAK_ADMIN:?error}
- KEYCLOAK_ADMIN_PASSWORD=${KEYCLOAK_ADMIN_PASSWORD:?error}
- CSRF_TRUSTED_ORIGINS=http://localhost,https://localhost,http://127.0.0.1,http://127.0.0.1:3000
```

## Architecture

Master-side behavior to preserve:

- Browser auth is now `wims-web` PKCE, rate-limited at backend `POST /api/auth/callback`, using `__Host-*` secure cookies and CSRF Origin/Referer middleware. Direct Grant remains separate for server-side password/email verification with `bfp-client` in the profile route.
- Profile email is user-editable only with current-password step-up; Keycloak username/email and DB `wims.users.email`/`username` sync are upstream behavior.
- Runtime config is secret-free and fail-fast: compose uses `${VAR:?error}`, images are pinned, Firebase values are placeholders, and CI copies `.env.example` into `src/.env` before compose.
- Nginx modes are separated: production `nginx.conf` keeps TLS and deny-by-default CORS; local override and CI override supply different gateway configs. Do not weaken production CORS to fix localhost/HSTS.
- Public no-auth report ingestion and civilian report clusters got Redis pooling/sliding-window/stale-cache hardening.
- Celery task registration moved to `celery_config.autodiscover_tasks(["tasks"])`; avoid restoring `tasks.*` side-effect imports in `main.py`.

## Overlap and conflicts

Overlapping files (19):

```text
docs/CHANGELOG.md
src/backend/api/routes/admin.py
src/backend/api/routes/incidents.py
src/backend/api/routes/regional.py
src/backend/api/routes/sessions.py
src/backend/api/routes/user.py
src/backend/auth.py
src/backend/main.py
src/backend/tests/integration/test_civilian_api.py
src/backend/tests/test_dynamic_rate_limits.py
src/docker-compose.yml
src/keycloak/import/bfp-realm.json
src/nginx/nginx.conf
system-wiki/architecture/infrastructure-config.md
system-wiki/architecture/pwa-tests-cicd.md
system-wiki/frontend/route-map.md
system-wiki/index.md
system-wiki/log.md
system-wiki/operations/local-dev-deploy-guide.md
```

Simulated merge-tree conflicts (11):

| File | Conflict implication | Must-keep upstream behavior |
|---|---|---|
| `src/backend/api/routes/incidents.py` | PR re-applies RLS context before analytics; master replaces `incident_ids` with `results`. | Use PR `set_rls_context(db, uuid.UUID(user_id))`, then loop `for iid in results["imported"]`; keep `failed` response payload and attachment/encoder fixes.
| `src/backend/api/routes/user.py` | Import-only conflict: PR imports `get_db_with_rls` from `auth`; master from `database`. | If PR’s auth wrapper remains, import from `auth`, but keep all master email/current-password profile logic.
| `src/backend/main.py` | PR startup schema patch/admin-engine block collides with master `app.middleware("http")(csrf_middleware)` and master startup-DDL note. | Register CSRF; keep rate limit on `/api/auth/callback`; keep autodiscovery/lazy `psutil`; do not startup-patch `wims.users.email`. Review PR startup DDL on `wims.users` policies for lock risk.
| `src/docker-compose.yml` | PR wants `wims_app_user:wimsapp` + `DATABASE_ADMIN_URL`; master uses strict env interpolation and removes hardcoded secrets. | Combine app-user design with `${POSTGRES_PASSWORD:?error}` / no hardcoded `password`, `admin`, Firebase keys, or `:latest` tags.
| `src/nginx/nginx.conf` | PR adds local HTTP/passthrough and in-location CORS; master uses production `map $http_origin $cors_origin`. | Keep production deny-by-default `$cors_origin`; put local HTTP/HSTS workaround in local/CI config, not production CORS.
| `system-wiki/architecture/infrastructure-config.md` | Both sides updated docs. | Keep upstream strict env, pinned image, CORS, canonical role notes.
| `system-wiki/architecture/pwa-tests-cicd.md` | Both sides updated docs. | Keep upstream security-scan, `wims-web`, Redis test isolation, startup-DDL hang note.
| `system-wiki/frontend/route-map.md` | Route note conflict. | Keep `/profile` email identity/current-password/partial-update note.
| `system-wiki/index.md` | Last-updated/summary conflict. | Combine both summaries.
| `system-wiki/log.md` | Large append conflict. | Append both branches’ entries chronologically.
| `system-wiki/operations/local-dev-deploy-guide.md` | Local dev/HSTS docs conflict. | Preserve separated local/prod/CI nginx modes and secure-cookie assumptions.

Auto-merged overlaps still requiring review:
- `src/backend/auth.py`: merge-tree preserved PR `auth.get_db_with_rls` plus master `wims-web`, `__Host-access_token`, async revocation, and email in user dict. Re-run auth tests.
- `src/backend/api/routes/admin.py`: upstream rate-limit docs say legacy `login` tier now represents auth callback; create-user note says credentials are emailed.
- `src/backend/api/routes/regional.py`: upstream stops decrypting PII in the list endpoint, returns `has_sensitive_data`, and removes legacy `VALIDATOR` from validator checks.
- `src/backend/api/routes/sessions.py`: upstream route is `DELETE /api/admin/sessions/{user_id}` for all sessions; single-session revocation belongs in `admin.py`.
- `src/keycloak/import/bfp-realm.json`: auto-merge should keep canonical roles and SMTP booleans; verify with `rg '"name": "(VALIDATOR|ANALYST)"' src/keycloak/import/bfp-realm.json` after rebase.

Open risk: PR also changes `src/keycloak/bfp-realm.json`, which master did not touch. Current PR copy still contains legacy `VALIDATOR` and `ANALYST` entries; mirror master cleanup there too if that file remains authoritative.

## Start Here

Start with `src/backend/main.py`. It has the largest semantic conflict and controls auth/CSRF/rate-limit/startup-patch interactions. Then resolve `src/docker-compose.yml` and `src/nginx/nginx.conf`, because they supply the env/CORS/security assumptions required by `main.py`, `auth.py`, and the frontend auth API routes.
