# Deferred — Registered Device Enrollment for Insider Threat Controls

The device-token abuse controls design replaces IP-based blocking with server-issued signed device tokens to avoid CGNAT/shared-IP collateral damage. For insider threats (BFP staff), the initial implementation relies on the existing authenticated session (`user_id` + role + device token) rather than requiring per-device enrollment.

## Status

Deferred — documented for future reference when workflow friction is addressed.

## Context

During the device-token design grill (2026-07-06), the team identified that insider threats from BFP personnel would benefit from tighter device-level controls: registered devices tied to an authenticated user, per-device access policies, and audit trails per workstation.

However, the registered device enrollment flow requires:
- A device registration UI (enroll/approve/revoke)
- Backend device management API (CRUD + session binding)
- Re-auth or step-up authentication on unrecognized devices
- Admin console for device oversight

This friction is incompatible with the current session model where BFP users authenticate via Keycloak SSO and can use any workstation. Implementing enrollment would disrupt the existing login flow without proportional security gain at this stage.

## Decision

For the initial device-token abuse controls implementation:

- **Insider threats** use the existing authenticated session (`user_id` + role) combined with the device token for correlation and audit.
- No device enrollment UI, no per-device access policies, no workstation auditing.
- The `device_token_hash` is stored alongside `user_id` in security logs and blocklist entries for forensic correlation.

## Future considerations

When the friction is acceptable, a registered device enrollment layer could:

- Require BFP staff to enroll personal workstations via a one-time code or QR scan.
- Trigger step-up authentication (TOTP) from unrecognized devices.
- Allow admins to remotely revoke a device's access.
- Surface "devices per user" in the admin security dashboard alongside the blocked-devices panel.
