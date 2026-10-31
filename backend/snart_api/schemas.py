"""Public API schemas shared by the frontend and service layer."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Category = Literal["dechets", "caniveau_bouche", "embouteillage", "indetermine"]
Vote = Literal["still_present", "resolved"]
ReportStatus = Literal["active", "stale", "resolved"]


class StructuredReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category: Category
    summary: str = Field(min_length=1, max_length=240)
    needs_review: bool = False
    provider: str = "demo_rules"
    model_id: str | None = None


class ConfirmationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, allow_inf_nan=False)

    user_id: str = Field(min_length=8, max_length=80)
    vote: Vote = "still_present"
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    accuracy_m: float | None = Field(default=None, ge=0, le=100_000)

    @model_validator(mode="after")
    def coordinates_are_paired(self) -> ConfirmationRequest:
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("Latitude et longitude doivent être fournies ensemble")
        return self


class ConfirmationFactors(BaseModel):
    nearby_confirmations: int
    remote_confirmations: int
    resolution_confirmations: int
    has_photo: bool
    freshness: str


class ReportRead(BaseModel):
    id: int
    category: Category
    summary: str
    description: str
    latitude: float | None
    longitude: float | None
    location_accuracy_m: float | None
    created_at: str
    observed_at: str
    last_confirmed_at: str | None
    status: ReportStatus
    confidence_percent: int
    confidence_factors: ConfirmationFactors
    structuring_mode: str
    model_id: str | None
    needs_review: bool
    has_photo: bool
    can_confirm: bool = True
