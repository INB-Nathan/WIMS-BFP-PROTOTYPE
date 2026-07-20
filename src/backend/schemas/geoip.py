"""Privacy-minimized coarse GeoIP evidence contracts."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class CoarseIpEvidence(BaseModel):
    """City/municipality-level evidence; never contains the source IP."""

    model_config = ConfigDict(frozen=True)

    available: Literal[True] = True
    city: str | None = None
    province: str | None = None
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy_m: int | None = Field(default=None, ge=0)
    provider: str
    lookup_at: datetime


class CoarseIpUnavailable(BaseModel):
    """Neutral result when coarse evidence cannot be resolved."""

    model_config = ConfigDict(frozen=True)

    available: Literal[False] = False
    reason: Literal[
        "database_unavailable",
        "lookup_unavailable",
        "coordinates_unavailable",
    ]


CoarseIpResult = CoarseIpEvidence | CoarseIpUnavailable
