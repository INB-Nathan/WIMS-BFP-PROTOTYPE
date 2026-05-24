"""Regional incident lifecycle policy constants."""

VALIDATOR_ACTION_MAP: dict[str, str] = {
    "accept": "VERIFIED",
    "accept_replace": "VERIFIED",
    "pending": "PENDING",
    "reject": "REJECTED",
}

VALIDATOR_TARGET_STATUSES = frozenset(VALIDATOR_ACTION_MAP.values())
VALIDATOR_DEFAULT_QUEUE_STATUSES = ("PENDING", "PENDING_VALIDATION")

ENCODER_EDITABLE_STATUSES = ("DRAFT", "REJECTED")
ENCODER_SUBMITTABLE_STATUSES = ("DRAFT", "REJECTED")
ENCODER_DELETABLE_STATUSES = ("DRAFT", "REJECTED")
VALIDATOR_ARCHIVABLE_STATUSES = ("VERIFIED", "REJECTED", "REPLACED")

ENCODER_STATUS_TRANSITIONS = {
    ("DRAFT", "submit"): "PENDING",
    ("REJECTED", "submit"): "PENDING",
    ("PENDING", "unpend"): "DRAFT",
    ("PENDING", "force_replace"): "PENDING",
    ("DRAFT", "delete"): "DRAFT",
    ("REJECTED", "delete"): "REJECTED",
}

VALIDATOR_STATUS_TRANSITIONS = {
    ("PENDING", "accept"): "VERIFIED",
    ("PENDING_VALIDATION", "accept"): "VERIFIED",
    ("PENDING", "accept_replace"): "VERIFIED",
    ("PENDING_VALIDATION", "accept_replace"): "VERIFIED",
    ("PENDING", "pending"): "PENDING",
    ("PENDING_VALIDATION", "pending"): "PENDING",
    ("PENDING", "reject"): "REJECTED",
    ("PENDING_VALIDATION", "reject"): "REJECTED",
}


def encoder_transition_target(current_status: str, action: str) -> str | None:
    return ENCODER_STATUS_TRANSITIONS.get((current_status, action))


def validator_transition_target(current_status: str, action: str) -> str | None:
    return VALIDATOR_STATUS_TRANSITIONS.get((current_status, action))
