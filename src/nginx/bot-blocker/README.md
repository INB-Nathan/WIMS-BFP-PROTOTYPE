# nginx-ultimate-bad-bot-blocker — Vendored Edge Ruleset

This directory contains a vendored, minimal subset of the
[nginx-ultimate-bad-bot-blocker](https://github.com/mitchellkrogza/nginx-ultimate-bad-bot-blocker)
by Mitchell Krog (MIT License).

## Upstream

- **Repo:** https://github.com/mitchellkrogza/nginx-ultimate-bad-bot-blocker
- **Version:** V4.2026.07.6037 (July 2026)
- **License:** MIT — see `LICENSE` in this directory.

## Files

| Path | Purpose |
|------|---------|
| `conf.d/globalblacklist.conf` | Http-scope map/geo blocklists (bad UAs, referrers, IPs) + rate-limit zones |
| `conf.d/wims-botblocker-settings.conf` | WIMS-specific zone definitions (e.g. `flood`) |
| `bots.d/blockbots.conf` | Server-block enforcement (return 444 on matches) |
| `bots.d/ddos.conf` | Server-block connection/referer DDoS rate limiting |
| `bots.d/blacklist-user-agents.conf` | Custom UA black/whitelist overrides |
| `bots.d/blacklist-ips.conf` | Custom IP blacklist overrides |
| `bots.d/bad-referrer-words.conf` | Custom bad referrer word patterns |
| `bots.d/custom-bad-referrers.conf` | Custom bad referrer domain overrides |
| `bots.d/whitelist-ips.conf` | IP whitelist (only bypasses IP blocks, not UA/referrer) |
| `bots.d/whitelist-domains.conf` | Domain whitelist (bypasses referrer checks) |
| `LICENSE` | MIT license text |

## Updating

1. Download the latest `globalblacklist.conf` from upstream:
   ```bash
   curl -sL -o conf.d/globalblacklist.conf \
     "https://raw.githubusercontent.com/mitchellkrogza/nginx-ultimate-bad-bot-blocker/master/conf.d/globalblacklist.conf"
   ```
2. Review the zone/settings collision guide below before deploying.
3. Run `cd src && docker compose up -d nginx-gateway --no-deps` and verify
   `docker exec wims-nginx-gateway nginx -t` passes.

## Zone / Variable Collision Guide

When updating `globalblacklist.conf`, check for duplicate definitions:

| Name | Defined by upstream | WIMS status |
|------|--------------------|-------------|
| `$bad_bot` | map in globalblacklist.conf | Not defined by WIMS — safe |
| `$bad_referer` | map in globalblacklist.conf | Not defined by WIMS — safe |
| `$bad_words` | map in globalblacklist.conf | Not defined by WIMS — safe |
| `$validate_client` | geo in globalblacklist.conf | Not defined by WIMS — safe |
| `$ratelimited` | geo in globalblacklist.conf | Not defined by WIMS — safe |
| `$bot_iplimit` | map in globalblacklist.conf | Not defined by WIMS — safe |
| `$bot_iplimit2` | map in globalblacklist.conf | Not defined by WIMS — safe |
| `bot2_connlimit` | limit_conn_zone in globalblacklist.conf | Not defined by WIMS — safe |
| `bot2_reqlimitip` | limit_req_zone in globalblacklist.conf | Not defined by WIMS — safe |
| `bot4_connlimit` | limit_conn_zone in globalblacklist.conf | Not defined by WIMS — safe |
| `bot4_reqlimitip` | limit_req_zone in globalblacklist.conf | Not defined by WIMS — safe |
| `addr` | Referenced in ddos.conf | **Defined by WIMS** — compatible (10m) |
| `flood` | Referenced in ddos.conf | **Defined in wims-botblocker-settings.conf** — safe |

## False-Positive Workflow

If a legitimate bot/UA/referrer is blocked:

1. Add the user-agent or referrer to the appropriate whitelist file in `bots.d/`.
2. Add the IP to `bots.d/whitelist-ips.conf`.
3. For complete bypass (UA + IP), uncomment the Super Whitelist in
   `bots.d/blockbots.conf`.
4. Reload nginx: `docker exec wims-nginx-gateway nginx -s reload`
5. Verify the path is unblocked.

---

*Vendored 2026-07-09. See `system-wiki/log.md` for deployment history.*
