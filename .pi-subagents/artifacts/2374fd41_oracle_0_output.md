Inherited decisions:
- Decision 1: vendor minimal deterministic bot-blocker files under `src/nginx/bot-blocker/`; no submodule/full clone; no build-time download.
- Decision 2: `globalblacklist.conf` in `http {}`; `blockbots.conf`/`ddos.conf` in each app-serving `server {}`; redirect-only server exempt.
- Avoid zone collisions: define only missing `flood`; do not redefine WIMS `addr`.

Diagnosis:
- Decision 2 is mostly implemented in top-level nginx configs.
- Decision 1 is **not safely implemented yet**: several vendored files are GitHub `429` error pages, and `globalblacklist.conf` still references `/etc/nginx/bots.d/*`, while Compose only mounts `/etc/nginx/bot-blocker`.

Drift / contradiction check:
- `src/nginx/bot-blocker/LICENSE:1` is not MIT license text; it is a GitHub `429: Too Many Requests` page.
- `bad-referrer-words.conf`, `whitelist-domains.conf`, and `whitelist-ips.conf` are also `429` pages.
- `globalblacklist.conf` includes `/etc/nginx/bots.d/...` at 8 sites, but only `/etc/nginx/bot-blocker` is mounted. This can break nginx startup.
- Contract tests pass but do not catch invalid file contents or nested absolute include paths.

Recommendation:
- Do **not merge PR #540 yet**.
- Fix vendored files and license, rewrite or mount support include paths consistently, and add tests for:
  - no `429: Too Many Requests` in vendored files
  - all absolute includes resolve inside mounted bot-blocker path
  - LICENSE contains MIT license text
- Then rerun `nginx -t` and normal/bad UA smoke.

Risks:
- Current PR may fail nginx startup.
- Even if include paths are fixed, the 429-page `.conf` files would be invalid nginx syntax.
- The handoff UA smoke checklist is claimed/gated only weakly; I found no repository evidence that actual `Mozilla`/`Googlebot`/`80legs` curl smoke was run.

Need from main agent:
- Fix blockers before force-pushing PR #540.

Suggested execution prompt:
- Implementation handoff warranted: “Fix PR #540 bot-blocker vendoring: replace 429 response files with valid upstream/MIT files, ensure `globalblacklist.conf` include paths resolve under `/etc/nginx/bot-blocker` or add a deliberate `/etc/nginx/bots.d` mount, add tests rejecting 429 contents and unresolved absolute includes, rerun bot-blocker tests and nginx syntax/smoke.”