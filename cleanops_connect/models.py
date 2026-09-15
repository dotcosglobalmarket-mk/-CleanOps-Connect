from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(slots=True)
class User:
    id: str
    email: str
    role: str
    postcode: str
    created_at: datetime = field(default_factory=utc_now)


@dataclass(slots=True)
class CleanerProfile:
    id: str
    user_id: str
    business_name: str
    service_type_codes: list[str]
    coverage_postcodes: list[str] = field(default_factory=list)
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    radius_miles: float = 15.0
    is_onboarded: bool = False
    insurance_opt_in: bool = False
    compliance_checks: dict[str, bool] = field(default_factory=dict)


@dataclass(slots=True)
class ServiceType:
    code: str
    name: str
    category: str
    insurance_required: bool = False


@dataclass(slots=True)
class Job:
    id: str
    customer_name: str
    postcode: str
    service_type_code: str
    created_at: datetime = field(default_factory=utc_now)
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    lead_score: Optional[int] = None
    status: str = "pending"
    metadata: dict[str, object] = field(default_factory=dict)


@dataclass(slots=True)
class JobOffer:
    id: str
    job_id: str
    cleaner_profile_id: str
    offered_at: datetime = field(default_factory=utc_now)
    status: str = "pending"


@dataclass(slots=True)
class Subscription:
    id: str
    cleaner_profile_id: str
    plan_name: str
    amount_gbp: float
    status: str = "trial"
    insurance_add_on: bool = False
    next_billing_date: Optional[str] = None
