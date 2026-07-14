"""Auth API schemas — self-service registration and authentication contracts."""

from __future__ import annotations

import re

from pydantic import BaseModel, EmailStr, Field, field_validator


# Password strength: min 8 chars, at least one uppercase, one lowercase, one digit.
_PASSWORD_PATTERN = re.compile(r"^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$")

# Philippine mobile number: starts with 0, followed by 9, then 9 more digits.
_PH_CONTACT_PATTERN = re.compile(r"^09\d{9}$")


class CivilianRegisterRequest(BaseModel):
    """Request body for POST /api/auth/register — civilian self-service signup.

    All fields are required. The caller must provide a valid Turnstile token
    and explicitly consent to the Data Privacy Act acknowledgement.
    """

    email: EmailStr
    first_name: str = Field(..., min_length=1, max_length=100)
    last_name: str = Field(..., min_length=1, max_length=100)
    password: str = Field(..., min_length=8)
    contact_number: str = Field(..., min_length=11, max_length=11)
    dpa_consent: bool
    turnstile_token: str = Field(..., min_length=1)

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if not _PASSWORD_PATTERN.match(v):
            raise ValueError(
                "Password must be at least 8 characters, with uppercase, lowercase, and a digit"
            )
        return v

    @field_validator("contact_number")
    @classmethod
    def validate_contact_number(cls, v: str) -> str:
        if not _PH_CONTACT_PATTERN.match(v):
            raise ValueError(
                "Contact number must be a valid Philippine mobile number (09XXXXXXXXX)"
            )
        return v


class RegisterResponse(BaseModel):
    """Response body for POST /api/auth/register — civilian self-service signup.

    After the verify-first change, registration only creates a disabled
    Keycloak account and sends a verification email; the DB record is created
    later by /verify-registration. ``user_id`` is therefore optional/absent at
    this stage.
    """

    status: str
    message: str
    email: str
    user_id: str | None = None


class VerifyRegistrationRequest(BaseModel):
    """Request body for POST /api/auth/verify-registration."""

    email: str
    code: str


class VerifyRegistrationResponse(BaseModel):
    """Response body for POST /api/auth/verify-registration."""

    status: str
    message: str
