# Research: mitchellkrogza/nginx-ultimate-bad-bot-blocker — Upstream Analysis

## Summary

The repo is an MIT-licensed nginx bad-bot, bad-referrer, and bad-IP blocker (V4.2026.07.6037, 696 bots, 7113 bad referrers). The main configuration file is `conf.d/globalblacklist.conf` (~541 KB, ~538 KB of which is generated blocklists), which should be placed in the `http {}` block. The `bots.d/` files serve two distinct roles: some are **included** by `globalblacklist.conf` (must exist at their expected paths or nginx will fail reload), and others (`blockbots.conf`, `ddos.conf`) are **optional server-block includes** that apply the rules within `server {}` contexts.

---

## License

**MIT License** — Copyright (c) 2017 Mitchell Krog. Full text at `LICENSE` file confirmed at `https://raw.githubusercontent.com/mitchellkrogza/nginx-ultimate-bad-bot-blocker/master/LICENSE`.  
[Source](https://raw.githubusercontent.com/mitchellkrogza/nginx-ultimate-bad-bot-blocker/master/LICENSE)

---

## File-by-File Report

### 1. `conf.d/globalblacklist.conf` (MAIN FILE — the `http {}` block include)

- **Size:** ~541 KB chars (~30000+ lines, truncated in fetch at 540816 chars)
- **Version:** V4.2026.07.6037, updated Thu Jul 9 11:11:28 UTC 2026
- **Structure:** 4 sections:
  - **Section 1 (UA Bots):** `map $http_user_agent $bad_bot { }` — values 0=allow, 1=allow-ratelimited(disabled), 2=ratelimited, 3=block(444), 4=super-ratelimited
  - **Section 2 (Referrers):** Two maps:
    - `map $http_referer $bad_words { }` — bad referrer *words* (snippets)
    - `map $http_referer $bad_referer { hostnames; }` — bad referrer *domains* (~7113 entries)
  - **Section 3 (IPs):** `geo $validate_client { }` — IPs/ranges, plus `geo $ratelimited { }` for DDoS sparing
  - **Section 4 (Rate Limit Activation):** maps `$bot_iplimit` and `$bot_iplimit2` from `$bad_bot`, plus `limit_conn_zone`/`limit_req_zone` directives

#### Include directives WITHIN `globalblacklist.conf`:

| Include path | Map/Geo block where included | Purpose |
|---|---|---|
| `/etc/nginx/bots.d/blacklist-user-agents.conf` | `$bad_bot` map | Custom override for UA black/whitelist |
| `/etc/nginx/bots.d/whitelist-domains.conf` | `$bad_words` map AND `$bad_referer` map | Whitelist own domains from referrer checks |
| `/etc/nginx/bots.d/bad-referrer-words.conf` | `$bad_words` map | Custom bad referrer word patterns |
| `/etc/nginx/bots.d/custom-bad-referrers.conf` | `$bad_referer` map | Custom bad referrer domain black/whitelist |
| `/etc/nginx/bots.d/blacklist-ips.conf` | `geo $validate_client` | Custom IP blacklist |
| `/etc/nginx/bots.d/whitelist-ips.conf` | `geo $validate_client` AND `geo $ratelimited` | Custom IP whitelist (always wins) |

#### Variables defined:

| Variable | Type | Source | Values |
|---|---|---|---|
| `$bad_bot` | `map $http_user_agent` | Hardcoded + includes | 0=allow,1=ratelimited-disabled,2=ratelimited,3=block(444),4=super-ratelimited |
| `$bad_words` | `map $http_referer` | Hardcoded + includes | 0/1 (1=block 444) |
| `$bad_referer` | `map $http_referer` (hostnames) | Hardcoded + includes | 0/1 (1=block 444) |
| `$validate_client` | `geo` | Hardcoded + includes | 0/1 (1=block 444) |
| `$ratelimited` | `geo` | Hardcoded + includes | 0=spared,1=ratelimited |
| `$bot_iplimit` | `map $bad_bot` | Derived | `$binary_remote_addr` when value=2, else `""` |
| `$bot_iplimit2` | `map $bad_bot` | Derived | `$binary_remote_addr` when value=4, else `""` |

#### Rate limiting zones (IN `globalblacklist.conf`, Section 4):

| Zone name | Type | Key | Size | Rate |
|---|---|---|---|---|
| `bot2_connlimit` | `limit_conn_zone` | `$bot_iplimit` | 16m | (shared) |
| `bot2_reqlimitip` | `limit_req_zone` | `$bot_iplimit` | 16m | 2r/s |
| `bot4_connlimit` | `limit_conn_zone` | `$bot_iplimit2` | 16m | (shared) |
| `bot4_reqlimitip` | `limit_req_zone` | `$bot_iplimit2` | 16m | 1r/m |

> **⚠️ Collision risk with WIMS:** These zone names (`bot2_*`, `bot4_*`) are uniqued via the `bot*_` prefix. However, `$bad_bot`, `$bad_referer`, `$bad_words`, `$validate_client`, `$ratelimited`, `$bot_iplimit`, `$bot_iplimit2` are generic variable names. If WIMS nginx config already defines any of these same variable names in the `http {}` block, there will be a **duplicate variable conflict** on nginx reload.

---

### 2. `bots.d/blockbots.conf` (server-block include)

- **Purpose:** Placed inside `server {}` blocks. Enforces the `$bad_bot`, `$bad_words`, `$bad_referer`, and `$validate_client` checks with `return 444`.
- **Size:** Small (<50 lines)
- **Defines:** No zones or variables. Only **uses** the variables defined in `globalblacklist.conf`.
- **Contains:**
  - Commented-out Super Whitelist (if/override)
  - `limit_conn bot2_connlimit 10;` and `limit_req zone=bot2_reqlimitip burst=10;` (active, applied per-request)
  - Commented-out `bot1_*` and `bot4_*` limit lines
  - `if ($bad_bot = '3') { return 444; }`
  - `if ($bad_words) { return 444; }`
  - `if ($bad_referer) { return 444; }`
  - `if ($validate_client) { return 444; }`

### 3. `bots.d/ddos.conf` (server-block include)

- **Purpose:** Placed inside `server {}` blocks. Applies connection/reference rate limiting as a DDOS filter.
- **Size:** ~40 lines
- **Defines:**
  - `limit_conn addr 200;` — **⚠️ uses zone name `addr`**, which is generic and could collide with WIMS
  - `limit_req zone=flood burst=200 nodelay;` — **⚠️ uses zone name `flood`**, which is generic and could collide with WIMS
- **Note:** The zones `addr` and `flood` must be defined **elsewhere** (typically in the `http {}` block) before `ddos.conf` can reference them. Upstream repo expects the user to define them manually. This file does **not** define the zones — it only uses them.

### 4. `bots.d/blacklist-user-agents.conf` (override file, included by globalblacklist.conf)

- **Size:** ~80 lines
- **Purpose:** Custom blacklist AND whitelist for user-agents. Loads **first** inside the `$bad_bot` map, so it overrides everything below it.
- **Contents:** Commented examples + default blacklist of 4 injection-attack patterns (`x22`, `{|}`, `mb_ereg_replace`, `file_put_contents`), all set to value 3.
- **Must exist** or nginx reload fails.

### 5. `bots.d/blacklist-ips.conf` (override file, included by globalblacklist.conf)

- **Size:** ~100 lines
- **Purpose:** Custom IP blacklist. Commented example + Cyveillance/Qwest block (0=disabled) + Berkeley scanner (0=disabled) + empty "MY BLACKLIST" section.
- **⚠️ Important:** The Cyveillance entries use value `0` (annotated with comment that these are now considered legitimate by the author). The blacklist section is empty by default.
- **Must exist** or nginx reload fails.

### 6. `bots.d/blacklist-domains.conf` (DEPRECATED)

- **Content:** Single line: `# DEPRECATED` followed by instructions to use `whitelist-domains.conf` and `custom-bad-referrers.conf` instead.
- **Not included** by globalblacklist.conf.
- **Can be deleted** from WIMS — unused.

### 7. `bots.d/bad-referrer-words.conf` (override file, included by globalblacklist.conf)

- **Size:** ~100 lines
- **Purpose:** Custom bad referrer word patterns (snipped word matching). Critically warns about false positives (e.g., `cialis` in domain `specialisteparquet.com`).
- **Contents:** Commented examples + one active rule: `mb_ereg_replace` → value 1.
- **⚠️ Risk:** Adding words here can block entire sites containing those substrings, even with whitelisted domains. Must use word boundaries `(?:\b)`.
- **Must exist** or nginx reload fails.

### 8. `bots.d/custom-bad-referrers.conf` (override file, included by globalblacklist.conf)

- **Size:** ~70 lines
- **Purpose:** Custom bad referrer domains. Is both blacklist (value 1) and whitelist (value 0).
- **Contents:** Commented examples only; no active rules by default.
- **Must exist** or nginx reload fails.

### 9. `bots.d/whitelist-ips.conf` (override file, included by globalblacklist.conf)

- **Size:** ~60 lines
- **Purpose:** Whitelist own IPs. This file is included **twice**: in `geo $validate_client` (for IP blocking) and in `geo $ratelimited` (for DDOS filtering).
- **⚠️ Critical note:** "Whitelisting IP's and RANGES here ONLY affects the IP blocking functions. This file will NOT allow your own IP to bypass bad User-Agent or Referrer String checks." To bypass everything, use the Super Whitelist in `blockbots.conf`.
- **Must exist** or nginx reload fails.

### 10. `bots.d/whitelist-domains.conf` (override file, included by globalblacklist.conf)

- **Size:** ~90 lines
- **Purpose:** Whitelist own domains from referrer checking. Included **twice**: in `$bad_words` map and in `$bad_referer` map.
- **⚠️ Warning:** If you whitelist your own domain here, attack strings in the referrer that pass through your own domain will NOT be detected by `bad-referrer-words.conf`.
- **Must exist** or nginx reload fails.

---

## Files NOT included by globalblacklist.conf (separate server-block includes)

| File | Inclusion | Why |
|---|---|---|
| `blockbots.conf` | User manually adds `include /etc/nginx/bots.d/blockbots.conf` inside `server {}` | Enforces the checks (return 444) |
| `ddos.conf` | User manually adds `include /etc/nginx/bots.d/ddos.conf` inside `server {}` | Applies rate limiting `addr`/`flood` zones |
| `blacklist-domains.conf` | DEPRECATED — not included anywhere | Use `custom-bad-referrers.conf` instead |

---

## Zone/Variable Name Collision Analysis with WIMS

| Name | Type | Defined in upstream | Collision risk |
|---|---|---|---|
| `$bad_bot` | `map` variable | `globalblacklist.conf` Section 1 | **HIGH** — generic name |
| `$bad_referer` | `map` variable | `globalblacklist.conf` Section 2 | **HIGH** — generic name |
| `$bad_words` | `map` variable | `globalblacklist.conf` Section 2 | **HIGH** — generic name |
| `$validate_client` | `geo` variable | `globalblacklist.conf` Section 3 | **MODERATE** — distinctive |
| `$ratelimited` | `geo` variable | `globalblacklist.conf` Section 3 | **MODERATE** — somewhat generic |
| `$bot_iplimit` | `map` variable | `globalblacklist.conf` Section 4 | **LOW** — prefixed with `bot_` |
| `$bot_iplimit2` | `map` variable | `globalblacklist.conf` Section 4 | **LOW** — prefixed with `bot_` |
| `bot2_connlimit` | `limit_conn_zone` | `globalblacklist.conf` Section 4 | **NONE** — bot-prefixed |
| `bot2_reqlimitip` | `limit_req_zone` | `globalblacklist.conf` Section 4 | **NONE** — bot-prefixed |
| `bot4_connlimit` | `limit_conn_zone` | `globalblacklist.conf` Section 4 | **NONE** — bot-prefixed |
| `bot4_reqlimitip` | `limit_req_zone` | `globalblacklist.conf` Section 4 | **NONE** — bot-prefixed |
| `addr` | `limit_conn_zone` | Referenced in `ddos.conf` | **HIGH** — extremely generic |
| `flood` | `limit_req_zone` | Referenced in `ddos.conf` | **HIGH** — extremely generic |

**Key risk:** If WIMS uses `$bad_bot`, `$bad_referer`, `$bad_words`, `$validate_client`, or `$ratelimited` (or `addr`/`flood` zones) in its own `http {}` block, there will be **nginx reload failures** from duplicate `map`/`geo`/`limit_*_zone` declarations. Zones `bot2_*` and `bot4_*` are unique enough to be safe.

---

## Sources

- **Kept:** `globalblacklist.conf` — primary configuration file, all includes and 4-section structure confirmed
- **Kept:** `blockbots.conf` — server-block enforcement of variables
- **Kept:** `ddos.conf` — server-block DDOS rate limiting
- **Kept:** `blacklist-user-agents.conf` — custom UA override template
- **Kept:** `blacklist-ips.conf` — custom IP blacklist template
- **Kept:** `bad-referrer-words.conf` — custom bad ref word template
- **Kept:** `custom-bad-referrers.conf` — custom bad ref domain template
- **Kept:** `whitelist-ips.conf` — IP whitelist template
- **Kept:** `whitelist-domains.conf` — domain whitelist template
- **Dropped:** `blacklist-domains.conf` — DEPRECATED file, not used
- **Kept:** `LICENSE` — MIT licensed

## Gaps

- WIMS existing nginx config was not examined during this research — the collision risk assessment assumes WIMS has any nginx `http {}` block directives. A side-by-side comparison of `$bad_bot`/`$bad_referer`/`$bad_words`/`$validate_client`/`$ratelimited`/`addr`/`flood` should be done before integration.
- The upstream expects whitelist-ips.conf to be included in `geo $validate_client` **after** blacklist entries but the geo block's default rule supersedes includes — need to verify the override chain behavior in nginx.
- `blockbots.conf` references `bot1_connlimit` and `bot1_reqlimitip` as commented-out lines. These zones are NOT defined in `globalblacklist.conf` — they would need manual definition if activated.

## Supervisor coordination

No supervisor contact needed — all requested files were fetched and analyzed directly. The research is complete.

---

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "All 10 requested files fetched and analyzed. globalblacklist.conf confirmed to include 6 bots.d files ([blacklist-user-agents.conf, whitelist-domains.conf, bad-referrer-words.conf, custom-bad-referrers.conf, blacklist-ips.conf, whitelist-ips.conf]). blockbots.conf and ddos.conf are separate server-block includes NOT included from globalblacklist.conf. blacklist-domains.conf is DEPRECATED. License confirmed as MIT. All variables ($bad_bot, $bad_referer, $bad_words, $validate_client, $ratelimited, $bot_iplimit, $bot_iplimit2) and zones (bot2_connlimit, bot2_reqlimitip, bot4_connlimit, bot4_reqlimitip, addr, flood) identified and collision risks assessed."
    }
  ],
  "changedFiles": [
    "/home/computa/Projects/WIMS-BFP/WIMS-BFP-PROTOTYPE/.pi-subagents/artifacts/outputs/240ca834-1cbb-4f5b-b1b7-b334ae11d037/research.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "web_search (license query)",
      "result": "passed",
      "summary": "Confirmed MIT License"
    },
    {
      "command": "fetch_content × 11 URLs",
      "result": "passed",
      "summary": "All 10 config files + LICENSE fetched successfully"
    },
    {
      "command": "get_search_content (globalblacklist.conf full content)",
      "result": "passed",
      "summary": "Full ~541KB content retrieved; Section 4 (rate limit zones) confirmed"
    }
  ],
  "validationOutput": [
    "All include directives catalogued: 6 files included from globalblacklist.conf, 2 server-block-only files, 1 deprecated file",
    "8 named variables and 6 rate-limiting zones identified in upstream",
    "Collision risk: 4 HIGH-risk variable names, 2 HIGH-risk zone names (addr, flood), 2 MODERATE-risk variable names",
    "No WIMS nginx config was read for collision verification — this is a gap"
  ],
  "residualRisks": [
    "WIMS existing nginx http{} block may define same variable names ($bad_bot, $bad_referer, etc.) causing nginx reload failure",
    "ddos.conf references zones 'addr' and 'flood' which are not defined in upstream — WIMS must define them in http{} or add them",
    "Whitelist-ips.conf whitelist only affects IP blocking, NOT UA/referrer checks — users may incorrectly assume it protects against everything",
    "The upstream expects all included files to exist at /etc/nginx/bots.d/ — if any is missing during nginx reload, nginx will fail to start"
  ],
  "noStagedFiles": true,
  "diffSummary": "Research document written to artifacts output path. No source code modified.",
  "reviewFindings": [
    "No blockers found in fetched content. All files are as-expected from the upstream repo at tag V4.2026.07.6037.",
    "Recommendation: Before integrating into WIMS, audit WIMS nginx config for variable/zone name overlap with upstream definitions."
  ],
  "manualNotes": "The upstream globalblacklist.conf is ~541KB with most content (~538KB) being generated list entries (696 bad bots + 7113 bad referrers + thousands of bad IPs). For integration, WIMS should consider whether all upstream lists are needed or only a subset. The rate limiting zones (bot2_*, bot4_*) are uniquely named and safe; the variable names ($bad_bot, etc.) are the primary collision risk."
}
```
