# Red Team Demo — Information Disclosure Pentest

**Target:** `https://wimsbfp.tech`
**Audience:** ITCST Professors
**Runtime:** 5–10 minutes
**Stance:** Ethical Hacker (Red Team)

---

## Setup (Before Presenting)

```bash
# Install testssl.sh
brew install testssl.sh
# or: git clone https://github.com/drwetter/testssl.sh.git

# Burp Suite running, browser proxy configured

# Terminal 1 (split pane): curl commands
# Terminal 2 (split pane): testssl.sh output
```

---

## Phase 1: Reconnaissance (~2 min)

### 1. TLS Protocol Scan

**Narrator:** *"First, we scan the transport layer to see what protocols the server accepts."*

```bash
testssl.sh --protocols https://wimsbfp.tech
```

**What to look for in output:**
- ✅ `TLS 1.2` offered
- ✅ `TLS 1.3` offered
- ❌ No `TLS 1.1` or `TLS 1.0`
- ❌ No `SSLv3` or `SSLv2`

**Talk track:** *"testssl.sh probes every protocol version the server supports. Here we see only TLS 1.2 and 1.3 — deprecated versions are disabled. This is a pass."*

---

### 2. Cipher Strength Check

**Narrator:** *"Next, we check which cipher suites the server negotiates — weak ciphers mean weak encryption."*

```bash
testssl.sh --std https://wimsbfp.tech
```

**What to look for:**
- ✅ `TLS_AES_256_GCM_SHA384` (TLS 1.3)
- ✅ `TLS_CHACHA20_POLY1305_SHA256` (TLS 1.3)
- ✅ `ECDHE-ECDSA-AES256-GCM-SHA384` (TLS 1.2)
- ❌ No `RC4`, `3DES`, `CBC-mode`, `EXPORT` ciphers

**Talk track:** *"Only AEAD ciphers are accepted — AES-256-GCM and ChaCha20-Poly1305. No weak or export-grade ciphers. Forward secrecy is enforced via ECDHE."*

---

### 3. Security Headers Scan

**Narrator:** *"Let's look at what security headers the server sends. These tell browsers how to behave."*

```bash
curl -sI https://wimsbfp.tech | grep -Ei '(strict-transport|x-content|x-frame|referrer|content-security|permissions|server)'
```

**Expected output:**
```
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
Referrer-Policy: strict-origin-when-cross-origin
Content-Security-Policy: default-src 'self'; ...
Permissions-Policy: camera=(), microphone=(), geolocation=(self)
Server: nginx
```

**Talk track:** *"Six of seven OWASP-recommended headers are present — HSTS forces HTTPS, X-Frame-Options prevents clickjacking, X-Content-Type-Options blocks MIME sniffing. The server banner says 'nginx' without a version — they've hidden that too."*

**Point out:** `X-Frame-Options: SAMEORIGIN` means the app CAN be framed from its own domain — a clickjacking surface on subdomains if any exist.

---

### 4. API Surface Discovery

**Narrator:** *"We probe for exposed documentation that would reveal the full API surface to an attacker."*

```bash
# Check OpenAPI schema
curl -sI https://wimsbfp.tech/openapi.json

# Swagger docs
curl -s -o /dev/null -w "HTTP %{http_code}" https://wimsbfp.tech/docs
```

**Expected:**
- `/openapi.json` → `404` (blocked by Next.js routing)
- `/docs` → HTTP 404 or timeout

**⚠️ Finding:** FastAPI's OpenAPI docs are NOT directly accessible through nginx — Next.js sits in front and returns 404.

**Talk track:** *"OpenAPI docs would list every endpoint, schema, and parameter — a goldmine for attackers. Here, FastAPI docs are blocked behind the Next.js layer. But let's try hitting the backend directly..."*

---

### 5. Dotfile & Sensitive Path Probing

**Narrator:** *"Common configuration files are often left exposed on production servers."*

```bash
for path in /.git/HEAD /.env /backup /robots.txt /admin; do
  echo "$path -> $(curl -s -o /dev/null -w '%{http_code}' https://wimsbfp.tech$path)"
done
```

**Expected:**
- `/.git/HEAD` → 404
- `/.env` → timeout/404
- `/backup` → timeout/404
- `/robots.txt` → 404
- `/admin` → 404 (Next.js page, not directory listing)

**Talk track:** *"No exposed dotfiles, no backup paths, no directory listing. The nginx configuration properly proxies everything through instead of serving static files."*

---

## Phase 2: Auth & Access Probing (~2 min)

### 6. Authentication Boundary Testing

**Narrator:** *"We probe protected endpoints without authentication to see how the server responds."*

```bash
# No auth
echo "GET /api/operations -> $(curl -s -o /dev/null -w 'HTTP %{http_code}' https://wimsbfp.tech/api/operations)"

# With Origin header (some CORS misconfigurations only trigger with Origin)
curl -s -D- https://wimsbfp.tech/api/operations | head -10
```

**Expected:**
- `GET /api/operations` → **HTTP 401**
- Response body: `{"detail":"Authentication credentials missing"}`

```bash
# Try /metrics (Prometheus endpoint)
echo "/metrics -> $(curl -s -o /dev/null -w 'HTTP %{http_code}' https://wimsbfp.tech/metrics)"
```

**Expected:** `/metrics` → **HTTP 404** (nginx explicitly returns 404 for this path)

**Talk track:** *"The API properly returns 401 for unauthenticated requests. The /metrics endpoint is also blocked at the nginx level — no Prometheus data exposed."*

---

### 7. Pydantic Validation Error Leak

**Narrator:** *"Now we try the civilian reports endpoint. Even with no auth, the server talks back — and tells us more than it should."*

```bash
curl -s https://wimsbfp.tech/api/civilian/reports
```

**Expected HTTP 422 response:**
```json
{"detail":[{"type":"missing","loc":["query","device_id"],
"msg":"Field required","input":null}]}
```

**⚠️ Finding:** The error reveals the internal parameter name `device_id` — a valid query parameter. This is a minor information disclosure.

**Talk track:** *"Even rejected requests leak information. The server tells us exactly what it expects — `device_id` is a required query parameter. This is internal schema leakage through FastAPI's default validation errors."*

---

### 8. CORS Origin Testing

**Narrator:** *"We test whether the server trusts origins it shouldn't — a misconfiguration that allows cross-origin data theft."*

```bash
# Unauthorized origin
echo "=== evil.com origin ==="
curl -s -D- -H "Origin: https://evil.com" https://wimsbfp.tech/api/operations | grep -i access-control

echo ""
echo "=== null origin (sandboxed iframe exploit) ==="
curl -s -D- -H "Origin: null" https://wimsbfp.tech/api/operations | grep -i access-control

echo ""
echo "=== legitimate origin ==="
curl -s -D- -H "Origin: https://wimsbfp.tech" https://wimsbfp.tech/api/operations | grep -i access-control
```

**Expected:**
- `evil.com` → `Access-Control-Allow-Origin` **absent** (blocked)
- `null` → `Access-Control-Allow-Origin` **absent** (blocked)
- `wimsbfp.tech` → `Access-Control-Allow-Origin: https://wimsbfp.tech` (allowed)

**Talk track:** *"CORS is properly locked down. The server only allows requests from its own origin — no random origin reflection, no null origin bypass. Cross-origin data theft from a malicious site is not possible."*

---

## Phase 3: Exploitation Attempts (~3 min)

### 9. Error Disclosure — Stack Trace Probe

**Narrator:** *"Malformed requests can trigger unhandled exceptions that leak internal structure."*

```bash
# Try various edge cases
curl -s -X POST -H "Content-Type: application/json" -d "not json" \
  -D- https://wimsbfp.tech/api/operations | head -10

echo "==="

curl -s -X POST \
  -H "Content-Type: application/json" \
  -d '{"latitude": 999, "longitude": 999, "description": "test"}' \
  https://wimsbfp.tech/api/v1/public/report
```

**Expected:**
- Bad JSON → **CSRF 403**: `{"detail":"CSRF validation failed: missing origin header"}`
- Public report with valid schema → **422**: leaks required field names

**⚠️ Finding:** No stack trace leak, but Pydantic validation responses disclose the internal schema (field names, types, constraints).

**Talk track:** *"Good news — no stack traces. Bad news — the validation framework tells attackers exactly what fields are expected, their types, and which ones are required. This is schema enumeration through error messages."*

---

### 10. XSS — Reflected

**Narrator:** *"We test whether the application reflects unsanitized user input back in responses — a Reflected XSS vector."*

```bash
# Open in browser
https://wimsbfp.tech/?q=<script>alert(1)</script>
```

**In Browser:**
- Press F12 → Network tab → reload
- Check response body for `alert(1)`
- Expected: **Not present** — React/Next.js encodes output

**Talk track:** *"The framework encodes output by default. Our injected script tag is HTML-encoded, not executed. No reflected XSS."*

---

### 11. XSS — Stored (via Burp)

**Narrator:** *"Stored XSS is more dangerous — the payload persists and fires for every user who views the page. We'll test this through the incident form."*

**In Burp Repeater:**
1. Login as `regional_encoder` 
2. POST to `/api/incidents/create` (or the proper create-incident endpoint)
3. Inject in the `narrative` field:
   ```json
   {"narrative": "<script>alert(document.cookie)</script>"}
   ```
4. Submit and then GET the incident detail page
5. Check if the payload executes

**⚠️ Expected finding:** The field is AES-256-GCM encrypted at rest and React JSX-escapes on render — **no stored XSS**.

**Talk track:** *"Even if we get past CSRF and auth, the application encrypts narrative fields at rest with AES-256-GCM and React's JSX handles output encoding. No XSS."*

---

### 12. Public DMZ — Consent & Report Endpoints

**Narrator:** *"The application has public-facing endpoints — we test these for rate limiting and abuse controls."*

```bash
# Submit to consent endpoint
curl -s -v -X POST https://wimsbfp.tech/api/auth/consent \
  -H "Content-Type: application/json" \
  -d '{"consent_given": true}' 2>&1 | tail -20
```

**Expected:**
- Returns 200/422 with proper validation
- Repeated rapid requests → **429 Too Many Requests** (rate limit)

**Talk track:** *"Public endpoints are rate-limited per IP — 5 requests per hour via Redis sliding window. This prevents abuse and reconnaissance automation."*

---## Phase 4: VPS Breach — Direct Database Access (~2 min)

**Narrator:** *"Let's say we've gained shell access to the VPS through another vector. Now we go straight for the database to see what data is exposed."*

---

### Prerequisite: Getting the DB Password

```bash
# First, find the Postgres password from the running compose env
ssh root@wimsbfp.tech

# Check docker compose env
cd /opt/wims-bfp
cat .env.production | grep POSTGRES_PASSWORD

# OR — dump it from the running container's env
sudo docker exec wims-postgres env | grep POSTGRES_PASSWORD
```

---

### 13. Shell Access → Docker → psql

**Narrator:** *"Once we're on the box, Docker makes it trivial. One exec and we're in the database as superuser."*

```bash
# Jump into the Postgres container
sudo docker exec -it wims-postgres psql -U postgres -d wims
```

**On screen:** You're now inside `psql (16.x)` with the `wims=#` prompt.

**Talk track:** *"One command and we're past the application layer entirely. No rate limits, no CSRF, no auth middleware — just raw SQL as the superuser."

---

### 14. First Look — Tables & Schema Enumeration

**Narrator:** *"First recon inside the database — what tables exist?"*

```sql
-- List all tables in the wims schema
\dt wims.*
```

**Narrator:** *"Let's look at the incident_sensitive_details table — this holds PII."*

```sql
\d wims.incident_sensitive_details
```

**Point out:** `pii_blob_enc TEXT`, `encryption_iv VARCHAR` — this is where the encrypted PII lives.

---

### 15. PII Encryption — The Ciphertext Reveal

**Narrator:** *"Here's the moment of truth — can we read PII?"*

```sql
-- Select encrypted PII rows
SELECT incident_id, LEFT(pii_blob_enc::text, 80) AS pii_ciphertext,
       LEFT(encryption_iv::text, 24) AS nonce
FROM wims.incident_sensitive_details
WHERE pii_blob_enc IS NOT NULL
LIMIT 5;
```

**Expected output:**
```
 incident_id |                   pii_ciphertext                     |        nonce
-------------+-------------------------------------------------------+----------------------
           1 | 7a8b3c9d... (gibberish base64 — AES-256-GCM)         | a1b2c3d4e5f6...
           2 | f8e7d6c5... (gibberish base64 — AES-256-GCM)         | b2c3d4e5f6a7...
           3 | a1b2c3d4... (gibberish base64 — AES-256-GCM)         | c3d4e5f6a7b8...
```

**Talk track:** *"We have the data — but it's useless. Every PII field is AES-256-GCM ciphertext with a unique nonce per row. The decryption key is in environment variables back on the host, not in the database. Without the key, this is just noise."

---

### 16. AI Narratives — Same Pattern

**Narrator:** *"Let's check the AI-generated narratives — these contain incident analysis."*

```sql
SELECT incident_id,
       LEFT(ai_narrative_enc::text, 60) AS narrative_ciphertext,
       LEFT(ai_narrative_encryption_iv::text, 24) AS nonce
FROM wims.fire_incidents
WHERE ai_narrative_enc IS NOT NULL
LIMIT 5;
```

**Expected output:** Same pattern — base64 ciphertext, no plaintext visible.

**Talk track:** *"Same encryption scheme, different AAD namespace — `incident_id:{id}:ai_narrative`. Even if the PII key and the narrative key were different, they'd both need their own keys to decrypt."

---

### 17. Witness PII — Same Story

**Narrator:** *"Citizen reports also contain witness information."*

```sql
SELECT report_id,
       LEFT(witness_pii_blob_enc::text, 60) AS witness_ciphertext
FROM wims.citizen_reports
WHERE witness_pii_blob_enc IS NOT NULL
LIMIT 5;
```

**Talk track:** *"Citizen witness PII follows the identical pattern — AES-256-GCM encrypted blob. The team was consistent: no PII is ever stored in plaintext."

---

### 18. Plaintext Schema Summary (What an Attacker CAN See)

**Narrator:** *"Let's summarize — what CAN we read as the superuser?"*

```sql
-- Non-sensitive incident metadata — all readable
SELECT incident_id, incident_number, category, sub_category,
       municipality, barangay, verification_status,
       alarm_level, status
FROM wims.fire_incidents
LIMIT 3;
```

**Talk track:** *"We can see incident metadata — location, category, status. But the caller's name, phone number, and full narrative? All encrypted. The system compartmentalizes: operational data is accessible, personal data is locked."*

---

### 19. Cross-Region RLS Bypass Attempt (via SQL, not API)

**Narrator:** *"As superuser, we bypass RLS entirely. But let's see what a normal application user would encounter."*

```sql
-- First check the RLS policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE tablename = 'fire_incidents';
```

**Expected output:** 4 policies — SELECT, INSERT, UPDATE, DELETE — all checking `wims.current_user_region_id()` for region scoping.

**Talk track:** *"RLS is enforced at the database level, not in application code. Even if an attacker tampers with the API, the database itself rejects cross-region reads unless you're SYSTEM_ADMIN or NATIONAL_ANALYST. But as the postgres superuser, we see everything."*

---

### 20. Exit the Database

```sql
\q
```

**Talk track:** *"We're inside the database, we have full read access, and the most sensitive data is encrypted. The remaining information disclosure surface is the schema metadata and non-sensitive fields — which is by design."

---

## Recommended Narrative (Hacker Arc)

> "We discovered the app is well-hardened at the network layer — TLS, headers, CORS, auth all pass. No XSS, no stack traces. But we got shell access through [other vector]. One `docker exec` later, we're inside the Postgres database as superuser, bypassing every application control — CSRF, auth, rate limits, all gone."
>
> "But here's the thing: even with full database access, the PII is AES-256-GCM ciphertext. Caller names, phone numbers, incident narratives — all encrypted at rest with unique nonces per row. The decryption key lives in the host environment, not in the database. So the crown jewels remain protected."
>
> "The information disclosure findings from this phase: non-sensitive metadata is readable, the schema is fully enumerable (table names, column types, constraints), and the RLS policies are transparent. This is useful for mapping the application's data model — but the data itself is compartmentalized behind encryption."

---

## Summary Table

| Phase | Test | Tool | Result | Severity |
|-------|------|------|--------|----------|
| Recon | TLS 1.3 enforcement | testssl.sh --protocols | ✅ Only TLS 1.2/1.3 | Info |
| Recon | Cipher strength | testssl.sh --std | ✅ AEAD-only | Info |
| Recon | Security headers | curl | ✅ 6/7 OWASP headers | Info |
| Recon | API docs exposure | curl | ✅ Blocked by Next.js | Info |
| Recon | Dotfiles / backups | curl | ✅ Not served | Info |
| Auth | Auth boundary | curl | ✅ 401 for unauthenticated | Info |
| Auth | Schema leak (Pydantic) | curl | ⚠️ Field names disclosed | Low |
| Auth | CORS origin reflection | curl | ✅ Locked to wimsbfp.tech | Info |
| Exploit | Error disclosure | curl | ✅ Generic 500s, no stack traces | Info |
| Exploit | Reflected XSS | Browser | ✅ Not found (React encoding) | Info |
| Exploit | Stored XSS | Burp | ✅ Encrypted + JSX-escaped | Info |
| Data | PII encryption (pii_blob_enc) | psql via VPS | ✅ AES-256-GCM ciphertext | Info |
| Data | AI narrative encryption | psql via VPS | ✅ AES-256-GCM ciphertext | Info |
| Data | Witness PII encryption | psql via VPS | ✅ AES-256-GCM ciphertext | Info |
| Data | Schema enumeration (table/column names) | psql \dt + \d | ⚠️ Full schema visible as superuser | Low |
| Data | Non-sensitive metadata readable | psql SELECT | ⚠️ Location, status, category visible | Note |
| Data | RLS bypass as superuser | psql | ✅ Postgres superuser bypasses RLS (expected) | Info |

---

## Demo Flow Script (Time Budget)

```
0:00 – 0:30  Intro: "We're testing WIMS-BFP for information disclosure..."
0:30 – 2:00  Phase 1: testssl.sh + curl security headers (split terminal)
2:00 – 3:00  Phase 1 cont: API discovery, dotfiles
3:00 – 4:00  Phase 2: Auth boundary, Pydantic leak, CORS
4:00 – 5:30  Phase 3: Error disclosure, XSS attempts
5:30 – 7:30  Phase 4: VPS breach → docker exec → psql reveal
7:30 – 8:00  Summary table & findings
8:00 – 10:00 Q&A / Deep dive on any finding
```

---

## Pro Tips for the Video

1. **Split terminal** — Show `testssl.sh` on one side, `curl` on the other
2. **Green/red labels** — Overlay ✅ or ❌ on each finding as you narrate
3. **Burp screenshots** — Pre-record Burp Repeater XSS tests (avoids live timing issues)
4. **jwt.io demo** — Optional: after auth, paste the JWT into jwt.io to show the decoded payload
5. **The "hacker arc"** — Start with recon (we know nothing), build to exploitation (we test XSS), end with data-access scenario (if we got in, what would we find?)
6. **Emphasize the minor findings** — For a secure system, the Pydantic schema leak and ANONYMOUS SELECT on citizen reports are the most interesting "hacker" findings to discuss
