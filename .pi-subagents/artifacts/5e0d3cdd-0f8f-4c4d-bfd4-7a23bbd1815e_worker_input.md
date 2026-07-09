# Task for worker

You are a delegated subagent running from a fork of the parent session. Treat the inherited conversation as reference-only context, not a live thread to continue. Do not continue or answer prior messages as if they are waiting for a reply. Your sole job is to execute the task below and return a focused result for that task using your tools.

Task:
Create the file `src/backend/tests/test_nginx_bot_blocker.py` for the WIMS-BFP project at /home/computa/Projects/WIMS-BFP/WIMS-BFP-PROTOTYPE.

This is a contract test file that verifies nginx bad-bot blocker integration for issue #517. The bot-blocker files are vendored under `src/nginx/bot-blocker/` with this structure:
- `conf.d/globalblacklist.conf` (main http-scope include, ~541KB)
- `conf.d/wims-botblocker-settings.conf` (WIMS-specific zone/settings)
- `bots.d/blockbots.conf`, `bots.d/ddos.conf` (server-block includes)
- `bots.d/blacklist-user-agents.conf`, `bots.d/blacklist-ips.conf`, `bots.d/bad-referrer-words.conf`, `bots.d/custom-bad-referrers.conf`, `bots.d/whitelist-ips.conf`, `bots.d/whitelist-domains.conf`

The three nginx configs are at `src/nginx/nginx.conf`, `src/nginx/nginx.local.conf`, `src/nginx/nginx.ci.conf`.
The docker-compose file is at `src/docker-compose.yml`.

Reference the existing test_nginx_forwarded_headers.py for the parametrization pattern (parametrize over all 3 configs).

Create these tests:

1. **test_nginx_globalblacklist_include** — For each of the 3 configs, assert that the http block includes `/etc/nginx/bot-blocker/conf.d/globalblacklist.conf`

2. **test_nginx_blockbots_ddos_in_every_server** — For each config, assert that EVERY server block contains both `include /etc/nginx/bot-blocker/bots.d/blockbots.conf;` and `include /etc/nginx/bot-blocker/bots.d/ddos.conf;`. The `/health` location and HTTP redirect server blocks are exempt.

3. **test_docker_compose_bot_blocker_volume_mount** — Parse `src/docker-compose.yml` and assert the nginx-gateway service mounts `./nginx/bot-blocker:/etc/nginx/bot-blocker:ro`

4. **test_globalblacklist_zone_names_no_collision** — Read `globalblacklist.conf` and assert NO `limit_conn_zone`/`limit_req_zone` directive collides with existing WIMS zones (`addr`, `general_api`, `public_api`, `civilian_api`, `keycloak_api`, `reset_credentials`). Bot-prefixed zones are safe.

5. **test_bot_blocker_support_files_exist** — Assert all required support files exist under `src/nginx/bot-blocker/`:
   - `conf.d/globalblacklist.conf`
   - `conf.d/wims-botblocker-settings.conf`  
   - `bots.d/blockbots.conf`
   - `bots.d/ddos.conf`
   - `bots.d/blacklist-user-agents.conf`
   - `bots.d/blacklist-ips.conf`
   - `bots.d/bad-referrer-words.conf`
   - `bots.d/custom-bad-referrers.conf`
   - `bots.d/whitelist-ips.conf`
   - `bots.d/whitelist-domains.conf`

6. **test_bot_blocker_flood_zone_defined** — Assert that `wims-botblocker-settings.conf` defines `limit_req_zone` with `zone=flood`

Use the same parametrization pattern as test_nginx_forwarded_headers.py (parametrize over all 3 configs). Use `assert`, not pytest special assertions where avoidable.

IMPORTANT: Do NOT try to read the actual globalblacklist.conf in tests 1-3 (it's 541KB). Just check with `in` / `in conf` for the include directives.

For test 4, read globalblacklist.conf but only scan for `limit_conn_zone` and `limit_req_zone` lines — don't load the full 541KB into memory unless needed.

Please report the exact file content you write as the output.

## Acceptance Contract
Acceptance level: reviewed
Completion is not accepted from prose alone. End with a structured acceptance report.

Criteria:
- criterion-1: Implement the requested change without widening scope
- criterion-2: Return evidence sufficient for an independent acceptance review

Required evidence: changed-files, tests-added, commands-run, validation-output, residual-risks, no-staged-files

Review gate: required by reviewer.

Finish with a fenced JSON block tagged `acceptance-report` in this shape:
Use empty arrays when no items apply; array fields contain strings unless object entries are shown.
```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "specific proof"
    }
  ],
  "changedFiles": [
    "src/file.ts"
  ],
  "testsAddedOrUpdated": [
    "test/file.test.ts"
  ],
  "commandsRun": [
    {
      "command": "command",
      "result": "passed",
      "summary": "short result"
    }
  ],
  "validationOutput": [
    "validation output or concise summary"
  ],
  "residualRisks": [
    "none"
  ],
  "noStagedFiles": true,
  "diffSummary": "short description of the diff",
  "reviewFindings": [
    "blocker: file.ts:12 - issue found, or no blockers"
  ],
  "manualNotes": "anything else the parent should know"
}
```