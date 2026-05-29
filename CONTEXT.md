# WIMS-BFP Context

Domain language for WIMS-BFP civilian reporting and incident workflow. This glossary is implementation-free and exists to keep public-reporting, validation, and official incident terms distinct.

## Language

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
