# Suricata Gap Detection Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 13 custom Suricata rules (SIDs 1000122–1000134) covering 5 attack categories that currently pass through undetected: directory brute-forcing, SSRF, HTTP method tampering, open redirect, and CRLF injection.

**Architecture:** All rules append to `src/suricata/rules/custom.rules` following the established single-line format. Validation uses `suricata -T` inside the `jasonish/suricata:7.0.5` Docker image against the real `suricata.yaml`. No application code changes — detection only (IDS mode, no drop rules).

**Tech Stack:** Suricata 7.0.5, Docker, custom.rules (SID range 1000000–1000999), `jasonish/suricata:7.0.5` image for validation.

## Global Constraints

- **Single-line rule format only.** Suricata 7.0.5's file parser does NOT support multi-line rules. Every rule must be one physical line.
- **Escape semicolons in pcre.** A bare `;` inside a `pcre:"..."` value is parsed as a Suricata option separator, causing "bad option value formatting" errors. Use `\;` inside pcre patterns.
- **Cannot mix request and response buffers in one rule.** `http.uri` (to_server) and `http.response_line` (from_server) are "conflicting directions" — use flowbits for cross-direction matching (see SIDs 1000115–1000120 for the established pattern).
- **SID range:** 1000000–1000999 (project custom range). Current high-water mark: 1000121. This plan uses 1000122–1000134.
- **Validation command:** `docker run --rm -v $(pwd)/src/suricata:/suricata jasonish/suricata:7.0.5 suricata -T -vv -c /suricata/suricata.yaml -S /suricata/rules/custom.rules 2>&1 | grep -E '(Error|successfully loaded|failed)'`
- **Expected result:** "N rules successfully loaded, 0 rules failed" where N = 37 + rules added so far.
- **Branch:** `feat/keycloak-brute-force-protection` (same branch as prior rule work).
- **classtype values used:** `attempted-recon` (recon/probing), `web-application-attack` (injection/exploitation), `policy-violation` (abuse).

## Out of Scope (with justification)

| Gap | Why deferred |
|---|---|
| **CORS misconfiguration probing** | Requires correlating `Origin:` request header with `Access-Control-Allow-Origin:` response header across many requests. Suricata flowbits track within a single flow, not across flows from the same IP. Would need `detection_filter` on Origin header variation — complex, high false-positive risk. |
| **SMTP injection against MailHog** | MailHog is bound to `127.0.0.1:1025` only (docker-compose.yml) — not externally accessible. Attacker cannot reach it through nginx. |
| **HTTP/2 fingerprinting** | Very low value for a prototype. Requires JA3/JA4 TLS fingerprinting config changes, not just rule additions. |
| **Production HTTPS blindness (port 443)** | Architectural limitation: Suricata in host mode sees only TLS ciphertext on 443. Fixing requires SSL key disclosure, Docker bridge port mirroring, or inline IPS mode — all major architectural changes beyond rule additions. Documented as a known gap. |
| **Post-auth business logic abuse (IDOR, workflow skip, bulk approve)** | Inherently undetectable at network layer. Same URI, same headers, valid JWT. Requires application-layer anomaly detection (audit log analysis, rate-of-change analytics). |

---

## File Structure

| File | Role | Modified in |
|---|---|---|
| `src/suricata/rules/custom.rules` | All custom detection rules (single file, single-line format) | Tasks 1–5 |
| `system-wiki/security/security-baseline.md` | Rule tier table + new detection sections | Task 6 |
| `system-wiki/log.md` | Change log entry | Task 6 |

No new files created. No application code changes. No nginx changes. No docker-compose changes.

---

## Task 1: Directory & Route Brute-Forcing Detection (SIDs 1000122–1000124)

**Threat:** Attackers use `ffuf`, `gobuster`, `dirb`, or manual probing to discover hidden endpoints, config files, and admin panels. Current coverage: only `/api/admin/` (SID 1000022). Everything else is invisible.

**Files:**
- Modify: `src/suricata/rules/custom.rules` (append after SID 1000121)

**Interfaces:**
- Consumes: existing rule format, SID 1000121 as insertion point
- Produces: SIDs 1000122–1000124, 3 new rules

- [ ] **Step 1: Append the 3 directory brute-forcing rules**

Append this block to the end of `src/suricata/rules/custom.rules`:

```
# ===== Directory & Route Brute-Forcing Detection (SID 1000122-1000124) =====
alert http any any -> any any (msg:"WIMS RECON sensitive dotfile probe"; flow:established,to_server; http.uri; pcre:"/\/\.(env|git|svn|htaccess|htpasswd|aws|ssh)/i"; classtype:attempted-recon; sid:1000122; rev:1;)
alert http any any -> any any (msg:"WIMS RECON sensitive path probe"; flow:established,to_server; http.uri; pcre:"/\/(backup|config|swagger|openapi|actuator|phpmyadmin|wp-admin|wp-login|server-status|docs|redoc)/i"; classtype:attempted-recon; sid:1000123; rev:1;)
alert http any any -> any any (msg:"WIMS RECON 404 enumeration burst"; flow:established,from_server; http.response_line; content:"404"; within:10; detection_filter:track by_src, count 20, seconds 60; classtype:attempted-recon; sid:1000124; rev:1;)
```

**Rule explanations:**
- **1000122:** Matches `/.env`, `/.git`, `/.svn`, `/.htaccess`, `/.htpasswd`, `/.aws`, `/.ssh` in URI. These are dotfiles/VCS files attackers probe for. Content match, no threshold — every probe is suspicious.
- **1000123:** Matches `/backup`, `/config`, `/swagger`, `/openapi`, `/actuator`, `/phpmyadmin`, `/wp-admin`, `/wp-login`, `/server-status`, `/docs`, `/redoc`. Note: FastAPI docs are enabled by default (`app = FastAPI(title="WIMS-BFP Backend")` — no `docs_url=None`), so `/docs` and `/openapi.json` are real exposure. Content match, no threshold.
- **1000124:** Generic 404 burst — 20+ HTTP 404 responses from same IP in 60s. This is the signature of `ffuf`/`gobuster` directory brute-forcing. Uses `from_server` direction with `detection_filter`.

- [ ] **Step 2: Validate with suricata -T**

Run:
```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && docker run --rm -v $(pwd)/src/suricata:/suricata jasonish/suricata:7.0.5 suricata -T -vv -c /suricata/suricata.yaml -S /suricata/rules/custom.rules 2>&1 | grep -E '(Error|successfully loaded|failed)'
```
Expected: `40 rules successfully loaded, 0 rules failed` (37 existing + 3 new)

- [ ] **Step 3: Fix parse errors if any**

If any rule fails, check for:
- Bare `;` in pcre (must be `\;`)
- Unescaped `/` in pcre (must be `\/`)
- Missing `rev:1;`
- Mixed direction buffers (http.uri is to_server only)

- [ ] **Step 4: Commit**

```bash
git add src/suricata/rules/custom.rules
git commit -m "feat: Suricata directory brute-forcing detection (SIDs 1000122-1000124)

- 1000122: sensitive dotfile probe (.env, .git, .svn, .htaccess)
- 1000123: sensitive path probe (/backup, /swagger, /openapi, /actuator)
- 1000124: 404 enumeration burst (20 hits/60s = ffuf/gobuster signature)"
```

---

## Task 2: SSRF Detection (SIDs 1000125–1000128)

**Threat:** Server-Side Request Forgery — attacker submits a URL parameter that makes the backend fetch internal resources (cloud metadata, localhost services, internal IPs). OWASP A10. ET Open has 57 SSRF rules but they're generic; these target the specific patterns most dangerous for a VPS deployment.

**Files:**
- Modify: `src/suricata/rules/custom.rules` (append after SID 1000124)

**Interfaces:**
- Consumes: existing rule format
- Produces: SIDs 1000125–1000128, 4 new rules

- [ ] **Step 1: Append the 4 SSRF rules**

Append this block to the end of `src/suricata/rules/custom.rules`:

```
# ===== OWASP A10 SSRF Detection (SID 1000125-1000128) =====
alert http any any -> any any (msg:"WIMS OWASP A10 SSRF URI internal target"; flow:established,to_server; http.uri; pcre:"/(169\.254\.169\.254|127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\]|0177\.0\.0\.1)/i"; classtype:web-application-attack; sid:1000125; rev:1;)
alert http any any -> any any (msg:"WIMS OWASP A10 SSRF URI dangerous scheme"; flow:established,to_server; http.uri; pcre:"/(file|gopher|dict|ldap|sftp|expect):\/\//i"; classtype:web-application-attack; sid:1000126; rev:1;)
alert http any any -> any any (msg:"WIMS OWASP A10 SSRF body internal target"; flow:established,to_server; http.request_body; pcre:"/(169\.254\.169\.254|127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\]|0177\.0\.0\.1)/i"; classtype:web-application-attack; sid:1000127; rev:1;)
alert http any any -> any any (msg:"WIMS OWASP A10 SSRF body dangerous scheme"; flow:established,to_server; http.request_body; pcre:"/(file|gopher|dict|ldap|sftp|expect):\/\//i"; classtype:web-application-attack; sid:1000128; rev:1;)
```

**Rule explanations:**
- **1000125 / 1000127:** Match cloud metadata IP (`169.254.169.254`), loopback (`127.0.0.1`, `localhost`, `0.0.0.0`, `[::1]`, octal `0177.0.0.1`) in URI and request body respectively. These are the most dangerous SSRF targets — metadata endpoints leak cloud credentials.
- **1000126 / 1000128:** Match dangerous URL schemes (`file://`, `gopher://`, `dict://`, `ldap://`, `sftp://`, `expect://`) in URI and request body. These schemes enable local file reads and protocol smuggling.

- [ ] **Step 2: Validate with suricata -T**

Run:
```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && docker run --rm -v $(pwd)/src/suricata:/suricata jasonish/suricata:7.0.5 suricata -T -vv -c /suricata/suricata.yaml -S /suricata/rules/custom.rules 2>&1 | grep -E '(Error|successfully loaded|failed)'
```
Expected: `44 rules successfully loaded, 0 rules failed` (40 + 4 new)

- [ ] **Step 3: Fix parse errors if any**

If `\[::1\]` causes issues, simplify to just `::1` without brackets. If `0177\.0\.0\.1` fails, remove it (octal bypass is rare).

- [ ] **Step 4: Commit**

```bash
git add src/suricata/rules/custom.rules
git commit -m "feat: Suricata SSRF detection (SIDs 1000125-1000128)

- 1000125/1000127: internal target SSRF (cloud metadata, loopback) in URI/body
- 1000126/1000128: dangerous URL schemes (file://, gopher://, dict://) in URI/body"
```

---

## Task 3: HTTP Method Tampering Detection (SIDs 1000129–1000130)

**Threat:** Attackers use non-standard HTTP methods to probe for debug endpoints, proxy functionality, or cross-site tracing (XST). `TRACE` and `CONNECT` are almost never legitimate in a REST API.

**Files:**
- Modify: `src/suricata/rules/custom.rules` (append after SID 1000128)

**Interfaces:**
- Consumes: existing rule format
- Produces: SIDs 1000129–1000130, 2 new rules

- [ ] **Step 1: Append the 2 HTTP method tampering rules**

Append this block to the end of `src/suricata/rules/custom.rules`:

```
# ===== HTTP Method Tampering Detection (SID 1000129-1000130) =====
alert http any any -> any any (msg:"WIMS OWASP A05 HTTP TRACE method"; flow:established,to_server; http.method; content:"TRACE"; classtype:attempted-recon; sid:1000129; rev:1;)
alert http any any -> any any (msg:"WIMS OWASP A05 HTTP CONNECT method"; flow:established,to_server; http.method; content:"CONNECT"; classtype:attempted-recon; sid:1000130; rev:1;)
```

**Rule explanations:**
- **1000129:** `TRACE` method — used for Cross-Site Tracing (XST) to steal cookies over HTTP TRACE reflection. No legitimate REST API uses TRACE.
- **1000130:** `CONNECT` method — used for HTTP proxy tunneling. If the backend isn't a proxy, CONNECT is an attack probe.
- Both use `http.method` content match with no threshold — every occurrence is suspicious.

- [ ] **Step 2: Validate with suricata -T**

Run:
```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && docker run --rm -v $(pwd)/src/suricata:/suricata jasonish/suricata:7.0.5 suricata -T -vv -c /suricata/suricata.yaml -S /suricata/rules/custom.rules 2>&1 | grep -E '(Error|successfully loaded|failed)'
```
Expected: `46 rules successfully loaded, 0 rules failed` (44 + 2 new)

- [ ] **Step 3: Commit**

```bash
git add src/suricata/rules/custom.rules
git commit -m "feat: Suricata HTTP method tampering detection (SIDs 1000129-1000130)

- 1000129: TRACE method (XST attack vector)
- 1000130: CONNECT method (proxy tunneling abuse)"
```

---

## Task 4: Open Redirect Detection (SIDs 1000131–1000132)

**Threat:** If any endpoint accepts a redirect URL parameter without validation, an attacker can craft `https://wimsbfp.tech/?next=//evil.com` to phish from a trusted `.gov.ph` domain. OWASP A01.

**Files:**
- Modify: `src/suricata/rules/custom.rules` (append after SID 1000130)

**Interfaces:**
- Consumes: existing rule format
- Produces: SIDs 1000131–1000132, 2 new rules

- [ ] **Step 1: Append the 2 open redirect rules**

Append this block to the end of `src/suricata/rules/custom.rules`:

```
# ===== Open Redirect Detection (SID 1000131-1000132) =====
alert http any any -> any any (msg:"WIMS OWASP A01 open redirect protocol-relative"; flow:established,to_server; http.uri; pcre:"/(next|redirect|url|return|callback|continue|dest|destination|go|out)=(\/\/|%2f%2f)/i"; classtype:web-application-attack; sid:1000131; rev:1;)
alert http any any -> any any (msg:"WIMS OWASP A01 open redirect external URL"; flow:established,to_server; http.uri; pcre:"/(next|redirect|url|return|callback|continue|dest|destination|go|out)=(https?%3a|https?:\/\/)/i"; classtype:web-application-attack; sid:1000132; rev:1;)
```

**Rule explanations:**
- **1000131:** Matches redirect parameters (`next`, `redirect`, `url`, `return`, `callback`, `continue`, `dest`, `destination`, `go`, `out`) followed by protocol-relative URLs (`//evil.com` or `%2f%2fevil.com`). Protocol-relative URLs bypass same-origin checks.
- **1000132:** Same redirect parameters followed by absolute external URLs (`http://` or `https://`, URL-encoded or raw). These are explicit cross-domain redirect attempts.

- [ ] **Step 2: Validate with suricata -T**

Run:
```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && docker run --rm -v $(pwd)/src/suricata:/suricata jasonish/suricata:7.0.5 suricata -T -vv -c /suricata/suricata.yaml -S /suricata/rules/custom.rules 2>&1 | grep -E '(Error|successfully loaded|failed)'
```
Expected: `48 rules successfully loaded, 0 rules failed` (46 + 2 new)

- [ ] **Step 3: Fix parse errors if any**

If `\/\/` in pcre causes issues, try replacing with `[\x2f][\x2f]` (hex for `/`). The pcre delimiter is `/` so literal slashes inside the regex need `\/` escaping.

- [ ] **Step 4: Commit**

```bash
git add src/suricata/rules/custom.rules
git commit -m "feat: Suricata open redirect detection (SIDs 1000131-1000132)

- 1000131: protocol-relative redirect (//evil.com in redirect params)
- 1000132: external URL redirect (http(s):// in redirect params)"
```

---

## Task 5: CRLF Injection / Response Splitting Detection (SIDs 1000133–1000134)

**Threat:** CRLF (`%0d%0a`) injection in URIs or request bodies can split HTTP responses, inject `Set-Cookie` headers, or poison caches. OWASP A03.

**Files:**
- Modify: `src/suricata/rules/custom.rules` (append after SID 1000132)

**Interfaces:**
- Consumes: existing rule format
- Produces: SIDs 1000133–1000134, 2 new rules

- [ ] **Step 1: Append the 2 CRLF injection rules**

Append this block to the end of `src/suricata/rules/custom.rules`:

```
# ===== CRLF Injection / Response Splitting Detection (SID 1000133-1000134) =====
alert http any any -> any any (msg:"WIMS OWASP A03 CRLF injection URI"; flow:established,to_server; http.uri; pcre:"/(%0d%0a|%0a%0d|%0d|%0a)/i"; classtype:web-application-attack; sid:1000133; rev:1;)
alert http any any -> any any (msg:"WIMS OWASP A03 CRLF injection body header injection"; flow:established,to_server; http.request_body; pcre:"/(%0d%0a|%0a%0d)(Set-Cookie|Location|Content-Type|HTTP\/)/i"; classtype:web-application-attack; sid:1000134; rev:1;)
```

**Rule explanations:**
- **1000133:** Matches any CRLF sequence (`%0d%0a`, `%0a%0d`, standalone `%0d`, `%0a`) in URI. These are URL-encoded carriage return / line feed — the response splitting payload. No threshold — any CRLF in a URI is an attack.
- **1000134:** Matches CRLF in request body followed by header injection patterns (`Set-Cookie`, `Location`, `Content-Type`, `HTTP/`). This catches response splitting attempts in POST bodies where the attacker tries to inject response headers.

- [ ] **Step 2: Validate with suricata -T**

Run:
```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && docker run --rm -v $(pwd)/src/suricata:/suricata jasonish/suricata:7.0.5 suricata -T -vv -c /suricata/suricata.yaml -S /suricata/rules/custom.rules 2>&1 | grep -E '(Error|successfully loaded|failed)'
```
Expected: `50 rules successfully loaded, 0 rules failed` (48 + 2 new)

- [ ] **Step 3: Fix parse errors if any**

If `HTTP\/` in the pcre causes issues (the `/` after `HTTP`), ensure it's escaped as `HTTP\/`. The pcre delimiter is `/` so every literal `/` needs `\/`.

- [ ] **Step 4: Commit**

```bash
git add src/suricata/rules/custom.rules
git commit -m "feat: Suricata CRLF injection / response splitting detection (SIDs 1000133-1000134)

- 1000133: CRLF sequences in URI (%0d%0a response splitting)
- 1000134: CRLF + header injection in body (Set-Cookie/Location/Content-Type)"
```

---

## Task 6: Full Validation + System Wiki Update + Final Commit

**Threat:** N/A — this task validates all 13 new rules together and updates the system wiki to reflect the expanded ruleset.

**Files:**
- Modify: `system-wiki/security/security-baseline.md` (tier table + new sections)
- Modify: `system-wiki/log.md` (change log entry)

**Interfaces:**
- Consumes: all rules from Tasks 1–5 (SIDs 1000122–1000134)
- Produces: updated wiki documentation

- [ ] **Step 1: Run full validation**

Run:
```bash
cd /home/xynate/WIMS-BFP-NEW/LOCAL-WIMS-BFP-PROTOTYPE && docker run --rm -v $(pwd)/src/suricata:/suricata jasonish/suricata:7.0.5 suricata -T -vv -c /suricata/suricata.yaml -S /suricata/rules/custom.rules 2>&1 | grep -E '(Error|successfully loaded|failed)'
```
Expected: `50 rules successfully loaded, 0 rules failed`

- [ ] **Step 2: Update security-baseline.md tier table**

In `system-wiki/security/security-baseline.md`, update the tier table to add a new tier 6:

Find:
```
| 5 | Privilege escalation + rate-limit abuse | 1000115–1000121 | 7 | Manual, committed to repo |
```
Replace with:
```
| 5 | Privilege escalation + rate-limit abuse | 1000115–1000121 | 7 | Manual, committed to repo |
| 6 | Recon + SSRF + method tamper + redirect + CRLF | 1000122–1000134 | 13 | Manual, committed to repo |
```

- [ ] **Step 3: Add new detection sections to security-baseline.md**

After the "### Rate-Limit Violation Detection (2026-06-23)" section and before "### Keycloak Realm Brute Force Detection", insert:

```markdown
### Recon & Exploitation Gap Rules (2026-06-23)

13 rules covering attack categories that previously had zero custom detection:

**Directory brute-forcing (SIDs 1000122-1000124):**
- 1000122: Sensitive dotfile probe (`/.env`, `/.git`, `/.svn`, `/.htaccess`)
- 1000123: Sensitive path probe (`/backup`, `/swagger`, `/openapi`, `/actuator`, `/docs`)
- 1000124: 404 enumeration burst (20 hits/60s = `ffuf`/`gobuster` signature)

**SSRF (SIDs 1000125-1000128):**
- 1000125/1000127: Internal target SSRF (cloud metadata `169.254.169.254`, loopback) in URI/body
- 1000126/1000128: Dangerous URL schemes (`file://`, `gopher://`, `dict://`, `ldap://`) in URI/body

**HTTP method tampering (SIDs 1000129-1000130):**
- 1000129: TRACE method (XST attack vector)
- 1000130: CONNECT method (proxy tunneling abuse)

**Open redirect (SIDs 1000131-1000132):**
- 1000131: Protocol-relative redirect (`//evil.com` in redirect params)
- 1000132: External URL redirect (`http(s)://` in redirect params)

**CRLF injection (SIDs 1000133-1000134):**
- 1000133: CRLF sequences in URI (`%0d%0a` response splitting)
- 1000134: CRLF + header injection in body (`Set-Cookie`/`Location`/`Content-Type`)

**Known limitations (documented, not addressed by rules):**
- CORS probing: requires cross-flow header correlation, complex with Suricata flowbits
- SMTP injection: MailHog bound to `127.0.0.1:1025`, not externally accessible
- Production HTTPS (port 443): Suricata sees only TLS ciphertext — all HTTP-level rules are dev-only (port 80)
- Post-auth business logic abuse (IDOR, workflow skip): inherently undetectable at network layer
```

- [ ] **Step 4: Update log.md**

Append a new entry to `system-wiki/log.md`:

```markdown
## [2026-06-23] feat: Suricata gap detection rules — recon, SSRF, method tamper, redirect, CRLF

- **Scope:** 13 new custom rules (SIDs 1000122-1000134) closing 5 attack category gaps identified in blind-spot analysis. All rules validated with `suricata -T` (50 total, 0 failed).
- **Directory brute-forcing (1000122-1000124):** Sensitive dotfile/path probes + 404 burst detection for `ffuf`/`gobuster` signatures.
- **SSRF (1000125-1000128):** Cloud metadata + loopback + dangerous URL schemes in URI and request body.
- **HTTP method tampering (1000129-1000130):** TRACE and CONNECT method detection.
- **Open redirect (1000131-1000132):** Protocol-relative and external URL redirect parameter probing.
- **CRLF injection (1000133-1000134):** Response splitting via `%0d%0a` in URI and header injection in body.
- **Deferred (with justification):** CORS probing (cross-flow correlation needed), SMTP injection (MailHog localhost-only), HTTP/2 fingerprinting (low value), production HTTPS blindness (architectural change).
- **Files:** `src/suricata/rules/custom.rules` (+13 rules), `system-wiki/security/security-baseline.md`, `system-wiki/log.md`.
- **Branch:** `feat/keycloak-brute-force-protection`.
- **Wiki update:** Security baseline tier table + new gap detection section; this log entry.
```

- [ ] **Step 5: Commit wiki updates**

```bash
git add system-wiki/security/security-baseline.md system-wiki/log.md
git commit -m "docs(wiki): update security baseline + log for gap detection rules

- Tier table: new tier 6 (SIDs 1000122-1000134, 13 rules)
- New section: Recon & Exploitation Gap Rules with known limitations
- Log entry: full change record for 2026-06-23 gap detection work"
```

---

## Self-Review

**1. Spec coverage:** All 5 attack categories from the approved scope are covered:
- ✅ Directory/route brute-forcing → Task 1 (SIDs 1000122-1000124)
- ✅ SSRF → Task 2 (SIDs 1000125-1000128)
- ✅ HTTP method tampering → Task 3 (SIDs 1000129-1000130)
- ✅ Open redirect → Task 4 (SIDs 1000131-1000132)
- ✅ CRLF injection → Task 5 (SIDs 1000133-1000134)
- ✅ Validation + wiki → Task 6

**2. Placeholder scan:** No TBD, TODO, or "add appropriate" patterns. Every rule has exact text. Every validation step has exact command and expected output.

**3. SID consistency:** SIDs are sequential 1000122→1000134 with no gaps or collisions. Each task's "expected loaded count" increments correctly: 37→40→44→46→48→50.

**4. Known pitfalls addressed:**
- Single-line format (documented in global constraints)
- Semicolon escaping in pcre (documented, no bare `;` in any pcre)
- No mixed-direction buffers (404 rule uses from_server only, no http.uri)
- `\/` escaping for literal slashes in pcre (documented in fix steps)
