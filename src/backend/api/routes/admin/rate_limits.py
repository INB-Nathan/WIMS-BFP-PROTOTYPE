"""System Admin API — dynamic rate-limit configuration routes."""

import os
import time

import redis
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from auth import get_system_admin
from auth import get_db_with_rls
from utils.audit import log_system_audit

router = APIRouter()

# Legacy admin/API tier label retained for compatibility. The historical
# "login" tier now represents the auth callback flow guarded by main.py.
RATE_LIMIT_CONFIG_KEY = "rate_limit_config:login"
RATE_LIMIT_DEFAULTS = {"window_seconds": 900, "threshold": 5}


class RateLimitUpdate(BaseModel):
    tier: str
    limit: int
    window: int

    @field_validator("tier")
    @classmethod
    def tier_must_be_known(cls, v: str) -> str:
        if v not in ("login",):
            raise ValueError("Unknown tier. Valid tiers: login")
        return v

    @field_validator("limit")
    @classmethod
    def limit_must_be_positive(cls, v: int) -> int:
        if v < 1:
            raise ValueError("limit must be >= 1")
        return v

    @field_validator("window")
    @classmethod
    def window_must_be_positive(cls, v: int) -> int:
        if v < 1:
            raise ValueError("window must be >= 1")
        return v


@router.get("/rate-limits")
def get_rate_limits(
    current_user: dict = Depends(get_system_admin),
):
    """Return auth-flow rate limit config using the legacy ``login`` tier label."""
    r = redis.from_url(os.getenv("REDIS_URL", "redis://redis:6379/0"), decode_responses=True)
    try:
        config = r.hgetall(RATE_LIMIT_CONFIG_KEY)
        window = int(config.get("window_seconds", RATE_LIMIT_DEFAULTS["window_seconds"]))
        threshold = int(config.get("threshold", RATE_LIMIT_DEFAULTS["threshold"]))
        updated_at = config.get("updated_at")
    except Exception:
        window = RATE_LIMIT_DEFAULTS["window_seconds"]
        threshold = RATE_LIMIT_DEFAULTS["threshold"]
        updated_at = None

    return {
        "tier": "login",
        "login_window_seconds": window,
        "login_threshold": threshold,
        "updated_at": updated_at,
    }


@router.patch("/rate-limits")
def update_rate_limits(
    body: RateLimitUpdate,
    request: Request,
    current_user: dict = Depends(get_system_admin),
    db: Session = Depends(get_db_with_rls),
):
    """Update rate limit config for the legacy ``login`` auth-flow tier."""
    config_key = f"rate_limit_config:{body.tier}"
    updated_at = str(time.time())

    r = redis.from_url(os.getenv("REDIS_URL", "redis://redis:6379/0"), decode_responses=True)
    try:
        r.hset(
            config_key,
            mapping={
                "window_seconds": body.window,
                "threshold": body.limit,
                "updated_at": updated_at,
            },
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Redis write failed: {e}")

    log_system_audit(
        db=db,
        user_id=current_user["user_id"],
        action_type="RATE_LIMIT_UPDATED",
        table_affected="redis",
        record_id=None,
        request=request,
    )
    db.commit()

    return {
        "tier": body.tier,
        "login_window_seconds": body.window,
        "login_threshold": body.limit,
        "updated_at": updated_at,
    }
