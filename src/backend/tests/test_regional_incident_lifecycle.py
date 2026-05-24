from services.regional_incidents.policies import (
    VALIDATOR_DEFAULT_QUEUE_STATUSES,
    encoder_transition_target,
    validator_transition_target,
)


def test_encoder_lifecycle_transition_matrix():
    assert encoder_transition_target("DRAFT", "submit") == "PENDING"
    assert encoder_transition_target("REJECTED", "submit") == "PENDING"
    assert encoder_transition_target("PENDING", "unpend") == "DRAFT"
    assert encoder_transition_target("PENDING", "force_replace") == "PENDING"
    assert encoder_transition_target("VERIFIED", "submit") is None
    assert encoder_transition_target("PENDING", "delete") is None


def test_validator_lifecycle_transition_matrix_includes_compat_pending_statuses():
    assert VALIDATOR_DEFAULT_QUEUE_STATUSES == ("PENDING", "PENDING_VALIDATION")
    assert validator_transition_target("PENDING", "accept") == "VERIFIED"
    assert validator_transition_target("PENDING_VALIDATION", "accept") == "VERIFIED"
    assert validator_transition_target("PENDING", "reject") == "REJECTED"
    assert validator_transition_target("PENDING_VALIDATION", "pending") == "PENDING"
    assert validator_transition_target("VERIFIED", "reject") is None
    assert validator_transition_target("REJECTED", "accept") is None
