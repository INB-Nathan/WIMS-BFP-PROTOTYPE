# Public Surface Information Architecture — Design Spec

**Map**: [#603](https://github.com/x1n4te/WIMS-BFP-PROTOTYPE/issues/603)
**Origin**: [#606](https://github.com/x1n4te/WIMS-BFP-PROTOTYPE/issues/606) (IA grilling)
**Research**: [#605](https://github.com/x1n4te/WIMS-BFP-PROTOTYPE/issues/605) (reference platforms + design language)
**Date**: 2026-07-15
**Status**: approved

---

## Scope

The public-facing surface: Intent Modal, Public Landing (`/`), Report Wizard (`/report`), Information Hub (`/information`), Contributor Dashboard (`/contributor`), Fire Stations (`/fire-stations`), and Report Tracking (`/tracking/:id`). Covers information architecture, navigation, and layout decisions. Does not cover visual design details (belongs to prototype #607) or asset creation (#608).

## Out of scope

- Fire perimeter polygon geometry (deferred ticket)
- MapLibre migration (deferred)
- WCAG compliance audit (not yet needed)
- Offline support for anonymous users
- Staff-side surfaces (encoder, validator, analyst, admin — sidebar stays, dashboard stays)
- `/login`, `/register`, `/verify*` (auth flow pages — redesign follows this spec's design language later)

---

## Design language (from research #605)

These are constraints, not design — the prototype (#607) interprets them visually:

- **Dark base**: `#1a1a1a`–`#2d2d2d`
- **Severity palette**: red `#d00`, orange `#e87`, yellow `#fc0`, green `#4a0`
- **Typography**: system sans-serif
- **Icons**: simple filled style
- **Motion**: only for state changes, never decoration
- **No**: splash animations, gamification, engagement metrics, inflated-danger framing
- **Severity indicators**: Must use shape + color, never color alone. Dark base + red/orange/green palette fails deuteranopia/protanopia users. Prototype #607 must pair hue with distinct iconography or pin shapes. This is a design constraint, not a deferred WCAG audit.

---

## Architecture

### 1. Intent Modal

**Trigger**: every visit to `/` (public landing route).

**Bypass rule**: If the user chose "Browse" within the last 2 hours (tracked via a lightweight session cookie, not localStorage), skip the modal and go directly to the Public Landing. The "Report a Fire" path always shows the modal — a panicked user should never get a stale bypass. This prevents fatigue for community monitors, journalists, or residents refreshing during an active fire event.

**Visual**: Full-screen, dark background with a WIMS-BFP-themed image + gradient overlay. Two large, touch-friendly cards side-by-side (stacked on mobile):

| Card | Color | Content | Destination |
|------|-------|---------|-------------|
| Report a Fire | Red-dominant, larger | Icon (flame), label "Report a Fire" | `/report` |
| Browse | Gray-subdued | Icon (compass), label "Browse" | `/` → Public Landing |

**Microcopy**: "No account needed to report" (singular line, below cards).

**Behavior**: No dismiss button ("X"). The user must choose a path. Closing the tab or navigating away is the only escape.

**Rationale**: Research shows zero-friction entry (Watch Duty) builds trust. Triage at the door focuses the urgent reporter immediately while giving the browser a rich experience.

---

### 2. Public Landing (`/`, Browse path)

**Header** (anonymous): `[BFP Logo]` — `[Register]` `[Sign In]` — `[Report a Fire]` (button, right-aligned on desktop, hidden on mobile in favor of FAB).

**Header** (logged-in civilian): `[BFP Logo]` `[Home]` `[Dashboard]` `[Information]` — `[Profile avatar]` `[Report a Fire]`.

**Body**:
- **Map** (~55% viewport): Leaflet map with heatmap and clustered-pin layers. Fire station locations as toggleable layer. Data sourced from existing backend endpoints. When no active emergencies exist, map still renders — default view shows verified BFP incident data from the national validator.
- **Bottom-sheet** (scrollable below the map): nearby fires list, announcements, fire station links. On desktop, this is a scrollable panel below the map; on mobile, a bottom-sheet pattern.

**Bottom-sheet content order**:
1. "Active fires near you" — list of nearby incidents (heatmap/cluster-driven)
2. "BFP Announcements" — show skeleton/gray placeholder containers during data fetch only. Once the API returns an empty array, transition to a quiet empty state: "No active announcements at this time." Never keep skeletons permanently on screen — they're universally interpreted as loading indicators and make the page look broken.
3. "Fire stations" — links to the `/fire-stations` split view

**Footer**: Privacy link, Register link, copyright.

**Removed from current landing**:
- Hero badge "BFP Incident Reporting Network" + pulsing green dot
- Live ticker marquee (`<LiveTicker />`)
- Hero section with title, subtitle, three buttons (replaced by Intent Modal)
- "Fire stations" standalone link card (folded into map layer + bottom-sheet)

**Data note**: "Nearby fire activity" previously lived in the `/report` wizard (Safety step). It moves to this landing. The backend public endpoint already serves this data.

---

### 3. Report Wizard (`/report`)

**Steps**: 5 steps:

```
Step 1 — Location     →  Map picker / GPS / manual lat-lng with landmark assistance
Step 2 — Photo        →  Optional photo upload (camera or gallery)
Step 3 — Category     →  Incident type + what you observe (large flames, heavy smoke, explosions, etc.)
Step 4 — Details      →  Description (required). Advanced fields (optional contact, additional notes) use progressive disclosure — shown only when the user expands "Add more detail."
Step 5 — Review       →  Full summary of all steps, duplicate detection results, confirmation → submit or offline-queue
```

**Progressive disclosure on Details**: The Details step shows only the essential field (description) by default. An expandable section "Add more detail" reveals optional fields: contact info, additional notes. This keeps the wizard fast for urgent reports while allowing thorough reports for those who want to provide more.

Duplicate detection already exists in the current wizard and requires no change.

**Landmark assistance**: On the Location step, a text input allows the reporter to describe nearby landmarks (e.g. "near Jollibee on Rizal Ave") to supplement the map pin / GPS coordinates. This is optional and helps validators contextualize the location. Not a replacement for coordinates.

**Observable indicators** (replaces severity dropdown): Category step asks "What do you observe?" with checkable options — large flames, heavy smoke, explosions, spreading fast, structures threatened, people trapped, electrical fire, chemical/ hazardous smell, other. These are observable, not assessed — a civilian reporter can't determine severity, but they can describe what they see.

**Persistent safety banner**: Non-dismissible banner at top of wizard throughout all steps: "You are safe. If you are in danger, call 911 or your local BFP hotline immediately." Replaces the old separate Safety step.

**Post-submit success screen**: A receipt-style confirmation — official layout with BFP branding, report summary (what, where, when), QR code encoding the tracking URL, tracking token with copy-to-clipboard, and timestamp. Designed to be screenshotted and feel like a government-issued acknowledgment, not a generic "success" message.

**Registration incentive**: Below the receipt, progressive disclosure: the token and QR let the user track this specific report. A section reveals what registering unlocks — "Track all your reports in one place, get status updates, contribute verified reports." CTA: "Register to unlock full tracking." The token remains functional even without registration; the incentive is additive, not a gate.

**Report FAB/button**: On mobile, a red floating action button pinned bottom-right on all public + contributor pages. On desktop, a red "Report a Fire" button in the header. Both link to `/report`.

**Draft continuation**: The wizard auto-saves progress to localStorage after each completed step (location, category, details). On entry to `/report`, if a draft exists, show a prompt: "You have an unfinished report. Continue where you left off?" with two options — "Continue draft" (resumes at the last incomplete step) or "Start fresh" (clears draft storage). The draft is cleared on successful submission. Expires after 24 hours of inactivity.

**Removed**: "Nearby fire activity / Mga kalapit na sunog" section (moved to Public Landing). Old Safety step (replaced by persistent banner).

---

### 4. Information Hub (`/information`)

**Audience**: Public, no auth required. Same information for anonymous and registered users.

**Content**:
- Filterable list of all active emergencies (search, severity filter, date range)
- Full announcements archive
- **"How to Report" guide** — educational section explaining the reporting flow, photo tips, what happens after submission, how tracking works
- CTA card: "Want to track your reports and contribute regularly? Register as a reporter."

**Relationship to landing**: Landing shows what's near you. `/information` shows everything, with deeper filtering and the How-to-Report guide.

---

### 5. Contributor Dashboard (`/contributor`)

**Audience**: Authenticated civilian reporters only (`CIVILIAN_REPORTER` role).

**Header**: Navbar (not sidebar). `[Logo]` `[Home]` `[Dashboard]` `[Information]` — `[Profile avatar]` `[Report a Fire]`.

**Body**:
1. Two stat cards: "Reports you filed" (count), "Verified reports" (count/percentage)
2. Scrollable list of user's reports with status indicators
3. Compact nearby activity map (same component as landing, smaller viewport)

**"Report again" flow**: Location-first, then details — matching the Report Wizard step order. The CTA in dashboard links directly to `/report`.

**Removed**: Sidebar for civilian role (replaced with navbar). Old Megaphone icon for Contributor, Newspaper icon for Information.

---

### 6. Fire Stations (`/fire-stations`)

**Layout**: Split view — interactive map on one side, scrollable station directory on the other. Desktop: side-by-side. Mobile: map collapses to top half, directory scrolls below.

**Access**: From landing bottom-sheet link and from map toggle (fire stations layer).

**Removed**: Standalone link card on landing page.

---

### 7. Report Tracking (`/tracking/:id`)

**Access**: QR code from post-submit success screen, or direct URL entry.

**Content**: Token lookup → status + timeline. Users arrive via QR code scan (from post-submit success screen) or by pasting a token. Dark styling applied. No structural redesign — the page itself is not broken, only needs restyling.

---

## Navigation matrix

| State | Header left | Header center | Header right | Mobile FAB |
|-------|-------------|---------------|--------------|------------|
| Anonymous (public) | Logo | — | Register, Sign In, [Report btn] | Red FAB |
| Logged-in civilian | Logo | Home, Dashboard, Information | Profile avatar, [Report btn] | Red FAB |
| Staff (encoder/validator/analyst/admin) | Sidebar (unchanged) | — | — | — |

---

## Dependency notes

- **Loading fix (#604)** must land before this spec is implemented — otherwise the public surface is still blocked by a hanging fetchSession.
- **Research (#605)** established the design language and reference patterns — this spec is the architecture translation.
- **Prototype (#607)** takes this IA spec and the research design language to produce a visual prototype.
- **Assets (#608)** produces the actual media after the prototype validates the direction.

---

## Edge cases and empty states

| State | Behavior |
|-------|----------|
| No active emergencies | Map shows verified BFP incident data (from national validator), not an empty state |
| No announcements | Skeleton containers during fetch → calm "No active announcements at this time" empty state on empty response |
| Map chunk fails to load (offline/SW quota) | Manual lat/lng fallback (existing `MapPickerErrorBoundary`) |
| User closes tab at intent modal | No state — modal re-appears on next visit unless 2-hour Browse bypass is active |
| User refreshes at intent modal | Modal re-appears unless 2-hour Browse bypass is active |
| Draft exists on /report entry | Prompt: "Continue draft" or "Start fresh" |

---

## Conflict with existing glossary

The existing `CONTEXT.md` defines `Community Safety Hub` at `/community`. This route does not exist in the codebase. The `/information` route serves that purpose. Standardize on `/information` — "Information Hub" is more authoritative for public safety than "Community," which implies a social forum.

## Security flag: anonymous token claiming

When an anonymous reporter registers after submitting a report, the backend must provide a secure handshake to claim their anonymous tracking token into the new `CIVILIAN_REPORTER` account. Without this, bad actors could scrape or claim random tokens. This is an implementation concern for the report flow ticket, not an IA decision, but must be addressed before registration incentive goes live.
