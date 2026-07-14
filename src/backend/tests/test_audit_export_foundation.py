from pathlib import Path

from utils.audit import AUDIT_SECURE_EXPORT


REPO_ROOT = Path(__file__).resolve().parents[2]


def test_secure_export_action_is_stable() -> None:
    assert AUDIT_SECURE_EXPORT == "AUDIT_SECURE_EXPORT"


def test_openbao_signer_policy_is_least_privilege() -> None:
    policy = (REPO_ROOT / "openbao" / "policies" / "wims-app.hcl").read_text()

    assert 'path "transit/sign/audit-export-signer"' in policy
    assert 'path "transit/verify/audit-export-signer"' in policy
    assert 'path "transit/keys/audit-export-signer"' in policy
    assert 'path "transit/delete/audit-export-signer"' not in policy
    assert 'path "transit/keys/audit-export-signer/rotate"' not in policy


def test_bootstrap_creates_non_exportable_ecdsa_signer() -> None:
    script = (REPO_ROOT / "openbao" / "init" / "bootstrap-openbao.sh").read_text()

    assert 'create_or_verify_signing_key "audit-export-signer"' in script
    assert "type=ecdsa-p256" in script
    assert "exportable=false" in script
    assert "allow_plaintext_backup=false" in script
