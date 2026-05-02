# Pull Request - M4 Incident Workflow Checkpoint

### Title
Mark the currently implemented M4 incident workflow slices and document the remaining gaps

### Summary
This PR updates the M4 incident workflow milestone to reflect the parts that are currently in place and to keep the intentionally deferred work visible.

The current implementation covers the core encoder and validator path:
- Regional encoders can create incidents with PostGIS coordinates.
- Regional encoders can edit their own non-verified incidents.
- Draft incidents can be saved, resumed, and kept out of the validator queue.
- National validators can review incidents and apply approve or reject decisions with a reason.

The PR does not claim the full M4 milestone is finished. Several items remain intentionally open and are listed below so they stay visible in review.

### What Is Working Now

| M4 Item | Status | Notes |
|---|---|---|
| M4-A Incident creation with PostGIS location | Met | Create flow exists and uses longitude/latitude to build the incident geometry. The incident also shows up in the regional incident list. |
| M4-B Incident edit for own non-verified incidents | Mostly met | Own incidents can be edited while they are still non-finalized. Verified incidents and incidents owned by other users are blocked. |
| M4-E Draft save | Met | Drafts can be saved and resumed, and they do not surface in the validator queue. |
| M4-F Validator verification queue | Mostly met | Validators can approve or reject incidents with a reason. The queue is available cross-region on the backend. |

### What Is Still Open On Purpose

| Item | Current State |
|------|---|
| Edit audit trail entry | Not implemented yet |
| Duplicate detection on import | Not implemented yet |
| Diff view | Not implemented yet |
| Bulk approve | Not implemented yet |
| Validator audit trail viewer | Not implemented yet |
| Regional RBAC enforcement | Not implemented yet |
| AFOR accuracy updates | Still needs work |
| Civilian and encoder incident merging | Still unresolved |
| Wildland workflow | Untouched |

### Bugs / Gaps To Call Out In Review

1. Others fields still need polishing in the output.
2. No regional RBAC yet, so encoders can still encode incidents outside their assigned region.
3. Duplicate detection is still missing.
4. Audit trail support is incomplete and the validator audit viewer does not exist yet.
5. Bulk approve is missing.
6. Civilian submissions and encoder submissions still need a proper merged coexistence model.
7. There is still no M4-I validator audit trail viewer.
8. There is no diff view.
9. AFOR import still needs accuracy improvements.
10. Wildland handling is still untouched.

### Additional Issues I Noticed

- The validator queue UI copy says incidents are in the assigned region, but the backend queue is actually cross-region for encoder-submitted incidents.
- Incident creation currently falls back to the encoder's assigned region when `region_id` is omitted, but it does not enforce that a supplied `region_id` matches the assigned region.
- The backend already has an incident verification history helper, but it is only used for submit and validator decision paths. Create, edit, and draft actions still do not write history rows.
- The validator UI exposes a pending/revert action in addition to approve and reject, which is outside the simplified wording of the milestone.
- Public civilian submissions use a separate DMZ path and are excluded from the validator queue because they do not carry an encoder ID.
- The milestone document and the runtime code use slightly different status terminology in places (`PENDING_REVIEW` versus `PENDING` / `PENDING_VALIDATION`), so that should be kept aligned in follow-up work.

### PR Intent

This is a checkpoint PR, not a claim that M4 is complete. It documents the implemented slice set, keeps the remaining work visible, and separates intentionally deferred items from gaps that were discovered during review.