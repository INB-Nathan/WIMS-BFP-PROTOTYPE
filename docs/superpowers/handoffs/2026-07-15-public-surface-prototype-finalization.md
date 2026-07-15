# Handoff — Finalize Public Surface Prototype (Wayfinder #603 / #607 / #608)

**Created:** 2026-07-15
**Branch:** `feat/public-surface-overhaul`
**Prototype file:** `prototypes/public-surface/index.html` (single self-contained file)
**Preview:** `cd prototypes/public-surface && python3 -m http.server 8090` → `http://localhost:8090/index.html`

---

## 1. Where we are (verified via `gh`)

This is the **WIMS-BFP public-surface overhaul**. It lives under one Wayfinder map with several child tickets:

| Ticket | Type | State | What it is |
|---|---|---|---|
| **#603** Wayfinder: Public Surface Overhaul | `wayfinder:map` | **OPEN** | Umbrella decision map. Destination: complete, professional public surface (landing, report flow, contributor experience) for anonymous reporters + `civilian_reporter`. |
| #604 Fix loading hang (`fetchSession` timeout) | `wayfinder:task` | CLOSED | Prerequisite; fixed in code (not in this prototype file — that fix belongs in `src/frontend`, see note §6). |
| #605 Research patterns | `wayfinder:research` | CLOSED | Watch Duty / PulsePoint / Calgary 311 / USWDS patterns. |
| #606 Resolve IA (grilling) | `wayfinder:grilling` | CLOSED | IA spec produced. |
| **#607 Visual prototype** | `wayfinder:prototype` | **CLOSED** | The prototype we just built (`prototypes/public-surface/index.html`). |
| **#608 Create custom media/assets** | `wayfinder:task` | **OPEN / unblocked** | Icons, illustrations, empty states, pubmats — the **remaining work** to finalize the prototype. |

**We were specifically working on #607** (the prototype). #607 is now delivered (CLOSED). The only open child of the map is **#608**, which is the image/media generation step needed to finalize the prototype's look.

---

## 2. ⚠️ FIRST THING THE NEXT AGENT MUST DO

**Before generating any images, the next agent MUST read the WIMS Wayfinder skill and its references:**

```
.pi/skills/wims-wayfinder/SKILL.md
.pi/skills/wims-wayfinder/references/concurrency-protocol.md
.pi/skills/wims-wayfinder/references/github-operations.md
.pi/skills/wims-wayfinder/references/prototype-companion.md
```

Tell it explicitly:

> "You are continuing the **same Wayfinder issue we are on right now** — map **#603** 'Public Surface Overhaul'. The prototype (#607) is already built and CLOSED. The open child you will work is **#608 'Create custom media/assets'** (image/asset generation). **Do not start generating images until you have read `.pi/skills/wims-wayfinder/SKILL.md` and its references**, and you are operating inside that workflow (claim #608 under the concurrency protocol, follow the GitHub-ops / branch discipline, and update #608 + the map via the writer-lock protocol). Wayfinder resolves **at most one non-research ticket per session** — #608 is that one ticket."

Why this matters: #608 is a tracked Wayfinder ticket, not a freestyle art task. The skill forbids improvising a partial remote workflow, requires batch confirmation before tracker mutations, and treats prototype work as disposable/non-mergeable (see `prototype-companion.md`). The agent must follow that, not just produce PNGs.

---

## 3. What the prototype contains (all built, committed)

Single-file `prototypes/public-surface/index.html`. Scenes / sections:

1. **Intent Modal** — Report a Fire / Browse; Browse has 2-hour session bypass.
2. **Landing** — full-viewport Leaflet-style map; incident list docked (flush right) or floating (toggle). Header/footer float over map. Footer spans below both map and list.
3. **Incidents** (`/incidents`) — filterable table of active BFP incidents (was split out of Information).
4. **Information** (`/information`) — BFP Announcements (with optional pubmat media block), How-to-Report guide, Community Resources (Fire Safety Tips + Emergency Numbers, full researched lists).
5. **Report Wizard** — 5 steps; safety banner; observable indicators; drafts auto-save concept.
6. **Fire Stations** — split map + directory.
7. **Contributor Dashboard** — navbar (not sidebar); stat cards; status breakdown; drafts; **Activity feed = timeline grouped by report**; empty state; nearby mini-map.
8. **Register** — side-by-side benefits + form (first/last name, phone, email, password strength meter, confirm match, privacy checkbox).
9. **Receipt** — split QR + token layout.
10. **Tracking** (`/tracking/:id`) — token, status pill, details, timeline.
11. **Profile / Settings** — avatar, account details, notification toggles, privacy/security, sign-out.
12. **Incident Detail modal** — badges, mini-map, photo strip, observations, timeline.

Dark base + light theme toggle (top-right). Responsive (table→cards, modal→bottom-sheet, sidebar→overlay).

---

## 4. Where #608 images go (current placeholders)

The prototype uses placeholder blocks that #608 should replace with AI-generated assets (BFP logo stays; all other media AI-generated per the earlier decision):

- `.ann-media` blocks in BFP Announcements (pubmat placeholders: "🖼️ Pubmat · …").
- `.landing-map-placeholder` (map background / heat blobs / pins — decorative SVG/CSS currently).
- Incident modal photo-strip placeholders ("📷 Photo 1/2", "+ Add photo").
- Empty-state icons (emoji currently).
- Receipt QR is a CSS placeholder (`reprint` is fine to stay as a generated QR later).
- General icons are emoji — #608 may replace with a consistent icon set.

Asset strategy: keep it professional/civic, no gamified or vibe-coded decoration. Severity must stay **shape + color** (WCAG), not color-alone.

---

## 5. Hard design constraints (do not violate)

- **Leaflet stays** for this scope; MapLibre migration is deferred.
- **No gamification / vibe-coded elements.** Animation only when conveying data.
- **Dark base** design language; light mode is a validated toggle, not the default.
- **All existing public routes preserved** (none deleted).
- **Severity = shape + color** (accessibility), not color alone.
- Professional civic/reporting tone (Watch Duty / USWDS influence).
- Prototype is disposable: it **cannot merge or silently become implementation** (per `prototype-companion.md`). When the real implementation begins, translate these screens into React components in `src/frontend` per the IA spec.

---

## 6. Out-of-scope notes for the next agent

- **#604 (loading fix)** is a *code* change in `src/frontend/src/context/AuthContext.tsx` + `src/frontend/src/lib/auth-refresh.ts` (add AbortController/timeout, pattern exists in `src/frontend/src/lib/syncEngine.ts` `SESSION_CHECK_TIMEOUT_MS`). It is **not** in the prototype file and is already handled separately. Don't re-do it in the prototype.
- The prototype's `fetchSession` timeout is a *visual* representation only; the real fix is in the frontend source.
- `CONTEXT.md` already has the glossary entries for this work; update it if #608 introduces new terms.
- IA spec: `docs/superpowers/specs/2026-07-15-public-surface-ia-design.md`.

---

## 7. Suggested next-agent sequence

1. Read `.pi/skills/wims-wayfinder/SKILL.md` + `concurrency-protocol.md` + `github-operations.md` + `prototype-companion.md`.
2. Confirm you are on map #603, prototype #607 delivered, open ticket #608.
3. Claim #608 under the concurrency protocol; preview any tracker mutations for batch confirmation.
4. Generate the #608 assets, wire them into the placeholder locations in `prototypes/public-surface/index.html`.
5. Resolve #608, close it, update the #603 map via the writer-lock protocol.
6. Report the frontier and stop (do not begin React implementation — that is a separate, later effort).

---

## 8. Quick reference

- Repo: `x1n4te/WIMS-BFP-PROTOTYPE` (verify with `gh repo view --json nameWithOwner`).
- Preview server: `python3 -m http.server 8090` in `prototypes/public-surface/`.
- Working branch: `feat/public-surface-overhaul` (off `origin/master`).
- Key files: `prototypes/public-surface/index.html`, `docs/superpowers/specs/2026-07-15-public-surface-ia-design.md`, `CONTEXT.md`.
