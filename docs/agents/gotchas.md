# Gotchas — Read Before Every Review

Each is a real mistake a sub-agent made.

## Priority 1 — Evidence & Integrity (Never Violate)

1. **Don't cite a line you didn't read.** If you say file.ts:42, read line 42 first.
2. **Verify security claims.** Zero evidence in the file means don't claim it.
3. **Never cite an FRS module without reading the source file.** The module map (`system-wiki/concepts/frs-module-map.md`) is a routing index with abbreviated names — not a requirements summary. Module names are misleading (e.g., Module 15 is "Reference Data Service", not "Offline-First"). Before stating "FRS Module N requires X," always `read system-wiki/raw/frs/frs-*.md` for that module and quote the exact line. If the FRS doesn't say it, don't claim it does.
4. **Don't bypass the spec unless you can justify it.** If an implementation deviates from an issue, PRD, acceptance criterion, file name, API contract, migration number, or explicit user instruction, the agent must state the deviation, explain why it is necessary, and show how it materially improves correctness, safety, maintainability, or user value. Otherwise, follow the spec exactly or ask first.
5. **Don't switch implementation approach without asking.** If the user's request implies a fundamentally different architecture than what you were planning (e.g., Pi-driven vs CI-driven, local vs remote), and changing approaches would conflict with existing files, agents, chains, or workflows, ask the user first. Don't silently build the wrong thing.

## Priority 2 — Methodology (Always Follow)

6. **Count explicitly.** Say "X of Y", not "all" or "most".
7. **Read the actual config.** Don't assume .env secrets; check for hardcoded values.
8. **Search before claiming.** `rg` for the function/symbol first.
9. **Check every service.** One 0.0.0.0 binding means not all are localhost-only.
10. **Check every image tag.** Two `:latest` means not all are pinned.
11. **Re-read after edits.** Line numbers shift. Verify before citing.
12. **No exceptions mean no rule.** If one service lacks health conditions, the pattern isn't universal.
13. **Prove it with a specific line and file.** "Clean code" needs receipts.
14. **Don't assume a commit's parent branch without verifying.** Seeing a commit in `git log --oneline` for the whole repo doesn't mean it's on master. Always run `git branch --contains <commit>` before claiming a branch is behind.
15. **Validate CI before merging.** Running local lint/tests isn't enough — GitHub CI runs `npm run lint`, `ruff check`, `ruff format --check`, `pytest`, and `vitest` in a fresh environment. Run the exact CI commands locally first, or you'll get red merge gates.

16. **Run ruff before every commit.** E402: don't place code between import blocks. `ruff check .` and `ruff format --check .` are cheap; skipping them pushes red.

17. **Target `master`, not `main`.** This repo has a stale orphan branch named `main` that is far behind `master`. Opening a PR against `main` shows 100+ unrelated commits and cannot be merged. If a PR shows far more commits than the branch has, check the base branch — it was probably opened against `main` by mistake. Always verify `gh pr view <N> --json baseRefName` before reviewing or merging. If found, close the duplicate and use the correct PR targeting `master`.

18. **Don't race the automated CD/deploy pipeline with manual VPS fixes.** Every push to `master` triggers two GitHub Actions workflows that deploy automatically:
    - **`cd.yml`**: builds `wims-backend` and `wims-frontend` Docker images, pushes them to `ghcr.io/x1n4te/<image>:latest`.
    - **`deploy.yml`** (after CI gate passes): SSHs into the VPS, runs `git reset --hard` + `git clean -fd` (wiping manual edits to tracked files), pulls the GHCR images, and runs `scripts/deploy-vps.sh` which does `docker compose up -d` with `-f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production`.

    If you SSH into the VPS and manually edit files or run `docker compose` commands while this pipeline is running, you will:
    - Have your manual edits wiped by `git reset --hard`.
    - Race with `compose up -d` (containers may get stuck in "Created" state, get killed, or end up on the wrong image).
    - End up with containers running stale images (`ghcr.io/...` from the last successful deploy) instead of the local builds you intended.

    **Before any manual VPS intervention:**
    1. Check GitHub Actions to see if a deploy is in progress: `gh run list --workflow=deploy.yml --limit=5`
    2. Wait for any running deploy to finish (green check) before touching the VPS.
    3. After it finishes, pull the latest commit and let the pipeline deploy it. Manual VPS edits should be the last resort, not the first reflex.
    4. If you must make an emergency VPS-only fix, commit the change to the repo and push so the next deploy doesn't revert it.

19. **Always set FRONTEND_IMAGE and BACKEND_IMAGE when running `docker compose up` manually on the VPS.** The base `docker-compose.yml` resolves images via `${FRONTEND_IMAGE:-wims-frontend:local}` and `${BACKEND_IMAGE:-wims-backend:local}`. If these env vars are not set, compose falls back to stale `:local` images instead of the `ghcr.io/x1n4te/<image>:latest` images built and deployed by the CD pipeline. The result: frontend/backend silently roll back to whatever outdated local build happened to be cached. Always export both vars and use `--no-build`:
    ```bash
    cd /opt/wims-bfp/src
    export FRONTEND_IMAGE=ghcr.io/x1n4te/wims-frontend:latest
    export BACKEND_IMAGE=ghcr.io/x1n4te/wims-backend:latest
    docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production up -d --no-build --wait <service>
    ```

20. **Nginx bind mounts go stale after `git reset --hard`.** When `git reset --hard` replaces a file (new inode), Docker bind mounts pointing to the old inode become stale — `docker exec … nginx -s reload` succeeds but the container still serves the old config. Check with `wc -l` on host vs container; if they differ, `docker compose down <svc> && docker compose up -d <svc>` to re-establish the mount. A simple `docker compose up -d <svc>` (without `down` first) does NOT fix this.
