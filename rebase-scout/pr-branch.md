# Code Context

## Commands Run

Exact shell commands run in `/home/xynate/WIMS-BFP-NEW/pr-worktrees/pr-182` for this read-only scout:

```bash
pwd && git status --short --branch && git rev-parse --abbrev-ref HEAD && git rev-parse HEAD && git merge-base origin/master HEAD
git log --oneline --decorate --graph --max-count=40 origin/master..HEAD
git diff --stat origin/master...HEAD && printf '\n--- name-status ---\n' && git diff --find-renames --name-status origin/master...HEAD && printf '\n--- dirstat ---\n' && git diff --dirstat=files,0 origin/master...HEAD
git diff --numstat origin/master...HEAD | sort -nr | head -40
printf '%s\n' '--- docs/wiki changed ---' && git diff --name-only origin/master...HEAD | rg '^(docs/|system-wiki/|AGENTS.md|CLAUDE.md|README|scripts/)' && printf '%s\n' '--- relevant top files line counts ---' && wc -l src/frontend/src/app/dashboard/validator/page.tsx src/frontend/src/app/dashboard/regional/page.tsx src/backend/main.py src/backend/database.py src/backend/auth.py docs/PR-rls-and-fixes.md
printf '%s\n' '--- frontend scripts ---' && node -e "const p=require('./src/frontend/package.json'); console.log(JSON.stringify(p.scripts,null,2))" && printf '%s\n' '--- pytest config ---' && sed -n '1,80p' src/backend/pytest.ini
git diff --summary origin/master...HEAD
rg -n "DATABASE_URL|DATABASE_ADMIN_URL|SYSTEM_TASK_USER_ID|_AdminSessionLocal|get_session|set_rls_context|def get_db\(" src/backend/database.py src/docker-compose.yml
rg -n "def get_db_with_rls|get_current_wims_user|set_rls_context|Depends\(" src/backend/auth.py src/backend/api/routes/map.py src/backend/api/routes/incidents.py src/backend/api/routes/regional.py src/backend/main.py
rg -n "apply_schema_patches|_apply_analytics_facts_rls|wims_app_user|svc_task|materialized view|analytics-summary|def _get_admin_session|startup_admin" src/backend/main.py
rg -n "ENABLE ROW LEVEL SECURITY|CREATE POLICY|FORCE ROW LEVEL SECURITY|wims_app_user|wims_app|SECURITY DEFINER|users_self_or_admin_select|analytics_incident_facts|SYSTEM_TASK_USER_ID|svc_task" src/postgres-init/03_users.sql src/postgres-init/09_rls_helpers.sql src/postgres-init/10_rls_policies.sql src/postgres-init/11_analytics_facts.sql src/postgres-init/42_ref_table_rls.sql src/postgres-init/43_app_login_role.sql
nl -ba src/backend/database.py | sed -n '1,120p'
nl -ba src/backend/auth.py | sed -n '280,410p'
nl -ba src/backend/main.py | sed -n '80,260p' && printf '\n--- analytics rls patch ---\n' && nl -ba src/backend/main.py | sed -n '321,430p' && printf '\n--- analytics summary endpoint ---\n' && nl -ba src/backend/main.py | sed -n '750,830p'
nl -ba src/docker-compose.yml | sed -n '115,175p'
nl -ba src/backend/tasks/analytics_refresh.py | sed -n '1,140p' && printf '\n--- drafts ---\n' && nl -ba src/backend/tasks/drafts.py | sed -n '1,120p'
nl -ba src/backend/tasks/civilian_reports.py | sed -n '1,120p' && printf '\n--- narrative relevant ---\n' && nl -ba src/backend/tasks/narrative.py | sed -n '1,160p'
nl -ba src/backend/api/routes/map.py | sed -n '100,155p' && printf '\n--- public emergency services? ---\n' && nl -ba src/backend/api/routes/map.py | sed -n '245,285p' && printf '\n--- operational map ---\n' && nl -ba src/backend/api/routes/map.py | sed -n '360,410p'
nl -ba src/postgres-init/42_ref_table_rls.sql | sed -n '1,90p'
nl -ba src/postgres-init/43_app_login_role.sql | sed -n '1,80p'
nl -ba src/postgres-init/11_analytics_facts.sql | sed -n '20,90p'
nl -ba src/postgres-init/09_rls_helpers.sql | sed -n '15,90p' && printf '\n--- users policy ---\n' && nl -ba src/postgres-init/10_rls_policies.sql | sed -n '45,65p' && printf '\n--- svc_task user ---\n' && nl -ba src/postgres-init/03_users.sql | sed -n '35,60p'
nl -ba src/postgres-init/21_all_regions.sql | sed -n '1,80p'
rg -n "encoder_ncr|assigned_region_id|encoder_nir|UPDATE wims.users" src/postgres-init/21_all_regions.sql | tail -40 && nl -ba src/postgres-init/21_all_regions.sql | sed -n '240,315p'
nl -ba src/postgres-init/21_all_regions.sql | sed -n '165,210p'
nl -ba src/frontend/src/app/dashboard/validator/page.tsx | sed -n '1,120p' && printf '\n--- status filter funcs ---\n' && rg -n "selectStatusFilter|dateFilter|ActionModal|IncidentTableRow|BulkApprove" src/frontend/src/app/dashboard/validator/page.tsx
nl -ba src/frontend/src/app/dashboard/regional/page.tsx | sed -n '1,120p' && printf '\n--- status filter funcs ---\n' && rg -n "selectStatusFilter|dateFilter|IncidentCard|NotificationToasts|WildlandFireBreakdown|InfoBlock|loadStatsRef|loadStats" src/frontend/src/app/dashboard/regional/page.tsx
nl -ba src/frontend/src/lib/roleRedirect.ts | sed -n '1,120p' && printf '\n--- callback usage ---\n' && nl -ba src/frontend/src/app/callback/page.tsx | sed -n '1,120p' && printf '\n--- roleRedirect tests ---\n' && nl -ba src/frontend/src/lib/__tests__/roleRedirect.test.ts | sed -n '1,120p'
nl -ba src/frontend/src/components/IncidentForm.tsx | sed -n '1,90p' && printf '\n--- draft markers ---\n' && rg -n "draft|localStorage|userEditedDraftRef|onChange|onInput" src/frontend/src/components/IncidentForm.tsx
nl -ba src/frontend/src/app/dashboard/validator/page.tsx | sed -n '145,205p' && printf '\n--- row/modal render ---\n' && nl -ba src/frontend/src/app/dashboard/validator/page.tsx | sed -n '830,965p'
nl -ba src/frontend/src/app/dashboard/regional/page.tsx | sed -n '130,245p' && printf '\n--- filter helpers ---\n' && nl -ba src/frontend/src/app/dashboard/regional/page.tsx | sed -n '255,325p' && printf '\n--- component render references ---\n' && nl -ba src/frontend/src/app/dashboard/regional/page.tsx | sed -n '416,430p;750,770p;950,965p'
nl -ba src/frontend/src/components/IncidentForm.tsx | sed -n '92,124p;790,825p;1412,1424p'
for f in src/frontend/src/components/validator/{AcceptConfirmModal.tsx,ActionModal.tsx,BulkApproveConfirmModal.tsx,BulkDuplicateModal.tsx,IncidentTableRow.tsx,ValidatorDuplicateModal.tsx,types.ts}; do printf '%5s %s\n' "$(wc -l < "$f")" "$f"; done && printf '\nregional\n' && for f in src/frontend/src/components/regional/{IncidentCard.tsx,NotificationToasts.tsx,WildlandFireBreakdown.tsx} src/frontend/src/components/ui/InfoBlock.tsx; do printf '%5s %s\n' "$(wc -l < "$f")" "$f"; done
nl -ba src/frontend/src/components/validator/types.ts | sed -n '1,80p' && printf '\n--- IncidentTableRow ---\n' && nl -ba src/frontend/src/components/validator/IncidentTableRow.tsx | sed -n '1,80p' && printf '\n--- regional IncidentCard ---\n' && nl -ba src/frontend/src/components/regional/IncidentCard.tsx | sed -n '1,60p'
nl -ba src/frontend/src/components/ui/InfoBlock.tsx | sed -n '1,80p' && printf '\n--- barrel ---\n' && nl -ba src/frontend/src/components/ui/index.ts | sed -n '1,40p'
nl -ba src/frontend/src/app/dashboard/page.tsx | sed -n '1,120p'
git diff origin/master...HEAD -- src/frontend/src/app/dashboard/page.tsx | sed -n '1,140p'
git diff --unified=2 origin/master...HEAD -- src/backend/api/routes/admin.py src/backend/api/routes/analytics.py src/backend/api/routes/incidents.py src/backend/api/routes/map.py src/backend/api/routes/ref.py src/backend/api/routes/regional.py src/backend/api/routes/sessions.py src/backend/api/routes/triage.py src/backend/api/routes/user.py | sed -n '1,260p'
nl -ba src/backend/api/routes/ref.py | sed -n '1,115p'
rg -n "UPDATE_PROFILE|userProfileConfig|firstName|lastName|localhost:8090|encoder_ncr|encoder_nir|requiredActions|defaultAction" src/keycloak/bfp-realm.json src/keycloak/import/bfp-realm.json | head -80
nl -ba src/keycloak/themes/wims-bfp/login/resources/css/wims-custom.css | sed -n '1,140p' && printf '\n--- OTP grid ---\n' && rg -n "otp|pf-v5-c-login__container|position: sticky|min-height: 100vh|grid-template-columns|@media" src/keycloak/themes/wims-bfp/login/resources/css/wims-custom.css | head -80
nl -ba src/keycloak/themes/wims-bfp/login/login-config-totp.ftl | sed -n '1,130p' && printf '\n--- login ftls markers ---\n' && rg -n "wims-|login-page|totp|otp|brand-panel|kcForm" src/keycloak/themes/wims-bfp/login/login.ftl src/keycloak/themes/wims-bfp/login/login-otp.ftl src/keycloak/themes/wims-bfp/login/login-config-totp.ftl | head -120
nl -ba src/keycloak/themes/wims-bfp/login/login.ftl | sed -n '1,70p'
git diff origin/master...HEAD -- src/keycloak/themes/wims-bfp/login/login.ftl | sed -n '1,120p'
git show origin/master:src/keycloak/themes/wims-bfp/login/login.ftl | nl -ba | sed -n '25,36p'
git show origin/master:src/keycloak/themes/wims-bfp/login/login.ftl | nl -ba | sed -n '8,16p'
nl -ba src/nginx/nginx.conf | sed -n '1,170p'
nl -ba src/nginx/nginx.conf | sed -n '166,230p'
nl -ba system-wiki/log.md | tail -130
nl -ba system-wiki/database/sql-init-files.md | sed -n '1,180p' && printf '\n--- infra config ---\n' && nl -ba system-wiki/architecture/infrastructure-config.md | sed -n '1,140p'
nl -ba system-wiki/frontend/route-map.md | sed -n '1,140p' && printf '\n--- validator hub ---\n' && nl -ba system-wiki/subsystems/validator-hub.md | sed -n '1,100p' && printf '\n--- regional dash ---\n' && nl -ba system-wiki/subsystems/regional-dashboard.md | sed -n '1,120p'
nl -ba system-wiki/gaps/ui-ux-gap-register.md | sed -n '1,140p'
nl -ba system-wiki/log.md | sed -n '1,120p'
rg -n "42_ref_table_rls|43_app_login_role|app_login|wims_app_user|DATABASE_ADMIN_URL|DATABASE_URL=postgresql://wims_app_user" system-wiki docs | head -100
nl -ba system-wiki/database/sql-init-files.md | sed -n '340,375p' && nl -ba system-wiki/operations/local-dev-deploy-guide.md | sed -n '100,115p' && nl -ba system-wiki/architecture/pwa-tests-cicd.md | sed -n '145,155p'
nl -ba docs/fix-localhost-hsts.md | sed -n '1,120p'
nl -ba scripts/Fix-LocalhostHSTS.ps1 | sed -n '1,100p'
nl -ba docs/regional-dashboard-handover.md | sed -n '1,130p'
nl -ba src/backend/tests/test_ref_table_rls.py | sed -n '1,260p'
nl -ba src/backend/tests/test_dev_user_seed_mapping.py | sed -n '1,180p'
nl -ba src/backend/tests/test_rls_init_contract.py | sed -n '1,120p' && printf '\n--- schema patch guard ---\n' && nl -ba src/backend/tests/test_schema_patch_startup_guard.py | sed -n '1,120p'
nl -ba src/postgres-init/14a_assign_ncr_to_test_users.sql | sed -n '1,60p' && nl -ba src/postgres-init/15_validator_workflow.sql | sed -n '1,40p'
rg -n "npm run lint|vitest|pytest|ruff|format|npm run build|docker compose|pytest" .github/workflows src/backend/pyproject.toml pyproject.toml src/backend/pytest.ini src/frontend/package.json
nl -ba .github/workflows/ci.yml | sed -n '110,150p;185,240p;250,268p' && printf '\n--- backend ruff config ---\n' && nl -ba src/backend/pyproject.toml | sed -n '1,80p'
git branch --contains HEAD && git remote -v && git show -s --format='%H%n%P%n%an%n%ad%n%s' HEAD
git branch -r --contains HEAD
printf 'docs files: '; git diff --name-only origin/master...HEAD | rg '^docs/' | wc -l; printf 'system-wiki files: '; git diff --name-only origin/master...HEAD | rg '^system-wiki/' | wc -l; printf 'scripts files: '; git diff --name-only origin/master...HEAD | rg '^scripts/' | wc -l; printf 'backend files: '; git diff --name-only origin/master...HEAD | rg '^src/backend/' | wc -l; printf 'frontend files: '; git diff --name-only origin/master...HEAD | rg '^src/frontend/' | wc -l; printf 'postgres-init files: '; git diff --name-only origin/master...HEAD | rg '^src/postgres-init/' | wc -l
git diff origin/master...HEAD -- system-wiki/architecture/infrastructure-config.md | sed -n '1,200p'
git diff --unified=3 origin/master...HEAD -- scripts/gen_cities.py scripts/afor_preview.py src/postgres-init/gen_cities.py | sed -n '1,220p'
rg -n "def |REGION|ref_cities|province|INSERT|ON CONFLICT|locality|Philippines|generate" scripts/gen_cities.py scripts/afor_preview.py src/postgres-init/gen_cities.py | head -120
printenv | rg '^(DATABASE|SQLALCHEMY|WIMS_APP_DATABASE_URL)=' || true
cd src/backend && python - <<'PY'
import os
print('DATABASE_URL', os.environ.get('DATABASE_URL'))
try:
    import main  # noqa: F401
    print('import main: ok')
except Exception as exc:
    print(type(exc).__name__, str(exc))
PY
rg -n "def sync_incident_to_analytics|sync_incident_to_analytics\(" src/backend
nl -ba src/backend/services/analytics_read_model.py | sed -n '1,170p' && printf '\n--- lifecycle sync contexts? ---\n' && nl -ba src/backend/services/regional_incidents/lifecycle.py | sed -n '700,740p;940,1025p'
python - <<'PY'
from pathlib import Path
for p in Path('src/backend').rglob('*.py'):
    text=p.read_text(errors='ignore').splitlines()
    for i,line in enumerate(text):
        if 'sync_incident_to_analytics' in line and not line.strip().startswith('from ') and 'def sync_incident_to_analytics' not in line:
            lo=max(0,i-8); hi=min(len(text),i+4)
            context='\n'.join(f'{j+1}:{text[j]}' for j in range(lo,hi))
            print(f'--- {p}:{i+1} ---\n{context}\n')
PY
nl -ba src/backend/services/regional_incidents/lifecycle.py | sed -n '1,80p'
nl -ba src/backend/services/analytics_read_model.py | sed -n '170,210p'
rg -n "sync_incidents_batch" src/backend
nl -ba src/backend/services/afor_import/commit.py | sed -n '830,870p' && nl -ba src/backend/services/afor_import/commit.py | sed -n '1,35p'
nl -ba src/backend/services/analytics_read_model.py | sed -n '182,285p'
rg -n "verify_incident_command|archive_finalized_incident|unarchive_finalized_incident|force_replace_pending_incident" src/backend/api/routes/regional.py | head -40
nl -ba src/backend/api/routes/regional.py | sed -n '2070,2100p;2388,2420p'
nl -ba src/backend/api/routes/regional.py | sed -n '2288,2326p'
rg -n "NATIONAL_VALIDATOR|fire_incidents_select|current_user_region_id|validator" src/postgres-init/10a_m4_incident_scope.sql src/postgres-init/17_cross_region_validator.sql src/postgres-init/10_rls_policies.sql | head -100
nl -ba src/postgres-init/10_rls_policies.sql | sed -n '145,172p' && printf '\n--- 10a ---\n' && nl -ba src/postgres-init/10a_m4_incident_scope.sql | sed -n '1,130p' && printf '\n--- 17 cross region ---\n' && nl -ba src/postgres-init/17_cross_region_validator.sql | sed -n '1,140p'
nl -ba src/keycloak/themes/wims-bfp/login/resources/css/wims-custom.css | sed -n '500,550p;714,846p;921,1020p'
nl -ba src/keycloak/bfp-realm.json | sed -n '860,885p;2320,2360p;2424,2430p;2440,2458p;2780,2796p'
nl -ba src/keycloak/import/bfp-realm.json | sed -n '860,885p;2320,2360p;2424,2430p;2440,2458p;2780,2796p'
nl -ba src/frontend/.dockerignore | sed -n '1,60p'
nl -ba src/frontend/src/app/login/page.tsx | sed -n '1,100p'
nl -ba src/frontend/src/components/Sidebar.tsx | sed -n '1,120p'
rg -n "Operational Map|dashboard/validator/map|MapPinned|NATIONAL_VALIDATOR|REGIONAL_ENCODER" src/frontend/src/components/Sidebar.tsx
nl -ba src/frontend/src/components/Sidebar.tsx | sed -n '205,252p'
nl -ba src/docker-compose.override.yml | sed -n '1,80p'
nl -ba src/nginx/nginx.local.conf | sed -n '1,140p'
nl -ba src/docker-compose.yml | sed -n '238,260p'
nl -ba src/docker-compose.prod.yml | sed -n '1,140p'
nl -ba src/frontend/package.json | sed -n '1,70p'
git diff --shortstat origin/master...HEAD
git diff --check origin/master...HEAD
python -m json.tool src/keycloak/bfp-realm.json >/tmp/pr182-bfp-realm.json.check && python -m json.tool src/keycloak/import/bfp-realm.json >/tmp/pr182-import-bfp-realm.json.check && echo 'keycloak realm JSON valid'
cd src && docker compose config --quiet
```

Outcomes from validation-style commands I actually ran:
- `git diff --check origin/master...HEAD` **failed**: `docs/fix-localhost-hsts.md:68` has trailing whitespace.
- Keycloak realm JSON syntax check **passed** for both realm files.
- `cd src && docker compose config --quiet` **passed** with no output.
- I did not run full pytest, ruff, frontend lint/build, or browser/Keycloak smoke tests.

## Files Retrieved

1. `docs/PR-rls-and-fixes.md` (lines 1-160, 160-379, 380-406) - PR's self-described intent, phased review fixes, files changed, rollout, known issues.
2. `src/backend/database.py` (lines 1-107) - runtime/admin session split, `SET LOCAL` RLS context, Celery `SYSTEM_TASK_USER_ID`.
3. `src/backend/auth.py` (lines 303-402) - `get_current_wims_user()` and canonical `get_db_with_rls()` dependency.
4. `src/backend/main.py` (lines 82-260, 321-389, 761-830) - startup schema patches, analytics RLS repair, `/api/analytics-summary` RLS dependency.
5. `src/docker-compose.yml` (lines 115-175, 238-260) - backend/celery database URL change and nginx port mapping.
6. `src/postgres-init/42_ref_table_rls.sql` (lines 1-44) - new reference geography RLS migration.
7. `src/postgres-init/43_app_login_role.sql` (lines 1-40) - new `wims_app_user` login role and grants.
8. `src/postgres-init/09_rls_helpers.sql` (lines 15-90), `src/postgres-init/10_rls_policies.sql` (lines 45-65, 145-172), `src/postgres-init/10a_m4_incident_scope.sql` (lines 1-130), `src/postgres-init/11_analytics_facts.sql` (lines 20-90), `src/postgres-init/03_users.sql` (lines 35-60), `src/postgres-init/21_all_regions.sql` (lines 1-80, 165-210) - RLS helpers/policies, analytics facts RLS, service account, canonical encoder region mapping.
9. `src/backend/api/routes/incidents.py` (diff context lines around 355-365 and 484-493), `src/backend/api/routes/regional.py` (lines 2070-2100, 2288-2326, 2388-2420), `src/backend/api/routes/map.py` (lines 100-155, 245-285, 360-410), `src/backend/api/routes/ref.py` (lines 1-115) - route dependency and RLS sync changes.
10. `src/backend/tasks/analytics_refresh.py` (lines 1-52), `src/backend/tasks/drafts.py` (lines 1-61), `src/backend/tasks/civilian_reports.py` (lines 1-56), `src/backend/tasks/narrative.py` (lines 1-60) - Celery service-account RLS context.
11. `src/backend/services/analytics_read_model.py` (lines 1-210, 182-285), `src/backend/services/regional_incidents/lifecycle.py` (lines 1-80, 700-740, 940-1025), `src/backend/services/afor_import/commit.py` (lines 1-35, 830-870) - analytics sync behavior and missed `SET LOCAL` risk candidates.
12. `src/backend/tests/test_ref_table_rls.py` (lines 1-214), `src/backend/tests/test_dev_user_seed_mapping.py` (lines 1-108), `src/backend/tests/test_rls_init_contract.py` (lines 1-37), `src/backend/tests/test_schema_patch_startup_guard.py` (lines 1-61) - new/changed focused tests for RLS and seed contracts.
13. `src/frontend/src/app/dashboard/validator/page.tsx` (lines 1-120, 145-205, 830-965), `src/frontend/src/app/dashboard/regional/page.tsx` (lines 1-120, 130-245, 255-325, 416-430, 750-770, 950-965) - refactored dashboard entry points and filter behavior.
14. `src/frontend/src/components/validator/types.ts` (lines 1-25), `src/frontend/src/components/validator/IncidentTableRow.tsx` (lines 1-80), `src/frontend/src/components/regional/IncidentCard.tsx` (lines 1-60), `src/frontend/src/components/ui/InfoBlock.tsx` (lines 1-23), `src/frontend/src/components/ui/index.ts` (lines 1-5) - extracted UI types/components.
15. `src/frontend/src/lib/roleRedirect.ts` (lines 1-40), `src/frontend/src/app/callback/page.tsx` (lines 1-100), `src/frontend/src/lib/__tests__/roleRedirect.test.ts` (lines 1-31), `src/frontend/src/app/login/page.tsx` (lines 1-91), `src/frontend/src/app/dashboard/page.tsx` (lines 1-120), `src/frontend/src/components/Sidebar.tsx` (lines 205-252) - post-login routing and nav changes.
16. `src/frontend/src/components/IncidentForm.tsx` (lines 92-124, 790-825, 1412-1424) - per-user manual-entry draft isolation and autosave guard.
17. `src/keycloak/themes/wims-bfp/login/resources/css/wims-custom.css` (lines 1-140, 500-550, 714-846, 921-1020), `src/keycloak/themes/wims-bfp/login/login-config-totp.ftl` (lines 1-130), `src/keycloak/themes/wims-bfp/login/login.ftl` (lines 1-70), `src/keycloak/bfp-realm.json` (lines 860-885, 2320-2360, 2424-2430, 2440-2458, 2780-2796), `src/keycloak/import/bfp-realm.json` (same line ranges) - Keycloak theme, MFA, redirect URI, user profile, and encoder seed changes.
18. `src/nginx/nginx.conf` (lines 1-230), `src/nginx/nginx.local.conf` (lines 1-99), `src/docker-compose.override.yml` (lines 1-4), `src/docker-compose.prod.yml` (lines 1-25), `src/frontend/.dockerignore` (lines 1-10) - nginx/CORS/HSTS/local-vs-prod config and Docker ignore.
19. `scripts/seed-dev-users.sh` (lines 1-170), `scripts/seed-dev-users.ps1` (lines 1-131), `docs/fix-localhost-hsts.md` (lines 1-92), `scripts/Fix-LocalhostHSTS.ps1` (lines 1-43), `docs/regional-dashboard-handover.md` (lines 1-130) - dev user seeding and docs changes.
20. `.github/workflows/ci.yml` (lines 110-150, 185-240, 250-268), `src/backend/pyproject.toml` (lines 1-17), `src/frontend/package.json` (lines 1-42) - likely CI/validation commands.
21. `system-wiki/log.md` (lines 1-120 and 1441-1570), `system-wiki/database/sql-init-files.md` (lines 1-180, 340-365), `system-wiki/architecture/infrastructure-config.md` (lines 1-140), `system-wiki/frontend/route-map.md` (lines 1-58), `system-wiki/subsystems/validator-hub.md` (lines 1-100), `system-wiki/subsystems/regional-dashboard.md` (lines 1-120), `system-wiki/gaps/ui-ux-gap-register.md` (lines 1-138), `system-wiki/operations/local-dev-deploy-guide.md` (lines 100-115), `system-wiki/architecture/pwa-tests-cicd.md` (lines 145-155) - wiki updates and possible stale spots.

## PR Intent

PR #182's branch intent is **Encoder/Validator page refactor + M15a row-level security**. The branch itself documents six main goals: component extraction for large encoder/validator pages, reference table RLS, switching app runtime DB access from `postgres` to `wims_app_user`, login/auth fixes, dashboard filter fixes, and dev encoder account cleanup (`docs/PR-rls-and-fixes.md` lines 1-18).

Git evidence:
- HEAD: `ad2bd03c348d66ec0c1bd74d72016124370246cf`.
- Merge base with `origin/master`: `5e7717483f16c75d4f04b083a15f87fd0c68f6f2`.
- HEAD is detached locally, but `git branch -r --contains HEAD` shows `origin/fix--refactored-enc-val-pages-and-M15-row-level-sec` and `pr/182`.
- Diff size: `104 files changed, 6621 insertions(+), 1943 deletions(-)`.

Commit themes from `origin/master..HEAD`: initial `refactor(enc-val)...M15a`, RLS fixes, backend/celery/test/ruff fixes, UI/login fixes, docs rewrite, PR review fixes, and final merge commit.

## Main Touched Subsystems

Counts from `git diff --name-only origin/master...HEAD`:
- Backend: 35 files.
- Frontend: 23 files.
- Postgres init/migrations: 10 files.
- Docs: 5 files.
- System wiki: 14 files.
- Scripts: 5 files.

Primary subsystems:
1. **RLS/database runtime** - `src/backend/database.py`, `src/backend/auth.py`, `src/backend/main.py`, SQL init files `09`, `10`, `11`, `42`, `43`, Docker DB env.
2. **Reference geography and dev users** - `03_users.sql`, `21_all_regions.sql`, Keycloak realms, `scripts/seed-dev-users.*`, `test_dev_user_seed_mapping.py`.
3. **Backend route RLS dependency cleanup** - API routes now import `get_db_with_rls` from `auth` instead of `database`, and selected routes reapply `set_rls_context()` after `db.commit()`.
4. **Celery RLS context** - analytics/drafts/civilian/narrative tasks use `SYSTEM_TASK_USER_ID`.
5. **Frontend encoder/validator dashboards** - large page component extraction and filter behavior changes.
6. **Login/auth redirect and draft isolation** - `roleRedirect.ts`, callback/login/dashboard pages, `IncidentForm.tsx` per-user draft key.
7. **Keycloak/login theme** - OTP/TOTP CSS/FTL layout, profile enforcement, redirect URI/web origins.
8. **Nginx/local HSTS/CORS** - production CORS whitelist, local HTTP passthrough docs/scripts.
9. **Docs/wiki** - PR handover docs, HSTS doc, multiple system-wiki synthesis pages and log entries.

## Key Code

### Runtime RLS connection split

- `src/docker-compose.yml` lines 123-128 sets backend `DATABASE_URL=postgresql://wims_app_user:wimsapp@postgres:5432/wims` and `DATABASE_ADMIN_URL=postgresql://postgres:password@postgres:5432/wims`; celery gets `DATABASE_URL=wims_app_user` at lines 161-167.
- `src/backend/database.py` lines 18-33 creates normal `_SessionLocal` from `DATABASE_URL` and `_AdminSessionLocal` from `DATABASE_ADMIN_URL`; lines 48-59 use `SET LOCAL wims.current_user_id = :uid`; lines 62-80 make `get_db()` an admin session; lines 83-107 let Celery/scripts call `get_session(user_id)`.
- `src/backend/auth.py` lines 303-378 resolves the Keycloak JWT to `wims.users`; lines 381-402 yields `_SessionLocal()` and calls `set_rls_context()` from the resolved user.

### Startup self-healing patches

- `src/backend/main.py` lines 102-127 describes startup patches: immutable rule, ref table RLS, service account, MV ownership, and analytics facts RLS.
- Lines 142-166 ensure `wims_app`/`wims_app_user` and grants.
- Lines 194-205 apply ref/users RLS patches.
- Lines 210-239 ensure `svc_task` and materialized view ownership.
- Lines 321-389 rebuild analytics facts RLS policies using `wims.current_user_role()` instead of PostgreSQL database roles.
- Lines 761-765 make `/api/analytics-summary` use `Depends(auth.get_db_with_rls)`.

### SQL migrations

- `src/postgres-init/43_app_login_role.sql` lines 1-5 explains backend/Celery connect as `wims_app_user`; lines 15-20 create/grant the login role; lines 25-38 grant schema/table/sequence/default privileges.
- `src/postgres-init/42_ref_table_rls.sql` lines 10-17 enables/forces RLS on `ref_regions`, `ref_provinces`, and `ref_cities`; lines 20-42 apply region-scoped SELECT policies.
- `src/postgres-init/09_rls_helpers.sql` lines 19-28 and 38-45 make role/region helper functions `SECURITY DEFINER` to avoid recursion on `wims.users`.
- `src/postgres-init/10_rls_policies.sql` lines 50-57 broadens users SELECT to staff roles.
- `src/postgres-init/11_analytics_facts.sql` lines 24-29 enables/forces analytics facts RLS and explains why `TO <role>` was incompatible with `wims_app_user`; lines 31-81 define read/write policies and grants.

### Route-level RLS and `SET LOCAL` reapply

- `src/backend/api/routes/incidents.py` diff context shows `set_rls_context(db, uuid.UUID(user_id))` before analytics sync after commit for upload bundle and create incident.
- `src/backend/api/routes/regional.py` lines 2309-2321 reapply `set_rls_context(db, corrector_user_id)` before `sync_incident_to_analytics()` after a correction commit.
- `src/backend/api/routes/map.py` lines 364-383 make `/api/validator/operational-map` use `auth.get_db_with_rls` directly.
- `src/backend/api/routes/ref.py` lines 20-97 use RLS DB for regions/provinces/cities; lines 88-92 bind `province_ids` placeholders instead of interpolating IDs.

### Frontend component extraction and auth redirect

- `src/frontend/src/app/dashboard/validator/page.tsx` lines 17-23 imports extracted validator components/types; lines 194-199 make status filter not mutate date; lines 838-963 render `IncidentTableRow` and extracted modals.
- `src/frontend/src/app/dashboard/regional/page.tsx` lines 22-24 imports regional components; lines 172-213 separate stats and incident loads; lines 311-314 make status selection not mutate date; lines 420-428/758-768/956-960 render extracted toasts/cards/wildland breakdown.
- Extracted validator component sizes: `ActionModal.tsx` 140 lines, `IncidentTableRow.tsx` 200, `ValidatorDuplicateModal.tsx` 100, plus smaller confirm/bulk/types files.
- Extracted regional component sizes: `IncidentCard.tsx` 121, `NotificationToasts.tsx` 81, `WildlandFireBreakdown.tsx` 68, `InfoBlock.tsx` 23.
- `src/frontend/src/lib/roleRedirect.ts` lines 1-40 centralizes role default routes and rejects cross-origin/cross-role saved dashboard redirects.
- `src/frontend/src/app/callback/page.tsx` lines 48-61 refreshes session/profile, fetches `/api/auth/session`, clears saved redirect, and routes with `resolvePostLoginRedirect()`.
- `src/frontend/src/components/IncidentForm.tsx` lines 112-120 uses `wims:incident_draft:${user.id}` and clears legacy key; lines 812-823 autosave only after `userEditedDraftRef`; lines 1415-1420 marks user edits on form `onChange`.

### Keycloak and nginx

- `src/keycloak/bfp-realm.json` and `src/keycloak/import/bfp-realm.json` lines 865-882 add `http://localhost:8090/*` redirect/web origin, lines 2349-2354 set `UPDATE_PROFILE.defaultAction=true`, line 2427 adds `userProfileConfig`, and lines 2440-2456/2780-2796 show canonical encoder users.
- `src/keycloak/themes/wims-bfp/login/resources/css/wims-custom.css` lines 82-96 alter the login container, lines 502-517 define compact TOTP setup grid, lines 714-846 define OTP input grids/cards, and lines 921-1020 add mobile breakpoints.
- `src/nginx/nginx.conf` lines 16-24 add a localhost server, lines 53-76 are dev-only open CORS echo, and lines 166-195 whitelist production API CORS origins.

## Architecture

The branch converts RLS from mostly declarative-but-bypassed to runtime-enforced:

1. Docker backend/celery connect as `wims_app_user` (`src/docker-compose.yml`), not `postgres`.
2. Auth resolves the WIMS user through admin DB access (`get_db()`/`_AdminSessionLocal`) because `wims.users` itself is RLS-protected.
3. Protected routes use `auth.get_db_with_rls()`, which opens a non-superuser session and runs `SET LOCAL wims.current_user_id = <wims_user_id>`.
4. SQL helper functions read that GUC and RLS policies filter rows by role/region/user.
5. Startup patches in `main.py` repair existing deployments that did not rerun new postgres-init migrations.
6. Celery tasks use the seeded `svc_task` SYSTEM_ADMIN user ID so background jobs see rows under RLS.
7. Frontend role redirect and reference endpoints are expected to align with the RLS-scoped route/data behavior.

Frontend architecture is mostly extraction: existing page state remains in the two dashboard page files; row/cards/modals are moved into `components/validator/` and `components/regional/`, with shared primitives in `components/ui/`.

## Risky Files / Open Questions

1. **Likely missed `SET LOCAL` reapply after commit in lifecycle service.**  
   `database.set_rls_context()` uses `SET LOCAL`, transaction-scoped (`src/backend/database.py` lines 48-59). PR fixed this pattern in `incidents.py` and `regional.py`, but `src/backend/services/regional_incidents/lifecycle.py` still commits then calls analytics sync without reapplying context: verify action commits at line 717 then syncs at lines 726-729; archive commits at line 947 then syncs at lines 953-954; unarchive commits at line 1008 then syncs at lines 1014-1015. These are invoked by `regional.py` lines 2086-2094 and 2398-2418. `sync_incident_to_analytics()` swallows/logs DB errors (`analytics_read_model.py` lines 82-88, 174-180), so failures may be silent.

2. **Analytics facts validator scope may conflict with cross-region validator intent.**  
   `10a_m4_incident_scope.sql` says `NATIONAL_VALIDATOR` has cross-region read/write (lines 1-4, 12-18), but `11_analytics_facts.sql` scopes validator SELECT to `region_id = current_user_region_id()` (lines 44-50). This may be intentional for analytics, but should be checked against M15/validator expectations.

3. **Startup patch complexity and non-fatal failures.**  
   `src/backend/main.py` lines 142-255 applies critical RLS/role/MV policy patches but logs warnings and continues on exceptions. Validate actual startup logs and DB state, not just app boot.

4. **Import-time admin engine URL.**  
   `src/backend/main.py` lines 82-86 creates `_startup_admin_engine` at import from `DATABASE_ADMIN_URL`/`SQLALCHEMY_DATABASE_URL`/`DATABASE_URL` or `""`. CI/Docker set env, but local imports without env may be fragile after dependencies are installed.

5. **Nginx local/prod path split.**  
   Branch changed `src/nginx/nginx.conf`, but plain local `docker compose` also loads `src/docker-compose.override.yml` lines 1-4, mounting `src/nginx/nginx.local.conf`. Local port `8090` is from compose host mapping `8090:80` (`src/docker-compose.yml` lines 241-245), not necessarily the new `listen 8090` in `nginx.conf`.

6. **Keycloak theme needs browser smoke.**  
   Realm JSON is syntactically valid, but FTL/CSS changes are broad. Also note `src/keycloak/themes/wims-bfp/login/login.ftl` line 31 contains a malformed-looking `class="${properties.kcFormClass!} onsubmit=...` attribute; `git show origin/master:...` showed the same pattern on base, so it is not introduced by this PR, but this touched template still deserves login smoke.

7. **Docs/wiki drift.**  
   Wiki was updated, but `system-wiki/architecture/infrastructure-config.md` still lists backend `DATABASE_URL` default as postgres at lines 45-50 while compose now uses `wims_app_user` (`src/docker-compose.yml` lines 127-128). Same page line 117 still says CORS dynamically echoes `$http_origin`, while production `nginx.conf` now whitelists origins at lines 174-183.

8. **Whitespace check fails.**  
   `git diff --check origin/master...HEAD` reports trailing whitespace at `docs/fix-localhost-hsts.md:68`.

## Docs/Wiki Already Changed

Docs changed (5):
- `docs/CHANGELOG.md`
- `docs/M4-INCIDENT-WORKFLOW-DETAILS.md`
- `docs/PR-rls-and-fixes.md` (new)
- `docs/fix-localhost-hsts.md` (new)
- `docs/regional-dashboard-handover.md`

System wiki changed (14):
- `system-wiki/architecture/docs-and-scripts.md`
- `system-wiki/architecture/infrastructure-config.md`
- `system-wiki/architecture/pwa-tests-cicd.md`
- `system-wiki/database/sql-init-files.md`
- `system-wiki/frontend/frontend-infrastructure.md`
- `system-wiki/frontend/route-map.md`
- `system-wiki/gaps/ui-ux-gap-register.md`
- `system-wiki/index.md`
- `system-wiki/log.md`
- `system-wiki/operations/local-dev-deploy-guide.md`
- `system-wiki/subsystems/references/regional-api-ref.md`
- `system-wiki/subsystems/regional-dashboard.md`
- `system-wiki/subsystems/validator-hub.md`
- `system-wiki/ui-ux/evaluation-loginpage-keycloaksso.md`

Notable wiki evidence:
- `system-wiki/log.md` lines 6-12 record frontend tab-switching investigation and HSTS doc/script.
- `system-wiki/log.md` lines 14-32 record RLS helper source-of-truth and auth/RLS test override updates.
- `system-wiki/log.md` lines 83-88 record canonical dev encoder usernames/mapping.
- `system-wiki/database/sql-init-files.md` line 365 mentions reference table RLS via `42_ref_table_rls.sql`, but `43_app_login_role.sql` is not clearly documented in that synthesis page from the inspected lines.

## Likely Validation Commands

CI-derived commands and targeted follow-ups:

```bash
# Whitespace first: currently fails at docs/fix-localhost-hsts.md:68
git diff --check origin/master...HEAD

# Frontend CI path
cd src/frontend
npm ci
npm run lint
npx vitest run
NEXT_PUBLIC_AUTH_API_URL=http://localhost:8080/auth/realms/bfp NEXT_PUBLIC_MAPBOX_TOKEN= NEXT_PUBLIC_BASE_URL=http://localhost npm run build

# Backend CI path (use a venv locally, especially on Arch)
cd src/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
ruff check .
ruff format --check .
pytest -v --tb=short --ignore=tests/test_rate_limiting.py --ignore=tests/test_suricata_ingestion.py --ignore=tests/test_infra_config.py --ignore=tests/integration/test_wims_initial_schema_bootstrap.py --ignore=tests/integration/test_auth_otp_policy.py --ignore=tests/integration/test_database_schema.py --ignore=tests/integration/test_rls_policy_enforcement.py --ignore=tests/integration/test_sql_quality_audit.py

# Targeted backend checks for this branch
cd src/backend
pytest tests/test_dev_user_seed_mapping.py tests/test_rls_init_contract.py tests/test_schema_patch_startup_guard.py -v
pytest tests/test_ref_table_rls.py -v  # requires initialized Postgres with wims_app_user

# Compose/infra
cd src
docker compose config --quiet
docker compose build --parallel

# Realm JSON sanity (already passed in scout)
python -m json.tool src/keycloak/bfp-realm.json >/tmp/bfp-realm.json.check
python -m json.tool src/keycloak/import/bfp-realm.json >/tmp/import-bfp-realm.json.check
```

Manual/runtime validation that matters for this branch:
- `cd src && docker compose up --build -d`, then inspect `docker logs -f wims-backend --since 30s` for the schema patch log lines listed in `docs/PR-rls-and-fixes.md` lines 341-351.
- Run `bash scripts/seed-dev-users.sh` on a live dev stack, then login smoke for `encoder_ncr`, one non-NCR encoder, `validator_test`, `analyst_test`, and `admin_test`.
- RLS smoke: encoder sees only own `ref_regions/ref_provinces/ref_cities`; analyst/validator/admin see expected broader data.
- Validator workflow smoke: approve/archive/unarchive an incident and verify `wims.analytics_incident_facts` updates despite the lifecycle `SET LOCAL` risk above.
- Keycloak browser smoke: initial login, UPDATE_PROFILE for a newly created non-seed user, TOTP enrollment, OTP challenge, and localhost:8090 redirect.
- Nginx production CORS smoke: allowed origins (`https://wimsbfp.tech`, `https://wims.bfp.gov.ph`) get credentialed CORS; disallowed origins do not.

## Start Here

Start with `docs/PR-rls-and-fixes.md` for the intended narrative, then immediately inspect `src/backend/database.py`, `src/backend/auth.py`, `src/backend/main.py`, and `src/postgres-init/42_ref_table_rls.sql` / `43_app_login_role.sql` because the core risk is whether the new `wims_app_user` + `SET LOCAL` RLS path works consistently across routes, tasks, and startup patches.
