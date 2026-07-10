---
description: Update WIMS system-wiki after a non-trivial change
argument-hint: "[change summary]"
---
Update the WIMS system-wiki for this change: `$ARGUMENTS`.

Steps:
1. Read `system-wiki/AGENTS.md` and the relevant synthesis page before editing.
2. Update only the synthesis page(s) affected by the change.
3. Update `system-wiki/index.md` so routing, the last-change summary, and the indexed-page count remain accurate.
4. Add a concise entry to `system-wiki/log.md` with scope, files modified, behavior/config/doc impact, and validation.
5. Update `system-wiki/gaps/frs-codebase-gap-register.md` only if this creates, closes, or modifies an FRS/codebase gap.
6. Do not edit `system-wiki/raw/` unless replacing it with a newer authoritative source batch.
7. Report exactly which wiki files changed and why.
