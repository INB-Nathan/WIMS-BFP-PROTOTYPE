import json
from pathlib import Path


REALM_PATH = Path(__file__).resolve().parents[3] / "keycloak" / "bfp-realm.json"


def _load_realm() -> dict:
    with REALM_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def _flow_by_alias(realm: dict, alias: str) -> dict:
    for flow in realm.get("authenticationFlows", []):
        if flow.get("alias") == alias:
            return flow
    raise AssertionError(f"Authentication flow not found: {alias}")


def _auth_config_by_alias(realm: dict, alias: str) -> dict:
    for cfg in realm.get("authenticatorConfig", []):
        if cfg.get("alias") == alias:
            return cfg
    raise AssertionError(f"Authenticator config not found: {alias}")


def test_otp_required_roles_are_configured():
    realm = _load_realm()
    browser_conditional_flow = _flow_by_alias(realm, "Browser - Conditional OTP")

    role_condition_configs = set()
    for execution in browser_conditional_flow.get("authenticationExecutions", []):
        if execution.get("authenticator") == "conditional-user-role":
            cfg_alias = execution.get("authenticatorConfig")
            if cfg_alias:
                role_condition_configs.add(cfg_alias)

    assert "otp-role-system-administrator" in role_condition_configs
    assert "otp-role-national-validator" in role_condition_configs

    admin_cfg = _auth_config_by_alias(realm, "otp-role-system-administrator")
    validator_cfg = _auth_config_by_alias(realm, "otp-role-national-validator")

    assert admin_cfg.get("config", {}).get("condUserRole") == "system_administrator"
    assert validator_cfg.get("config", {}).get("condUserRole") == "national_validator"


def test_otp_trusted_device_window_is_7_days():
    realm = _load_realm()
    otp_cfg = _auth_config_by_alias(realm, "otp-trusted-device")

    # Explicit 7-day trusted-device window
    assert otp_cfg.get("config", {}).get("otpRememberDeviceFor") == "7d"


def test_non_target_roles_not_forced_to_otp():
    realm = _load_realm()
    target_roles = set()

    for alias in ("otp-role-system-administrator", "otp-role-national-validator"):
        cfg = _auth_config_by_alias(realm, alias)
        target_roles.add(cfg.get("config", {}).get("condUserRole"))

    assert "regional_encoder" not in target_roles
    assert "national_analyst" not in target_roles
    assert "citizen" not in target_roles
