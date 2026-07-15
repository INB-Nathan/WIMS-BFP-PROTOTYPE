# WIMS-BFP Context

Domain language for WIMS-BFP civilian reporting and incident workflow. This glossary is implementation-free and exists to keep public-reporting, validation, and official incident terms distinct.

## Language

**Intent Modal**:
A mandatory full-screen gate shown on every landing page visit that asks the user to choose between "Report a Fire" (→ /report) or "Browse" (→ Public Landing). Replaces the old hero section; there is no dismiss button — the user must choose a path.
_Avoid_: Splash screen, welcome screen, onboarding modal

**Public Landing**:
The map-first home page shown after choosing "Browse" in the Intent Modal. It features a heatmap/clustered-pin map layer, a scrollable bottom-sheet with nearby fire activity, announcements, and fire station listings. Replaces the old hero-centric landing.
_Avoid_: Homepage, hero page, root page

**Civilian Reporter Dashboard**:
The `/contributor` hub for logged-in civilian reporters, reached through a top navbar (not the sidebar used by staff roles). Shows reporter stats, their submitted reports with status, and a small nearby-activity map.
_Avoid_: Contributor sidebar, civilian workspace

**Report Wizard**:
The 5-step report flow at `/report`: Location (with landmark assistance) → Photo (optional) → Category (incident type + what you observe) → Details → Review. The old "Safety" step is removed (nearby fire activity moved to Public Landing, safety warning moved to a persistent banner). Drafts auto-save to localStorage and can be resumed within 24 hours.
_Avoid_: Report form, multi-step form, report stepper

**Report FAB**:
A floating action button pinned bottom-right on mobile, and a header button on desktop, that links directly to `/report`. Present on all public and contributor pages.
_Avoid_: Report shortcut, quick report, emergency button

**Landmark Assistance**:
An optional text input on the Report Wizard Location step that lets the reporter describe nearby landmarks (e.g. "near Jollibee on Rizal Ave") to supplement map coordinates. It helps validators contextualize the location but is not a substitute for GPS/ pin coordinates.
_Avoid_: Address field, location notes

**Observable Indicators**:
Checkable options on the Category step (large flames, heavy smoke, explosions, spreading fast, structures threatened, people trapped, electrical fire, chemical/hazardous smell, other) that replace the old severity dropdown. These are what a civilian can see — not assessed severity — and guide validators in triage.
_Avoid_: Severity, risk level, assessment

**Report Receipt**:
The post-submit success screen styled as an official government acknowledgment — BFP branding, report summary, QR code, tracking token, timestamp. Designed to be screenshotted and feel authoritative. Users can track their report with the token; registering unlocks the full contributor dashboard.
_Avoid_: Success message, confirmation screen, thank-you page

**Civilian Report**:
A public signal submitted by a civilian about a possible fire or emergency. It is not an official BFP incident record.
_Avoid_: Incident, confirmed incident, fire incident

**Civilian Report Cluster**:
An area-level grouping of related civilian reports used to represent report pressure without exposing individual reports. One cluster has many civilian reports.
_Avoid_: Incident cluster, exact incident pin

**Public Fire Report Area**:
The public-facing name for a civilian report cluster shown on the root map. It communicates that people have reported activity in an area, not that BFP has confirmed an incident there.
_Avoid_: Confirmed incident, fire out state, operational incident

**Report Count Intensity**:
A public map signal based only on how many civilian reports are grouped in an area. It is not a severity, confidence, or validation status.
_Avoid_: Severity, risk level, validator priority

**Official Fire Incident**:
A BFP-managed incident record created through the internal workflow. It is distinct from civilian reports and should not be implied by public cluster map labels.
_Avoid_: Civilian report, public signal

**Community Safety Hub**:
The public `/community` page for safety guidance, announcements, informational events, and BFP station discovery. It is separate from the anonymous emergency-reporting flow at `/` and does not rank contributors.
_Avoid_: Public leaderboard, social forum

## Flagged Ambiguities

**"incident" on the public root map**:
Resolved as "public fire report area" for root-map copy. The map shows report clusters, not individual incidents or verified BFP incident records.

**"severity" on the public root map**:
Resolved as report count intensity only. Validator severity is internal and should not be reused for public map markers.

## Example Dialogue

Developer: "Should the homepage show current incidents nearby?"

Domain expert: "Show public fire report areas instead. Those are civilian report clusters, not confirmed incidents."

Developer: "Can marker color mean severity?"

Domain expert: "No. Use report count intensity only because validators may not have reviewed the cluster yet."
