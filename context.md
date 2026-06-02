# Code Context — Profile/Email Feature Review

**Branch:** `fix/profile-email-and-polish` (5 commits on top of `master` base at `5e77174`)
**Issues:** #28 (profile/email editing), #86 (frontend profile tests)
**Last commit:** `4721f80` — "fix(#28): sync DB username when email changes (S1)"

---

## Files Retrieved

1. `src/backend/api/routes/user.py` (lines 1–242) — Self-service profile routes; core of the feature.
2. `src/backend/auth.py` (lines 1–420) — Auth dependency `get_current_wims_user()` resolution; `email` added to `user_dict`.
3. `src/backend/main.py` (lines 1–310) — FastAPI app entry; startup schema patch for email column + index.
4. `src/backend/services/keycloak_admin.py` (lines 1–200) — Keycloak admin client; `update_user_profile()` now syncs email and username.
5. `src/backend/tests/test_profile_email.py` (lines 1–222) — 10 backend tests for profile/email endpoints.
6. `src/frontend/src/app/profile/page.tsx` (lines 1–320) — Profile page component with email input and password change.
7. `src/frontend/src/app/profile/__tests__/profile.test.tsx` (lines 1–204) — 9 frontend tests for profile page.
8. `src/frontend/src/lib/api/legacy.ts` (lines 1–700+) — API client; `fetchMyProfile`, `updateMyProfile`, `changeMyPassword` functions.
9. `src/frontend/src/lib/api/transport.ts` (lines 1–96) — `apiFetch` transport with 401 refresh/redirect handling.
10. `src/frontend/src/lib/api/admin.ts` (lines 1–18) — Re-exports profile API functions from legacy.ts.
11. `src/frontend/src/lib/api/index.ts` (lines 1–15) — Central API barrel export.
12. `src/postgres-init/44_add_email_to_users.sql` (lines 1–10) — DB migration: `email VARCHAR(255)`, `idx_users_email`.
13. `src/postgres-init/03_users.sql` (lines 1–64) — Original `wims.users` table definition (before email column).
14. `src/postgres-init/10_rls_policies.sql` — RLS policies on `wims.users` (self-or-admin select/update).
15. `system-wiki/backend/remaining-routes.md` (lines 1–120) — Updated ProfileUpdate/email docs.
16. `system-wiki/log.md` (lines 1–80) — 5 detailed log entries for this feature.
17. `src/backend/requirements.txt` (lines 1–25) — Dependencies; `email-validator>=2.0.0` already present.
18. `src/frontend/src/context/AuthContext.tsx` (lines 1–80) — Auth context providing `user` object with `email` field.

---

## Key Code

### Backend: ProfileUpdate Schema (`src/backend/api/routes/user.py`, lines 21–50)

```python
class ProfileUpdate(BaseModel):
    """Fields a user is allowed to update on their own profile."""
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[EmailStr] = None          # <-- NEW: EmailStr validated
    contact_number: Optional[str] = None

    @field_validator("first_name", "last_name")
    @classmethod
    def name_not_empty(cls, v):
        if v is not None and not v.strip():
            raise ValueError("Name must not be blank")
        return v.strip() if v else v
```

### Backend: Email sync in `update_my_profile()` (`src/backend/api/routes/user.py`, lines 82–138)

- Updates Keycloak first via `update_user_profile(...)` — this is the source of truth.
- Then syncs `contact_number` and `email`/`username` to `wims.users` in independent try/except blocks.
- On DB sync failure, returns `{"status": "partial", "message": ...}` instead of silently succeeding.
- S1 fix: email DB sync also sets `username = :uname` (same as email).

### Backend: `get_my_profile()` (`src/backend/api/routes/user.py`, lines 59–78)

- Fetches profile from Keycloak via `get_user_profile(keycloak_id)`.
- Augments with `contact_number` from `wims.users` DB query.
- Falls back to `current_user.get("email", "")` if Keycloak profile has no email.

### Backend: Auth `user_dict` email (`src/backend/auth.py`, line ~370)

```python
user_dict = {
    "user_id": row[0],
    "keycloak_id": keycloak_sub,
    "role": row[1],
    "username": row[2],
    "kc_username": token_payload.get("preferred_username"),
    "email": token_payload.get("email", ""),   # <-- ADDED by review fix
}
```
This ensures the email fallback in `get_my_profile()` has a real value from the JWT.

### Backend: Startup schema patch (`src/backend/main.py`, lines 60–98)

```python
# Migration 44: add email column to wims.users
db.execute(text("ALTER TABLE wims.users ADD COLUMN IF NOT EXISTS email VARCHAR(255)"))
db.execute(text("CREATE INDEX IF NOT EXISTS idx_users_email ON wims.users(email)"))
```

### Backend: Keycloak email sync (`src/backend/services/keycloak_admin.py`, lines 145–170)

```python
def update_user_profile(keycloak_id, *, first_name=None, last_name=None, email=None, contact_number=None):
    payload = {}
    ...
    if email is not None:
        payload["email"] = email
        payload["username"] = email  # keep username = email in sync
    ...
    adm.update_user(user_id=keycloak_id, payload=payload)
```

### Frontend: Email input and warning (`src/frontend/src/app/profile/page.tsx`, lines 46–54, 129–157)

- Editable email input with placeholder showing current email from fetched profile.
- Alert banner: "Changing your email may update your login identity/username."
- Phone validation: `/^09\d{9}$/` (11 digits starting with 09).

### Frontend: API functions (`src/frontend/src/lib/api/legacy.ts`, lines 203–232)

```typescript
export async function fetchMyProfile(): Promise<{ first_name: string; last_name: string; email: string; contact_number: string }>
export async function updateMyProfile(payload: { first_name?: string; last_name?: string; email?: string; contact_number?: string })
export async function changeMyPassword(payload: { current_password: string; new_password: string; otp_code?: string })
```
All use `apiFetch()` from `transport.ts` which includes cookie auth and 401→refresh→redirect logic.

### DB Migration (`src/postgres-init/44_add_email_to_users.sql`)

```sql
ALTER TABLE wims.users ADD COLUMN IF NOT EXISTS email VARCHAR(255);
CREATE INDEX IF NOT EXISTS idx_users_email ON wims.users(email);
```

### DB Schema (`src/postgres-init/03_users.sql`)

Original `wims.users` columns: `user_id` (UUID PK), `keycloak_id` (UUID UNIQUE), `username` (VARCHAR UNIQUE), `role` (VARCHAR), `assigned_region_id`, `contact_number`, `is_active`, `mfa_enabled`, `last_login`, `created_at`, `updated_at`.

---

## Architecture

### Data Flow: Email Editing

```
User types email → ProfilePage (React state)
  → updateMyProfile(payload) in legacy.ts
    → apiFetch('PATCH /api/user/me') with JSON body
      → update_my_profile() in user.py
        1. update_user_profile() → Keycloak Admin API → sets email + username in Keycloak
        2. DB: UPDATE wims.users SET email=..., username=..., updated_at=now() WHERE user_id=...
        3. If (2) fails → returns {"status": "partial", ...}
```

### Data Flow: Profile View

```
ProfilePage mount → useEffect → fetchMyProfile()
  → apiFetch('GET /api/user/me/profile')
    → get_my_profile() in user.py
      1. Get_user_profile(keycloak_id) → Keycloak Admin API → first_name, last_name, email
      2. SELECT contact_number FROM wims.users WHERE keycloak_id = ...
      3. If no email from Keycloak → use current_user["email"] from JWT
      4. Return merged profile
```

### Auth Integration

- All profile routes depend on `get_current_wims_user` (FastAPI dependency).
- This dependency validates JWT → matches to `wims.users` row → returns `user_dict` (with email).
- For DB writes, `get_db_with_rls` sets `SET LOCAL wims.current_user_id` for RLS enforcement.
- RLS on `wims.users` allows self or SYSTEM_ADMIN to UPDATE/SELECT.

### Keycloak Integration

- `update_user_profile()` in `keycloak_admin.py` is the source-of-truth write.
- Uses `_get_admin_client()` which authenticates as Keycloak master admin via direct grant.
- When email changes, Keycloak also updates `username` to match email.
- `get_user_profile()` fetches user data from Keycloak admin API.

### Frontend Routing

- Profile page at `/profile` → renders `ProfilePage` component.
- Uses `useAuth()` from `AuthContext` to get current user (`loading`, `user`, `logout`).
- `fetchMyProfile()` called on mount to populate current values as placeholders.
- `updateMyProfile()` called on save with only non-empty fields.
- On password change success, calls `logout()` after 1.5s delay.

### Test Structure

- **Backend:** `test_profile_email.py` — 10 tests covering:
  - ProfileUpdate schema (email field present, null by default, EmailStr validation, invalid rejects)
  - PATCH /api/user/me (email→Keycloak, email→DB, DB partial failure)
  - GET /api/user/me/profile (email from Keycloak, fallback to context email)
- **Frontend:** `profile.test.tsx` — 9 tests covering:
  - Email input renders, current email in placeholder, warning text
  - Fallback when profile has no email
  - Region display: All Regions (NATIONAL_ANALYST), National (SYSTEM_ADMIN), region ID (REGIONAL_ENCODER), dash (no region)
  - Profile save calls `updateMyProfile` with email

---

## Integration Points

| Integration | File(s) | Direction |
|---|---|---|
| **DB Schema** | `03_users.sql` → `44_add_email_to_users.sql` | Added `email VARCHAR(255)` + index to `wims.users` |
| **Startup Patch** | `main.py` `apply_schema_patches()` | Idempotent `ADD COLUMN IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` for existing containers |
| **Keycloak** | `keycloak_admin.py` `update_user_profile()` | Writes email + username to Keycloak (source of truth) |
| **Keycloak** | `keycloak_admin.py` `get_user_profile()` | Reads email from Keycloak for profile display |
| **Backend Auth** | `auth.py` `get_current_wims_user()` | `user_dict` now carries `"email"` from JWT for fallback |
| **Backend Route** | `user.py` `update_my_profile()` | Updates Keycloak first, then DB (two-phase: KC→DB) |
| **Backend Route** | `user.py` `get_my_profile()` | Reads Keycloak, augments from DB, falls back to JWT email |
| **Frontend API** | `legacy.ts` → `transport.ts` | `apiFetch()` with cookie auth, 401→refresh→redirect |
| **Frontend Re-export** | `admin.ts` → `legacy.ts` → `index.ts` | Profile functions re-exported through barrel |
| **Frontend Auth** | `AuthContext.tsx` | Provides `user.email` from session |
| **Frontend Component** | `profile/page.tsx` | Email input, warning text, save handler |
| **Wiki Docs** | `remaining-routes.md`, `log.md` | Updated to document email profile feature |

---

## Start Here

Open **`src/backend/api/routes/user.py`** first. It contains both endpoint implementations (`get_my_profile`, `update_my_profile`, `change_my_password`) and the `ProfileUpdate`/`PasswordChange` schemas. This is the heart of the feature and where all backend-side changes converge. Follow the call chain:

1. `user.py:update_my_profile()` → calls `keycloak_admin.py:update_user_profile()` for Keycloak write
2. `user.py:update_my_profile()` → calls DB UPDATE for `wims.users` sync
3. `user.py:get_my_profile()` → calls `keycloak_admin.py:get_user_profile()` for Keycloak read

From there, examine `test_profile_email.py` to verify test coverage of every code path, then `profile/page.tsx` to validate the frontend integration.

---

## Constraints, Risks & Open Questions

- **Keycloak is source of truth** — DB sync is best-effort. On partial failure, user sees a warning but Keycloak data is already updated. This is intentional but could lead to inconsistency if Keycloak is rolled back separately.
- **Username = email in Keycloak** — When email is updated, Keycloak also sets `username = email`. This is a Keycloak-level identity change that affects login credentials. Frontend warns the user.
- **RLS on self-update** — `users_self_update_or_admin` policy allows the user to update their own row. The PATCH route uses `get_db_with_rls()` which sets `wims.current_user_id` via `SET LOCAL`. This works because the auth dependency ran first and attached `request.state.wims_user`.
- **No route for removing email** — The `ProfileUpdate.email` is `Optional[EmailStr] = None`. Setting it to `None` means "don't update email". There is no way to clear the email field via the API. This is likely intentional (email is a login identifier).
- **Password change min length discrepancy** — Backend validates min 8 chars, frontend min 12 chars. The frontend is stricter; backend accepts passwords the frontend would reject. This could confuse users bypassing the UI (direct API calls).
- **Email column denormalization** — Email is stored in both Keycloak (source) and `wims.users` (cache). No sync-back mechanism if Keycloak is updated outside this endpoint (e.g., admin console).
- **Test coverage is good but not exhaustive** — No test for updating all fields simultaneously, no test for Keycloak failure rollback behavior (DB is not rolled back when Keycloak fails — the route raises 502 before DB writes).
